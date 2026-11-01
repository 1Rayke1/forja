#!/usr/bin/env python3
"""
Inspeção profunda de modelos 3D (FBX/GLB/glTF) com o Blender em modo headless.

Uso:
    blender --background --factory-startup --python tools/inspecionar-3d-blender.py -- \
        <saida.json> <arquivo1> [arquivo2 ...]

Para cada arquivo, abre uma cena vazia, importa o modelo e registra o que
existe de verdade no arquivo: malhas (vértices/polígonos/materiais), esqueletos
(armaduras e ossos), ações de animação (faixas de quadro, curvas), FPS da cena
e caixa delimitadora. Nada é inferido pelo nome do arquivo.

O JSON gerado é a evidência usada pelo inventário de docs/assets-3d/.
"""
import json
import os
import sys

import bpy

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 2:
    print("uso: -- <saida.json> <arquivos...>")
    sys.exit(2)

out_path, files = args[0], args[1:]
report = []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        raise RuntimeError("formato não suportado: " + ext)


def inspect(path):
    entry = {
        "arquivo": os.path.basename(path),
        "caminho": path,
        "bytes": os.path.getsize(path),
    }
    try:
        reset()
        import_file(path)
        scene = bpy.context.scene

        armatures = []
        for ob in bpy.data.objects:
            if ob.type != "ARMATURE":
                continue
            bones = [b.name for b in ob.data.bones]
            armatures.append({
                "nome": ob.name,
                "ossos": len(bones),
                "nomes_de_ossos": bones,
                "ossos_raiz": [b.name for b in ob.data.bones if b.parent is None],
                "escala": [round(v, 4) for v in ob.scale],
            })

        meshes = []
        for ob in bpy.data.objects:
            if ob.type != "MESH":
                continue
            data = ob.data
            meshes.append({
                "nome": ob.name,
                "vertices": len(data.vertices),
                "poligonos": len(data.polygons),
                "materiais": [m.name for m in data.materials if m],
                "grupos_de_vertices": len(ob.vertex_groups),
                "armature_modifier": any(m.type == "ARMATURE" for m in ob.modifiers),
                "dimensoes": [round(v, 3) for v in ob.dimensions],
            })

        actions = []
        for action in bpy.data.actions:
            fcurves = list(action.fcurves)
            frames = [fc for fc in fcurves]
            inicio, fim = action.frame_range
            actions.append({
                "nome": action.name,
                "quadro_inicial": round(inicio, 2),
                "quadro_final": round(fim, 2),
                "curvas": len(fcurves),
                "ossos_animados": len({fc.group.name for fc in frames if fc.group}),
            })

        entry.update({
            "fps": scene.render.fps / max(1, scene.render.fps_base),
            "armaduras": armatures,
            "malhas": meshes,
            "acoes": actions,
            "total_objetos": len(bpy.data.objects),
            "tem_esqueleto": bool(armatures),
            "tem_malha_com_pele": any(m["armature_modifier"] for m in meshes),
            "tem_animacao": any(a["curvas"] > 0 for a in actions),
        })
    except Exception as exc:  # noqa: BLE001 — o relatório precisa registrar a falha
        entry["erro"] = "%s: %s" % (type(exc).__name__, exc)
    return entry


for f in files:
    result = inspect(f)
    report.append(result)
    resumo = {
        "arquivo": result["arquivo"],
        "armaduras": len(result.get("armaduras", [])),
        "malhas": len(result.get("malhas", [])),
        "acoes": len(result.get("acoes", [])),
        "erro": result.get("erro"),
    }
    print("[inspecao] " + json.dumps(resumo, ensure_ascii=False))

with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
print("[inspecao] relatório em " + out_path)
