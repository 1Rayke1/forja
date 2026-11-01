#!/usr/bin/env python3
"""
FORJA — retargeting das animações de mocap para o rig de 16 ossos.

O pacote `Mocap_Pack_06_Fitness_and_Workout` (release `assets-3d-v2`) entrega
cada exercício em três rigs de origem diferentes:

  Rokoko_Default  61 ossos (Hips, Spine1..4, Neck, Head, Right/LeftArm, ...)
  UE5             79 ossos (pelvis, spine_01..05, clavicle_l, upperarm_l, ...)
  iClone          52 ossos (mixamorig:Hips, mixamorig:LeftArm, ...)

Nenhum deles é o rig dos personagens do FORJA (16 ossos: hips, spine, neck,
armL/R, elbowL/R, handL/R, legL/R, kneeL/R, footL/R, prop). Aplicar o clipe
direto no esqueleto de destino produziria poses erradas — é exatamente o caso
que o requisito proíbe. Este script faz o retargeting de verdade:

  1. importa o FBX e localiza a armadura de origem e a ação principal;
  2. para cada quadro, calcula a rotação mundial que a animação aplica em cada
     osso de origem (pose × repouso⁻¹) e a projeta no osso equivalente do rig
     de destino (delta × repouso do destino), processando a hierarquia de pai
     para filho;
  3. transporta a translação do quadril, com escala pela razão de altura entre
     origem e destino;
  4. grava os quadros como uma ação nova no rig de destino e exporta em GLB.

Uso:
    blender -b --factory-startup -P tools/blender/retarget-mocap.py -- \
        <exercises.glb> <fbx> <id-do-clipe> <saida.glb> [quadros] [deslocamento]

`quadros` = quantos quadros exportar (24 fps, padrão 192 = 8 s).
`deslocamento` = quadro inicial na origem (padrão 0).
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 4:
    print("uso: -- <exercises.glb> <fbx> <id> <saida.glb> [quadros] [deslocamento]")
    sys.exit(2)

GLB, FBX, CLIP_ID, SAIDA = args[0], args[1], args[2], args[3]
QUADROS = int(args[4]) if len(args) > 4 else 192
DESLOC = int(args[5]) if len(args) > 5 else 0
FPS_ALVO = 24

# origem → destino. Listas em ordem de preferência: vale o primeiro nome que
# existir no esqueleto de origem.
MAPA = {
    "hips":   ["Hips", "mixamorig:Hips", "pelvis", "root"],
    "spine":  ["Spine2", "Spine1", "Spine", "mixamorig:Spine1", "mixamorig:Spine",
               "spine_03", "spine_02"],
    "neck":   ["Neck", "mixamorig:Neck", "neck_01", "Head", "mixamorig:Head", "head"],
    "armL":   ["LeftArm", "mixamorig:LeftArm", "upperarm_l", "LeftShoulder"],
    "elbowL": ["LeftForeArm", "mixamorig:LeftForeArm", "lowerarm_l"],
    "handL":  ["LeftHand", "mixamorig:LeftHand", "hand_l"],
    "armR":   ["RightArm", "mixamorig:RightArm", "upperarm_r", "RightShoulder"],
    "elbowR": ["RightForeArm", "mixamorig:RightForeArm", "lowerarm_r"],
    "handR":  ["RightHand", "mixamorig:RightHand", "hand_r"],
    "legL":   ["LeftThigh", "LeftUpLeg", "mixamorig:LeftUpLeg", "thigh_l"],
    "kneeL":  ["LeftShin", "LeftLeg", "mixamorig:LeftLeg", "calf_l"],
    "footL":  ["LeftFoot", "mixamorig:LeftFoot", "foot_l"],
    "legR":   ["RightThigh", "RightUpLeg", "mixamorig:RightUpLeg", "thigh_r"],
    "kneeR":  ["RightShin", "RightLeg", "mixamorig:RightLeg", "calf_r"],
    "footR":  ["RightFoot", "mixamorig:RightFoot", "foot_r"],
}
ORDEM = ["hips", "spine", "neck", "armL", "elbowL", "handL", "armR", "elbowR",
         "handR", "legL", "kneeL", "footL", "legR", "kneeR", "footR"]


def preparar_destino():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    alvo = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    alvo.name = "rig-destino"
    # a malha do manequim FICA: é ela que dá a evidência visual do retargeting
    for ob in list(bpy.data.objects):
        if ob.type == "MESH" and len(ob.data.vertices) < 1000:
            bpy.data.objects.remove(ob, do_unlink=True)
    for acao in list(bpy.data.actions):
        bpy.data.actions.remove(acao, do_unlink=True)
    alvo.animation_data_clear()
    for pb in alvo.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix()
    return alvo


def importar_origem():
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=FBX, ignore_leaf_bones=False)
    novos = [o for o in bpy.data.objects if o not in antes]
    origem = next((o for o in novos if o.type == "ARMATURE"), None)
    if origem is None:
        raise RuntimeError("FBX sem armadura")
    # remove as malhas da origem: só a animação interessa
    for ob in novos:
        if ob.type == "MESH":
            bpy.data.objects.remove(ob, do_unlink=True)
    # a ação principal é a que tem mais curvas (as outras são ossos "tip")
    origem.animation_data_create()
    if origem.animation_data.action is None:
        candidatas = [a for a in bpy.data.actions if a.users >= 0]
        if candidatas:
            origem.animation_data.action = max(candidatas, key=lambda a: len(a.fcurves))
    return origem


def nomes_disponiveis(arm):
    return {b.name for b in arm.data.bones}


def resolver_mapa(origem):
    disponiveis = nomes_disponiveis(origem)
    mapa = {}
    for destino, candidatos in MAPA.items():
        for nome in candidatos:
            if nome in disponiveis:
                mapa[destino] = nome
                break
    return mapa


def altura_do_quadril(arm):
    """Altura do quadril em espaço de MUNDO (já com a escala do objeto)."""
    bone = arm.data.bones.get("Hips") or arm.data.bones.get("pelvis") or \
        next((b for b in arm.data.bones if b.parent is None), None)
    if not bone:
        return 1.0
    return (arm.matrix_world @ bone.matrix_local).to_translation().z


def retargetar(alvo, origem, mapa, quadros, deslocamento):
    """
    Transporta o movimento da armadura de origem para a de destino.

    Toda a matemática é feita em espaço de mundo (matrix_world × pose), porque
    os dois importadores (FBX e glTF) colocam a conversão de eixo na rotação do
    objeto. Misturar espaço de objeto de rigs diferentes produz personagem
    deitado — foi exatamente o defeito detectado no primeiro teste visual.
    """
    cena = bpy.context.scene
    # o FPS de ORIGEM é o do FBX (60). Depois da leitura, a cena passa a 24 fps
    # para o exportador gravar os tempos no ritmo certo.
    fps_origem = cena.render.fps if cena.render.fps > 1 else 60
    cena.render.fps = FPS_ALVO
    cena.render.fps_base = 1.0

    acao_origem = origem.animation_data.action
    inicio_origem = acao_origem.frame_range[0]

    z_origem = altura_do_quadril(origem)
    z_destino = altura_do_quadril(alvo)
    escala = (z_destino / z_origem) if z_origem > 0.01 else 1.0

    acao = bpy.data.actions.new("retarget-" + CLIP_ID)
    alvo.animation_data_create()
    alvo.animation_data.action = acao

    for pb in alvo.pose.bones:
        pb.matrix_basis = Matrix()

    Mw_src = origem.matrix_world.copy()
    Mw_tgt = alvo.matrix_world.copy()
    Mw_tgt_inv = Mw_tgt.inverted()

    rest_src_world = {b.name: Mw_src @ b.matrix_local for b in origem.data.bones}
    rest_tgt_world = {b.name: Mw_tgt @ b.matrix_local for b in alvo.data.bones}

    for indice in range(quadros):
        quadro_destino = indice + 1
        t = deslocamento + (indice / float(FPS_ALVO)) * fps_origem
        cena.frame_set(int(round(inicio_origem + t)))
        bpy.context.view_layer.update()

        # 1) quadril: translação (deslocamento em mundo, escalado pela altura)
        if "hips" in mapa:
            src_pb = origem.pose.bones[mapa["hips"]]
            pose_hips_world = Mw_src @ src_pb.matrix
            delta = pose_hips_world.to_translation() - rest_src_world[mapa["hips"]].to_translation()
            delta *= escala
            base = rest_tgt_world["hips"]
            destino = base.copy()
            # a origem do pacote olha para -Y e o destino para +Y: o eixo
            # frontal é invertido para o personagem não andar de costas
            destino.translation = base.to_translation() + Vector((-delta.x, delta.y, delta.z))
            alvo.pose.bones["hips"].matrix = Mw_tgt_inv @ destino
            bpy.context.view_layer.update()

        # 2) rotações, pai antes de filho
        for destino_nome in ORDEM:
            if destino_nome not in mapa:
                continue
            src_nome = mapa[destino_nome]
            src_pb = origem.pose.bones[src_nome]
            rot_src_mundo = (Mw_src @ src_pb.matrix).to_quaternion()
            dir_src = (rot_src_mundo @ Vector((0.0, 1.0, 0.0))).normalized()
            dir_src = Vector((-dir_src.x, dir_src.y, dir_src.z)).normalized()

            rot_repouso_destino = rest_tgt_world[destino_nome].to_quaternion()
            # O eixo "membro" não é o mesmo do osso nos dois rigs. No rig de
            # origem o membro segue +Y do osso; no rig do FORJA os braços e as
            # pernas se desenham no sentido -Y (os ossos apontam para cima). Usar
            # +Y nos dois deixa o personagem de cabeça para baixo — foi o que o
            # render de validação mostrou.
            eixo = Vector((0.0, -1.0, 0.0)) if destino_nome in (
                "armL", "elbowL", "handL", "armR", "elbowR", "handR",
                "legL", "kneeL", "footL", "legR", "kneeR", "footR",
            ) else Vector((0.0, 1.0, 0.0))
            dir_repouso_destino = (rot_repouso_destino @ eixo).normalized()

            giro = dir_repouso_destino.rotation_difference(dir_src)
            alvo_rot_mundo = giro @ rot_repouso_destino

            pb = alvo.pose.bones[destino_nome]
            atual = Mw_tgt @ pb.matrix
            matriz = alvo_rot_mundo.to_matrix().to_4x4()
            matriz.translation = atual.to_translation()
            pb.matrix = Mw_tgt_inv @ matriz
            bpy.context.view_layer.update()

        # 3) chaves
        for destino_nome in ORDEM:
            alvo.pose.bones[destino_nome].keyframe_insert(
                "rotation_quaternion", frame=quadro_destino, group=destino_nome)
        alvo.pose.bones["hips"].keyframe_insert("location", frame=quadro_destino, group="hips")

    cena.frame_start = 1
    cena.frame_end = quadros
    return acao, mapa, escala


def exportar(alvo, acao, caminho):
    cena = bpy.context.scene
    alvo.animation_data.action = acao
    # O importador do FBX deixa a cena com o frame_end da captura original
    # (milhares de quadros). O exportador glTF amostra TODOS os objetos até esse
    # frame, e o clipe saía com duração de 115 s em vez de 6 s. A faixa é fixada
    # na extensão real da ação antes de exportar.
    cena.render.fps = FPS_ALVO
    cena.render.fps_base = 1.0
    cena.frame_start = 1
    cena.frame_end = max(1, int(round(acao.frame_range[1])))
    print(f"[retarget] faixa de exportação: {cena.frame_start}..{cena.frame_end} "
          f"a {FPS_ALVO} fps")
    curvas = len(acao.fcurves)
    total_chaves = sum(len(fc.keyframe_points) for fc in acao.fcurves)
    extensao = acao.frame_range
    print(f"[retarget] ação {acao.name}: {curvas} curvas, {total_chaves} chaves, "
          f"faixa {extensao[0]:.0f}..{extensao[1]:.0f}")
    for quadro in (1, max(1, cena.frame_end // 2), cena.frame_end):
        cena.frame_set(quadro)
        bpy.context.view_layer.update()
        amostra = alvo.pose.bones["elbowL"].matrix_basis.to_quaternion()
        print(f"[retarget] elbowL em {quadro}: {[round(v, 3) for v in amostra]}")
    # A armadura de origem não faz parte do clipe publicado.
    for ob in list(bpy.data.objects):
        if ob is not alvo:
            bpy.data.objects.remove(ob, do_unlink=True)
    # Nenhuma ação que não seja a do clipe pode sobrar: o exportador glTF leva
    # em conta o range das ações existentes (a captura original tem milhares de
    # quadros) e o clipe saía com 115 s em vez de 6 s.
    for outra in list(bpy.data.actions):
        if outra is not acao:
            bpy.data.actions.remove(outra, do_unlink=True)
    print("[retarget] ações no arquivo:", [(a.name, tuple(round(v) for v in a.frame_range))
                                           for a in bpy.data.actions])
    for ob in bpy.data.objects:
        ob.select_set(ob is alvo)
    bpy.context.view_layer.objects.active = alvo
    print(f"[retarget] fps {cena.render.fps}/{cena.render.fps_base} "
          f"faixa {cena.frame_start}..{cena.frame_end}")
    bpy.ops.export_scene.gltf(
        filepath=caminho,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_bake_animation=False,
        export_frame_range=True,
        export_optimize_animation_size=True,
        export_skins=False,
        export_materials="NONE",
        export_cameras=False,
        export_lights=False,
    )


alvo = preparar_destino()
origem = importar_origem()
nome_origem = origem.name
ossos_origem = len(origem.data.bones)
mapa = resolver_mapa(origem)
print("[retarget] origem:", origem.name, "mapeados:", json.dumps(mapa))
acao, mapa, escala = retargetar(alvo, origem, mapa, QUADROS, DESLOC)
# A cena é salva ANTES da exportação: o exportador glTF mexe temporariamente na
# transformação dos objetos e não restaura quando há duas armaduras na cena.
if os.environ.get("FORJA_RETARGET_BLEND"):
    bpy.ops.wm.save_as_mainfile(filepath=os.environ["FORJA_RETARGET_BLEND"])
    print("[retarget] cena salva em", os.environ["FORJA_RETARGET_BLEND"])

exportar(alvo, acao, SAIDA)
print("[retarget]", json.dumps({
    "id": CLIP_ID,
    "origem": os.path.basename(FBX),
    "rig_origem": nome_origem,
    "ossos_origem": ossos_origem,
    "rig_destino": alvo.name,
    "ossos_destino": len(alvo.data.bones),
    "mapeados": len(mapa),
    "escala": round(escala, 4),
    "quadros": QUADROS,
    "fps": FPS_ALVO,
    "duracao_s": round(QUADROS / FPS_ALVO, 2),
    "bytes": os.path.getsize(SAIDA),
    "arquivo": os.path.basename(SAIDA),
}, ensure_ascii=False))
