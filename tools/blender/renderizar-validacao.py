#!/usr/bin/env python3
"""
FORJA — render de validação visual dos personagens e das animações.

Renderiza (Cycles CPU, sem GPU) uma imagem por chamada:

    blender -b --factory-startup -P tools/blender/renderizar-validacao.py -- \
        <personagem.glb> <saida.png> [animacao.glb] [quadro] [fps]

Sem `animacao.glb`, renderiza a pose de repouso. Com ele, aplica a animação
do arquivo e renderiza o quadro pedido (padrão: 40% da duração).

É a evidência visual de que o movimento é o esperado — não um nome de arquivo.
"""
import json
import os
import sys

import bpy

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 2:
    print("uso: -- <personagem.glb> <saida.png> [animacao.glb] [quadro] [fps]")
    sys.exit(2)

personagem, saida = args[0], args[1]
animacao = args[2] if len(args) > 2 and args[2] not in ("", "-") else None
quadro = float(args[3]) if len(args) > 3 else None
fps = int(args[4]) if len(args) > 4 else 24

if personagem.lower().endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=personagem)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=personagem)
personagem_objetos = list(bpy.data.objects)

if animacao and not personagem.lower().endswith(".blend"):
    bpy.ops.import_scene.gltf(filepath=animacao)
    arm_char = next(o for o in personagem_objetos if o.type == "ARMATURE")

    # O importador do Blender cria uma ação por nó animado; para renderizar,
    # todas as curvas são fundidas em uma única ação.
    merged = bpy.data.actions.new("clipe-render")
    ja_copiadas = set()
    for acao_importada in list(bpy.data.actions):
        if acao_importada is merged:
            continue
        for curva in acao_importada.fcurves:
            chave = (curva.data_path, curva.array_index)
            if chave in ja_copiadas:
                continue
            ja_copiadas.add(chave)
            nova = merged.fcurves.new(curva.data_path, index=curva.array_index,
                                      action_group=curva.group.name if curva.group else "")
            nova.keyframe_points.add(len(curva.keyframe_points))
            for i, kp in enumerate(curva.keyframe_points):
                novo_ponto = nova.keyframe_points[i]
                novo_ponto.co = kp.co
                novo_ponto.interpolation = kp.interpolation
            nova.update()
    for ob in [o for o in bpy.data.objects if o not in personagem_objetos]:
        bpy.data.objects.remove(ob, do_unlink=True)

    arm_char.animation_data_create()
    arm_char.animation_data.action = merged
    print("[render] clipe aplicado:", len(merged.fcurves), "curvas")

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.resolution_x = 400
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False

if quadro is not None:
    scene.frame_start = 1
    scene.frame_end = max(2, int(quadro) + 1)
    scene.frame_set(int(quadro))

# mundo e luzes
mundo = bpy.data.worlds.new("mundo")
mundo.use_nodes = True
mundo.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.07, 0.06, 1)
mundo.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = mundo

luz = bpy.data.objects.new("sol", bpy.data.lights.new("sol", type="SUN"))
luz.data.energy = 4.0
luz.rotation_euler = (0.9, 0.2, 0.7)
scene.collection.objects.link(luz)

preenchimento = bpy.data.objects.new("luz-fria", bpy.data.lights.new("luz-fria", type="AREA"))
preenchimento.data.energy = 120
preenchimento.data.size = 3
preenchimento.location = (-2.2, -2.4, 2.0)
preenchimento.rotation_euler = (1.0, 0, -0.8)
scene.collection.objects.link(preenchimento)

# câmera de corpo inteiro
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (0.35, -3.9, 1.35)
cam.rotation_euler = (1.50, 0.0, 0.09)
scene.collection.objects.link(cam)
scene.camera = cam

# piso neutro
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
piso = bpy.context.active_object
material_piso = bpy.data.materials.new("piso")
material_piso.use_nodes = True
material_piso.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.10, 0.11, 0.10, 1)
piso.data.materials.append(material_piso)

scene.render.filepath = saida
bpy.ops.render.render(write_still=True)
print("[render]", json.dumps({"saida": saida, "bytes": os.path.getsize(saida), "quadro": quadro}))
