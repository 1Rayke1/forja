#!/usr/bin/env python3
"""
FORJA — exportador de clipes de animação (um arquivo GLB por exercício).

Entrada: `tools/fontes-3d/exercises.glb` (manequim MIT do DeskBreak, rig de 16
ossos, 435 ações de 24 fps).

Cada ação é exportada isolada em `assets/3d/animacoes/<id>.glb`, sem malha e sem
textura: o arquivo contém só a armadura e o clipe, o que mantém cada download na
casa das dezenas de KB e permite ao app carregar apenas a animação do exercício
atual (requisito de desempenho no Android).

O exportador do Blender joga TODAS as ações do arquivo dentro de uma única
animação quando elas vivem no mesmo blend. Por isso o script separa as ações em
um blend próprio e abre a cena base limpa antes de cada exportação — foi a
única forma encontrada de garantir 1 arquivo = 1 animação.

Uso:
    blender -b --factory-startup -P tools/blender/exportar-animacoes.py -- \
        <exercises.glb> <diretorio-de-saida> <lista.json> [<dir-de-trabalho>]

`lista.json`: [{"id": "cal-flexao-3d", "acao": "biceps-curl_rig"}, ...]
Saída: <id>.glb por item + <saida>/clipes.json com duração e quadros medidos.
"""
import json
import os
import sys

import bpy

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 3:
    print("uso: -- <exercises.glb> <saida> <lista.json> [<dir-de-trabalho>]")
    sys.exit(2)
GLB, OUT_DIR, LISTA = args[0], args[1], args[2]
WORK = args[3] if len(args) > 3 else os.path.join(OUT_DIR, ".trabalho")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

with open(LISTA, encoding="utf-8") as fh:
    itens = json.load(fh)

# ---------------------------------------------------------------- preparação
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
arm.name = "rig"
arm.data.name = "rig"
for ob in list(bpy.data.objects):
    if ob.type != "ARMATURE":
        bpy.data.objects.remove(ob, do_unlink=True)

acoes = {a.name: a for a in bpy.data.actions}
bpy.context.scene.render.fps = 24
bpy.context.scene.render.fps_base = 1.0

# Todas as ações num blend separado; a cena base fica sem nenhuma.
blend_acoes = os.path.join(WORK, "acoes.blend")
arm.animation_data_clear()
bpy.data.libraries.write(blend_acoes, set(acoes.values()), fake_user=True)

for nome in list(acoes):
    bpy.data.actions.remove(acoes[nome], do_unlink=True)
blend_base = os.path.join(WORK, "base.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_base)
print("[clipe] base e ações preparadas:", len(acoes), "ações")


def abrir_base_com(acao_nome):
    bpy.ops.wm.open_mainfile(filepath=blend_base)
    with bpy.data.libraries.load(blend_acoes, link=False) as (origem, destino):
        if acao_nome not in origem.actions:
            return None
        destino.actions = [acao_nome]
    acao = destino.actions[0]
    braco = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    braco.animation_data_create()
    braco.animation_data.action = acao
    return braco, acao


saida = []
for item in itens:
    resultado = abrir_base_com(item["acao"])
    if resultado is None:
        print("[clipe] AUSENTE", item["acao"])
        continue
    braco, acao = resultado
    inicio, fim = acao.frame_range
    cena = bpy.context.scene
    cena.render.fps = 24
    cena.frame_start = max(1, int(round(inicio)))
    cena.frame_end = max(cena.frame_start + 1, int(round(fim)))

    destino_glb = os.path.join(OUT_DIR, item["id"] + ".glb")
    for ob in bpy.data.objects:
        ob.select_set(ob is braco)
    bpy.context.view_layer.objects.active = braco
    bpy.ops.export_scene.gltf(
        filepath=destino_glb,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_current_frame=False,
        export_skins=False,
        export_materials="NONE",
        export_cameras=False,
        export_lights=False,
    )

    quadros = int(round(fim - inicio))
    saida.append({
        "id": item["id"],
        "acao": item["acao"],
        "arquivo": item["id"] + ".glb",
        "bytes": os.path.getsize(destino_glb),
        "quadros": quadros,
        "fps": 24,
        "duracao_s": round(quadros / 24.0, 2),
        "ossos": len(braco.data.bones),
    })
    print("[clipe]", json.dumps(saida[-1], ensure_ascii=False))

with open(os.path.join(OUT_DIR, "clipes.json"), "w", encoding="utf-8") as fh:
    json.dump(saida, fh, ensure_ascii=False, indent=2)
print("[clipe] total", len(saida))
