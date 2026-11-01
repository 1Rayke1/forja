#!/usr/bin/env python3
"""
FORJA — construtor dos personagens 3D (masculino e feminino).

Entrada real: `tools/fontes-3d/exercises.glb`, extraído do app DeskBreak
(release `assets-3d-v1`), MIT — manequim articulado com esqueleto de 16 ossos
(`hips`, `spine`, `neck`, `armL/armR`, `elbowL/elbowR`, `handL/handR`,
`legL/legR`, `kneeL/kneeR`, `footL/footR`, `prop`).

Os dois personagens são VARIANTES REAIS DE MALHA desse manequim: o script
altera a geometria (proporções de ombro, cintura, quadril, perna, braço e
altura), ajusta o esqueleto de repouso junto (para as articulações continuarem
coesas) e gera uma textura de madeira tingida própria de cada um. Não é uma
troca de cor: são duas malhas diferentes, com esqueletos de repouso diferentes,
compatíveis com o mesmo conjunto de animações de 16 ossos.

Uso:
    blender --background --factory-startup --python tools/blender/construir-personagens.py -- \
        <exercises.glb> <diretorio-de-saida>

Saída:
    <saida>/masculino.glb, <saida>/feminino.glb
    <saida>/personagens.json   (métricas reais do que foi gerado)
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv
args = argv[argv.index("--") + 1:] if "--" in argv else []
if len(args) < 2:
    print("uso: -- <exercises.glb> <diretorio-de-saida>")
    sys.exit(2)
GLB, OUT_DIR = args[0], args[1]
os.makedirs(OUT_DIR, exist_ok=True)

"""
Perfis de proporção. Cada valor multiplica a coordenada em relação ao eixo
central do corpo (ou, quando indicado, a altura total). Os números são
escolhas de produto, não medidas antropométricas: a base é um manequim
articulado, e o que muda entre os personagens é a silhueta.
"""
PERFIS = {
    "masculino": {
        "ombro": 1.16,       # braços e ombros mais largos
        "braco": 1.10,       # membros superiores mais grossos
        "cintura": 1.02,     # tronco mais reto
        "quadril": 0.94,     # quadril mais estreito
        "perna": 1.00,
        "altura": 1.045,
        "peito": 1.10,       # alargamento da caixa torácica
        "tinta": (0.72, 0.60, 0.47),   # nogueira escura
        "nome": "Personagem masculino",
    },
    "feminino": {
        "ombro": 0.90,
        "braco": 0.90,
        "cintura": 0.90,
        "quadril": 1.16,
        "perna": 1.05,
        "altura": 0.965,
        "peito": 0.94,
        "tinta": (1.16, 1.06, 0.94),   # madeira clara
        "nome": "Personagem feminino",
    },
}


def limpar():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def importar():
    bpy.ops.import_scene.gltf(filepath=GLB)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000)
    return arm, mesh


def fator_do_osso(nome, perfil):
    """Multiplicador lateral (eixo X) aplicado ao osso e à malha dele."""
    if nome in ("armL", "armR", "elbowL", "elbowR", "handL", "handR"):
        return perfil["ombro"] * perfil["braco"] ** 0.5
    if nome in ("legL", "legR", "kneeL", "kneeR", "footL", "footR"):
        return perfil["quadril"] * perfil["perna"] ** 0.5
    if nome == "hips":
        return perfil["quadril"]
    if nome == "spine":
        return perfil["cintura"] * perfil["peito"] ** 0.5
    return 1.0


def alturas_de_referencia(arm):
    """Alturas (Z) usadas para o perfil vertical do tronco."""
    b = {bone.name: bone for bone in arm.data.bones}
    return {
        "quadril": b["hips"].head_local.z,
        "cintura": b["spine"].head_local.z + 0.25,
        "ombro": b["spine"].tail_local.z,
        "cabeca": b["neck"].tail_local.z,
    }


def morfar_malha(mesh_obj, arm, perfil):
    """Aplica a silhueta: fator lateral por grupo + perfil do tronco + altura."""
    alturas = alturas_de_referencia(arm)
    grupos = {g.index: g.name for g in mesh_obj.vertex_groups}
    # maior peso por vértice → o osso que "manda" naquele pedaço
    dominante = [None] * len(mesh_obj.data.vertices)
    for vert in mesh_obj.data.vertices:
        melhor, melhor_peso = None, -1.0
        for g in vert.groups:
            if g.weight > melhor_peso:
                melhor, melhor_peso = g.group, g.weight
        dominante[vert.index] = grupos.get(melhor)

    esc_altura = perfil["altura"]
    for vert in mesh_obj.data.vertices:
        bone = dominante[vert.index]
        co = vert.co.copy()
        fator = fator_do_osso(bone, perfil)

        # Perfil vertical do tronco: ombros, caixa torácica e cintura.
        if bone in ("spine", "neck", "armL", "armR", "elbowL", "elbowR", "handL", "handR"):
            z = co.z
            ombro_alt = alturas["ombro"]
            cintura_alt = alturas["cintura"]
            topo = alturas["cabeca"] or 1.9
            if z > ombro_alt - 0.1:
                fator *= perfil["peito"] ** 0.5
            elif cintura_alt - 0.16 < z < cintura_alt + 0.12:
                fator *= perfil["cintura"] ** 0.5
            if bone == "neck" and z > ombro_alt + 0.05:
                fator *= 0.98

        co.x *= fator
        # Joelho/pé acompanham o quadril; a altura só afeta tronco e cabeça.
        co.z *= esc_altura
        vert.co = co

    mesh_obj.data.update()


def morfar_esqueleto(arm, perfil):
    """Move as juntas de repouso junto com a malha (mesmo fator por osso)."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for bone in arm.data.edit_bones:
        fator = fator_do_osso(bone.name, perfil)
        bone.head.x *= fator
        bone.tail.x *= fator
        bone.head.z *= perfil["altura"]
        bone.tail.z *= perfil["altura"]
        # cabeça/colo acompanham a largura do tronco
        if bone.name == "neck":
            bone.head.x *= perfil["cintura"] ** 0.5
            bone.tail.x *= perfil["cintura"] ** 0.5
    bpy.ops.object.mode_set(mode="OBJECT")


