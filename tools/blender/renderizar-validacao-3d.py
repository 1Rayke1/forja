"""
FORJA — render de validação dos personagens 3D.

Abre o GLB do personagem e o GLB de um clipe **exportados para o app** (os mesmos
arquivos que o navegador baixa), aplica o clipe no esqueleto do personagem e
renderiza quadros com Cycles (CPU), sem GPU. Serve como evidência visual de que:

  - o GLB do personagem abre e tem malha com skin;
  - o clipe casa com os nomes de ossos do personagem e move o boneco;
  - o mesmo clipe pode ser aplicado ao masculino e ao feminino (rig único).

Uso:
  blender --background --factory-startup --python tools/blender/renderizar-validacao-3d.py -- \
      <personagem.glb> <clipe.glb> <saida_dir> <nome> [--video] [--amostras N]

Saída: <saida_dir>/<nome>-01.png, -02.png, -03.png (stills em 15/45/75% do clipe)
       ou <saida_dir>/<nome>.mp4 quando --video é passado.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 4:
    print("uso: -- <personagem.glb> <clipe.glb> <saida_dir> <nome> [--video] [--amostras N]")
    sys.exit(2)

PERSONAGEM, CLIPE, SAIDA, NOME = args[0], args[1], args[2], args[3]
VIDEO = "--video" in args
AMOSTRAS = 24
if "--amostras" in args:
    AMOSTRAS = int(args[args.index("--amostras") + 1])

os.makedirs(SAIDA, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)


def importar(caminho):
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=caminho)
    return [ob for ob in bpy.data.objects if ob not in antes]


# ---------------------------------------------------------------- personagem
novos = importar(PERSONAGEM)
armaduras = [ob for ob in novos if ob.type == "ARMATURE"]
if not armaduras:
    print("[render] ERRO: o GLB do personagem não tem armadura")
    sys.exit(3)
personagem = armaduras[0]
malhas = [ob for ob in novos if ob.type == "MESH"]

# ---------------------------------------------------------------- clipe
novos_clipe = importar(CLIPE)
armaduras_clipe = [ob for ob in novos_clipe if ob.type == "ARMATURE"]
if not armaduras_clipe:
    print("[render] ERRO: o GLB do clipe não tem armadura")
    sys.exit(3)
origem = armaduras_clipe[0]
acao = origem.animation_data.action if origem.animation_data else None
if acao is None:
    acoes = [a for a in bpy.data.actions]
    acao = acoes[0] if acoes else None
if acao is None:
    print("[render] ERRO: o GLB do clipe não tem ação")
    sys.exit(3)

# O clipe é aplicado ao esqueleto do personagem: os nomes de ossos são os mesmos.
personagem.animation_data_create()
personagem.animation_data.action = acao
if hasattr(acao, "slots") and len(acao.slots) and hasattr(personagem.animation_data, "action_slot"):
    try:
        personagem.animation_data.action_slot = acao.slots[0]
    except Exception:
        pass

# Só o personagem fica na cena.
for ob in novos_clipe:
    bpy.data.objects.remove(ob, do_unlink=True)

quadros = acao.frame_range
inicio, fim = int(round(quadros[0])), int(round(quadros[1]))
duracao = max(1, fim - inicio)

# ---------------------------------------------------------------- cena
cena = bpy.context.scene
mundo = bpy.data.worlds.new("mundo")
mundo.use_nodes = True
mundo.node_tree.nodes["Background"].inputs[0].default_value = (0.035, 0.04, 0.035, 1)
mundo.node_tree.nodes["Background"].inputs[1].default_value = 0.6
cena.world = mundo

piso = bpy.data.meshes.new("piso")
piso.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
piso.update()
objeto_piso = bpy.data.objects.new("piso", piso)
cena.collection.objects.link(objeto_piso)
material_piso = bpy.data.materials.new("piso")
material_piso.use_nodes = True
material_piso.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.11, 0.09, 1)
material_piso.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
objeto_piso.data.materials.append(material_piso)

# Altura real do personagem a partir de malhas + ossos, para enquadrar.
bpy.context.view_layer.update()
z_max = 0.0
for ob in malhas:
    for canto in ob.bound_box:
        z_max = max(z_max, (ob.matrix_world @ Vector(canto)).z)
altura = max(1.6, z_max)

alvo = Vector((0, 0, altura * 0.52))
camera_dados = bpy.data.cameras.new("camera")
camera_dados.lens = 50
camera = bpy.data.objects.new("camera", camera_dados)
cena.collection.objects.link(camera)
distancia = altura * 2.35
camera.location = Vector((distancia * 0.62, -distancia * 0.80, altura * 0.60))
direcao = alvo - camera.location
camera.rotation_euler = direcao.to_track_quat("-Z", "Y").to_euler()
cena.camera = camera

def luz(nome, tipo, energia, posicao, tamanho=3.0, cor=(1, 1, 1)):
    dados = bpy.data.lights.new(nome, type=tipo)
    dados.energy = energia
    dados.color = cor
    if tipo == "AREA":
        dados.size = tamanho
    objeto = bpy.data.objects.new(nome, dados)
    objeto.location = posicao
    objeto.rotation_euler = (alvo - Vector(posicao)).to_track_quat("-Z", "Y").to_euler()
    cena.collection.objects.link(objeto)
    return objeto

luz("principal", "AREA", 420, (2.4, -2.8, 3.4), 3.2, (1.0, 0.97, 0.9))
luz("contra", "AREA", 260, (-2.8, 2.6, 3.0), 3.0, (0.72, 0.95, 0.55))
luz("topo", "AREA", 140, (0.0, 0.6, 4.2), 2.6)

cena.render.engine = "CYCLES"
cena.cycles.device = "CPU"
cena.cycles.samples = AMOSTRAS
cena.cycles.use_denoising = True
cena.render.resolution_x = 420
cena.render.resolution_y = 560
cena.render.resolution_percentage = 100
cena.render.image_settings.file_format = "PNG"
cena.render.film_transparent = False

print(f"[render] personagem={os.path.basename(PERSONAGEM)} malhas={len(malhas)} "
      f"altura={altura:.2f}m clipe={os.path.basename(CLIPE)} quadros={inicio}..{fim}")

if VIDEO:
    cena.render.fps = 24
    cena.frame_start = inicio
    cena.frame_end = fim
    cena.render.image_settings.file_format = "FFMPEG"
    cena.render.ffmpeg.format = "MPEG4"
    cena.render.ffmpeg.codec = "H264"
    cena.render.ffmpeg.constant_rate_factor = "HIGH"
    cena.render.filepath = os.path.join(SAIDA, NOME + ".mp4")
    bpy.ops.render.render(animation=True)
    print(f"[render] vídeo em {cena.render.filepath}")
else:
    for indice, fracao in enumerate((0.15, 0.45, 0.75), start=1):
        cena.frame_set(inicio + int(duracao * fracao))
        cena.render.filepath = os.path.join(SAIDA, f"{NOME}-{indice:02d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[render] {cena.render.filepath}")

print("[render] OK")
