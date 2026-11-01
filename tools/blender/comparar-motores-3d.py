#!/usr/bin/env python3
"""
FORJA — auditoria de importação e comparação controlada entre Cycles e EEVEE.

Executa em Blender 4.2.1 (modo headless) duas etapas complementares sobre os
modelos 3D originais da release `modelos-3d-originais`:

  1. `--modo auditar`:
     - testa a importação direta no Blender 4.2.1 do arquivo bruto `.bin`,
       da cópia `.glb` intacta (mesmo SHA-256) e da sonda Meshopt;
     - importa a variante compatível (ou decodificada de Meshopt) e inspeciona
       malhas, vértices, triângulos, materiais, texturas, armaduras e ações;
     - testa deformação real de skin e compatibilidade direta de pose com os
       clipes atuais de 16 ossos do FORJA (`postura-base.glb` / `agachamento.glb`);
     - classifica deterministicamente `masculino` e `feminino` registrando as
       evidências usadas.

  2. `--modo comparar` (padrão):
     - dispara um subprocesso isolado do Blender por par `(personagem, motor)`
       (`CYCLES` e `EEVEE` / `BLENDER_EEVEE_NEXT`) para medir tempo frio,
       tempo quente (2º quadro, sem custo único de compilação de shaders/BVH)
       e pico real de memória (`VmHWM` do kernel e `Peak` interno do Blender)
       sem contaminação entre motores;
     - usa exatamente a mesma cena, modelo, pose, materiais originais,
       iluminação, câmera, gerenciamento de cor e resolução nos dois motores.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import re
import resource
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

OSSOS_FORJA_16 = [
    "hips", "spine", "neck",
    "armL", "elbowL", "handL",
    "armR", "elbowR", "handR",
    "legL", "kneeL", "footL",
    "legR", "kneeR", "footR",
    "prop",
]

SINONIMOS_RIG_HUMANOIDE = {
    "hips": ["hips", "pelvis", "root", "hip", "cog", "center"],
    "spine": ["spine2", "spine1", "spine", "spine03", "spine02", "chest", "upperchest", "torso"],
    "neck": ["neck", "neck01", "head"],
    "armL": ["arml", "leftarm", "upperarml", "lupperarm", "shoulderl", "leftshoulder"],
    "elbowL": ["elbowl", "leftforearm", "lowerarml", "lforearm", "forearml"],
    "handL": ["handl", "lefthand", "lhand", "wristl"],
    "armR": ["armr", "rightarm", "upperarmr", "rupperarm", "shoulderr", "rightshoulder"],
    "elbowR": ["elbowr", "rightforearm", "lowerarmr", "rforearm", "forearmr"],
    "handR": ["handr", "righthand", "rhand", "wristr"],
    "legL": ["legl", "leftupleg", "leftthigh", "thighl", "lupleg", "upperlegl"],
    "kneeL": ["kneel", "leftleg", "leftshin", "calfl", "lleg", "lowerlegl", "shinl"],
    "footL": ["footl", "leftfoot", "lfoot", "anklel"],
    "legR": ["legr", "rightupleg", "rightthigh", "thighr", "rupleg", "upperlegr"],
    "kneeR": ["kneer", "rightleg", "rightshin", "calfr", "rleg", "lowerlegr", "shinr"],
    "footR": ["footr", "rightfoot", "rfoot", "ankler"],
}

REGEX_FEMININO = re.compile(
    r"(?:^|[^a-z0-9])(feminino|feminina|female|woman|mulher|girl|eve|venus|fem)(?:$|[^a-z0-9])",
    re.IGNORECASE,
)
REGEX_MASCULINO = re.compile(
    r"(?:^|[^a-z0-9])(masculino|masculina|male|man|homem|boy|adam|mars|masc)(?:$|[^a-z0-9])",
    re.IGNORECASE,
)


def extrair_args_usuario() -> list[str]:
    argv = sys.argv
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return argv[1:]


def ler_memoria_proc_mb() -> dict[str, float | None]:
    """Lê VmRSS, VmHWM (pico real de RSS) e VmPeak em MiB a partir de /proc/self/status."""
    resultado: dict[str, float | None] = {
        "vm_rss_mb": None,
        "vm_hwm_mb": None,
        "vm_peak_mb": None,
    }
    mapa_chaves = {
        "VmRSS:": "vm_rss_mb",
        "VmHWM:": "vm_hwm_mb",
        "VmPeak:": "vm_peak_mb",
    }
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            for linha in fh:
                partes = linha.split()
                if len(partes) >= 2 and partes[0] in mapa_chaves:
                    kb = float(partes[1])
                    resultado[mapa_chaves[partes[0]]] = round(kb / 1024.0, 2)
    except OSError:
        pass
    if resultado["vm_hwm_mb"] is None:
        ru = resource.getrusage(resource.RUSAGE_SELF)
        if ru.ru_maxrss > 0:
            resultado["vm_hwm_mb"] = round(ru.ru_maxrss / 1024.0, 2)
    return resultado


@contextlib.contextmanager
def capturar_saida_nativa():
    """Captura stdout e stderr inclusive de extensões C/C++ do Blender."""
    sys.stdout.flush()
    sys.stderr.flush()
    fd_out_orig = os.dup(1)
    fd_err_orig = os.dup(2)
    tmp_file = tempfile.NamedTemporaryFile(mode="w+b", delete=False)
    tmp_path = tmp_file.name
    try:
        os.dup2(tmp_file.fileno(), 1)
        os.dup2(tmp_file.fileno(), 2)
        yield tmp_path
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        os.dup2(fd_out_orig, 1)
        os.dup2(fd_err_orig, 2)
        os.close(fd_out_orig)
        os.close(fd_err_orig)
        tmp_file.close()


def ler_e_apagar(caminho: str) -> str:
    try:
        with open(caminho, "r", encoding="utf-8", errors="replace") as fh:
            texto = fh.read()
    except OSError:
        texto = ""
    try:
        os.unlink(caminho)
    except OSError:
        pass
    return texto


def normalizar_nome_osso(nome: str) -> str:
    limpo = re.sub(r"^(mixamorig:?|armature\|?|bip01_?|cc_base_?|def[-_]?)", "", nome, flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]", "", limpo.lower())


def consultar_gpu_blender() -> dict[str, Any]:
    """Lê informações reais de OpenGL/GPU expostas pelo módulo `gpu` do Blender."""
    info: dict[str, Any] = {"disponivel": False}
    try:
        import gpu  # type: ignore

        info["vendor"] = gpu.platform.vendor_get()
        info["renderer"] = gpu.platform.renderer_get()
        info["version"] = gpu.platform.version_get()
        if hasattr(gpu.platform, "device_type_get"):
            info["device_type"] = gpu.platform.device_type_get()
        if hasattr(gpu.platform, "backend_type_get"):
            info["backend"] = gpu.platform.backend_type_get()
        info["disponivel"] = True
    except Exception as exc:  # noqa: BLE001
        info["erro"] = f"{type(exc).__name__}: {exc}"
    return info


def metadados_blender() -> dict[str, Any]:
    import bpy  # type: ignore

    engines = [
        item.identifier
        for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ]
    gltf_ver = None
    try:
        import io_scene_gltf2  # type: ignore

        gltf_ver = getattr(io_scene_gltf2, "bl_info", {}).get("version")
    except Exception:
        pass
    return {
        "versao": bpy.app.version_string,
        "versao_tupla": list(bpy.app.version),
        "build_hash": getattr(bpy.app, "build_hash", b"").decode("utf-8", errors="replace")
        if isinstance(getattr(bpy.app, "build_hash", ""), bytes)
        else str(getattr(bpy.app, "build_hash", "")),
        "binario": bpy.app.binary_path,
        "motores_disponiveis": engines,
        "io_scene_gltf2_versao": list(gltf_ver) if gltf_ver else None,
    }


def importar_modelo_blender(caminho: str, forcar_gltf: bool = False) -> dict[str, Any]:
    """Importa um arquivo 3D em cena limpa, capturando logs nativos e erros reais."""
    import bpy  # type: ignore

    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(caminho)[1].lower()
    t0 = time.perf_counter()
    erro = None
    retorno_op = None
    with capturar_saida_nativa() as tmp_log:
        try:
            if forcar_gltf or ext in (".glb", ".gltf"):
                retorno_op = list(bpy.ops.import_scene.gltf(filepath=caminho))
            elif ext == ".fbx":
                retorno_op = list(bpy.ops.import_scene.fbx(filepath=caminho, ignore_leaf_bones=False))
            elif ext == ".obj":
                retorno_op = list(bpy.ops.wm.obj_import(filepath=caminho))
            elif ext == ".blend":
                retorno_op = list(bpy.ops.wm.open_mainfile(filepath=caminho))
            else:
                retorno_op = list(bpy.ops.import_scene.gltf(filepath=caminho))
        except Exception as exc:  # noqa: BLE001
            erro = f"{type(exc).__name__}: {exc}"
    duracao = round(time.perf_counter() - t0, 4)
    log_texto = ler_e_apagar(tmp_log).strip()

    malhas = [ob for ob in bpy.data.objects if ob.type == "MESH"]
    armaduras = [ob for ob in bpy.data.objects if ob.type == "ARMATURE"]
    total_vertices = sum(len(ob.data.vertices) for ob in malhas)
    sucesso = (erro is None) and (len(malhas) > 0) and (total_vertices > 0)
    if erro is None and not sucesso:
        erro = f"Importação sem geometria utilizável (malhas={len(malhas)}, vertices={total_vertices})"

    avisos = [
        linha.strip()
        for linha in log_texto.splitlines()
        if any(chave in linha.upper() for chave in ("WARN", "ERROR", "FAIL", "EXTENSION", "MESHOPT", "KTX", "DRACO"))
    ]
    return {
        "caminho": caminho,
        "arquivo": os.path.basename(caminho),
        "sucesso": sucesso,
        "retorno_operador": retorno_op,
        "tempo_s": duracao,
        "objetos_importados": len(bpy.data.objects),
        "malhas": len(malhas),
        "armaduras": len(armaduras),
        "vertices_totais": total_vertices,
        "erro": erro,
        "avisos": avisos[:40],
        "log": log_texto[-4000:] if log_texto else "",
    }


def avaliar_geometria_mundo() -> dict[str, Any]:
    """Calcula caixa delimitadora real em espaço de mundo a partir da malha avaliada."""
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    malhas_orig = [ob for ob in bpy.data.objects if ob.type == "MESH" and not ob.hide_render]

    xs: list[float] = []
    ys: list[float] = []
    zs: list[float] = []
    amostras_anatomia: list[tuple[float, float, float]] = []

    for ob in malhas_orig:
        ob_eval = ob.evaluated_get(depsgraph)
        malha_eval = ob_eval.to_mesh()
        try:
            mw = ob_eval.matrix_world
            n_verts = len(malha_eval.vertices)
            passo = max(1, n_verts // 25000)
            for idx, vert in enumerate(malha_eval.vertices):
                p = mw @ Vector(vert.co)
                xs.append(p.x)
                ys.append(p.y)
                zs.append(p.z)
                if idx % passo == 0:
                    amostras_anatomia.append((p.x, p.y, p.z))
        finally:
            ob_eval.to_mesh_clear()

    if not xs:
        return {
            "vazio": True,
            "bbox_min": [0.0, 0.0, 0.0],
            "bbox_max": [0.0, 0.0, 0.0],
            "dimensoes": [0.0, 0.0, 0.0],
            "centro": [0.0, 0.0, 0.0],
        }

    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    zmin, zmax = min(zs), max(zs)
    largura = xmax - xmin
    profundidade = ymax - ymin
    altura = zmax - zmin
    cx = 0.5 * (xmin + xmax)
    cy = 0.5 * (ymin + ymax)
    cz = 0.5 * (zmin + zmax)

    # Medidas do tronco central (excluindo braços abertos em A-pose/T-pose)
    # para auxiliar auditoria anatômica e classificação transparente.
    largura_quadril_central = None
    largura_cintura_central = None
    largura_peito_central = None
    profundidade_peito_central = None
    if altura > 1e-5:
        meia_faixa_tronco = 0.16 * altura

        def fatia_central(z_ini: float, z_fim: float) -> list[tuple[float, float, float]]:
            return [
                (x, y, z)
                for (x, y, z) in amostras_anatomia
                if z_ini <= (z - zmin) / altura <= z_fim and abs(x - cx) <= meia_faixa_tronco
            ]

        pts_quadril = fatia_central(0.47, 0.55)
        pts_cintura = fatia_central(0.58, 0.65)
        pts_peito = fatia_central(0.70, 0.78)
        if len(pts_quadril) >= 12:
            largura_quadril_central = round(max(p[0] for p in pts_quadril) - min(p[0] for p in pts_quadril), 4)
        if len(pts_cintura) >= 12:
            largura_cintura_central = round(max(p[0] for p in pts_cintura) - min(p[0] for p in pts_cintura), 4)
        if len(pts_peito) >= 12:
            largura_peito_central = round(max(p[0] for p in pts_peito) - min(p[0] for p in pts_peito), 4)
            profundidade_peito_central = round(max(p[1] for p in pts_peito) - min(p[1] for p in pts_peito), 4)

    razao_cintura_quadril = None
    if largura_cintura_central and largura_quadril_central and largura_quadril_central > 1e-4:
        razao_cintura_quadril = round(largura_cintura_central / largura_quadril_central, 4)

    return {
        "vazio": False,
        "bbox_min": [round(xmin, 4), round(ymin, 4), round(zmin, 4)],
        "bbox_max": [round(xmax, 4), round(ymax, 4), round(zmax, 4)],
        "dimensoes": [round(largura, 4), round(profundidade, 4), round(altura, 4)],
        "largura_x_m": round(largura, 4),
        "profundidade_y_m": round(profundidade, 4),
        "altura_z_m": round(altura, 4),
        "centro": [round(cx, 4), round(cy, 4), round(cz, 4)],
        "anatomia_tronco": {
            "largura_quadril_central_m": largura_quadril_central,
            "largura_cintura_central_m": largura_cintura_central,
            "largura_peito_central_m": largura_peito_central,
            "profundidade_peito_central_m": profundidade_peito_central,
            "razao_cintura_quadril": razao_cintura_quadril,
        },
    }


def detectar_direcao_frente(geom: dict[str, Any]) -> dict[str, Any]:
    """
    Determina o sinal frontal no eixo Y do Blender.
    Pela convenção glTF (+Z frontal → -Y no Blender), a frente padrão é -Y (-1).
    Se houver ossos de pé/dedo do pé (toe/foot) ou nariz/cabeça, confirma pelo vetor real.
    """
    import bpy  # type: ignore

    armaduras = [ob for ob in bpy.data.objects if ob.type == "ARMATURE"]
    for arm in armaduras:
        mw = arm.matrix_world
        ossos = {normalizar_nome_osso(b.name): b for b in arm.data.bones}
        for par_pe, par_dedo in (
            (["leftfoot", "footl", "lfoot"], ["lefttoebase", "lefttoe", "toel", "ltoebase"]),
            (["rightfoot", "footr", "rfoot"], ["righttoebase", "righttoe", "toer", "rtoebase"]),
        ):
            b_pe = next((ossos[n] for n in par_pe if n in ossos), None)
            b_dedo = next((ossos[n] for n in par_dedo if n in ossos), None)
            if b_pe and b_dedo:
                p_pe = mw @ b_pe.head_local
                p_dedo = mw @ b_dedo.head_local
                dy = p_dedo.y - p_pe.y
                if abs(dy) > 1e-3:
                    return {
                        "sinal_y": -1.0 if dy < 0 else 1.0,
                        "criterio": f"vetor pé→dedo ({b_pe.name}→{b_dedo.name}, dy={dy:.4f})",
                    }
    return {
        "sinal_y": -1.0,
        "criterio": "convenção padrão glTF 2.0 (+Z glTF → -Y Blender)",
    }


def inspecionar_cena_completa(clipe_forja: str | None = None) -> dict[str, Any]:
    """Extrai inventário detalhado da cena já importada + teste real de rig/pose."""
    import bpy  # type: ignore
    from mathutils import Euler, Matrix, Vector  # type: ignore

    geom = avaliar_geometria_mundo()
    frente = detectar_direcao_frente(geom)

    malhas_info = []
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        me.calc_loop_triangles()
        malhas_info.append({
            "nome": ob.name,
            "vertices": len(me.vertices),
            "poligonos": len(me.polygons),
            "triangulos": len(me.loop_triangles),
            "uv_layers": [uv.name for uv in me.uv_layers],
            "color_attributes": [ca.name for ca in getattr(me, "color_attributes", [])],
            "shape_keys": len(me.shape_keys.key_blocks) if me.shape_keys else 0,
            "grupos_vertices": len(ob.vertex_groups),
            "tem_modificador_armadura": any(m.type == "ARMATURE" for m in ob.modifiers),
            "materiais": [m.name for m in me.materials if m],
            "escala_objeto": [round(v, 4) for v in ob.scale],
        })

    materiais_info = []
    for mat in bpy.data.materials:
        texturas = []
        principled_resumo = {}
        if mat.use_nodes and mat.node_tree:
            for node in mat.node_tree.nodes:
                if node.type == "TEX_IMAGE" and getattr(node, "image", None):
                    img = node.image
                    texturas.append({
                        "nome": img.name,
                        "resolucao": [int(img.size[0]), int(img.size[1])],
                        "colorspace": img.colorspace_settings.name if img.colorspace_settings else None,
                        "empacotada": img.packed_file is not None,
                        "tem_dados": bool(img.has_data),
                    })
                elif node.type == "BSDF_PRINCIPLED":
                    for socket_nome in ("Base Color", "Metallic", "Roughness", "Alpha"):
                        if socket_nome in node.inputs:
                            val = node.inputs[socket_nome].default_value
                            if hasattr(val, "__iter__"):
                                principled_resumo[socket_nome] = [round(float(x), 4) for x in val]
                            else:
                                principled_resumo[socket_nome] = round(float(val), 4)
        materiais_info.append({
            "nome": mat.name,
            "use_nodes": bool(mat.use_nodes),
            "surface_render_method": getattr(mat, "surface_render_method", getattr(mat, "blend_method", None)),
            "principled": principled_resumo,
            "texturas": texturas,
        })

    imagens_sem_dados = [
        img.name for img in bpy.data.images
        if img.name not in ("Render Result", "Viewer Node") and (img.size[0] == 0 or not img.has_data)
    ]

    armaduras_info = []
    armaduras_objs = [ob for ob in bpy.data.objects if ob.type == "ARMATURE"]
    razao_ombro_quadril_ossos = None
    for arm in armaduras_objs:
        mw = arm.matrix_world
        nomes_ossos = [b.name for b in arm.data.bones]
        mapa_norm = {normalizar_nome_osso(b.name): b for b in arm.data.bones}

        b_arm_l = next((mapa_norm[c] for c in SINONIMOS_RIG_HUMANOIDE["armL"] if c in mapa_norm), None)
        b_arm_r = next((mapa_norm[c] for c in SINONIMOS_RIG_HUMANOIDE["armR"] if c in mapa_norm), None)
        b_leg_l = next((mapa_norm[c] for c in SINONIMOS_RIG_HUMANOIDE["legL"] if c in mapa_norm), None)
        b_leg_r = next((mapa_norm[c] for c in SINONIMOS_RIG_HUMANOIDE["legR"] if c in mapa_norm), None)

        vao_ombros = None
        vao_quadril = None
        if b_arm_l and b_arm_r:
            vao_ombros = round(((mw @ b_arm_l.head_local) - (mw @ b_arm_r.head_local)).length, 4)
        if b_leg_l and b_leg_r:
            vao_quadril = round(((mw @ b_leg_l.head_local) - (mw @ b_leg_r.head_local)).length, 4)
        if vao_ombros and vao_quadril and vao_quadril > 1e-4:
            razao_ombro_quadril_ossos = round(vao_ombros / vao_quadril, 4)

        armaduras_info.append({
            "nome": arm.name,
            "ossos": len(nomes_ossos),
            "raizes": [b.name for b in arm.data.bones if b.parent is None],
            "amostra_ossos": nomes_ossos[:40],
            "todos_ossos": nomes_ossos,
            "escala_objeto": [round(v, 4) for v in arm.scale],
            "vao_ombros_m": vao_ombros,
            "vao_quadril_m": vao_quadril,
            "razao_ombro_quadril_ossos": razao_ombro_quadril_ossos,
        })

    acoes_info = [
        {
            "nome": ac.name,
            "faixa_quadros": [round(float(ac.frame_range[0]), 2), round(float(ac.frame_range[1]), 2)],
            "curvas": len(ac.fcurves),
        }
        for ac in bpy.data.actions
    ]

    # Teste real de pose e compatibilidade com o rig atual de 16 ossos do FORJA
    pose_teste: dict[str, Any] = {
        "tem_armadura": len(armaduras_objs) > 0,
        "tem_skin_ativo": any(m["tem_modificador_armadura"] and m["grupos_vertices"] > 0 for m in malhas_info),
        "compativel_direto_forja_16_ossos": False,
        "ossos_forja_exatos": [],
        "ossos_forja_faltantes": list(OSSOS_FORJA_16),
        "ossos_humanoides_mapeaveis": {},
        "teste_deformacao_skin": None,
        "teste_aplicacao_clipe_forja": None,
        "erros_pose": [],
    }

    if not armaduras_objs:
        pose_teste["erros_pose"].append(
            "Modelo estático sem objeto ARMATURE: não possui esqueleto nem pesos de skin; "
            "não pode receber clipes de animação sem etapa prévia de rigging."
        )
    else:
        arm_principal = max(armaduras_objs, key=lambda o: len(o.data.bones))
        nomes_exatos = {b.name for b in arm_principal.data.bones}
        casados_exatos = [n for n in OSSOS_FORJA_16 if n in nomes_exatos]
        faltantes_exatos = [n for n in OSSOS_FORJA_16 if n not in nomes_exatos]
        pose_teste["ossos_forja_exatos"] = casados_exatos
        pose_teste["ossos_forja_faltantes"] = faltantes_exatos
        pose_teste["compativel_direto_forja_16_ossos"] = len(casados_exatos) >= 15

        mapa_norm = {normalizar_nome_osso(b.name): b.name for b in arm_principal.data.bones}
        mapeados_humanoides = {}
        for alvo_forja, candidatos in SINONIMOS_RIG_HUMANOIDE.items():
            for cand in candidatos:
                if cand in mapa_norm:
                    mapeados_humanoides[alvo_forja] = mapa_norm[cand]
                    break
        pose_teste["ossos_humanoides_mapeaveis"] = mapeados_humanoides

        if not pose_teste["compativel_direto_forja_16_ossos"]:
            pose_teste["erros_pose"].append(
                f"Incompatibilidade direta com os clipes atuais de 16 ossos do FORJA: "
                f"apenas {len(casados_exatos)}/16 nomes exatos presentes "
                f"(mapeáveis por normalização humanoide: {len(mapeados_humanoides)}/15)."
            )

        # Teste reversível de deformação real de vértices ao girar um osso
        osso_teste_nome = (
            mapeados_humanoides.get("armL")
            or mapeados_humanoides.get("legL")
            or (arm_principal.pose.bones[0].name if len(arm_principal.pose.bones) else None)
        )
        if osso_teste_nome and osso_teste_nome in arm_principal.pose.bones:
            pb = arm_principal.pose.bones[osso_teste_nome]
            modo_ant = pb.rotation_mode
            matriz_ant = pb.matrix_basis.copy()
            try:
                bpy.context.view_layer.update()
                deps_antes = bpy.context.evaluated_depsgraph_get()
                amostra_antes = []
                for ob in bpy.data.objects:
                    if ob.type == "MESH":
                        ev = ob.evaluated_get(deps_antes)
                        me = ev.to_mesh()
                        passo = max(1, len(me.vertices) // 2000)
                        amostra_antes.extend(
                            (ev.matrix_world @ Vector(me.vertices[i].co)).copy()
                            for i in range(0, len(me.vertices), passo)
                        )
                        ev.to_mesh_clear()

                pb.rotation_mode = "XYZ"
                pb.rotation_euler = Euler((0.35, 0.0, 0.25), "XYZ")
                bpy.context.view_layer.update()
                deps_depois = bpy.context.evaluated_depsgraph_get()
                amostra_depois = []
                for ob in bpy.data.objects:
                    if ob.type == "MESH":
                        ev = ob.evaluated_get(deps_depois)
                        me = ev.to_mesh()
                        passo = max(1, len(me.vertices) // 2000)
                        amostra_depois.extend(
                            (ev.matrix_world @ Vector(me.vertices[i].co)).copy()
                            for i in range(0, len(me.vertices), passo)
                        )
                        ev.to_mesh_clear()

                movidos = sum(
                    1 for a, b in zip(amostra_antes, amostra_depois) if (a - b).length > 1e-3
                )
                desloc_max = max(
                    ((a - b).length for a, b in zip(amostra_antes, amostra_depois)),
                    default=0.0,
                )
                pose_teste["teste_deformacao_skin"] = {
                    "osso_testado": osso_teste_nome,
                    "amostras_comparadas": len(amostra_antes),
                    "vertices_movidos": movidos,
                    "deslocamento_max_m": round(desloc_max, 4),
                    "deforma_malha": movidos > 0,
                }
                if movidos == 0:
                    pose_teste["erros_pose"].append(
                        f"Girar o osso '{osso_teste_nome}' não moveu vértices da malha (skin sem efeito)."
                    )
            finally:
                pb.rotation_mode = modo_ant
                pb.matrix_basis = matriz_ant
                bpy.context.view_layer.update()

        # Se foi passado um clipe real do FORJA, testa aplicá-lo diretamente e reverte
        if clipe_forja and os.path.isfile(clipe_forja):
            antes_objs = set(bpy.data.objects)
            antes_acoes = set(bpy.data.actions)
            acao_ant = arm_principal.animation_data.action if arm_principal.animation_data else None
            try:
                bpy.ops.import_scene.gltf(filepath=clipe_forja)
                novas_acoes = [a for a in bpy.data.actions if a not in antes_acoes]
                novos_objs = [o for o in bpy.data.objects if o not in antes_objs]
                curvas_validas = 0
                curvas_invalidas = 0
                for ac in novas_acoes:
                    for fc in ac.fcurves:
                        m = re.match(r'pose\.bones\["([^"]+)"\]', fc.data_path)
                        if m:
                            if m.group(1) in nomes_exatos:
                                curvas_validas += 1
                            else:
                                curvas_invalidas += 1
                pose_teste["teste_aplicacao_clipe_forja"] = {
                    "clipe": os.path.basename(clipe_forja),
                    "acoes_importadas": len(novas_acoes),
                    "curvas_casadas_no_modelo": curvas_validas,
                    "curvas_sem_osso_no_modelo": curvas_invalidas,
                    "aplicavel_sem_retarget": curvas_validas > 0 and curvas_invalidas == 0,
                }
            except Exception as exc:  # noqa: BLE001
                pose_teste["teste_aplicacao_clipe_forja"] = {
                    "clipe": os.path.basename(clipe_forja),
                    "erro": f"{type(exc).__name__}: {exc}",
                    "aplicavel_sem_retarget": False,
                }
            finally:
                if arm_principal.animation_data:
                    arm_principal.animation_data.action = acao_ant
                for ob in [o for o in bpy.data.objects if o not in antes_objs]:
                    bpy.data.objects.remove(ob, do_unlink=True)
                for ac in [a for a in bpy.data.actions if a not in antes_acoes]:
                    bpy.data.actions.remove(ac, do_unlink=True)
                bpy.context.view_layer.update()

    return {
        "geometria_mundo": geom,
        "frente_detectada": frente,
        "malhas": malhas_info,
        "totais": {
            "malhas": len(malhas_info),
            "vertices": sum(m["vertices"] for m in malhas_info),
            "poligonos": sum(m["poligonos"] for m in malhas_info),
            "triangulos": sum(m["triangulos"] for m in malhas_info),
            "materiais": len(materiais_info),
            "imagens_sem_dados": imagens_sem_dados,
            "armaduras": len(armaduras_info),
            "ossos": sum(a["ossos"] for a in armaduras_info),
            "acoes": len(acoes_info),
        },
        "materiais": materiais_info,
        "armaduras": armaduras_info,
        "acoes": acoes_info,
        "pose_compatibilidade": pose_teste,
    }


def pontuar_identidade_genero(item_prep: dict[str, Any], inspecao: dict[str, Any]) -> dict[str, Any]:
    """
    Calcula evidências nominais, esqueléticas e anatômicas para distinguir
    masculino vs feminino sem suposição cega pelo nome do anexo `.bin`.
    """
    textos_internos: list[str] = []
    glb_info = item_prep.get("glb_json_resumo") or {}
    for chave in ("nomes_cenas", "nomes_nos", "nomes_malhas", "nomes_materiais", "nomes_imagens", "nomes_skins", "nomes_animacoes"):
        textos_internos.extend(str(x) for x in (glb_info.get(chave) or []))
    if glb_info.get("generator"):
        textos_internos.append(str(glb_info["generator"]))
    for m in inspecao.get("malhas", []):
        textos_internos.append(m["nome"])
    for mat in inspecao.get("materiais", []):
        textos_internos.append(mat["nome"])
        for tex in mat.get("texturas", []):
            textos_internos.append(tex["nome"])

    hits_fem = [t for t in textos_internos if REGEX_FEMININO.search(t)]
    hits_masc = [t for t in textos_internos if REGEX_MASCULINO.search(t) and not REGEX_FEMININO.search(t)]

    geom = inspecao.get("geometria_mundo") or {}
    altura = float(geom.get("altura_z_m") or 0.0)
    anat = geom.get("anatomia_tronco") or {}
    whr = anat.get("razao_cintura_quadril")

    arms = inspecao.get("armaduras") or []
    shr_ossos = arms[0].get("razao_ombro_quadril_ossos") if arms else None

    return {
        "hits_nominais_feminino": hits_fem[:15],
        "hits_nominais_masculino": hits_masc[:15],
        "razao_ombro_quadril_ossos": shr_ossos,
        "razao_cintura_quadril_tronco": whr,
        "altura_z_m": altura,
    }


def classificar_par_modelos(modelos_auditados: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """Atribui `masculino` e `feminino` aos dois modelos auditados com justificativa explícita."""
    if len(modelos_auditados) != 2:
        for idx, m in enumerate(modelos_auditados):
            m["personagem"] = "masculino" if idx == 0 else f"modelo-{idx + 1}"
            m["criterio_classificacao"] = "quantidade diferente de 2 modelos"
        return modelos_auditados, "quantidade diferente de 2 modelos"

    a, b = modelos_auditados[0], modelos_auditados[1]
    ev_a = a["evidencias_genero"]
    ev_b = b["evidencias_genero"]

    # 1) Nomes internos explícitos (cenas, nós, malhas, materiais, texturas)
    sinal_a = (1 if ev_a["hits_nominais_masculino"] else 0) - (1 if ev_a["hits_nominais_feminino"] else 0)
    sinal_b = (1 if ev_b["hits_nominais_masculino"] else 0) - (1 if ev_b["hits_nominais_feminino"] else 0)
    if sinal_a != sinal_b:
        criterio = "metadados/nomes internos do modelo (malhas, nós, materiais ou texturas)"
        if sinal_a > sinal_b:
            a["personagem"], b["personagem"] = "masculino", "feminino"
        else:
            a["personagem"], b["personagem"] = "feminino", "masculino"
        a["criterio_classificacao"] = criterio
        b["criterio_classificacao"] = criterio
        return [a, b], criterio

    # 2) Razão ombro/quadril das articulações do esqueleto
    shr_a = ev_a.get("razao_ombro_quadril_ossos")
    shr_b = ev_b.get("razao_ombro_quadril_ossos")
    if shr_a is not None and shr_b is not None and abs(shr_a - shr_b) > 0.03:
        criterio = f"razão articular ombro/quadril do esqueleto ({shr_a} vs {shr_b})"
        if shr_a > shr_b:
            a["personagem"], b["personagem"] = "masculino", "feminino"
        else:
            a["personagem"], b["personagem"] = "feminino", "masculino"
        a["criterio_classificacao"] = criterio
        b["criterio_classificacao"] = criterio
        return [a, b], criterio

    # 3) Razão cintura/quadril do tronco central (menor no modelo feminino) + altura
    whr_a = ev_a.get("razao_cintura_quadril_tronco")
    whr_b = ev_b.get("razao_cintura_quadril_tronco")
    if whr_a is not None and whr_b is not None and abs(whr_a - whr_b) > 0.025:
        criterio = f"razão geométrica cintura/quadril do tronco ({whr_a} vs {whr_b})"
        if whr_a > whr_b:
            a["personagem"], b["personagem"] = "masculino", "feminino"
        else:
            a["personagem"], b["personagem"] = "feminino", "masculino"
        a["criterio_classificacao"] = criterio
        b["criterio_classificacao"] = criterio
        return [a, b], criterio

    # 4) Altura em metros (quando escalados em escala antropométrica real)
    alt_a = ev_a.get("altura_z_m") or 0.0
    alt_b = ev_b.get("altura_z_m") or 0.0
    if abs(alt_a - alt_b) > 0.02:
        criterio = f"altura total do modelo em espaço de mundo ({alt_a:.4f} vs {alt_b:.4f})"
        if alt_a >= alt_b:
            a["personagem"], b["personagem"] = "masculino", "feminino"
        else:
            a["personagem"], b["personagem"] = "feminino", "masculino"
        a["criterio_classificacao"] = criterio
        b["criterio_classificacao"] = criterio
        return [a, b], criterio

    # 5) Ordem da release ("Modelos 3D originais — masculino e feminino": WA0008, WA0009)
    criterio = "ordem dos anexos na release 'Modelos 3D originais — masculino e feminino.' (dimensões equivalentes)"
    a["personagem"], b["personagem"] = "masculino", "feminino"
    a["criterio_classificacao"] = criterio
    b["criterio_classificacao"] = criterio
    return [a, b], criterio


def executar_modo_auditar(args: argparse.Namespace) -> int:
    with open(args.preparacao, "r", encoding="utf-8") as fh:
        prep = json.load(fh)

    meta_blender = metadados_blender()
    gpu_info = consultar_gpu_blender()
    linhas_log: list[str] = [
        f"=== AUDITORIA DE IMPORTAÇÃO NO BLENDER {meta_blender['versao']} ===",
        f"Motores disponíveis: {', '.join(meta_blender['motores_disponiveis'])}",
        f"io_scene_gltf2: {meta_blender['io_scene_gltf2_versao']}",
        "",
    ]

    modelos_auditados: list[dict[str, Any]] = []
    for item in prep.get("arquivos", []):
        nome_orig = item["nome_arquivo"]
        linhas_log.append(f"--- Modelo original: {nome_orig} (SHA-256: {item['sha256']}) ---")

        # 1. Teste real de importação direta com a extensão original (.bin)
        teste_bin = importar_modelo_blender(item["caminho_original"], forcar_gltf=True)
        linhas_log.append(
            f"[1] Importação direta (.bin): sucesso={teste_bin['sucesso']} "
            f"tempo={teste_bin['tempo_s']}s erro={teste_bin['erro']}"
        )
        if teste_bin["log"]:
            linhas_log.append(teste_bin["log"])

        # 2. Teste real de importação direta como .glb intacto (mesmo SHA-256, sem decodificar Meshopt)
        teste_glb_intacto = None
        if item.get("caminho_glb_intacto"):
            teste_glb_intacto = importar_modelo_blender(item["caminho_glb_intacto"], forcar_gltf=True)
            linhas_log.append(
                f"[2] Importação direta (.glb intacto, sem decodificar Meshopt): "
                f"sucesso={teste_glb_intacto['sucesso']} tempo={teste_glb_intacto['tempo_s']}s "
                f"erro={teste_glb_intacto['erro']}"
            )
            if teste_glb_intacto["log"]:
                linhas_log.append(teste_glb_intacto["log"])

        # 3. Se o arquivo original não tinha Meshopt e geramos sonda Meshopt, testar no Blender 4.2.1
        teste_sonda_meshopt = None
        if item.get("caminho_sonda_meshopt"):
            teste_sonda_meshopt = importar_modelo_blender(item["caminho_sonda_meshopt"], forcar_gltf=True)
            linhas_log.append(
                f"[3] Sonda de compatibilidade EXT_meshopt_compression no Blender 4.2.1: "
                f"sucesso={teste_sonda_meshopt['sucesso']} erro={teste_sonda_meshopt['erro']}"
            )
            if teste_sonda_meshopt["log"]:
                linhas_log.append(teste_sonda_meshopt["log"])

        # 4. Escolher e importar o arquivo efetivo para inspeção completa e renderização
        candidatos_render = []
        if teste_glb_intacto and teste_glb_intacto["sucesso"]:
            candidatos_render.append(("glb_intacto_direto", item["caminho_glb_intacto"]))
        if item.get("caminho_sem_meshopt"):
            candidatos_render.append(("glb_meshopt_decodificado", item["caminho_sem_meshopt"]))
        if item.get("caminho_desquantizado"):
            candidatos_render.append(("glb_meshopt_desquantizado", item["caminho_desquantizado"]))
        if item.get("caminho_extraido"):
            candidatos_render.append(("arquivo_extraido", item["caminho_extraido"]))

        escolhido_origem = None
        escolhido_caminho = None
        teste_escolhido = None
        inspecao = None

        for rotulo, cam in candidatos_render:
            res = importar_modelo_blender(cam)
            linhas_log.append(
                f"[4] Candidato para render ({rotulo}: {os.path.basename(cam)}): "
                f"sucesso={res['sucesso']} malhas={res['malhas']} vertices={res['vertices_totais']} erro={res['erro']}"
            )
            if res["log"]:
                linhas_log.append(res["log"])
            if res["sucesso"]:
                escolhido_origem = rotulo
                escolhido_caminho = cam
                teste_escolhido = res
                inspecao = inspecionar_cena_completa(clipe_forja=args.clipe_forja)
                break

        evidencias = pontuar_identidade_genero(item, inspecao or {})
        modelos_auditados.append({
            "nome_arquivo_original": nome_orig,
            "bytes_original": item["bytes"],
            "sha256_original": item["sha256"],
            "sha256_confere_release": item.get("sha256_confere_release"),
            "formato_binario_detectado": item.get("formato_detectado"),
            "usa_meshopt_no_original": item.get("usa_meshopt_original", False),
            "extensoes_gltf_usadas": (item.get("glb_json_resumo") or {}).get("extensionsUsed", []),
            "extensoes_gltf_obrigatorias": (item.get("glb_json_resumo") or {}).get("extensionsRequired", []),
            "testes_importacao_blender": {
                "bin_direto": teste_bin,
                "glb_intacto_direto": teste_glb_intacto,
                "sonda_meshopt_blender_4_2_1": teste_sonda_meshopt,
                "modelo_preparado_render": teste_escolhido,
            },
            "origem_modelo_render": escolhido_origem,
            "caminho_modelo_render": escolhido_caminho,
            "inspecao_cena": inspecao,
            "evidencias_genero": evidencias,
        })
        linhas_log.append("")

    modelos_classificados, criterio_geral = classificar_par_modelos(modelos_auditados)
    for m in modelos_classificados:
        linhas_log.append(
            f"[classificacao] {m['nome_arquivo_original']} → {m['personagem']} ({m['criterio_classificacao']})"
        )

    saida_auditoria = {
        "blender": meta_blender,
        "gpu_auditoria": gpu_info,
        "criterio_classificacao_personagens": criterio_geral,
        "modelos": modelos_classificados,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.saida_json)), exist_ok=True)
    with open(args.saida_json, "w", encoding="utf-8") as fh:
        json.dump(saida_auditoria, fh, ensure_ascii=False, indent=2)

    if args.log_importacao:
        os.makedirs(os.path.dirname(os.path.abspath(args.log_importacao)), exist_ok=True)
        with open(args.log_importacao, "w", encoding="utf-8") as fh:
            fh.write("\n".join(linhas_log) + "\n")

    print("[auditar] concluído:", json.dumps({
        m["personagem"]: {
            "arquivo_original": m["nome_arquivo_original"],
            "sha256": m["sha256_original"],
            "origem_render": m["origem_modelo_render"],
            "vertices": ((m.get("inspecao_cena") or {}).get("totais") or {}).get("vertices"),
        }
        for m in modelos_classificados
    }, ensure_ascii=False))
    return 0 if all(m.get("caminho_modelo_render") for m in modelos_classificados) else 1


def montar_cena_comparativa(
    largura_px: int,
    altura_px: int,
    sinal_frente_forcado: float | None = None,
) -> dict[str, Any]:
    """
    Constrói exatamente a mesma cena de estúdio (mundo, piso, 4 luzes de área,
    câmera 50 mm enquadrada pela caixa delimitadora e gerenciamento de cor)
    para que Cycles e EEVEE sejam comparados sob condições idênticas.
    """
    import bpy  # type: ignore
    from mathutils import Vector  # type: ignore

    cena = bpy.context.scene
    geom = avaliar_geometria_mundo()
    if geom["vazio"]:
        raise RuntimeError("Cena sem geometria visível para renderizar.")

    frente_info = detectar_direcao_frente(geom)
    sinal_frente = float(sinal_frente_forcado) if sinal_frente_forcado in (-1.0, 1.0) else float(frente_info["sinal_y"])
    # Quando a frente é -Y, o lado direito do observador é +X; quando é +Y, inverte X para manter o mesmo ângulo 3/4.
    sinal_x = 1.0 if sinal_frente < 0 else -1.0

    xmin, ymin, zmin = geom["bbox_min"]
    xmax, ymax, zmax = geom["bbox_max"]
    largura_m = max(1e-3, xmax - xmin)
    profundidade_m = max(1e-3, ymax - ymin)
    altura_m = max(1e-3, zmax - zmin)
    cx = 0.5 * (xmin + xmax)
    cy = 0.5 * (ymin + ymax)

    escala_cena = altura_m / 1.75

    # Mundo escuro neutro (palco FORJA)
    mundo = bpy.data.worlds.new("forja_mundo_comparacao")
    mundo.use_nodes = True
    bg = mundo.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.035, 0.038, 0.042, 1.0)
        bg.inputs[1].default_value = 0.55
    cena.world = mundo

    # Piso fosco encostado exatamente na cota mínima dos pés (zmin)
    raio_piso = 3.6 * altura_m
    malha_piso = bpy.data.meshes.new("forja_piso_malha")
    malha_piso.from_pydata(
        [
            (cx - raio_piso, cy - raio_piso, zmin),
            (cx + raio_piso, cy - raio_piso, zmin),
            (cx + raio_piso, cy + raio_piso, zmin),
            (cx - raio_piso, cy + raio_piso, zmin),
        ],
        [],
        [(0, 1, 2, 3)],
    )
    malha_piso.update()
    obj_piso = bpy.data.objects.new("forja_piso", malha_piso)
    cena.collection.objects.link(obj_piso)

    mat_piso = bpy.data.materials.new("forja_piso_material")
    mat_piso.use_nodes = True
    bsdf_piso = mat_piso.node_tree.nodes.get("Principled BSDF")
    if bsdf_piso:
        bsdf_piso.inputs["Base Color"].default_value = (0.075, 0.080, 0.085, 1.0)
        bsdf_piso.inputs["Roughness"].default_value = 0.82
        if "Metallic" in bsdf_piso.inputs:
            bsdf_piso.inputs["Metallic"].default_value = 0.05
    obj_piso.data.materials.append(mat_piso)

    alvo = Vector((cx, cy, zmin + altura_m * 0.51))

    # Câmera 50 mm em vista 3/4 frontal com distância calculada para nunca cortar membros
    cam_dados = bpy.data.cameras.new("forja_camera")
    cam_dados.lens = 50.0
    cam_dados.sensor_fit = "HORIZONTAL"
    cam_dados.sensor_width = 36.0
    cam_dados.clip_start = max(0.005, 0.02 * escala_cena)
    cam_dados.clip_end = max(100.0, 60.0 * escala_cena)

    tan_meio_x = (cam_dados.sensor_width * 0.5) / cam_dados.lens
    tan_meio_y = tan_meio_x * (float(altura_px) / float(largura_px))

    azimute = 0.38  # ~21.8° de rotação 3/4 para evidenciar volume, sombra e silhueta
    elevacao = 0.10
    largura_proj = abs(largura_m * math.cos(azimute)) + abs(profundidade_m * math.sin(azimute))
    dist_y = (altura_m * 1.24) / (2.0 * tan_meio_y)
    dist_x = (largura_proj * 1.26) / (2.0 * tan_meio_x)
    distancia = max(dist_x, dist_y, 1.1 * altura_m) + 0.35 * profundidade_m

    vetor_cam = Vector((
        math.sin(azimute) * math.cos(elevacao) * distancia * sinal_x,
        math.cos(azimute) * math.cos(elevacao) * distancia * sinal_frente,
        math.sin(elevacao) * distancia,
    ))
    cam_obj = bpy.data.objects.new("forja_camera", cam_dados)
    cam_obj.location = alvo + vetor_cam
    cam_obj.rotation_euler = (alvo - cam_obj.location).to_track_quat("-Z", "Y").to_euler()
    cena.collection.objects.link(cam_obj)
    cena.camera = cam_obj

    # Iluminação de estúdio de 4 pontos (AREA lights físicas idênticas nos dois motores)
    s = escala_cena
    s2 = s * s
    definicao_luzes = [
        ("forja_luz_principal", 380.0 * s2, 3.0 * s, (1.00, 0.96, 0.90),
         Vector((cx + 2.4 * s * sinal_x, cy + 2.8 * s * sinal_frente, zmin + 2.85 * s))),
        ("forja_luz_preenchimento", 180.0 * s2, 3.2 * s, (0.82, 0.89, 1.00),
         Vector((cx - 2.6 * s * sinal_x, cy + 2.2 * s * sinal_frente, zmin + 2.05 * s))),
        ("forja_luz_recorte", 240.0 * s2, 2.8 * s, (1.00, 0.84, 0.64),
         Vector((cx - 2.3 * s * sinal_x, cy - 2.6 * s * sinal_frente, zmin + 2.80 * s))),
        ("forja_luz_topo", 120.0 * s2, 2.4 * s, (1.00, 1.00, 1.00),
         Vector((cx, cy - 0.3 * s * sinal_frente, zmin + 3.55 * s))),
    ]
    luzes_resumo = []
    for nome_luz, energia, tamanho, cor, pos in definicao_luzes:
        dados_luz = bpy.data.lights.new(nome_luz, type="AREA")
        dados_luz.energy = energia
        dados_luz.size = tamanho
        dados_luz.color = cor
        ob_luz = bpy.data.objects.new(nome_luz, dados_luz)
        ob_luz.location = pos
        ob_luz.rotation_euler = (alvo - pos).to_track_quat("-Z", "Y").to_euler()
        cena.collection.objects.link(ob_luz)
        luzes_resumo.append({
            "nome": nome_luz,
            "tipo": "AREA",
            "energia_w": round(energia, 2),
            "tamanho_m": round(tamanho, 3),
            "cor_rgb": list(cor),
            "posicao": [round(v, 4) for v in pos],
        })

    # Resolução, formato de saída e gerenciamento de cor idênticos
    cena.render.resolution_x = largura_px
    cena.render.resolution_y = altura_px
    cena.render.resolution_percentage = 100
    cena.render.film_transparent = False
    cena.render.image_settings.file_format = "PNG"
    cena.render.image_settings.color_mode = "RGB"
    cena.render.image_settings.color_depth = "8"
    cena.view_settings.exposure = 0.0
    cena.view_settings.gamma = 1.0

    bpy.context.view_layer.update()
    return {
        "resolucao_px": [largura_px, altura_px],
        "geometria_enquadrada": geom,
        "frente_usada": {"sinal_y": sinal_frente, "origem": frente_info["criterio"]},
        "piso_z_m": round(zmin, 4),
        "camera": {
            "lente_mm": cam_dados.lens,
            "sensor_mm": cam_dados.sensor_width,
            "posicao": [round(v, 4) for v in cam_obj.location],
            "alvo": [round(v, 4) for v in alvo],
            "distancia_m": round(distancia, 4),
        },
        "luzes": luzes_resumo,
        "gerenciamento_cor": {
            "display_device": cena.display_settings.display_device,
            "view_transform": cena.view_settings.view_transform,
            "look": cena.view_settings.look,
            "exposure": cena.view_settings.exposure,
            "gamma": cena.view_settings.gamma,
        },
    }


def configurar_motor_render(motor_pedido: str, amostras: int) -> dict[str, Any]:
    import bpy  # type: ignore

    cena = bpy.context.scene
    engines_disp = {
        item.identifier
        for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    }
    avisos: list[str] = []

    if motor_pedido.upper() == "CYCLES":
        cena.render.engine = "CYCLES"
        cena.cycles.device = "CPU"
        cena.cycles.samples = amostras
        if hasattr(cena.cycles, "use_adaptive_sampling"):
            cena.cycles.use_adaptive_sampling = True
            cena.cycles.adaptive_threshold = 0.01
        denoiser_usado = None
        if hasattr(cena.cycles, "use_denoising"):
            try:
                denoisers = [
                    it.identifier
                    for it in cena.cycles.bl_rna.properties["denoiser"].enum_items
                ]
                if "OPENIMAGEDENOISE" in denoisers:
                    cena.cycles.use_denoising = True
                    cena.cycles.denoiser = "OPENIMAGEDENOISE"
                    denoiser_usado = "OPENIMAGEDENOISE"
                else:
                    cena.cycles.use_denoising = False
                    avisos.append(f"OPENIMAGEDENOISE indisponível ({denoisers}); denoising desativado.")
            except Exception as exc:  # noqa: BLE001
                cena.cycles.use_denoising = False
                avisos.append(f"Falha ao configurar denoiser Cycles: {exc}")
        return {
            "motor_solicitado": "CYCLES",
            "engine_id_blender": cena.render.engine,
            "dispositivo": cena.cycles.device,
            "amostras": cena.cycles.samples,
            "adaptive_sampling": getattr(cena.cycles, "use_adaptive_sampling", None),
            "denoiser": denoiser_usado,
            "threads_modo": cena.render.threads_mode,
            "threads": cena.render.threads,
            "avisos_configuracao": avisos,
        }

    if motor_pedido.upper() == "EEVEE":
        if "BLENDER_EEVEE_NEXT" in engines_disp:
            cena.render.engine = "BLENDER_EEVEE_NEXT"
        elif "BLENDER_EEVEE" in engines_disp:
            cena.render.engine = "BLENDER_EEVEE"
        else:
            raise RuntimeError(f"Motor EEVEE não encontrado em {sorted(engines_disp)}")

        eevee = cena.eevee
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = amostras
        if hasattr(eevee, "use_shadows"):
            eevee.use_shadows = True
        return {
            "motor_solicitado": "EEVEE",
            "engine_id_blender": cena.render.engine,
            "amostras": getattr(eevee, "taa_render_samples", amostras),
            "use_shadows": getattr(eevee, "use_shadows", None),
            "use_raytracing": getattr(eevee, "use_raytracing", None),
            "avisos_configuracao": avisos,
        }

    raise ValueError(f"Motor desconhecido: {motor_pedido}")


def extrair_pico_stats_blender(stats_linhas: list[str]) -> float | None:
    """Extrai o maior valor Mem/Peak (em MiB) reportado pelo callback render_stats do Blender."""
    unidades = {"B": 1.0 / (1024.0 * 1024.0), "K": 1.0 / 1024.0, "M": 1.0, "G": 1024.0}
    maior_mb: float | None = None
    padrao = re.compile(r"(?:Peak|Mem)[:\s]+([0-9]+(?:\.[0-9]+)?)\s*([BKMG])", re.IGNORECASE)
    for texto in stats_linhas:
        for valor_s, unid in padrao.findall(texto):
            mb = float(valor_s) * unidades.get(unid.upper(), 1.0)
            if maior_mb is None or mb > maior_mb:
                maior_mb = mb
    return round(maior_mb, 2) if maior_mb is not None else None


def executar_modo_renderizar(args: argparse.Namespace) -> int:
    import bpy  # type: ignore

    t_proc_0 = time.perf_counter()
    mem_inicio = ler_memoria_proc_mb()
    stats_capturados: list[str] = []

    def _on_stats(texto: str) -> None:
        stats_capturados.append(str(texto))

    bpy.app.handlers.render_stats.append(_on_stats)
    resultado: dict[str, Any] = {
        "personagem": args.personagem,
        "motor": args.motor.upper(),
        "modelo_entrada": args.modelo,
        "saida_png": args.saida_png,
        "sucesso": False,
        "memoria_inicio": mem_inicio,
    }

    try:
        imp = importar_modelo_blender(args.modelo)
        resultado["importacao"] = imp
        resultado["memoria_pos_importacao"] = ler_memoria_proc_mb()
        if not imp["sucesso"]:
            raise RuntimeError(f"Falha ao importar {args.modelo}: {imp['erro']}")

        t_cena_0 = time.perf_counter()
        cena_cfg = montar_cena_comparativa(
            largura_px=args.largura,
            altura_px=args.altura,
            sinal_frente_forcado=args.sinal_frente,
        )
        motor_cfg = configurar_motor_render(args.motor, args.amostras)
        tempo_prep_cena = round(time.perf_counter() - t_cena_0, 4)

        resultado["cena"] = cena_cfg
        resultado["configuracao_motor"] = motor_cfg
        resultado["tempo_preparacao_cena_s"] = tempo_prep_cena

        os.makedirs(os.path.dirname(os.path.abspath(args.saida_png)), exist_ok=True)
        bpy.context.scene.render.filepath = os.path.abspath(args.saida_png)

        # Render 1 (frio): inclui compilação inicial de shaders (EEVEE) / BVH (Cycles)
        ru_antes_frio = resource.getrusage(resource.RUSAGE_SELF)
        t_frio_0 = time.perf_counter()
        with capturar_saida_nativa() as tmp_frio_log:
            bpy.ops.render.render(write_still=True)
        tempo_render_frio = round(time.perf_counter() - t_frio_0, 4)
        ru_depois_frio = resource.getrusage(resource.RUSAGE_SELF)
        log_frio = ler_e_apagar(tmp_frio_log)
        mem_pos_frio = ler_memoria_proc_mb()

        gpu_pos_render = consultar_gpu_blender()

        # Render 2 (quente): mede custo por quadro em regime permanente (câmera/shaders/BVH já prontos)
        fd_warm, caminho_warm = tempfile.mkstemp(suffix=".png", prefix="forja_warm_")
        os.close(fd_warm)
        try:
            bpy.context.scene.render.filepath = caminho_warm
            ru_antes_quente = resource.getrusage(resource.RUSAGE_SELF)
            t_quente_0 = time.perf_counter()
            with capturar_saida_nativa() as tmp_quente_log:
                bpy.ops.render.render(write_still=True)
            tempo_render_quente = round(time.perf_counter() - t_quente_0, 4)
            ru_depois_quente = resource.getrusage(resource.RUSAGE_SELF)
            _ = ler_e_apagar(tmp_quente_log)
        finally:
            try:
                os.unlink(caminho_warm)
            except OSError:
                pass

        mem_final = ler_memoria_proc_mb()
        png_existe = os.path.isfile(args.saida_png) and os.path.getsize(args.saida_png) > 0
        if not png_existe:
            raise RuntimeError(f"PNG de saída ausente ou vazio: {args.saida_png}")

        cpu_frio_user = round(ru_depois_frio.ru_utime - ru_antes_frio.ru_utime, 4)
        cpu_frio_sys = round(ru_depois_frio.ru_stime - ru_antes_frio.ru_stime, 4)
        cpu_quente_user = round(ru_depois_quente.ru_utime - ru_antes_quente.ru_utime, 4)
        cpu_quente_sys = round(ru_depois_quente.ru_stime - ru_antes_quente.ru_stime, 4)

        avisos_render = [
            linha.strip()
            for linha in log_frio.splitlines()
            if any(k in linha.upper() for k in ("WARN", "ERROR", "OPENGL", "EGL", "SHADER", "LLVMPIPE", "MESA"))
        ]

        resultado.update({
            "sucesso": True,
            "png_bytes": os.path.getsize(args.saida_png),
            "tempos_s": {
                "importacao": imp["tempo_s"],
                "preparacao_cena": tempo_prep_cena,
                "render_frio": tempo_render_frio,
                "render_quente": tempo_render_quente,
                "cpu_frio_total": round(cpu_frio_user + cpu_frio_sys, 4),
                "cpu_frio_user": cpu_frio_user,
                "cpu_frio_sys": cpu_frio_sys,
                "cpu_quente_total": round(cpu_quente_user + cpu_quente_sys, 4),
                "processo_total": round(time.perf_counter() - t_proc_0, 4),
            },
            "memoria_mb": {
                "rss_inicio": mem_inicio["vm_rss_mb"],
                "rss_pos_importacao": resultado["memoria_pos_importacao"]["vm_rss_mb"],
                "rss_pos_render_frio": mem_pos_frio["vm_rss_mb"],
                "pico_rss_hwm_pos_frio": mem_pos_frio["vm_hwm_mb"],
                "pico_rss_hwm_processo": mem_final["vm_hwm_mb"],
                "pico_virtual_vmpeak": mem_final["vm_peak_mb"],
                "pico_interno_blender": extrair_pico_stats_blender(stats_capturados),
            },
            "gpu_opengl": gpu_pos_render,
            "amostra_render_stats": stats_capturados[-8:],
            "avisos_render": avisos_render[:40],
            "trecho_log_render": log_frio[-3000:] if log_frio else "",
        })
    except Exception as exc:  # noqa: BLE001
        resultado["sucesso"] = False
        resultado["erro"] = f"{type(exc).__name__}: {exc}"
        resultado["traceback"] = traceback.format_exc()
        resultado["memoria_erro"] = ler_memoria_proc_mb()
        resultado["gpu_opengl"] = consultar_gpu_blender()
    finally:
        if _on_stats in bpy.app.handlers.render_stats:
            bpy.app.handlers.render_stats.remove(_on_stats)

    os.makedirs(os.path.dirname(os.path.abspath(args.saida_json)), exist_ok=True)
    with open(args.saida_json, "w", encoding="utf-8") as fh:
        json.dump(resultado, fh, ensure_ascii=False, indent=2)

    print("[render-motor]", json.dumps({
        "personagem": resultado["personagem"],
        "motor": resultado["motor"],
        "sucesso": resultado["sucesso"],
        "tempos_s": resultado.get("tempos_s"),
        "memoria_mb": resultado.get("memoria_mb"),
        "erro": resultado.get("erro"),
    }, ensure_ascii=False))
    return 0 if resultado["sucesso"] else 1


def resolver_binario_blender(explicito: str | None) -> str:
    if explicito:
        return explicito
    try:
        import bpy  # type: ignore

        if getattr(bpy.app, "binary_path", None):
            return bpy.app.binary_path
    except Exception:
        pass
    return "blender"


def executar_modo_comparar(args: argparse.Namespace) -> int:
    with open(args.auditoria, "r", encoding="utf-8") as fh:
        auditoria = json.load(fh)

    blender_bin = resolver_binario_blender(args.blender_bin)
    saida_dir = Path(args.saida_dir).resolve()
    logs_dir = saida_dir / "logs"
    saida_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    script_atual = str(Path(__file__).resolve())
    execucoes: list[dict[str, Any]] = []
    falhas = 0

    modelos_ordenados = sorted(
        auditoria.get("modelos", []),
        key=lambda m: 0 if m.get("personagem") == "masculino" else 1,
    )

    for modelo_info in modelos_ordenados:
        personagem = modelo_info["personagem"]
        caminho_modelo = modelo_info.get("caminho_modelo_render")
        sinal_frente = (
            ((modelo_info.get("inspecao_cena") or {}).get("frente_detectada") or {}).get("sinal_y")
        )

        for motor in ("CYCLES", "EEVEE"):
            motor_slug = motor.lower()
            amostras = args.amostras_cycles if motor == "CYCLES" else args.amostras_eevee
            saida_png = str(saida_dir / f"{personagem}-{motor_slug}.png")
            saida_metrica_json = str(saida_dir / f".metrica-{personagem}-{motor_slug}.json")
            log_subproc = logs_dir / f"render-{personagem}-{motor_slug}.log"

            if not caminho_modelo:
                falhas += 1
                execucoes.append({
                    "personagem": personagem,
                    "motor": motor,
                    "sucesso": False,
                    "erro": "Modelo não pôde ser importado na auditoria prévia; renderização não executada.",
                })
                continue

            cmd = []
            if args.usar_xvfb:
                cmd.extend(["xvfb-run", "-a", "-s", "-screen 0 1920x1080x24 +iglx"])
            cmd.extend([
                blender_bin,
                "--background",
                "--factory-startup",
                "--python",
                script_atual,
                "--",
                "--modo",
                "renderizar",
                "--personagem",
                personagem,
                "--modelo",
                caminho_modelo,
                "--motor",
                motor,
                "--saida-png",
                saida_png,
                "--saida-json",
                saida_metrica_json,
                "--largura",
                str(args.largura),
                "--altura",
                str(args.altura),
                "--amostras",
                str(amostras),
            ])
            if sinal_frente in (-1.0, 1.0):
                cmd.extend(["--sinal-frente", str(sinal_frente)])

            env = os.environ.copy()
            env.setdefault("LIBGL_ALWAYS_SOFTWARE", "1")
            env.setdefault("GALLIUM_DRIVER", "llvmpipe")

            print(f"[comparar] iniciando {personagem} × {motor} ({args.largura}x{args.altura}, {amostras} amostras)...")
            t0 = time.perf_counter()
            proc = subprocess.run(cmd, capture_output=True, text=True, env=env, check=False)
            dur_parede = round(time.perf_counter() - t0, 4)

            log_subproc.write_text(
                f"$ {' '.join(cmd)}\n"
                f"exit_code={proc.returncode} wall_s={dur_parede}\n\n"
                f"=== STDOUT ===\n{proc.stdout}\n\n=== STDERR ===\n{proc.stderr}\n",
                encoding="utf-8",
            )

            if os.path.isfile(saida_metrica_json):
                with open(saida_metrica_json, "r", encoding="utf-8") as fh:
                    dados_exec = json.load(fh)
                try:
                    os.unlink(saida_metrica_json)
                except OSError:
                    pass
            else:
                dados_exec = {
                    "personagem": personagem,
                    "motor": motor,
                    "modelo_entrada": caminho_modelo,
                    "saida_png": saida_png,
                    "sucesso": False,
                    "erro": f"Subprocesso Blender encerrou sem JSON de métricas (código {proc.returncode}).",
                }

            dados_exec["codigo_saida_processo"] = proc.returncode
            dados_exec["tempo_parede_subprocesso_s"] = dur_parede
            dados_exec["arquivo_log"] = str(log_subproc.relative_to(saida_dir))
            if not dados_exec.get("sucesso"):
                falhas += 1
            execucoes.append(dados_exec)

    bruto = {
        "gerado_em_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "parametros_comparacao": {
            "largura_px": args.largura,
            "altura_px": args.altura,
            "amostras_cycles": args.amostras_cycles,
            "amostras_eevee": args.amostras_eevee,
            "usar_xvfb": bool(args.usar_xvfb),
        },
        "auditoria": auditoria,
        "execucoes": execucoes,
        "falhas_execucao": falhas,
    }

    saida_bruta = Path(args.saida_json).resolve()
    saida_bruta.parent.mkdir(parents=True, exist_ok=True)
    saida_bruta.write_text(json.dumps(bruto, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[comparar] relatório bruto gravado em {saida_bruta} (falhas={falhas})")
    return 0 if falhas == 0 else 1


def construir_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="FORJA — Comparação controlada Cycles vs EEVEE no Blender 4.2.1")
    p.add_argument("--modo", choices=["auditar", "renderizar", "comparar"], default="comparar")

    # argumentos --modo auditar
    p.add_argument("--preparacao", help="JSON gerado pela etapa de inspeção/Meshopt")
    p.add_argument("--log-importacao", help="Caminho do log textual de importação no Blender")
    p.add_argument("--clipe-forja", default="assets/3d/animacoes/postura-base.glb")

    # argumentos --modo renderizar (worker isolado por motor)
    p.add_argument("--personagem", help="masculino ou feminino")
    p.add_argument("--modelo", help="Caminho do GLB preparado para renderizar")
    p.add_argument("--motor", choices=["CYCLES", "EEVEE", "cycles", "eevee"])
    p.add_argument("--saida-png", help="PNG de saída do worker")
    p.add_argument("--amostras", type=int, default=64)
    p.add_argument("--sinal-frente", type=float, default=None)

    # argumentos --modo comparar (orquestrador)
    p.add_argument("--auditoria", help="JSON produzido por --modo auditar")
    p.add_argument("--saida-dir", default="docs/validacao-3d/comparacao-motores")
    p.add_argument("--saida-json", required=True, help="JSON de saída do modo escolhido")
    p.add_argument("--largura", type=int, default=720)
    p.add_argument("--altura", type=int, default=960)
    p.add_argument("--amostras-cycles", type=int, default=64)
    p.add_argument("--amostras-eevee", type=int, default=64)
    p.add_argument("--blender-bin", default=None)
    p.add_argument("--usar-xvfb", action="store_true")
    return p


def main() -> int:
    parser = construir_parser()
    args = parser.parse_args(extrair_args_usuario())
    if args.modo == "auditar":
        if not args.preparacao:
            parser.error("--preparacao é obrigatório em --modo auditar")
        return executar_modo_auditar(args)
    if args.modo == "renderizar":
        if not (args.personagem and args.modelo and args.motor and args.saida_png):
            parser.error("--personagem, --modelo, --motor e --saida-png são obrigatórios em --modo renderizar")
        return executar_modo_renderizar(args)
    if not args.auditoria:
        parser.error("--auditoria é obrigatório em --modo comparar")
    return executar_modo_comparar(args)


if __name__ == "__main__":
    sys.exit(main())