def tingir_textura(perfil, nome):
    """Gera uma textura de madeira própria, derivada da textura original."""
    for img in bpy.data.images:
        if img.size[0] < 64:
            continue
        px = list(img.pixels)
        r, g, b = perfil["tinta"]
        for i in range(0, len(px), 4):
            px[i] = min(1.0, px[i] * r)
            px[i + 1] = min(1.0, px[i + 1] * g)
            px[i + 2] = min(1.0, px[i + 2] * b)
        img.pixels = px
        img.name = "madeira-" + nome
        return img.name
    return None


def exportar(caminho, nome_objetos, material_nome):
    for ob in bpy.data.objects:
        ob.select_set(ob.name in nome_objetos)
    bpy.context.view_layer.objects.active = bpy.data.objects[nome_objetos[0]]
    bpy.ops.export_scene.gltf(
        filepath=caminho,
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_apply=False,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_skins=True,
    )


def metricas(mesh_obj, arm):
    zs = [(mesh_obj.matrix_world @ v.co).z for v in mesh_obj.data.vertices]
    xs = [(mesh_obj.matrix_world @ v.co).x for v in mesh_obj.data.vertices]
    return {
        "vertices": len(mesh_obj.data.vertices),
        "poligonos": len(mesh_obj.data.polygons),
        "ossos": len(arm.data.bones),
        "altura_m": round(max(zs) - min(zs), 3),
        "largura_ombros_m": round(max(xs) - min(xs), 3),
        "materiais": [m.name for m in mesh_obj.data.materials if m],
    }


def construir():
    relat = {}
    for slug, perfil in PERFIS.items():
        limpar()
        arm, mesh = importar()
        arm.name = "rig-" + slug
        mesh.name = "personagem-" + slug
        morfar_malha(mesh, arm, perfil)
        morfar_esqueleto(arm, perfil)
        tex = tingir_textura(perfil, slug)

        # nome dos materiais reflete o personagem (auditoria no GLB final)
        for mat in bpy.data.materials:
            if mat.name in ("wood", "wood_joint"):
                mat.name = mat.name + "-" + slug

        # o "Icosphere" é o prop de material do app original: não vai junto
        icosphere = [o.name for o in bpy.data.objects if o.type == "MESH" and o is not mesh]
        for nome in icosphere:
            bpy.data.objects.remove(bpy.data.objects[nome], do_unlink=True)

        caminho = os.path.join(OUT_DIR, slug + ".glb")
        exportar(caminho, [arm.name, mesh.name], slug)
        relat[perfil["nome"]] = dict(
            id=slug,
            label=perfil["nome"],
            arquivo=slug + ".glb",
            bytes=os.path.getsize(caminho),
            textura=tex,
            rig="rig-16-ossos",
            **metricas(mesh_obj=mesh, arm=arm)
        )
        print("[personagem]", json.dumps(relat[perfil["nome"]], ensure_ascii=False))

    with open(os.path.join(OUT_DIR, "personagens.json"), "w", encoding="utf-8") as fh:
        json.dump(relat, fh, ensure_ascii=False, indent=2)


construir()
