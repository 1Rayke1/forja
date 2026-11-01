#!/usr/bin/env python3
"""
FORJA — Piloto controlado do exercício abdominal tradicional (crunch abdominal)
com o modelo masculino original (`DOC-20261031-WA0008.bin`) e Blender Cycles.

Modos de operação:
  1. `--modo prevalidar`:
     - importa o modelo masculino original decodificado de Meshopt (preservando
       os 78 ossos, pesos de skin e 3 texturas 4K originais);
     - lê diretamente o clipe `assets/3d/animacoes/abdominal-supra.glb`
       (`gentle-curl-up`, 3,000 s, 16 nós) e executa o retarget anatômico sem
       inventar movimentos artificiais;
     - constrói o cenário escuro com colchonete chanfrado, iluminação limpa de
       estúdio e duas câmeras genuinamente independentes (`1280x720` horizontal
       16:9 e `720x1280` vertical 9:16);
     - audita os 90 quadros (30 FPS) na malha deformada real (correspondência
       de ossos, fechamento do loop, biomecânica abdominal, contato consistente
       com o colchonete, ausência de interpenetração mão/antebraço × tronco/coxa
       via KDTree e visibilidade integral do corpo + colchonete nas duas câmeras);
     - se `--falhar-se-invalido` estiver ativo e houver incompatibilidade, grava
       o diagnóstico completo e interrompe antes da renderização final;
     - renderiza quadros diagnósticos reais no Cycles (`OPENIMAGEDENOISE`) nos
       dois formatos independentes para inspeção visual pré-render e aferição de
       tempo/memória.

  2. `--modo render`:
     - reconstrói deterministicamente a mesma cena, animação de 90 quadros e
       câmera específica do formato (`horizontal` 1280x720 ou `vertical` 720x1280)
       e renderiza a fatia `[--quadro-inicio .. --quadro-fim]` com Cycles
       (`use_persistent_data=True`, semente fixa, `OPENIMAGEDENOISE`).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import resource
import struct
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


FPS_PILOTO = 30
TOTAL_QUADROS_CICLO = 90  # 3.000 s exatos a 30 FPS (quadros 1..90 -> t = 0/30 .. 89/30 s)
DURACAO_CICLO_S = 3.0

# Pesos anatômicos de distribuição na coluna torácica/lombar (soma = 1.000)
# Com fator analítico de preservação de corda (`Waist -> NeckTwist01`), reproduz
# exatamente a inclinação de corda `spine -> neck` (~22°) do clipe original.
PESOS_COLUNA_TORACICA = (
    ("Waist", 0.20),
    ("Spine01", 0.45),
    ("Spine02", 0.35),
)
PESOS_COLUNA_CERVICAL = (
    ("NeckTwist01", 0.40),
    ("NeckTwist02", 0.35),
    ("Head", 0.25),
)
# Offset estático constante de folga coronal dos braços para contornar a barra
# lateral da bermuda esportiva do modelo realista ( detectado na pré-validação q23-q25 )
AFASTAMENTO_CORONAL_BRACO_GRAUS = 9.0

TABELA_CORRESPONDENCIA_OSSOS = [
    {
        "origem_clipe": "hips",
        "destino_rig_78": ["Hip", "Pelvis"],
        "papel_anatomico": "Raiz corporal e pelve em decúbito dorsal sobre o colchonete",
        "metodo": "Delta de mundo guinado + calibração fechada de contato sacral no colchonete",
    },
    {
        "origem_clipe": "spine",
        "destino_rig_78": ["Waist (15%)", "Spine01 (45%)", "Spine02 (40%)"],
        "papel_anatomico": "Flexão torácica progressiva do crunch abdominal (~0° → 22° → 0°)",
        "metodo": "Distribuição vertebral contínua com soma exata = 100% da curva original",
    },
    {
        "origem_clipe": "neck",
        "destino_rig_78": ["NeckTwist01 (40%)", "NeckTwist02 (35%)", "Head (25%)"],
        "papel_anatomico": "Estabilização e flexão cervical neutra acompanhando o tronco (~0° → 20° → 0°)",
        "metodo": "Distribuição cervical contínua com soma exata = 100% (+ FacialBone/Eyes solidários)",
    },
    {
        "origem_clipe": "armL",
        "destino_rig_78": ["L_Clavicle (10%)", "L_Upperarm", "L_UpperarmTwist01", "L_UpperarmTwist02"],
        "papel_anatomico": "Braço esquerdo estendido acompanhando a elevação do tronco sem cruzar a coxa",
        "metodo": "Direção real (armL→elbowL) transportada pelo referencial da coluna (zero torção de holonomia)",
    },
    {
        "origem_clipe": "elbowL",
        "destino_rig_78": ["L_Forearm", "L_ForearmTwist01", "L_ForearmTwist02", "L_ElbowShareBone (50%)"],
        "papel_anatomico": "Antebraço esquerdo com leve flexão fisiológica constante (~6°)",
        "metodo": "Direção real (elbowL→handL) transportada pelo braço + bissetriz no ShareBone",
    },
    {
        "origem_clipe": "handL",
        "destino_rig_78": ["L_Hand", "L_Thumb1..3", "L_Index1..3", "L_Mid1..3", "L_Ring1..3", "L_Pinky1..3"],
        "papel_anatomico": "Punho e mão esquerda neutros com palma voltada medialmente",
        "metodo": "Continuidade do delta do antebraço mantendo repouso anatômico dos dedos",
    },
    {
        "origem_clipe": "armR",
        "destino_rig_78": ["R_Clavicle (10%)", "R_Upperarm", "R_UpperarmTwist01", "R_UpperarmTwist02"],
        "papel_anatomico": "Braço direito simétrico acompanhando a elevação do tronco",
        "metodo": "Direção real (armR→elbowR) transportada pelo referencial da coluna",
    },
    {
        "origem_clipe": "elbowR",
        "destino_rig_78": ["R_Forearm", "R_ForearmTwist01", "R_ForearmTwist02", "R_ElbowShareBone (50%)"],
        "papel_anatomico": "Antebraço direito com leve flexão fisiológica constante (~6°)",
        "metodo": "Direção real (elbowR→handR) transportada pelo braço + bissetriz no ShareBone",
    },
    {
        "origem_clipe": "handR",
        "destino_rig_78": ["R_Hand", "R_Thumb1..3", "R_Index1..3", "R_Mid1..3", "R_Ring1..3", "R_Pinky1..3"],
        "papel_anatomico": "Punho e mão direita neutros com palma voltada medialmente",
        "metodo": "Continuidade do delta do antebraço mantendo repouso anatômico dos dedos",
    },
    {
        "origem_clipe": "legL",
        "destino_rig_78": ["L_Thigh", "L_ThighTwist01", "L_ThighTwist02"],
        "papel_anatomico": "Coxa esquerda flexionada (~42°–44°) mantendo joelho elevado",
        "metodo": "Cadeia fechada sagital de 2 elos preservando ângulo de joelho (~94°) e pé fixo",
    },
    {
        "origem_clipe": "kneeL",
        "destino_rig_78": ["L_Calf", "L_CalfTwist01", "L_CalfTwist02", "L_KneeShareBone (50%)"],
        "papel_anatomico": "Perna esquerda flexionada (~94°) conectando joelho ao pé plantado",
        "metodo": "Direção exata joelho→tornozelo + bissetriz patelar 50% em L_KneeShareBone",
    },
    {
        "origem_clipe": "footL",
        "destino_rig_78": ["L_Foot", "L_ToeBase"],
        "papel_anatomico": "Pé esquerdo plantado com sola inteira apoiada sobre o colchonete",
        "metodo": "Orientação plantar horizontal de repouso travada sem deslizamento (drift = 0 mm)",
    },
    {
        "origem_clipe": "legR",
        "destino_rig_78": ["R_Thigh", "R_ThighTwist01", "R_ThighTwist02"],
        "papel_anatomico": "Coxa direita flexionada (~42°–44°) mantendo joelho elevado",
        "metodo": "Cadeia fechada sagital de 2 elos preservando ângulo de joelho (~94°) e pé fixo",
    },
    {
        "origem_clipe": "kneeR",
        "destino_rig_78": ["R_Calf", "R_CalfTwist01", "R_CalfTwist02", "R_KneeShareBone (50%)"],
        "papel_anatomico": "Perna direita flexionada (~94°) conectando joelho ao pé plantado",
        "metodo": "Direção exata joelho→tornozelo + bissetriz patelar 50% em R_KneeShareBone",
    },
    {
        "origem_clipe": "footR",
        "destino_rig_78": ["R_Foot", "R_ToeBase"],
        "papel_anatomico": "Pé direito plantado com sola inteira apoiada sobre o colchonete",
        "metodo": "Orientação plantar horizontal de repouso travada sem deslizamento (drift = 0 mm)",
    },
]


def extrair_args_usuario() -> list[str]:
    argv = sys.argv
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return argv[1:]


def ler_memoria_proc_mb() -> dict[str, float | None]:
    resultado: dict[str, float | None] = {"vm_rss_mb": None, "vm_hwm_mb": None, "vm_peak_mb": None}
    mapa = {"VmRSS:": "vm_rss_mb", "VmHWM:": "vm_hwm_mb", "VmPeak:": "vm_peak_mb"}
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as fh:
            for linha in fh:
                partes = linha.split()
                if len(partes) >= 2 and partes[0] in mapa:
                    resultado[mapa[partes[0]]] = round(float(partes[1]) / 1024.0, 2)
    except OSError:
        pass
    if resultado["vm_hwm_mb"] is None:
        ru = resource.getrusage(resource.RUSAGE_SELF)
        if ru.ru_maxrss > 0:
            resultado["vm_hwm_mb"] = round(ru.ru_maxrss / 1024.0, 2)
    return resultado


@contextlib.contextmanager
def capturar_saida_nativa():
    sys.stdout.flush()
    sys.stderr.flush()
    fd_out = os.dup(1)
    fd_err = os.dup(2)
    tmp = tempfile.NamedTemporaryFile(mode="w+b", delete=False)
    caminho = tmp.name
    try:
        os.dup2(tmp.fileno(), 1)
        os.dup2(tmp.fileno(), 2)
        yield caminho
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        os.dup2(fd_out, 1)
        os.dup2(fd_err, 2)
        os.close(fd_out)
        os.close(fd_err)
        tmp.close()


def ler_e_apagar(caminho: str) -> str:
    try:
        with open(caminho, "r", encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
    except OSError:
        txt = ""
    try:
        os.unlink(caminho)
    except OSError:
        pass
    return txt


def malhas_personagem_renderizaveis() -> tuple[list[Any], list[str]]:
    import bpy  # type: ignore

    shapes_osso = set()
    for arm in bpy.data.objects:
        if arm.type == "ARMATURE" and getattr(arm, "pose", None):
            for pb in arm.pose.bones:
                if getattr(pb, "custom_shape", None) is not None:
                    shapes_osso.add(pb.custom_shape.name)

    nomes_vl = {ob.name for ob in bpy.context.view_layer.objects}
    reais = []
    ignoradas = []
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name.startswith("forja_"):
            continue
        cols = [c.name.lower() for c in getattr(ob, "users_collection", [])]
        eh_widget = (
            ob.hide_render
            or ob.name in shapes_osso
            or any("gltf_not_exported" in c for c in cols)
            or ob.name not in nomes_vl
        )
        if eh_widget:
            ignoradas.append(ob.name)
        else:
            reais.append(ob)
    return reais, ignoradas


# ---------------------------------------------------------------------------
# Leitura binária direta do clipe GLB (`abdominal-supra.glb`) e avaliação FK
# ---------------------------------------------------------------------------

def carregar_clipe_glb(caminho_glb: str) -> dict[str, Any]:
    """Lê hierarquia, repouso e canais de animação de um GLB 2.0 convertendo Y-up -> Z-up."""
    from mathutils import Quaternion, Vector  # type: ignore

    with open(caminho_glb, "rb") as fh:
        magic, ver, _ = struct.unpack("<4sII", fh.read(12))
        if magic != b"glTF" or ver != 2:
            raise RuntimeError(f"Cabeçalho GLB inválido em {caminho_glb}: {magic!r} v{ver}")
        jlen, _ = struct.unpack("<II", fh.read(8))
        gltf = json.loads(fh.read(jlen).decode("utf-8"))
        blen, _ = struct.unpack("<II", fh.read(8))
        bin_buf = fh.read(blen)

    def ler_accessor(idx: int) -> list[Any]:
        acc = gltf["accessors"][idx]
        bv = gltf["bufferViews"][acc["bufferView"]]
        offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        cnt = acc["count"]
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
        ct = acc["componentType"]
        if ct != 5126:
            raise RuntimeError(f"Accessor {idx} com componentType {ct} não suportado (esperado FLOAT 5126)")
        stride = bv.get("byteStride", 4 * ncomp)
        saida: list[Any] = []
        for i in range(cnt):
            vals = struct.unpack_from(f"<{ncomp}f", bin_buf, offset + i * stride)
            saida.append(vals[0] if ncomp == 1 else list(vals))
        return saida

    def vec_gltf_para_bl(v: list[float]) -> Vector:
        # glTF (x, y, z) Y-up -> Blender (x, -z, y) Z-up
        return Vector((float(v[0]), -float(v[2]), float(v[1])))

    def quat_gltf_para_bl(q: list[float]) -> Quaternion:
        # q_gltf = [x, y, z, w] -> q_bl = Quaternion((w, x, -z, y))
        qn = Quaternion((float(q[3]), float(q[0]), -float(q[2]), float(q[1])))
        qn.normalize()
        return qn

    nos: list[dict[str, Any]] = []
    pais: dict[int, int] = {}
    indice_por_nome: dict[str, int] = {}
    for idx, n in enumerate(gltf.get("nodes", [])):
        nome = n.get("name", f"node_{idx}")
        indice_por_nome[nome] = idx
        nos.append({
            "idx": idx,
            "nome": nome,
            "pos_rest": vec_gltf_para_bl(n.get("translation", [0.0, 0.0, 0.0])),
            "rot_rest": quat_gltf_para_bl(n.get("rotation", [0.0, 0.0, 0.0, 1.0])),
            "esc_rest": Vector(tuple(float(x) for x in n.get("scale", [1.0, 1.0, 1.0]))),
            "filhos": list(n.get("children", [])),
        })
        for ch in n.get("children", []):
            pais[ch] = idx

    # Ordem topológica (pai sempre antes dos filhos)
    ordem: list[int] = []
    visitados: set[int] = set()

    def visitar(i: int) -> None:
        if i in visitados:
            return
        if i in pais:
            visitar(pais[i])
        visitados.add(i)
        ordem.append(i)

    for i in range(len(nos)):
        visitar(i)

    if not gltf.get("animations"):
        raise RuntimeError(f"GLB {caminho_glb} não contém animações.")
    anim = gltf["animations"][0]
    canais: dict[tuple[str, str], dict[str, Any]] = {}
    duracao = 0.0
    for ch in anim["channels"]:
        s = anim["samplers"][ch["sampler"]]
        tempos = [float(t) for t in ler_accessor(s["input"])]
        brutos = ler_accessor(s["output"])
        caminho_alvo = ch["target"]["path"]
        nome_no = nos[ch["target"]["node"]]["nome"]
        if caminho_alvo == "translation":
            valores = [vec_gltf_para_bl(v) for v in brutos]
        elif caminho_alvo == "rotation":
            valores = [quat_gltf_para_bl(v) for v in brutos]
        else:
            valores = [Vector((float(v[0]), float(v[1]), float(v[2]))) for v in brutos]
        if tempos:
            duracao = max(duracao, max(tempos))
        canais[(nome_no, caminho_alvo)] = {
            "tempos": tempos,
            "valores": valores,
            "interp": s.get("interpolation", "LINEAR"),
        }

    return {
        "caminho": caminho_glb,
        "nome_animacao": anim.get("name", "Animation"),
        "duracao": duracao,
        "nos": nos,
        "pais": pais,
        "ordem": ordem,
        "indice_por_nome": indice_por_nome,
        "canais": canais,
    }


def amostrar_canal(canal: dict[str, Any], t: float, eh_quat: bool):
    tempos = canal["tempos"]
    valores = canal["valores"]
    interp = canal["interp"]
    if not tempos:
        raise RuntimeError("Canal vazio")
    if t <= tempos[0] or len(tempos) == 1:
        return valores[0].copy()
    if t >= tempos[-1]:
        return valores[-1].copy()

    # Busca binária do intervalo [i, i+1]
    lo, hi = 0, len(tempos) - 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if tempos[mid] <= t:
            lo = mid
        else:
            hi = mid

    if interp == "STEP":
        return valores[lo].copy()

    dt = tempos[hi] - tempos[lo]
    fator = (t - tempos[lo]) / dt if dt > 1e-9 else 0.0
    a = valores[lo]
    b = valores[hi]
    if eh_quat:
        if a.dot(b) < 0.0:
            b = -b
        q = a.slerp(b, fator)
        q.normalize()
        return q
    return a.lerp(b, fator)


def avaliar_pose_clipe(clipe: dict[str, Any], t: float | None) -> dict[str, dict[str, Any]]:
    """
    Avalia posição e rotação de mundo (Z-up Blender) de cada nó do clipe.
    Se `t is None`, avalia a pose de repouso.
    """
    from mathutils import Quaternion  # type: ignore

    nos = clipe["nos"]
    pais = clipe["pais"]
    canais = clipe["canais"]
    pose_mundo: dict[str, dict[str, Any]] = {}
    por_idx: dict[int, tuple[Any, Any]] = {}

    for idx in clipe["ordem"]:
        no = nos[idx]
        nome = no["nome"]
        if t is None:
            pos_loc = no["pos_rest"].copy()
            rot_loc = no["rot_rest"].copy()
        else:
            c_pos = canais.get((nome, "translation"))
            c_rot = canais.get((nome, "rotation"))
            pos_loc = amostrar_canal(c_pos, t, False) if c_pos else no["pos_rest"].copy()
            rot_loc = amostrar_canal(c_rot, t, True) if c_rot else no["rot_rest"].copy()

        if idx in pais:
            p_pos, p_rot = por_idx[pais[idx]]
            w_pos = p_pos + (p_rot @ pos_loc)
            w_rot = p_rot @ rot_loc
            w_rot.normalize()
        else:
            w_pos = pos_loc
            w_rot = rot_loc.copy()
            w_rot.normalize()

        por_idx[idx] = (w_pos, w_rot)
        pose_mundo[nome] = {
            "pos": w_pos,
            "quat": w_rot,
            "pos_local": pos_loc,
            "quat_local": rot_loc,
        }
    return pose_mundo


# ---------------------------------------------------------------------------
# Retarget anatômico exato + cadeia fechada de contato no colchonete
# ---------------------------------------------------------------------------

def resolver_joelho_sagital_2_elos(
    xh: float,
    zh: float,
    xa: float,
    za: float,
    l_coxa: float,
    l_perna: float,
) -> tuple[float, float]:
    """
    Resolve analiticamente (Lei dos Cossenos) a posição (x, z) do joelho no plano
    sagital para quadril (xh, zh) e tornozelo plantado (xa, za), com polo +Z.
    """
    vx = xa - xh
    vz = za - zh
    dist = math.hypot(vx, vz)
    d_min = abs(l_coxa - l_perna) + 1e-5
    d_max = (l_coxa + l_perna) - 1e-5
    dist_clamped = min(max(dist, d_min), d_max)
    if dist < 1e-8:
        return xh, zh + l_coxa

    cos_a = (l_coxa * l_coxa + dist_clamped * dist_clamped - l_perna * l_perna) / (2.0 * l_coxa * dist_clamped)
    cos_a = min(max(cos_a, -1.0), 1.0)
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))

    ux = vx / dist
    uz = vz / dist
    # Perpendicular no plano XZ apontando para +Z (como ux > 0, (-uz, +ux) tem componente Z > 0)
    px, pz = -uz, ux
    if pz < 0.0:
        px, pz = -px, -pz

    kx = xh + l_coxa * (cos_a * ux + sin_a * px)
    kz = zh + l_coxa * (cos_a * uz + sin_a * pz)
    return kx, kz


def auditar_grupos_vertices(arm_obj: Any, malhas: list[Any]) -> dict[str, Any]:
    """Classifica vértices por região anatômica para medição exata de contato e interpenetração."""
    from mathutils import Vector  # type: ignore

    grupos_tronco_cabeca = {
        "Hip", "Pelvis", "Waist", "Spine01", "Spine02",
        "NeckTwist01", "NeckTwist02", "Head", "FacialBone", "L_Eye", "R_Eye",
        "L_Clavicle", "R_Clavicle",
    }
    grupos_pelve_lombar = {"Hip", "Pelvis", "Waist", "Spine01"}
    grupos_pe_esq = {"L_Foot", "L_ToeBase"}
    grupos_pe_dir = {"R_Foot", "R_ToeBase"}
    grupos_mao_antebraco = {
        "L_Forearm", "L_ForearmTwist01", "L_ForearmTwist02", "L_Hand",
        "L_Thumb1", "L_Thumb2", "L_Thumb3", "L_Index1", "L_Index2", "L_Index3",
        "L_Mid1", "L_Mid2", "L_Mid3", "L_Ring1", "L_Ring2", "L_Ring3",
        "L_Pinky1", "L_Pinky2", "L_Pinky3",
        "R_Forearm", "R_ForearmTwist01", "R_ForearmTwist02", "R_Hand",
        "R_Thumb1", "R_Thumb2", "R_Thumb3", "R_Index1", "R_Index2", "R_Index3",
        "R_Mid1", "R_Mid2", "R_Mid3", "R_Ring1", "R_Ring2", "R_Ring3",
        "R_Pinky1", "R_Pinky2", "R_Pinky3",
    }
    grupos_bracos_completos = grupos_mao_antebraco | {
        "L_Upperarm", "L_UpperarmTwist01", "L_UpperarmTwist02", "L_ElbowShareBone",
        "R_Upperarm", "R_UpperarmTwist01", "R_UpperarmTwist02", "R_ElbowShareBone",
    }
    grupos_corpo_inferior_tronco = {
        "Hip", "Pelvis", "Waist", "Spine01",
        "L_Thigh", "L_ThighTwist01", "L_ThighTwist02", "L_Calf", "L_CalfTwist01", "L_CalfTwist02",
        "R_Thigh", "R_ThighTwist01", "R_ThighTwist02", "R_Calf", "R_CalfTwist01", "R_CalfTwist02",
    }

    soma_pesos_osso: dict[str, float] = {b.name: 0.0 for b in arm_obj.data.bones}
    indices_por_malha: list[dict[str, list[int]]] = []
    z_min_rest_pe_esq = float("inf")
    z_min_rest_pe_dir = float("inf")
    z_min_rest_global = float("inf")
    z_max_rest_global = float("-inf")

    for ob in malhas:
        mw = ob.matrix_world
        mapa_vg = {vg.index: vg.name for vg in ob.vertex_groups}
        idx_tronco: list[int] = []
        idx_pelve: list[int] = []
        idx_pe_l: list[int] = []
        idx_pe_r: list[int] = []
        idx_mao_ant: list[int] = []
        idx_bracos: list[int] = []
        idx_corpo_inf: list[int] = []

        # Subamostragem determinística para consultas rápidas (~40k vértices totais)
        passo = max(1, len(ob.data.vertices) // 45000)
        for v_idx, vert in enumerate(ob.data.vertices):
            p_w = mw @ Vector(vert.co)
            if p_w.z < z_min_rest_global:
                z_min_rest_global = p_w.z
            if p_w.z > z_max_rest_global:
                z_max_rest_global = p_w.z

            melhor_grupo = None
            melhor_peso = 0.0
            for g in vert.groups:
                nome_g = mapa_vg.get(g.group)
                if nome_g is not None:
                    if nome_g in soma_pesos_osso:
                        soma_pesos_osso[nome_g] += float(g.weight)
                    if g.weight > melhor_peso:
                        melhor_peso = float(g.weight)
                        melhor_grupo = nome_g

            if melhor_grupo in grupos_pe_esq and p_w.z < z_min_rest_pe_esq:
                z_min_rest_pe_esq = p_w.z
            if melhor_grupo in grupos_pe_dir and p_w.z < z_min_rest_pe_dir:
                z_min_rest_pe_dir = p_w.z

            if v_idx % passo != 0:
                continue

            if melhor_grupo in grupos_tronco_cabeca:
                idx_tronco.append(v_idx)
            if melhor_grupo in grupos_pelve_lombar:
                idx_pelve.append(v_idx)
            if melhor_grupo in grupos_pe_esq:
                idx_pe_l.append(v_idx)
            if melhor_grupo in grupos_pe_dir:
                idx_pe_r.append(v_idx)
            if melhor_grupo in grupos_mao_antebraco:
                idx_mao_ant.append(v_idx)
            if melhor_grupo in grupos_bracos_completos:
                idx_bracos.append(v_idx)
            if melhor_grupo in grupos_corpo_inferior_tronco:
                idx_corpo_inf.append(v_idx)

        indices_por_malha.append({
            "tronco_cabeca": idx_tronco,
            "pelve_lombar": idx_pelve,
            "pe_esq": idx_pe_l,
            "pe_dir": idx_pe_r,
            "mao_antebraco": idx_mao_ant,
            "bracos_completos": idx_bracos,
            "corpo_inferior_tronco": idx_corpo_inf,
        })

    return {
        "soma_pesos_osso": {k: round(v, 2) for k, v in soma_pesos_osso.items()},
        "indices_por_malha": indices_por_malha,
        "z_min_rest_pe_esq": z_min_rest_pe_esq,
        "z_min_rest_pe_dir": z_min_rest_pe_dir,
        "z_min_rest_global": z_min_rest_global,
        "z_max_rest_global": z_max_rest_global,
        "altura_rest_m": z_max_rest_global - z_min_rest_global,
    }


class ControladorPoseExata:
    """
    Calcula matrizes locais (`pb.location`, `pb.rotation_quaternion`) em ordem
    topológica para atingir rotações e posições de mundo exatas sem depender de
    `view_layer.update()` intermediário por osso.
    """

    def __init__(self, arm_obj: Any) -> None:
        from mathutils import Matrix  # type: ignore

        self.arm_obj = arm_obj
        self.mw = arm_obj.matrix_world.copy()
        self.mw_inv = self.mw.inverted()
        self.q_mw = self.mw.to_quaternion()
        self.q_mw_inv = self.q_mw.inverted()

        self.ordem_nomes: list[str] = []
        visitados: set[str] = set()

        def visitar(b: Any) -> None:
            if b.name in visitados:
                return
            if b.parent is not None:
                visitar(b.parent)
            visitados.add(b.name)
            self.ordem_nomes.append(b.name)

        for b in arm_obj.data.bones:
            visitar(b)

        self.pai_por_osso: dict[str, str | None] = {}
        self.rest_arm: dict[str, Any] = {}
        self.rest_rel: dict[str, Any] = {}
        self.rest_world_pos: dict[str, Any] = {}
        self.rest_world_quat: dict[str, Any] = {}

        for nome in self.ordem_nomes:
            b = arm_obj.data.bones[nome]
            pai = b.parent.name if b.parent is not None else None
            self.pai_por_osso[nome] = pai
            m_loc = b.matrix_local.copy()
            self.rest_arm[nome] = m_loc
            if pai is None:
                self.rest_rel[nome] = m_loc.copy()
            else:
                self.rest_rel[nome] = self.rest_arm[pai].inverted() @ m_loc
            m_w = self.mw @ m_loc
            self.rest_world_pos[nome] = m_w.to_translation()
            q_w = m_w.to_quaternion()
            q_w.normalize()
            self.rest_world_quat[nome] = q_w

        for pb in arm_obj.pose.bones:
            pb.rotation_mode = "QUATERNION"

    def aplicar_quadro(
        self,
        quats_mundo_desejados: dict[str, Any],
        pos_mundo_hip: Any,
    ) -> dict[str, tuple[Any, Any]]:
        from mathutils import Matrix, Quaternion, Vector  # type: ignore

        m_posed_arm: dict[str, Any] = {}
        resultado_mundo: dict[str, tuple[Any, Any]] = {}

        for nome in self.ordem_nomes:
            pb = self.arm_obj.pose.bones[nome]
            pai = self.pai_por_osso[nome]
            m_zero = self.rest_rel[nome].copy() if pai is None else (m_posed_arm[pai] @ self.rest_rel[nome])

            if nome == "Hip":
                q_des_w = quats_mundo_desejados["Hip"]
                q_arm = self.q_mw_inv @ q_des_w
                q_arm.normalize()
                p_arm = self.mw_inv @ pos_mundo_hip
                m_alvo_arm = Matrix.LocRotScale(p_arm, q_arm, Vector((1.0, 1.0, 1.0)))
                b_pose = m_zero.inverted() @ m_alvo_arm
                pb.location = b_pose.to_translation()
                q_loc = b_pose.to_quaternion()
                q_loc.normalize()
                pb.rotation_quaternion = q_loc
                pb.scale = Vector((1.0, 1.0, 1.0))
                m_posed_arm[nome] = m_alvo_arm
            elif nome in quats_mundo_desejados:
                q_des_w = quats_mundo_desejados[nome]
                q_arm = self.q_mw_inv @ q_des_w
                q_arm.normalize()
                q_zero = m_zero.to_quaternion()
                q_zero.normalize()
                q_loc = q_zero.inverted() @ q_arm
                q_loc.normalize()
                pb.location = Vector((0.0, 0.0, 0.0))
                pb.rotation_quaternion = q_loc
                pb.scale = Vector((1.0, 1.0, 1.0))
                m_rot = q_loc.to_matrix().to_4x4()
                m_posed_arm[nome] = m_zero @ m_rot
            else:
                pb.location = Vector((0.0, 0.0, 0.0))
                pb.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
                pb.scale = Vector((1.0, 1.0, 1.0))
                m_posed_arm[nome] = m_zero

            m_w = self.mw @ m_posed_arm[nome]
            qw = m_w.to_quaternion()
            qw.normalize()
            resultado_mundo[nome] = (m_w.to_translation(), qw)

        return resultado_mundo


def construir_animacao_retarget(
    arm_obj: Any,
    malhas: list[Any],
    clipe: dict[str, Any],
    info_grupos: dict[str, Any],
    z_topo_colchonete: float,
) -> dict[str, Any]:
    """
    Executa o retarget completo de `abdominal-supra.glb` para os 78 ossos do
    modelo masculino original e grava a Action de 90 quadros (30 FPS).
    """
    import bpy  # type: ignore
    from mathutils import Quaternion, Vector  # type: ignore

    ctrl = ControladorPoseExata(arm_obj)
    ossos_existentes = set(ctrl.ordem_nomes)
    obrigatorios = [
        "BoneRoot", "Hip", "Pelvis", "Waist", "Spine01", "Spine02",
        "NeckTwist01", "NeckTwist02", "Head",
        "L_Clavicle", "L_Upperarm", "L_Forearm", "L_Hand",
        "R_Clavicle", "R_Upperarm", "R_Forearm", "R_Hand",
        "L_Thigh", "L_Calf", "L_Foot", "L_ToeBase",
        "R_Thigh", "R_Calf", "R_Foot", "R_ToeBase",
    ]
    faltando = [n for n in obrigatorios if n not in ossos_existentes]
    if faltando:
        raise RuntimeError(f"Ossos anatômicos obrigatórios ausentes no rig de 78 ossos: {faltando}")

    pose_rest_src = avaliar_pose_clipe(clipe, None)

    # Determinar guinada horizontal exata entre origem e destino (em Z-up Blender)
    # Frente anatômica = Z_up × (ombro_direito - ombro_esquerdo)
    z_up = Vector((0.0, 0.0, 1.0))
    v_rl_src = pose_rest_src["armR"]["pos"] - pose_rest_src["armL"]["pos"]
    frente_src = Vector((-v_rl_src.y, v_rl_src.x, 0.0)).normalized()

    v_rl_dst = ctrl.rest_world_pos["R_Upperarm"] - ctrl.rest_world_pos["L_Upperarm"]
    frente_dst = Vector((-v_rl_dst.y, v_rl_dst.x, 0.0)).normalized()

    q_yaw = frente_src.rotation_difference(frente_dst)
    q_yaw.normalize()
    q_yaw_inv = q_yaw.inverted()

    altura_dst = float(info_grupos["altura_rest_m"])
    # Escala proporcional pela altura do quadril em pé
    escala_pos = float(ctrl.rest_world_pos["Hip"].z - info_grupos["z_min_rest_global"]) / max(
        1e-4, float(pose_rest_src["hips"]["pos"].z)
    )

    # Direções de repouso dos membros superiores no destino e na origem
    dir_rest_dst = {
        "L_Upperarm": (ctrl.rest_world_pos["L_Forearm"] - ctrl.rest_world_pos["L_Upperarm"]).normalized(),
        "L_Forearm": (ctrl.rest_world_pos["L_Hand"] - ctrl.rest_world_pos["L_Forearm"]).normalized(),
        "R_Upperarm": (ctrl.rest_world_pos["R_Forearm"] - ctrl.rest_world_pos["R_Upperarm"]).normalized(),
        "R_Forearm": (ctrl.rest_world_pos["R_Hand"] - ctrl.rest_world_pos["R_Forearm"]).normalized(),
        "L_Thigh": (ctrl.rest_world_pos["L_Calf"] - ctrl.rest_world_pos["L_Thigh"]).normalized(),
        "L_Calf": (ctrl.rest_world_pos["L_Foot"] - ctrl.rest_world_pos["L_Calf"]).normalized(),
        "R_Thigh": (ctrl.rest_world_pos["R_Calf"] - ctrl.rest_world_pos["R_Thigh"]).normalized(),
        "R_Calf": (ctrl.rest_world_pos["R_Foot"] - ctrl.rest_world_pos["R_Calf"]).normalized(),
    }
    dir_rest_src = {
        "armL": (pose_rest_src["elbowL"]["pos"] - pose_rest_src["armL"]["pos"]).normalized(),
        "elbowL": (pose_rest_src["handL"]["pos"] - pose_rest_src["elbowL"]["pos"]).normalized(),
        "armR": (pose_rest_src["elbowR"]["pos"] - pose_rest_src["armR"]["pos"]).normalized(),
        "elbowR": (pose_rest_src["handR"]["pos"] - pose_rest_src["elbowR"]["pos"]).normalized(),
    }

    # Comprimentos reais dos 3 segmentos torácicos para preservar exatamente a
    # inclinação da corda `Waist -> NeckTwist01` igual à de `spine -> neck` da fonte
    l_waist = (ctrl.rest_world_pos["Spine01"] - ctrl.rest_world_pos["Waist"]).length
    l_spine01 = (ctrl.rest_world_pos["Spine02"] - ctrl.rest_world_pos["Spine01"]).length
    l_spine02 = (ctrl.rest_world_pos["NeckTwist01"] - ctrl.rest_world_pos["Spine02"]).length
    comp_toracico_total = max(1e-5, l_waist + l_spine01 + l_spine02)
    pesos_acum_tor = []
    soma_p = 0.0
    for _, p_seg in PESOS_COLUNA_TORACICA:
        soma_p += p_seg
        pesos_acum_tor.append(soma_p)
    media_ponderada_corda = (
        pesos_acum_tor[0] * l_waist
        + pesos_acum_tor[1] * l_spine01
        + pesos_acum_tor[2] * l_spine02
    ) / comp_toracico_total
    fator_corda_toracica = 1.0 / max(0.25, media_ponderada_corda)

    # Comprimentos reais de coxa e perna no modelo masculino original
    l_coxa_l = (ctrl.rest_world_pos["L_Calf"] - ctrl.rest_world_pos["L_Thigh"]).length
    l_perna_l = (ctrl.rest_world_pos["L_Foot"] - ctrl.rest_world_pos["L_Calf"]).length
    l_coxa_r = (ctrl.rest_world_pos["R_Calf"] - ctrl.rest_world_pos["R_Thigh"]).length
    l_perna_r = (ctrl.rest_world_pos["R_Foot"] - ctrl.rest_world_pos["R_Calf"]).length

    # Altura exata do tornozelo acima da sola plana do calçado em repouso
    h_sola_l = float(ctrl.rest_world_pos["L_Foot"].z - info_grupos["z_min_rest_pe_esq"])
    h_sola_r = float(ctrl.rest_world_pos["R_Foot"].z - info_grupos["z_min_rest_pe_dir"])

    # Vetor de deslocamento Hip -> articulação do quadril em repouso (no frame de Hip)
    q_hip_rest_inv = ctrl.rest_world_quat["Hip"].inverted()
    off_hip_para_coxa_l = q_hip_rest_inv @ (ctrl.rest_world_pos["L_Thigh"] - ctrl.rest_world_pos["Hip"])
    off_hip_para_coxa_r = q_hip_rest_inv @ (ctrl.rest_world_pos["R_Thigh"] - ctrl.rest_world_pos["Hip"])

    q_ident = Quaternion((1.0, 0.0, 0.0, 0.0))

    def transferir_direcao_transportada(
        d_rest_destino: Any,
        q_rest_destino: Any,
        q_delta_pai_mundo: Any,
        d_pose_mundo_alvo: Any,
        d_rest_origem_guinado: Any | None = None,
        q_delta_origem_guinado: Any | None = None,
    ) -> tuple[Any, Any]:
        """
        Transporta `d_rest_destino` pelo delta do pai antes do balanço mínimo até
        `d_pose_mundo_alvo`, eliminando torção esférica espúria (holonomia A-pose -> supino),
        e reaplica eventual torção axial real da fonte.
        Retorna `(q_mundo_final, q_delta_mundo_membro)`.
        """
        d_ref_dst = (q_delta_pai_mundo @ d_rest_destino).normalized()
        q_swing_dst = d_ref_dst.rotation_difference(d_pose_mundo_alvo)
        q_twist = q_ident
        if d_rest_origem_guinado is not None and q_delta_origem_guinado is not None:
            d_ref_src = (q_delta_pai_mundo @ d_rest_origem_guinado).normalized()
            q_swing_src = d_ref_src.rotation_difference(d_pose_mundo_alvo)
            q_rel_src = q_delta_origem_guinado @ q_delta_pai_mundo.inverted()
            q_res_twist = q_swing_src.inverted() @ q_rel_src
            proj = (
                q_res_twist.x * d_pose_mundo_alvo.x
                + q_res_twist.y * d_pose_mundo_alvo.y
                + q_res_twist.z * d_pose_mundo_alvo.z
            )
            ang_twist = 2.0 * math.atan2(proj, q_res_twist.w)
            q_twist = Quaternion(d_pose_mundo_alvo, ang_twist)

        q_delta_membro = q_twist @ q_swing_dst @ q_delta_pai_mundo
        q_delta_membro.normalize()
        q_mundo = q_delta_membro @ q_rest_destino
        q_mundo.normalize()
        return q_mundo, q_delta_membro

    tempos_ciclo = [(k / float(TOTAL_QUADROS_CICLO)) * DURACAO_CICLO_S for k in range(TOTAL_QUADROS_CICLO)]
    poses_src_ciclo = [avaliar_pose_clipe(clipe, t) for t in tempos_ciclo]
    p_hips_src_0 = poses_src_ciclo[0]["hips"]["pos"]

    # Ângulo interno do joelho na pose inicial da animação-fonte (~86.02°, flexão ~93.98°)
    v_coxa_0 = (poses_src_ciclo[0]["kneeL"]["pos"] - poses_src_ciclo[0]["legL"]["pos"]).normalized()
    v_perna_0 = (poses_src_ciclo[0]["footL"]["pos"] - poses_src_ciclo[0]["kneeL"]["pos"]).normalized()
    flexao_joelho_0_rad = math.acos(min(1.0, max(-1.0, v_coxa_0.dot(v_perna_0))))
    ang_interno_joelho_0_rad = math.pi - flexao_joelho_0_rad

    def montar_quats_tronco_bracos(pose_s: dict[str, Any]) -> tuple[dict[str, Any], Any]:
        quats: dict[str, Any] = {}

        def delta_guinado(nome_src: str) -> Any:
            q_d = pose_s[nome_src]["quat"] @ pose_rest_src[nome_src]["quat"].inverted()
            q_g = q_yaw @ q_d @ q_yaw_inv
            q_g.normalize()
            return q_g

        q_d_hips = delta_guinado("hips")
        q_d_spine = delta_guinado("spine")
        q_d_neck = delta_guinado("neck")
        q_d_arm_l = delta_guinado("armL")
        q_d_elb_l = delta_guinado("elbowL")
        q_d_arm_r = delta_guinado("armR")
        q_d_elb_r = delta_guinado("elbowR")

        quats["Hip"] = q_d_hips @ ctrl.rest_world_quat["Hip"]
        quats["Pelvis"] = q_d_hips @ ctrl.rest_world_quat["Pelvis"]

        # Distribuição vertebral torácica com preservação exata da corda spine->neck
        q_rel_spine_chord = q_d_spine @ q_d_hips.inverted()
        q_rel_spine_chord.normalize()
        eixo_sp, ang_sp = q_rel_spine_chord.to_axis_angle()
        q_rel_spine_topo = Quaternion(eixo_sp, ang_sp * fator_corda_toracica)
        q_rel_spine_topo.normalize()

        acum = 0.0
        q_d_spine_efetivo = q_d_spine
        for nome_osso, peso in PESOS_COLUNA_TORACICA:
            acum += peso
            q_parcial = q_ident.slerp(q_rel_spine_topo, min(1.0, acum))
            q_parcial_mundo = q_parcial @ q_d_hips
            q_parcial_mundo.normalize()
            quats[nome_osso] = q_parcial_mundo @ ctrl.rest_world_quat[nome_osso]
            q_d_spine_efetivo = q_parcial_mundo

        # Distribuição cervical (NeckTwist01 + NeckTwist02 + Head -> atinge exatamente q_d_neck da fonte)
        q_rel_neck = q_d_neck @ q_d_spine_efetivo.inverted()
        q_rel_neck.normalize()
        acum_n = 0.0
        for nome_osso, peso in PESOS_COLUNA_CERVICAL:
            acum_n += peso
            q_parcial = q_ident.slerp(q_rel_neck, min(1.0, acum_n))
            q_parcial_mundo = q_parcial @ q_d_spine_efetivo
            q_parcial_mundo.normalize()
            quats[nome_osso] = q_parcial_mundo @ ctrl.rest_world_quat[nome_osso]

        # Braços e antebraços por direção real transportada + offset estático de folga da bermuda
        for lado, s_arm, s_elb, s_hand in (
            ("L", "armL", "elbowL", "handL"),
            ("R", "armR", "elbowR", "handR"),
        ):
            q_d_arm_s = q_d_arm_l if lado == "L" else q_d_arm_r
            q_d_elb_s = q_d_elb_l if lado == "L" else q_d_elb_r
            sinal_lat = 1.0 if lado == "L" else -1.0
            q_folga_bermuda = Quaternion(
                Vector((0.0, 0.0, 1.0)),
                sinal_lat * math.radians(AFASTAMENTO_CORONAL_BRACO_GRAUS),
            )

            d_pose_arm = (q_folga_bermuda @ (q_yaw @ (pose_s[s_elb]["pos"] - pose_s[s_arm]["pos"]))).normalized()
            d_pose_elb = (q_folga_bermuda @ (q_yaw @ (pose_s[s_hand]["pos"] - pose_s[s_elb]["pos"]))).normalized()

            # Acompanhamento escapular sutil na clavícula (10% do avanço do braço)
            d_ref_arm_clav = (q_d_spine_efetivo @ dir_rest_dst[f"{lado}_Upperarm"]).normalized()
            q_swing_clav = q_ident.slerp(d_ref_arm_clav.rotation_difference(d_pose_arm), 0.10)
            q_d_clav = q_swing_clav @ q_d_spine_efetivo
            q_d_clav.normalize()
            quats[f"{lado}_Clavicle"] = q_d_clav @ ctrl.rest_world_quat[f"{lado}_Clavicle"]

            q_w_up, q_d_up = transferir_direcao_transportada(
                dir_rest_dst[f"{lado}_Upperarm"],
                ctrl.rest_world_quat[f"{lado}_Upperarm"],
                q_d_spine_efetivo,
                d_pose_arm,
                (q_folga_bermuda @ (q_yaw @ dir_rest_src[s_arm])).normalized(),
                q_folga_bermuda @ q_d_arm_s,
            )
            quats[f"{lado}_Upperarm"] = q_w_up

            q_w_fore, q_d_fore = transferir_direcao_transportada(
                dir_rest_dst[f"{lado}_Forearm"],
                ctrl.rest_world_quat[f"{lado}_Forearm"],
                q_d_up,
                d_pose_elb,
                (q_folga_bermuda @ (q_yaw @ dir_rest_src[s_elb])).normalized(),
                q_folga_bermuda @ q_d_elb_s,
            )
            quats[f"{lado}_Forearm"] = q_w_fore

            # Bissetriz de volume no cotovelo (ShareBone)
            nome_share_elb = f"{lado}_ElbowShareBone"
            if nome_share_elb in ossos_existentes:
                q_meio_elb = q_d_up.slerp(q_d_fore, 0.5)
                q_meio_elb.normalize()
                quats[nome_share_elb] = q_meio_elb @ ctrl.rest_world_quat[nome_share_elb]

            # Mão neutra acompanhando o antebraço
            quats[f"{lado}_Hand"] = q_d_fore @ ctrl.rest_world_quat[f"{lado}_Hand"]

        return quats, q_d_hips

    # -----------------------------------------------------------------------
    # Passo 1: Calibrar cota vertical `Hip.z(t)` na malha avaliada para contato
    # contínuo do dorso/sacro com o topo do colchonete (compressão suave 1.0 mm)
    # -----------------------------------------------------------------------
    compressao_apoio = 0.0010 * altura_dst
    z_alvo_dorso = z_topo_colchonete - compressao_apoio
    z_hip_ref = z_topo_colchonete + 0.09 * altura_dst

    # Avaliar em 30 amostras uniformes (a cada 3 quadros) e interpolar
    # suavemente para manter custo baixo (~1.8 s) e curva C² perfeitamente periódica.
    passo_cal = 3
    indices_cal = list(range(0, TOTAL_QUADROS_CICLO, passo_cal))
    z_hip_amostrado: dict[int, float] = {}

    for k in indices_cal:
        quats_parciais, _ = montar_quats_tronco_bracos(poses_src_ciclo[k])
        desloc_src = (poses_src_ciclo[k]["hips"]["pos"] - p_hips_src_0) * escala_pos
        desloc_dst = q_yaw @ desloc_src
        ctrl.aplicar_quadro(quats_parciais, Vector((desloc_dst.x, 0.0, z_hip_ref)))
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()

        z_min_tronco = float("inf")
        z_min_bracos = float("inf")
        for m_i, ob in enumerate(malhas):
            ob_ev = ob.evaluated_get(deps)
            me = ob_ev.to_mesh()
            try:
                mw_ob = ob_ev.matrix_world
                for v_i in info_grupos["indices_por_malha"][m_i]["tronco_cabeca"]:
                    zw = (mw_ob @ Vector(me.vertices[v_i].co)).z
                    if zw < z_min_tronco:
                        z_min_tronco = zw
                for v_i in info_grupos["indices_por_malha"][m_i]["bracos_completos"]:
                    zw = (mw_ob @ Vector(me.vertices[v_i].co)).z
                    if zw < z_min_bracos:
                        z_min_bracos = zw
            finally:
                ob_ev.to_mesh_clear()

        # Ancora o peso corporal exclusivamente no contato dorsal/sacral real com o colchonete
        z_hip_amostrado[k] = z_hip_ref + (z_alvo_dorso - z_min_tronco)

    # Interpolação periódica suave para os 90 quadros + filtro circular [0.25, 0.5, 0.25]
    z_hip_bruto = [0.0] * TOTAL_QUADROS_CICLO
    n_cal = len(indices_cal)
    for idx_c, k0 in enumerate(indices_cal):
        k1 = indices_cal[(idx_c + 1) % n_cal]
        span = (k1 - k0) % TOTAL_QUADROS_CICLO or TOTAL_QUADROS_CICLO
        v0 = z_hip_amostrado[k0]
        v1 = z_hip_amostrado[k1]
        for s in range(span):
            u = s / float(span)
            # Interpolação cosseno suave por trecho
            u_suave = 0.5 - 0.5 * math.cos(math.pi * u)
            z_hip_bruto[(k0 + s) % TOTAL_QUADROS_CICLO] = v0 + (v1 - v0) * u_suave

    z_hip_ciclo = [
        0.25 * z_hip_bruto[(k - 1) % TOTAL_QUADROS_CICLO]
        + 0.50 * z_hip_bruto[k]
        + 0.25 * z_hip_bruto[(k + 1) % TOTAL_QUADROS_CICLO]
        for k in range(TOTAL_QUADROS_CICLO)
    ]

    # -----------------------------------------------------------------------
    # Passo 2: Posicionar tornozelos plantados na superfície do colchonete e
    # centralizar longitudinalmente o conjunto (cabeça..dedos dos pés) em X = 0
    # -----------------------------------------------------------------------
    _, q_d_hips_0 = montar_quats_tronco_bracos(poses_src_ciclo[0])
    p_hip_0_prov = Vector((0.0, 0.0, z_hip_ciclo[0]))
    p_coxa_l_0 = p_hip_0_prov + (q_d_hips_0 @ ctrl.rest_world_quat["Hip"] @ off_hip_para_coxa_l)
    p_coxa_r_0 = p_hip_0_prov + (q_d_hips_0 @ ctrl.rest_world_quat["Hip"] @ off_hip_para_coxa_r)

    z_ank_l = (z_topo_colchonete - 0.0006 * altura_dst) + h_sola_l
    z_ank_r = (z_topo_colchonete - 0.0006 * altura_dst) + h_sola_r

    dist_chord_l = math.sqrt(
        max(1e-5, l_coxa_l * l_coxa_l + l_perna_l * l_perna_l - 2.0 * l_coxa_l * l_perna_l * math.cos(ang_interno_joelho_0_rad))
    )
    dist_chord_r = math.sqrt(
        max(1e-5, l_coxa_r * l_coxa_r + l_perna_r * l_perna_r - 2.0 * l_coxa_r * l_perna_r * math.cos(ang_interno_joelho_0_rad))
    )
    dz_l = z_ank_l - p_coxa_l_0.z
    dz_r = z_ank_r - p_coxa_r_0.z
    dx_ank_l = math.sqrt(max(0.01, dist_chord_l * dist_chord_l - dz_l * dz_l))
    dx_ank_r = math.sqrt(max(0.01, dist_chord_r * dist_chord_r - dz_r * dz_r))
    dx_ank_medio = 0.5 * (dx_ank_l + dx_ank_r)

    x_ank_prov = 0.5 * (p_coxa_l_0.x + p_coxa_r_0.x) + dx_ank_medio

    # Aplicar quadro 0 provisório para medir extensão real [x_min, x_max] e centralizar em X = 0
    def resolver_pernas_no_quadro(
        quats: dict[str, Any],
        q_d_hips: Any,
        p_hip_w: Any,
        x_tornozelo_fixo: float,
    ) -> dict[str, Any]:
        q_hip_w = quats["Hip"]
        p_th_l = p_hip_w + (q_hip_w @ off_hip_para_coxa_l)
        p_th_r = p_hip_w + (q_hip_w @ off_hip_para_coxa_r)

        kx_l, kz_l = resolver_joelho_sagital_2_elos(p_th_l.x, p_th_l.z, x_tornozelo_fixo, z_ank_l, l_coxa_l, l_perna_l)
        kx_r, kz_r = resolver_joelho_sagital_2_elos(p_th_r.x, p_th_r.z, x_tornozelo_fixo, z_ank_r, l_coxa_r, l_perna_r)

        p_kn_l = Vector((kx_l, p_th_l.y, kz_l))
        p_kn_r = Vector((kx_r, p_th_r.y, kz_r))
        p_an_l = Vector((x_tornozelo_fixo, p_th_l.y, z_ank_l))
        p_an_r = Vector((x_tornozelo_fixo, p_th_r.y, z_ank_r))

        d_th_l = (p_kn_l - p_th_l).normalized()
        d_ca_l = (p_an_l - p_kn_l).normalized()
        d_th_r = (p_kn_r - p_th_r).normalized()
        d_ca_r = (p_an_r - p_kn_r).normalized()

        q_w_th_l, q_d_th_l = transferir_direcao_transportada(
            dir_rest_dst["L_Thigh"], ctrl.rest_world_quat["L_Thigh"], q_d_hips, d_th_l
        )
        q_w_ca_l, q_d_ca_l = transferir_direcao_transportada(
            dir_rest_dst["L_Calf"], ctrl.rest_world_quat["L_Calf"], q_d_th_l, d_ca_l
        )
        q_w_th_r, q_d_th_r = transferir_direcao_transportada(
            dir_rest_dst["R_Thigh"], ctrl.rest_world_quat["R_Thigh"], q_d_hips, d_th_r
        )
        q_w_ca_r, q_d_ca_r = transferir_direcao_transportada(
            dir_rest_dst["R_Calf"], ctrl.rest_world_quat["R_Calf"], q_d_th_r, d_ca_r
        )

        quats["L_Thigh"] = q_w_th_l
        quats["L_Calf"] = q_w_ca_l
        quats["R_Thigh"] = q_w_th_r
        quats["R_Calf"] = q_w_ca_r

        if "L_KneeShareBone" in ossos_existentes:
            qm_l = q_d_th_l.slerp(q_d_ca_l, 0.5)
            qm_l.normalize()
            quats["L_KneeShareBone"] = qm_l @ ctrl.rest_world_quat["L_KneeShareBone"]
        if "R_KneeShareBone" in ossos_existentes:
            qm_r = q_d_th_r.slerp(q_d_ca_r, 0.5)
            qm_r.normalize()
            quats["R_KneeShareBone"] = qm_r @ ctrl.rest_world_quat["R_KneeShareBone"]

        # Sola dos calçados horizontal apoiada no colchonete (orientação plantar de repouso)
        quats["L_Foot"] = ctrl.rest_world_quat["L_Foot"].copy()
        quats["R_Foot"] = ctrl.rest_world_quat["R_Foot"].copy()
        quats["L_ToeBase"] = ctrl.rest_world_quat["L_ToeBase"].copy()
        quats["R_ToeBase"] = ctrl.rest_world_quat["R_ToeBase"].copy()

        return {
            "p_thigh_l": p_th_l,
            "p_knee_l": p_kn_l,
            "p_ankle_l": p_an_l,
            "p_thigh_r": p_th_r,
            "p_knee_r": p_kn_r,
            "p_ankle_r": p_an_r,
        }

    quats0, q_dh0 = montar_quats_tronco_bracos(poses_src_ciclo[0])
    resolver_pernas_no_quadro(quats0, q_dh0, p_hip_0_prov, x_ank_prov)
    ctrl.aplicar_quadro(quats0, p_hip_0_prov)
    bpy.context.view_layer.update()
    deps0 = bpy.context.evaluated_depsgraph_get()
    xs_q0: list[float] = []
    ys_q0: list[float] = []
    for m_i, ob in enumerate(malhas):
        ob_ev = ob.evaluated_get(deps0)
        me = ob_ev.to_mesh()
        try:
            mw_ob = ob_ev.matrix_world
            passo_b = max(1, len(me.vertices) // 15000)
            for v_i in range(0, len(me.vertices), passo_b):
                pw = mw_ob @ Vector(me.vertices[v_i].co)
                xs_q0.append(pw.x)
                ys_q0.append(pw.y)
        finally:
            ob_ev.to_mesh_clear()

    offset_centro_x = -0.5 * (min(xs_q0) + max(xs_q0))
    offset_centro_y = -0.5 * (min(ys_q0) + max(ys_q0))
    x_tornozelo_plantado = x_ank_prov + offset_centro_x

    # -----------------------------------------------------------------------
    # Passo 3: Gravar Action determinística de 90 quadros (frames 1..90 @ 30 FPS)
    # com continuidade de sinal nos quaternions
    # -----------------------------------------------------------------------
    cena = bpy.context.scene
    cena.render.fps = FPS_PILOTO
    cena.render.fps_base = 1.0
    cena.frame_start = 1
    cena.frame_end = TOTAL_QUADROS_CICLO

    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()
    acao = bpy.data.actions.new(name="ForjaPilotoAbdominalCrunch")
    arm_obj.animation_data.action = acao

    quat_anterior_local: dict[str, Any] = {}
    serie_cinematica: list[dict[str, Any]] = []

    for k in range(TOTAL_QUADROS_CICLO):
        quadro_bl = k + 1
        quats_k, q_dh_k = montar_quats_tronco_bracos(poses_src_ciclo[k])
        desloc_src = (poses_src_ciclo[k]["hips"]["pos"] - p_hips_src_0) * escala_pos
        desloc_dst = q_yaw @ desloc_src
        p_hip_k = Vector((
            offset_centro_x + desloc_dst.x,
            offset_centro_y,
            z_hip_ciclo[k],
        ))
        info_pernas = resolver_pernas_no_quadro(quats_k, q_dh_k, p_hip_k, x_tornozelo_plantado)
        mundo_k = ctrl.aplicar_quadro(quats_k, p_hip_k)

        for nome in ctrl.ordem_nomes:
            pb = arm_obj.pose.bones[nome]
            ql = pb.rotation_quaternion.copy()
            ant = quat_anterior_local.get(nome)
            if ant is not None and ql.dot(ant) < 0.0:
                ql = -ql
                pb.rotation_quaternion = ql
            quat_anterior_local[nome] = ql.copy()
            pb.keyframe_insert(data_path="rotation_quaternion", frame=quadro_bl)
            if nome == "Hip":
                pb.keyframe_insert(data_path="location", frame=quadro_bl)

        # Registrar métricas cinemáticas deste quadro
        v_coxa = (mundo_k["L_Calf"][0] - mundo_k["L_Thigh"][0]).normalized()
        v_perna = (mundo_k["L_Foot"][0] - mundo_k["L_Calf"][0]).normalized()
        flex_joelho_graus = math.degrees(math.acos(min(1.0, max(-1.0, v_coxa.dot(v_perna)))))

        # Flexão torácica e cervical medidas na pose fonte/destino
        q_d_sp = (q_yaw @ (poses_src_ciclo[k]["spine"]["quat"] @ pose_rest_src["spine"]["quat"].inverted()) @ q_yaw_inv)
        q_d_nk = (q_yaw @ (poses_src_ciclo[k]["neck"]["quat"] @ pose_rest_src["neck"]["quat"].inverted()) @ q_yaw_inv)
        q_rel_sp = q_d_sp @ q_dh_k.inverted()
        q_rel_nk = q_d_nk @ q_d_sp.inverted()
        flex_toracica_graus = math.degrees(2.0 * math.acos(min(1.0, abs(q_rel_sp.w))))
        flex_cervical_graus = math.degrees(2.0 * math.acos(min(1.0, abs(q_rel_nk.w))))

        serie_cinematica.append({
            "quadro": quadro_bl,
            "tempo_s": round(tempos_ciclo[k], 5),
            "hip_pos": [round(v, 5) for v in mundo_k["Hip"][0]],
            "head_pos": [round(v, 5) for v in mundo_k["Head"][0]],
            "ombro_l_pos": [round(v, 5) for v in mundo_k["L_Upperarm"][0]],
            "mao_l_pos": [round(v, 5) for v in mundo_k["L_Hand"][0]],
            "joelho_l_pos": [round(v, 5) for v in mundo_k["L_Calf"][0]],
            "pe_l_pos": [round(v, 5) for v in mundo_k["L_Foot"][0]],
            "pe_r_pos": [round(v, 5) for v in mundo_k["R_Foot"][0]],
            "flexao_toracica_graus": round(flex_toracica_graus, 3),
            "flexao_cervical_graus": round(flex_cervical_graus, 3),
            "inclinacao_cabeca_total_graus": round(flex_toracica_graus + flex_cervical_graus, 3),
            "flexao_joelho_graus": round(flex_joelho_graus, 3),
            "alvos_perna": {k_p: [round(x, 5) for x in v_p] for k_p, v_p in info_pernas.items()},
        })

    # Interpolação linear exata entre os 90 quadros densos (evita overshoot Bezier nas bordas)
    for fc in acao.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

    # Medir fechamento exato t=0.0 vs t=3.0 no clipe fonte
    pose_src_t0 = avaliar_pose_clipe(clipe, 0.0)
    pose_src_tfim = avaliar_pose_clipe(clipe, clipe["duracao"])
    erro_periodo_fonte_m = max(
        (pose_src_t0[n]["pos"] - pose_src_tfim[n]["pos"]).length
        for n in pose_src_t0
    )

    cena.frame_set(1)
    bpy.context.view_layer.update()

    return {
        "acao_nome": acao.name,
        "fps": FPS_PILOTO,
        "quadros_ciclo": TOTAL_QUADROS_CICLO,
        "duracao_ciclo_s": DURACAO_CICLO_S,
        "guinada_graus": round(math.degrees(2.0 * math.acos(min(1.0, abs(q_yaw.w)))), 2),
        "fator_corda_toracica": round(fator_corda_toracica, 5),
        "afastamento_coronal_braco_graus": AFASTAMENTO_CORONAL_BRACO_GRAUS,
        "frente_origem_xy": [round(frente_src.x, 4), round(frente_src.y, 4)],
        "frente_destino_xy": [round(frente_dst.x, 4), round(frente_dst.y, 4)],
        "escala_posicao_raiz": round(escala_pos, 5),
        "comprimentos_membros_m": {
            "coxa_esq": round(l_coxa_l, 5),
            "perna_esq": round(l_perna_l, 5),
            "coxa_dir": round(l_coxa_r, 5),
            "perna_dir": round(l_perna_r, 5),
            "altura_sola_esq": round(h_sola_l, 5),
            "altura_sola_dir": round(h_sola_r, 5),
        },
        "x_tornozelo_plantado_m": round(x_tornozelo_plantado, 5),
        "extensao_x_personagem_q1_m": [round(min(xs_q0) + offset_centro_x, 5), round(max(xs_q0) + offset_centro_x, 5)],
        "erro_periodo_exato_fonte_m": round(erro_periodo_fonte_m, 6),
        "correspondencia_ossos": TABELA_CORRESPONDENCIA_OSSOS,
        "serie_cinematica": serie_cinematica,
    }


# ---------------------------------------------------------------------------
# Cenário escuro de estúdio, colchonete chanfrado e duas câmeras independentes
# ---------------------------------------------------------------------------

def criar_cenario_e_cameras(
    altura_personagem: float,
    extensao_x_personagem: tuple[float, float],
    z_topo_colchonete: float,
    malhas_personagem: list[Any],
) -> dict[str, Any]:
    """
    Constrói cenário escuro limpo de estúdio, colchonete chanfrado com micro-relevo
    EVA, iluminação física de estúdio escalada por `s²` e duas câmeras independentes
    resolvidas matematicamente via `world_to_camera_view` sobre todos os quadros.
    """
    import bmesh  # type: ignore
    import bpy  # type: ignore
    from bpy_extras.object_utils import world_to_camera_view  # type: ignore
    from mathutils import Vector  # type: ignore

    cena = bpy.context.scene
    h = altura_personagem
    escala_s = h / 1.75
    s2 = escala_s * escala_s

    # 1. Mundo escuro limpo de estúdio
    mundo = bpy.data.worlds.new("forja_piloto_mundo_escuro")
    mundo.use_nodes = True
    bg = mundo.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.0030, 0.0036, 0.0048, 1.0)
        bg.inputs[1].default_value = 0.16
    cena.world = mundo

    # 2. Piso amplo escuro fosco em Z = 0.000 (cenário escuro de estúdio sem costura)
    mat_piso = bpy.data.materials.new("forja_piloto_piso_mat")
    mat_piso.use_nodes = True
    bsdf_piso = mat_piso.node_tree.nodes.get("Principled BSDF")
    if bsdf_piso:
        bsdf_piso.inputs["Base Color"].default_value = (0.0048, 0.0054, 0.0068, 1.0)
        bsdf_piso.inputs["Roughness"].default_value = 0.92
        if "Specular IOR Level" in bsdf_piso.inputs:
            bsdf_piso.inputs["Specular IOR Level"].default_value = 0.10

    raio_piso = 9.0 * h
    bm_piso = bmesh.new()
    bmesh.ops.create_circle(bm_piso, cap_ends=True, cap_tris=False, segments=64, radius=raio_piso)
    malha_piso = bpy.data.meshes.new("forja_piloto_piso_mesh")
    bm_piso.to_mesh(malha_piso)
    bm_piso.free()
    obj_piso = bpy.data.objects.new("forja_piloto_piso", malha_piso)
    obj_piso.location = (0.0, 0.0, 0.0)
    obj_piso.data.materials.append(mat_piso)
    cena.collection.objects.link(obj_piso)

    # 3. Colchonete esportivo chanfrado (`Z = 0 .. z_topo_colchonete`)
    comp_corpo = extensao_x_personagem[1] - extensao_x_personagem[0]
    comprimento_colchonete = max(1.08 * h, comp_corpo + 0.26 * h)
    largura_colchonete = 0.48 * h
    espessura_colchonete = z_topo_colchonete

    mat_colchonete = bpy.data.materials.new("forja_piloto_colchonete_mat")
    mat_colchonete.use_nodes = True
    nt = mat_colchonete.node_tree
    bsdf_col = nt.nodes.get("Principled BSDF")
    if bsdf_col:
        bsdf_col.inputs["Base Color"].default_value = (0.036, 0.041, 0.052, 1.0)
        bsdf_col.inputs["Roughness"].default_value = 0.65
        if "Specular IOR Level" in bsdf_col.inputs:
            bsdf_col.inputs["Specular IOR Level"].default_value = 0.36
        # Micro-textura celular discreta de EVA para leitura tátil sob Cycles
        tex_coord = nt.nodes.new("ShaderNodeTexCoord")
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 320.0 / max(0.2, h)
        noise.inputs["Detail"].default_value = 5.0
        noise.inputs["Roughness"].default_value = 0.65
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.045
        bump.inputs["Distance"].default_value = 0.002 * h
        nt.links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf_col.inputs["Normal"])

    bm_col = bmesh.new()
    bmesh.ops.create_cube(bm_col, size=1.0)
    for v in bm_col.verts:
        v.co.x *= comprimento_colchonete
        v.co.y *= largura_colchonete
        v.co.z = (v.co.z + 0.5) * espessura_colchonete
    # Arredondar primeiro as 4 arestas verticais dos cantos (cantos de colchonete real)
    arestas_vert = [
        e for e in bm_col.edges
        if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-6 and abs(e.verts[0].co.y - e.verts[1].co.y) < 1e-6
    ]
    bmesh.ops.bevel(
        bm_col,
        geom=arestas_vert,
        offset=0.045 * largura_colchonete,
        offset_type="OFFSET",
        segments=6,
        profile=0.5,
        affect="EDGES",
    )
    # Chanfrar suavemente as bordas superior e inferior
    arestas_horiz = [
        e for e in bm_col.edges
        if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6 and e.verts[0].co.z > 0.5 * espessura_colchonete
    ]
    bmesh.ops.bevel(
        bm_col,
        geom=arestas_horiz,
        offset=0.22 * espessura_colchonete,
        offset_type="OFFSET",
        segments=3,
        profile=0.5,
        affect="EDGES",
    )
    malha_col = bpy.data.meshes.new("forja_piloto_colchonete_mesh")
    bm_col.to_mesh(malha_col)
    bm_col.free()
    for poly in malha_col.polygons:
        poly.use_smooth = True
    obj_colchonete = bpy.data.objects.new("forja_piloto_colchonete", malha_col)
    obj_colchonete.data.materials.append(mat_colchonete)
    cena.collection.objects.link(obj_colchonete)

    # 4. Iluminação de estúdio de 4 pontos calibrada para ambos os ângulos de câmera
    alvo_luz = Vector((0.0, 0.0, z_topo_colchonete + 0.14 * h))
    luzes_cfg = [
        # Key softbox principal frontal-superior levemente voltada ao tronco/abdômen
        (
            "forja_piloto_luz_key",
            420.0 * s2,
            2.8 * escala_s,
            (1.00, 0.97, 0.92),
            Vector((0.95 * h, -1.65 * h, 1.95 * h)),
        ),
        # Fill suave do quadrante frontal-esquerdo (+X, +Y) iluminando a câmera vertical 9:16 e sombras
        (
            "forja_piloto_luz_fill",
            240.0 * s2,
            3.1 * escala_s,
            (0.88, 0.93, 1.00),
            Vector((1.65 * h, 1.45 * h, 1.75 * h)),
        ),
        # Rim/recorte traseiro-superior destacando silhueta de ombros, cabeça, braços e joelhos contra o fundo escuro
        (
            "forja_piloto_luz_rim",
            260.0 * s2,
            2.5 * escala_s,
            (1.00, 0.90, 0.78),
            Vector((-1.55 * h, 1.30 * h, 1.80 * h)),
        ),
        # Top softbox zenital limpa para leitura uniforme do colchonete e relevo abdominal
        (
            "forja_piloto_luz_top",
            150.0 * s2,
            2.6 * escala_s,
            (0.98, 0.99, 1.00),
            Vector((-0.10 * h, -0.15 * h, 2.55 * h)),
        ),
    ]
    luzes_info = []
    for nome_l, energia, tam, cor, pos_l in luzes_cfg:
        dl = bpy.data.lights.new(nome_l, type="AREA")
        dl.energy = energia
        dl.size = tam
        dl.color = cor
        ol = bpy.data.objects.new(nome_l, dl)
        ol.location = pos_l
        ol.rotation_euler = (alvo_luz - pos_l).to_track_quat("-Z", "Y").to_euler()
        cena.collection.objects.link(ol)
        luzes_info.append({
            "nome": nome_l,
            "energia_w": round(energia, 3),
            "tamanho_m": round(tam, 4),
            "cor_rgb": list(cor),
            "posicao": [round(v, 4) for v in pos_l],
        })

    # 5. Coletar nuvem global de pontos 3D a enquadrar (colchonete inteiro + personagem em todo o movimento)
    pontos_enquadramento: list[Any] = [obj_colchonete.matrix_world @ Vector(v.co) for v in obj_colchonete.data.vertices]
    for q_amostra in (1, 16, 31, 46, 61, 76, 90):
        cena.frame_set(q_amostra)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        for ob in malhas_personagem:
            ob_ev = ob.evaluated_get(deps)
            me = ob_ev.to_mesh()
            try:
                mw_ob = ob_ev.matrix_world
                passo_p = max(1, len(me.vertices) // 2500)
                for i_v in range(0, len(me.vertices), passo_p):
                    pontos_enquadramento.append(mw_ob @ Vector(me.vertices[i_v].co))
            finally:
                ob_ev.to_mesh_clear()
    cena.frame_set(1)
    bpy.context.view_layer.update()

    def resolver_camera_independente(
        nome_cam: str,
        largura_px: int,
        altura_px: int,
        lente_mm: float,
        azimute_graus: float,
        elevacao_graus: float,
        ocupacao_alvo: float,
    ) -> tuple[Any, dict[str, Any]]:
        cena.render.resolution_x = largura_px
        cena.render.resolution_y = altura_px

        cd = bpy.data.cameras.new(nome_cam)
        cd.lens = lente_mm
        cd.sensor_fit = "AUTO"
        cd.sensor_width = 36.0
        cd.clip_start = max(0.005, 0.02 * escala_s)
        cd.clip_end = max(80.0, 50.0 * escala_s)

        co = bpy.data.objects.new(nome_cam, cd)
        cena.collection.objects.link(co)
        cena.camera = co

        az = math.radians(azimute_graus)
        el = math.radians(elevacao_graus)
        dir_unit = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))).normalized()

        alvo = Vector((0.0, 0.0, z_topo_colchonete + 0.11 * h))
        dist = 2.2 * h

        # Iterar recentralização 2D no plano da imagem + ajuste exato de distância
        for _ in range(14):
            co.location = alvo + dir_unit * dist
            quat_cam = (alvo - co.location).to_track_quat("-Z", "Y")
            co.rotation_euler = quat_cam.to_euler()
            bpy.context.view_layer.update()

            us: list[float] = []
            vs: list[float] = []
            for pt in pontos_enquadramento:
                ndc = world_to_camera_view(cena, co, pt)
                us.append(float(ndc.x))
                vs.append(float(ndc.y))

            u_min, u_max = min(us), max(us)
            v_min, v_max = min(vs), max(vs)
            u_centro = 0.5 * (u_min + u_max)
            v_centro = 0.5 * (v_min + v_max)
            span_u = max(1e-4, u_max - u_min)
            span_v = max(1e-4, v_max - v_min)
            span_dom = max(span_u, span_v)

            # Converter desvio NDC (u_centro - 0.5, v_centro - 0.5) em deslocamento 3D no plano focal
            fov_h = 2.0 * math.atan((0.5 * cd.sensor_width) / cd.lens)
            if largura_px >= altura_px:
                larg_mundo = 2.0 * dist * math.tan(0.5 * fov_h)
                alt_mundo = larg_mundo * (altura_px / float(largura_px))
            else:
                alt_mundo = 2.0 * dist * math.tan(0.5 * fov_h)
                larg_mundo = alt_mundo * (largura_px / float(altura_px))

            eixo_dir_cam = quat_cam @ Vector((1.0, 0.0, 0.0))
            eixo_cima_cam = quat_cam @ Vector((0.0, 1.0, 0.0))
            alvo = (
                alvo
                + eixo_dir_cam * ((u_centro - 0.50) * larg_mundo)
                + eixo_cima_cam * ((v_centro - 0.49) * alt_mundo)
            )
            dist = dist * (span_dom / ocupacao_alvo)

        co.location = alvo + dir_unit * dist
        co.rotation_euler = (alvo - co.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()

        us_f = [float(world_to_camera_view(cena, co, pt).x) for pt in pontos_enquadramento]
        vs_f = [float(world_to_camera_view(cena, co, pt).y) for pt in pontos_enquadramento]

        resumo_cam = {
            "nome": nome_cam,
            "resolucao_px": [largura_px, altura_px],
            "proporcao": f"{largura_px}:{altura_px}",
            "lente_mm": lente_mm,
            "azimute_graus": azimute_graus,
            "elevacao_graus": elevacao_graus,
            "distancia_m": round(dist, 5),
            "posicao_mundo": [round(v, 5) for v in co.location],
            "alvo_mundo": [round(v, 5) for v in alvo],
            "ndc_u_intervalo": [round(min(us_f), 4), round(max(us_f), 4)],
            "ndc_v_intervalo": [round(min(vs_f), 4), round(max(vs_f), 4)],
            "margem_minima_borda_pct": round(
                100.0 * min(min(us_f), 1.0 - max(us_f), min(vs_f), 1.0 - max(vs_f)), 2
            ),
        }
        return co, resumo_cam

    # Câmera 1 — Horizontal 16:9 (1280x720): vista lateral-anterior 3/4 clássica (-58°, elev 22°, lente 52 mm)
    cam_h, info_cam_h = resolver_camera_independente(
        nome_cam="forja_cam_horizontal_16x9",
        largura_px=1280,
        altura_px=720,
        lente_mm=52.0,
        azimute_graus=-58.0,
        elevacao_graus=22.0,
        ocupacao_alvo=0.82,
    )

    # Câmera 2 — Vertical 9:16 (720x1280): reposicionada em diagonal longitudinal elevada (+23°, elev 45°, lente 48 mm)
    cam_v, info_cam_v = resolver_camera_independente(
        nome_cam="forja_cam_vertical_9x16",
        largura_px=720,
        altura_px=1280,
        lente_mm=48.0,
        azimute_graus=23.0,
        elevacao_graus=45.0,
        ocupacao_alvo=0.86,
    )

    # Gerenciamento de cor consistente (AgX)
    cena.render.resolution_percentage = 100
    cena.render.film_transparent = False
    cena.render.image_settings.file_format = "PNG"
    cena.render.image_settings.color_mode = "RGB"
    cena.render.image_settings.color_depth = "8"
    cena.view_settings.exposure = 0.08
    cena.view_settings.gamma = 1.0

    return {
        "colchonete": {
            "comprimento_m": round(comprimento_colchonete, 5),
            "largura_m": round(largura_colchonete, 5),
            "espessura_m": round(espessura_colchonete, 5),
            "z_base_m": 0.0,
            "z_topo_m": round(z_topo_colchonete, 5),
            "objeto": obj_colchonete,
        },
        "luzes": luzes_info,
        "cameras": {
            "horizontal": {"objeto": cam_h, "info": info_cam_h},
            "vertical": {"objeto": cam_v, "info": info_cam_v},
        },
        "gerenciamento_cor": {
            "display_device": cena.display_settings.display_device,
            "view_transform": cena.view_settings.view_transform,
            "look": cena.view_settings.look,
            "exposure": round(float(cena.view_settings.exposure), 3),
            "gamma": round(float(cena.view_settings.gamma), 3),
        },
    }


# ---------------------------------------------------------------------------
# Auditoria pré-renderização rigorosa (Seção 3 do piloto)
# ---------------------------------------------------------------------------

def auditar_animacao_e_cena(
    arm_obj: Any,
    malhas: list[Any],
    info_grupos: dict[str, Any],
    info_retarget: dict[str, Any],
    info_cenario: dict[str, Any],
) -> dict[str, Any]:
    """
    Executa todas as verificações obrigatórias antes da renderização final:
      - correspondência exata dos ossos;
      - fechamento contínuo do loop (quadro 90 -> quadro 1);
      - amplitude e coerência biomecânica do crunch abdominal;
      - contato consistente de dorso/glúteos e pés com o colchonete;
      - ausência de interpenetração mão/antebraço × tronco/quadril/coxa (KDTree 3D);
      - visibilidade integral de personagem + colchonete nas câmeras 16:9 e 9:16.
    """
    import bpy  # type: ignore
    from bpy_extras.object_utils import world_to_camera_view  # type: ignore
    from mathutils import Vector, kdtree  # type: ignore

    cena = bpy.context.scene
    h = float(info_grupos["altura_rest_m"])
    z_topo = float(info_cenario["colchonete"]["z_topo_m"])
    obj_col = info_cenario["colchonete"]["objeto"]
    cam_h = info_cenario["cameras"]["horizontal"]["objeto"]
    cam_v = info_cenario["cameras"]["vertical"]["objeto"]

    # 1. Continuidade de ossos nos 90 quadros e na transição 90 -> 1
    serie = info_retarget["serie_cinematica"]
    chaves_pos = ["hip_pos", "head_pos", "ombro_l_pos", "mao_l_pos", "joelho_l_pos", "pe_l_pos", "pe_r_pos"]

    maior_salto_interno_m = 0.0
    for i in range(1, len(serie)):
        for ch in chaves_pos:
            d = (Vector(serie[i][ch]) - Vector(serie[i - 1][ch])).length
            if d > maior_salto_interno_m:
                maior_salto_interno_m = d

    salto_fechamento_loop_m = max(
        (Vector(serie[0][ch]) - Vector(serie[-1][ch])).length
        for ch in chaves_pos
    )
    razao_loop_vs_interno = salto_fechamento_loop_m / max(1e-6, maior_salto_interno_m)

    desvio_pe_esq_m = max(
        (Vector(s["pe_l_pos"]) - Vector(serie[0]["pe_l_pos"])).length
        for s in serie
    )
    desvio_pe_dir_m = max(
        (Vector(s["pe_r_pos"]) - Vector(serie[0]["pe_r_pos"])).length
        for s in serie
    )

    elevacao_ombro_m = max(s["ombro_l_pos"][2] for s in serie) - min(s["ombro_l_pos"][2] for s in serie)
    elevacao_cabeca_m = max(s["head_pos"][2] for s in serie) - min(s["head_pos"][2] for s in serie)
    elevacao_mao_m = max(s["mao_l_pos"][2] for s in serie) - min(s["mao_l_pos"][2] for s in serie)
    flex_tor_max = max(s["flexao_toracica_graus"] for s in serie)
    flex_cerv_max = max(s["flexao_cervical_graus"] for s in serie)
    joelho_min = min(s["flexao_joelho_graus"] for s in serie)
    joelho_max = max(s["flexao_joelho_graus"] for s in serie)

    # 2. Verificação densa na malha deformada real + KDTree 3D + frustum das 2 câmeras
    quadros_malha = sorted(set(list(range(1, TOTAL_QUADROS_CICLO + 1, 3)) + [1, 23, 46, 68, 90]))
    z_dorso_rel_mm: list[float] = []
    z_pe_l_rel_mm: list[float] = []
    z_pe_r_rel_mm: list[float] = []
    z_bracos_rel_mm: list[float] = []
    z_global_min_m = float("inf")
    dist_min_mao_corpo_mm = float("inf")
    quadro_menor_dist_mao = 1

    verts_colchonete = [obj_col.matrix_world @ Vector(v.co) for v in obj_col.data.vertices]
    fora_frustum_h = 0
    fora_frustum_v = 0
    ndc_h_limites = [1.0, 0.0, 1.0, 0.0]  # u_min, u_max, v_min, v_max
    ndc_v_limites = [1.0, 0.0, 1.0, 0.0]

    def registrar_ndc(cena_atual: Any, cam: Any, largura: int, altura: int, pts: list[Any], lims: list[float]) -> int:
        cena_atual.render.resolution_x = largura
        cena_atual.render.resolution_y = altura
        cena_atual.camera = cam
        bpy.context.view_layer.update()
        violacoes = 0
        for pt in pts:
            ndc = world_to_camera_view(cena_atual, cam, pt)
            u, v, z_d = float(ndc.x), float(ndc.y), float(ndc.z)
            lims[0] = min(lims[0], u)
            lims[1] = max(lims[1], u)
            lims[2] = min(lims[2], v)
            lims[3] = max(lims[3], v)
            if u < 0.015 or u > 0.985 or v < 0.015 or v > 0.985 or z_d <= 0.0:
                violacoes += 1
        return violacoes

    # Medir vértices deformados no quadro 1 e quadro 90 para fechamento exato em malha
    amostras_loop_q1: list[Any] = []
    amostras_loop_q90: list[Any] = []

    for q in quadros_malha:
        cena.frame_set(q)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()

        pts_corpo_inf: list[Any] = []
        pts_mao_ant: list[Any] = []
        pts_frustum_q: list[Any] = list(verts_colchonete)

        z_min_dorso_q = float("inf")
        z_min_pe_l_q = float("inf")
        z_min_pe_r_q = float("inf")
        z_min_bracos_q = float("inf")

        for m_i, ob in enumerate(malhas):
            ob_ev = ob.evaluated_get(deps)
            me = ob_ev.to_mesh()
            try:
                mw_ob = ob_ev.matrix_world
                grupos_m = info_grupos["indices_por_malha"][m_i]

                for v_i in grupos_m["tronco_cabeca"]:
                    pw = mw_ob @ Vector(me.vertices[v_i].co)
                    if pw.z < z_min_dorso_q:
                        z_min_dorso_q = pw.z
                    if pw.z < z_global_min_m:
                        z_global_min_m = pw.z

                for v_i in grupos_m["pe_esq"]:
                    pw = mw_ob @ Vector(me.vertices[v_i].co)
                    if pw.z < z_min_pe_l_q:
                        z_min_pe_l_q = pw.z
                    if pw.z < z_global_min_m:
                        z_global_min_m = pw.z

                for v_i in grupos_m["pe_dir"]:
                    pw = mw_ob @ Vector(me.vertices[v_i].co)
                    if pw.z < z_min_pe_r_q:
                        z_min_pe_r_q = pw.z
                    if pw.z < z_global_min_m:
                        z_global_min_m = pw.z

                for v_i in grupos_m["bracos_completos"]:
                    pw = mw_ob @ Vector(me.vertices[v_i].co)
                    if pw.z < z_min_bracos_q:
                        z_min_bracos_q = pw.z
                    if pw.z < z_global_min_m:
                        z_global_min_m = pw.z

                for v_i in grupos_m["corpo_inferior_tronco"]:
                    pts_corpo_inf.append(mw_ob @ Vector(me.vertices[v_i].co))
                for v_i in grupos_m["mao_antebraco"]:
                    pts_mao_ant.append(mw_ob @ Vector(me.vertices[v_i].co))

                passo_f = max(1, len(me.vertices) // 2000)
                for v_i in range(0, len(me.vertices), passo_f):
                    pw = mw_ob @ Vector(me.vertices[v_i].co)
                    pts_frustum_q.append(pw)
                    if q == 1:
                        amostras_loop_q1.append(pw)
                    elif q == TOTAL_QUADROS_CICLO:
                        amostras_loop_q90.append(pw)
            finally:
                ob_ev.to_mesh_clear()

        z_dorso_rel_mm.append((z_min_dorso_q - z_topo) * 1000.0)
        z_pe_l_rel_mm.append((z_min_pe_l_q - z_topo) * 1000.0)
        z_pe_r_rel_mm.append((z_min_pe_r_q - z_topo) * 1000.0)
        z_bracos_rel_mm.append((z_min_bracos_q - z_topo) * 1000.0)

        if pts_corpo_inf and pts_mao_ant:
            kd = kdtree.KDTree(len(pts_corpo_inf))
            for idx_p, pt_c in enumerate(pts_corpo_inf):
                kd.insert(pt_c, idx_p)
            kd.balance()
            menor_q_mm = min(kd.find(pt_m)[2] for pt_m in pts_mao_ant) * 1000.0
            if menor_q_mm < dist_min_mao_corpo_mm:
                dist_min_mao_corpo_mm = menor_q_mm
                quadro_menor_dist_mao = q

        fora_frustum_h += registrar_ndc(cena, cam_h, 1280, 720, pts_frustum_q, ndc_h_limites)
        fora_frustum_v += registrar_ndc(cena, cam_v, 720, 1280, pts_frustum_q, ndc_v_limites)

    salto_malha_loop_m = 0.0
    if amostras_loop_q1 and len(amostras_loop_q1) == len(amostras_loop_q90):
        salto_malha_loop_m = max(
            (a - b).length for a, b in zip(amostras_loop_q1, amostras_loop_q90)
        )

    # Escala equivalente humana (1.75 m) para facilitar leitura clínica em mm
    fator_escala_humana = 1.75 / max(1e-4, h)

    verificacoes = {
        "correspondencia_15_ossos_completa": len(TABELA_CORRESPONDENCIA_OSSOS) == 15,
        "loop_continuo_sem_salto": (info_retarget["erro_periodo_exato_fonte_m"] < 0.002) and (razao_loop_vs_interno <= 1.35),
        "amplitude_abdominal_coerente": (18.0 <= flex_tor_max <= 30.0) and (elevacao_ombro_m > 0.06 * h),
        "pes_plantados_sem_deslizamento": max(desvio_pe_esq_m, desvio_pe_dir_m) < 0.001 * h,
        "contato_dorso_colchonete_consistente": (
            min(z_dorso_rel_mm) >= -4.0 * (h / 0.98) and max(z_dorso_rel_mm) <= 3.5 * (h / 0.98)
        ),
        "contato_pes_colchonete_consistente": (
            min(min(z_pe_l_rel_mm), min(z_pe_r_rel_mm)) >= -4.0 * (h / 0.98)
            and max(max(z_pe_l_rel_mm), max(z_pe_r_rel_mm)) <= 4.0 * (h / 0.98)
        ),
        "sem_penetracao_abaixo_do_piso": z_global_min_m >= 0.002 * h,
        "sem_interpenetracao_mao_tronco_coxa": (dist_min_mao_corpo_mm * fator_escala_humana) >= 8.0,
        "visibilidade_integral_horizontal_16x9": fora_frustum_h == 0,
        "visibilidade_integral_vertical_9x16": fora_frustum_v == 0,
    }
    aprovado = all(verificacoes.values())

    problemas = [nome for nome, ok in verificacoes.items() if not ok]

    cena.frame_set(1)
    bpy.context.view_layer.update()

    return {
        "aprovado": aprovado,
        "problemas_detectados": problemas,
        "verificacoes": verificacoes,
        "metricas": {
            "altura_nativa_modelo_m": round(h, 5),
            "fator_equivalente_1m75": round(fator_escala_humana, 4),
            "maior_salto_osso_entre_quadros_m": round(maior_salto_interno_m, 6),
            "salto_osso_fechamento_loop_q90_q1_m": round(salto_fechamento_loop_m, 6),
            "razao_passo_loop_vs_interno": round(razao_loop_vs_interno, 4),
            "salto_malha_fechamento_loop_q90_q1_m": round(salto_malha_loop_m, 6),
            "erro_periodo_exato_fonte_t0_t3_m": info_retarget["erro_periodo_exato_fonte_m"],
            "flexao_toracica_max_graus": round(flex_tor_max, 2),
            "flexao_cervical_max_graus": round(flex_cerv_max, 2),
            "inclinacao_cabeca_max_graus": round(flex_tor_max + flex_cerv_max, 2),
            "flexao_joelho_intervalo_graus": [round(joelho_min, 2), round(joelho_max, 2)],
            "elevacao_ombro_nativa_m": round(elevacao_ombro_m, 5),
            "elevacao_ombro_equiv_1m75_cm": round(elevacao_ombro_m * fator_escala_humana * 100.0, 2),
            "elevacao_cabeca_equiv_1m75_cm": round(elevacao_cabeca_m * fator_escala_humana * 100.0, 2),
            "elevacao_mao_equiv_1m75_cm": round(elevacao_mao_m * fator_escala_humana * 100.0, 2),
            "desvio_horizontal_pe_esq_mm": round(desvio_pe_esq_m * 1000.0, 4),
            "desvio_horizontal_pe_dir_mm": round(desvio_pe_dir_m * 1000.0, 4),
            "dorso_rel_colchonete_mm": [round(min(z_dorso_rel_mm), 3), round(max(z_dorso_rel_mm), 3)],
            "pe_esq_rel_colchonete_mm": [round(min(z_pe_l_rel_mm), 3), round(max(z_pe_l_rel_mm), 3)],
            "pe_dir_rel_colchonete_mm": [round(min(z_pe_r_rel_mm), 3), round(max(z_pe_r_rel_mm), 3)],
            "bracos_rel_colchonete_mm": [round(min(z_bracos_rel_mm), 3), round(max(z_bracos_rel_mm), 3)],
            "z_min_global_acima_piso_mm": round(z_global_min_m * 1000.0, 3),
            "distancia_min_mao_antebraco_vs_corpo_mm_nativo": round(dist_min_mao_corpo_mm, 3),
            "distancia_min_mao_antebraco_vs_corpo_mm_equiv_1m75": round(
                dist_min_mao_corpo_mm * fator_escala_humana, 2
            ),
            "quadro_menor_distancia_mao_corpo": quadro_menor_dist_mao,
            "ndc_global_horizontal_16x9": [round(x, 4) for x in ndc_h_limites],
            "ndc_global_vertical_9x16": [round(x, 4) for x in ndc_v_limites],
            "violacoes_frustum_horizontal": fora_frustum_h,
            "violacoes_frustum_vertical": fora_frustum_v,
        },
    }


# ---------------------------------------------------------------------------
# Configuração determinística do Blender Cycles + Renderização
# ---------------------------------------------------------------------------

def configurar_cycles_piloto(amostras: int) -> dict[str, Any]:
    import bpy  # type: ignore

    cena = bpy.context.scene
    cena.render.engine = "CYCLES"
    cena.cycles.device = "CPU"
    cena.cycles.samples = amostras
    cena.cycles.use_adaptive_sampling = True
    cena.cycles.adaptive_threshold = 0.018
    cena.cycles.adaptive_min_samples = min(12, amostras)

    # Limitar bounces para eliminar ruído indireto estéril mantendo GI limpa no colchonete/pele
    cena.cycles.max_bounces = 4
    cena.cycles.diffuse_bounces = 2
    cena.cycles.glossy_bounces = 2
    cena.cycles.transmission_bounces = 2
    cena.cycles.volume_bounces = 0
    cena.cycles.transparent_max_bounces = 4
    cena.cycles.caustics_reflective = False
    cena.cycles.caustics_refractive = False

    # Semente fixa para zero cintilação temporal na transição do loop
    cena.cycles.seed = 42
    if hasattr(cena.cycles, "use_animated_seed"):
        cena.cycles.use_animated_seed = False

    if hasattr(cena.render, "use_persistent_data"):
        cena.render.use_persistent_data = True

    denoiser_ativo = None
    erro_denoiser = None
    try:
        cena.cycles.use_denoising = True
        cena.cycles.denoiser = "OPENIMAGEDENOISE"
        if hasattr(cena.cycles, "denoising_input_passes"):
            cena.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
        if hasattr(cena.cycles, "denoising_prefilter"):
            cena.cycles.denoising_prefilter = "ACCURATE"
        denoiser_ativo = str(cena.cycles.denoiser)
    except Exception as exc:  # noqa: BLE001
        cena.cycles.use_denoising = False
        erro_denoiser = f"{type(exc).__name__}: {exc}"

    return {
        "engine": "CYCLES",
        "device": "CPU",
        "samples": amostras,
        "adaptive_threshold": 0.018,
        "adaptive_min_samples": min(12, amostras),
        "max_bounces": 4,
        "diffuse_bounces": 2,
        "glossy_bounces": 2,
        "seed_fixa": 42,
        "use_persistent_data": bool(getattr(cena.render, "use_persistent_data", False)),
        "denoiser": denoiser_ativo,
        "erro_denoiser": erro_denoiser,
        "threads": int(cena.render.threads),
    }


def inspecionar_png_renderizado(caminho_png: str) -> dict[str, Any]:
    import bpy  # type: ignore

    if not os.path.isfile(caminho_png):
        return {"existe": False}
    img = bpy.data.images.load(caminho_png, check_existing=False)
    try:
        larg, alt = int(img.size[0]), int(img.size[1])
        px = list(img.pixels)
        total = max(1, larg * alt)
        passo = max(1, total // 20000) * 4
        soma_lum = 0.0
        n = 0
        claros = 0
        for i in range(0, len(px), passo):
            lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            soma_lum += lum
            if lum > 0.06:
                claros += 1
            n += 1
        return {
            "existe": True,
            "bytes": os.path.getsize(caminho_png),
            "resolucao": [larg, alt],
            "luminancia_media": round(soma_lum / max(1, n), 5),
            "fracao_pixels_visiveis": round(claros / max(1, n), 5),
        }
    finally:
        bpy.data.images.remove(img)


def preparar_cena_completa(caminho_modelo: str, caminho_clipe: str) -> dict[str, Any]:
    import bpy  # type: ignore

    bpy.ops.wm.read_factory_settings(use_empty=True)
    with capturar_saida_nativa() as tmp_log:
        bpy.ops.import_scene.gltf(filepath=caminho_modelo)
    log_imp = ler_e_apagar(tmp_log)

    malhas, malhas_ignoradas = malhas_personagem_renderizaveis()
    armaduras = [ob for ob in bpy.data.objects if ob.type == "ARMATURE"]
    if not malhas or not armaduras:
        raise RuntimeError(f"Modelo inválido: malhas={len(malhas)}, armaduras={len(armaduras)}")
    arm_obj = armaduras[0]

    bpy.context.view_layer.update()
    info_grupos = auditar_grupos_vertices(arm_obj, malhas)
    altura_h = float(info_grupos["altura_rest_m"])
    z_topo_colchonete = 0.016 * altura_h

    clipe = carregar_clipe_glb(caminho_clipe)
    info_retarget = construir_animacao_retarget(arm_obj, malhas, clipe, info_grupos, z_topo_colchonete)
    ext_x = tuple(info_retarget["extensao_x_personagem_q1_m"])
    info_cenario = criar_cenario_e_cameras(altura_h, ext_x, z_topo_colchonete, malhas)

    return {
        "arm_obj": arm_obj,
        "malhas": malhas,
        "malhas_ignoradas": malhas_ignoradas,
        "log_importacao": log_imp[-2000:] if log_imp else "",
        "info_grupos": info_grupos,
        "clipe": clipe,
        "info_retarget": info_retarget,
        "info_cenario": info_cenario,
    }


def executar_prevalidacao(args: argparse.Namespace) -> int:
    import bpy  # type: ignore

    t_inicio_total = time.perf_counter()
    ctx = preparar_cena_completa(args.modelo, args.clipe)
    auditoria = auditar_animacao_e_cena(
        ctx["arm_obj"],
        ctx["malhas"],
        ctx["info_grupos"],
        ctx["info_retarget"],
        ctx["info_cenario"],
    )
    cfg_cycles = configurar_cycles_piloto(args.amostras)

    os.makedirs(args.dir_saida, exist_ok=True)
    cena = bpy.context.scene
    quadros_prova = [1, 23, 46]  # t = 0.00s (início/base), t = 0.73s (subida), t = 1.50s (pico de contração)
    provas_renderizadas: list[dict[str, Any]] = []

    if not (args.falhar_se_invalido and not auditoria["aprovado"]):
        for formato, larg, alt in (("horizontal", 1280, 720), ("vertical", 720, 1280)):
            cam_obj = ctx["info_cenario"]["cameras"][formato]["objeto"]
            cena.camera = cam_obj
            cena.render.resolution_x = larg
            cena.render.resolution_y = alt
            for q in quadros_prova:
                cena.frame_set(q)
                bpy.context.view_layer.update()
                nome_png = f"prova-{formato}-q{q:04d}.png"
                caminho_png = os.path.join(args.dir_saida, nome_png)
                cena.render.filepath = caminho_png
                t0 = time.perf_counter()
                with capturar_saida_nativa() as tmp_r:
                    bpy.ops.render.render(write_still=True)
                dt = round(time.perf_counter() - t0, 3)
                log_r = ler_e_apagar(tmp_r)
                metricas_img = inspecionar_png_renderizado(caminho_png)
                provas_renderizadas.append({
                    "formato": formato,
                    "quadro": q,
                    "tempo_animacao_s": round((q - 1) / float(FPS_PILOTO), 4),
                    "arquivo": nome_png,
                    "tempo_render_s": dt,
                    "imagem": metricas_img,
                    "log_cauda": "\n".join(log_r.strip().splitlines()[-6:]) if log_r else "",
                })
                print(
                    f"[prevalidar] {nome_png} ({larg}x{alt}) renderizado em {dt}s "
                    f"lum={metricas_img.get('luminancia_media')}",
                    flush=True,
                )

    cenario_limpo = {
        "colchonete": {
            k: v for k, v in ctx["info_cenario"]["colchonete"].items() if k != "objeto"
        },
        "luzes": ctx["info_cenario"]["luzes"],
        "cameras": {
            "horizontal": ctx["info_cenario"]["cameras"]["horizontal"]["info"],
            "vertical": ctx["info_cenario"]["cameras"]["vertical"]["info"],
        },
        "gerenciamento_cor": ctx["info_cenario"]["gerenciamento_cor"],
    }

    relatorio = {
        "etapa": "prevalidacao_piloto_abdominal_masculino_cycles",
        "blender_versao": bpy.app.version_string,
        "modelo_entrada": os.path.basename(args.modelo),
        "clipe_entrada": args.clipe,
        "ossos_totais_personagem": len(ctx["arm_obj"].data.bones),
        "vertices_personagem": sum(len(m.data.vertices) for m in ctx["malhas"]),
        "triangulos_personagem": sum(sum(len(p.vertices) - 2 for p in m.data.polygons) for m in ctx["malhas"]),
        "malhas_auxiliares_ignoradas": ctx["malhas_ignoradas"],
        "retarget": {
            k: v for k, v in ctx["info_retarget"].items() if k != "serie_cinematica"
        },
        "amostras_cinematicas_chave": [
            ctx["info_retarget"]["serie_cinematica"][idx]
            for idx in (0, 15, 22, 30, 45, 60, 67, 75, 89)
        ],
        "cenario_e_cameras": cenario_limpo,
        "cycles_config": cfg_cycles,
        "auditoria": auditoria,
        "provas_cycles": provas_renderizadas,
        "memoria_proc": ler_memoria_proc_mb(),
        "tempo_total_prevalidacao_s": round(time.perf_counter() - t_inicio_total, 3),
    }

    caminho_json = os.path.join(args.dir_saida, "diagnostico-retarget.json")
    with open(caminho_json, "w", encoding="utf-8") as fh:
        json.dump(relatorio, fh, indent=2, ensure_ascii=False)

    print(
        "[prevalidar] resultado:",
        json.dumps(
            {
                "aprovado": auditoria["aprovado"],
                "problemas": auditoria["problemas_detectados"],
                "denoiser": cfg_cycles["denoiser"],
                "provas": len(provas_renderizadas),
                "memoria_hwm_mb": relatorio["memoria_proc"]["vm_hwm_mb"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    if args.falhar_se_invalido and not auditoria["aprovado"]:
        return 2
    return 0


def executar_render_fatia(args: argparse.Namespace) -> int:
    import bpy  # type: ignore

    formato = args.formato.lower()
    if formato not in ("horizontal", "vertical"):
        raise ValueError(f"Formato inválido: {formato}")

    q_ini = max(1, int(args.quadro_inicio))
    q_fim = min(TOTAL_QUADROS_CICLO, int(args.quadro_fim))
    if q_ini > q_fim:
        raise ValueError(f"Intervalo de quadros inválido: {q_ini}..{q_fim}")

    t_ini = time.perf_counter()
    ctx = preparar_cena_completa(args.modelo, args.clipe)
    cfg_cycles = configurar_cycles_piloto(args.amostras)

    cena = bpy.context.scene
    cam_info = ctx["info_cenario"]["cameras"][formato]
    larg, alt = cam_info["info"]["resolucao_px"]
    cena.camera = cam_info["objeto"]
    cena.render.resolution_x = larg
    cena.render.resolution_y = alt

    os.makedirs(args.dir_saida, exist_ok=True)
    quadros_info: list[dict[str, Any]] = []

    for q in range(q_ini, q_fim + 1):
        cena.frame_set(q)
        bpy.context.view_layer.update()
        nome_arq = f"quadro_{q:04d}.png"
        caminho_arq = os.path.join(args.dir_saida, nome_arq)
        cena.render.filepath = caminho_arq
        tq0 = time.perf_counter()
        with capturar_saida_nativa() as tmp_log:
            bpy.ops.render.render(write_still=True)
        dt_q = round(time.perf_counter() - tq0, 3)
        _ = ler_e_apagar(tmp_log)
        if not os.path.isfile(caminho_arq) or os.path.getsize(caminho_arq) < 1024:
            raise RuntimeError(f"Falha ao gravar {caminho_arq}")
        quadros_info.append({
            "quadro": q,
            "arquivo": nome_arq,
            "bytes": os.path.getsize(caminho_arq),
            "tempo_s": dt_q,
        })
        print(f"[render:{formato}] quadro {q:03d}/{TOTAL_QUADROS_CICLO} em {dt_q}s", flush=True)

    resumo_fatia = {
        "formato": formato,
        "resolucao_px": [larg, alt],
        "quadro_inicio": q_ini,
        "quadro_fim": q_fim,
        "total_quadros_fatia": len(quadros_info),
        "cycles_config": cfg_cycles,
        "tempo_total_s": round(time.perf_counter() - t_ini, 3),
        "tempo_medio_quadro_s": round(
            sum(x["tempo_s"] for x in quadros_info) / max(1, len(quadros_info)), 3
        ),
        "memoria_proc": ler_memoria_proc_mb(),
        "quadros": quadros_info,
    }
    caminho_telemetria = os.path.join(args.dir_saida, f"telemetria-{formato}-{q_ini:04d}-{q_fim:04d}.json")
    with open(caminho_telemetria, "w", encoding="utf-8") as fh:
        json.dump(resumo_fatia, fh, indent=2, ensure_ascii=False)
    return 0


def construir_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="FORJA — Piloto abdominal masculino com Blender Cycles")
    p.add_argument("--modo", choices=["prevalidar", "render"], required=True)
    p.add_argument("--modelo", required=True, help="Caminho do GLB masculino original decodificado")
    p.add_argument("--clipe", default="assets/3d/animacoes/abdominal-supra.glb")
    p.add_argument("--dir-saida", required=True)
    p.add_argument("--amostras", type=int, default=32)
    p.add_argument("--formato", choices=["horizontal", "vertical"], default="horizontal")
    p.add_argument("--quadro-inicio", type=int, default=1)
    p.add_argument("--quadro-fim", type=int, default=TOTAL_QUADROS_CICLO)
    p.add_argument("--falhar-se-invalido", action="store_true")
    return p


def main() -> int:
    parser = construir_parser()
    args = parser.parse_args(extrair_args_usuario())
    if args.modo == "prevalidar":
        return executar_prevalidacao(args)
    return executar_render_fatia(args)


if __name__ == "__main__":
    sys.exit(main())
