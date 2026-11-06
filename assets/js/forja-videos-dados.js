/*
  FORJA — catálogo de vídeos oficiais de demonstração (YouTube).

  Regras editoriais e técnicas:
  - Nenhum arquivo de vídeo é baixado ou armazenado no repositório.
  - A reprodução usa sempre incorporação oficial via youtube-nocookie.com,
    formato horizontal 16:9, controles visíveis, sem reprodução automática
    e SEMPRE silenciosa (mute=1).
  - Vídeos curtos (máximo de 60 segundos), públicos e verificados em 16:9.
  - Entradas com valor `null` usam automaticamente a imagem de referência do
    exercício e exibem "Vídeo de demonstração ainda não disponível", podendo
    receber um vídeo oficial no futuro sem alterar a estrutura do exercício.
  - Nenhuma chave de API existe neste arquivo nem em qualquer JavaScript
    público. A pesquisa de vídeos personalizados passa exclusivamente pelo
    proxy do backend (`endpoint` abaixo), que guarda YOUTUBE_API_KEY no
    ambiente do servidor — veja docs/videos-youtube.md.
  - YouTube Shorts não fazem parte do produto: a pesquisa só aceita vídeos
    convencionais horizontais e nenhum zoom/corte é aplicado.
*/
(function (global) {
  "use strict";

  function entry(videoId, title, channelTitle, durationSeconds) {
    return Object.freeze({
      videoId,
      title,
      channelTitle,
      durationSeconds,
      aspectRatio: "16:9"
    });
  }

  /*
    Configuração pública da pesquisa. Contém apenas o endereço do proxy do
    próprio domínio — nunca uma credencial. Se alguém definir `apiKey` antes
    deste arquivo, o campo é descartado aqui: o navegador não envia chave
    nenhuma para o YouTube.
  */
  /*
    endpoint pode ser:
      - "/api/youtube-search" (padrão): caminho absoluto do mesmo host. Funciona
        na Netlify (que tem redirect para a Function) e no harness de teste.
        Em hosts sem backend (GitHub Pages em 1rayke1.github.io, file://,
        localhost sem Functions), F.apiUrl é aplicado em resolveEndpoint e
        aponta para a Netlify de produção.
      - uma URL absoluta (http://…, https://…): usada como está para ambientes
        de desenvolvimento com Netlify CLI ou endpoints alternativos.
  */
  const FORJA_YOUTUBE_DEFAULTS = {
    endpoint: "/api/youtube-search",
    maxDurationSeconds: 60,
    maxResults: 10,
    cacheTtlMs: 600000
  };

  const provided = global.FORJA_YOUTUBE_CONFIG;
  const merged = Object.assign({}, FORJA_YOUTUBE_DEFAULTS,
    provided && typeof provided === "object" ? provided : {});
  delete merged.apiKey;
  global.FORJA_YOUTUBE_CONFIG = merged;

  global.FORJA_VIDEOS_DATA = Object.freeze({
    version: 1,
    embedHost: "https://www.youtube-nocookie.com",
    maxDurationSeconds: 60,
    unavailableMessage: "Vídeo de demonstração ainda não disponível",
    exercicios: Object.freeze({
      /* Calistenia (18 exercícios) */
      "calisthenics:cal-rotacao-ombros": entry(
        "hne3nHGXPRM",
        "Arm Circles (Exercise Library)",
        "Horton Barbell",
        14
      ),
      "calisthenics:cal-mobilidade-quadril": entry(
        "kvyYhCbOUaQ",
        "90/90 Hip Rotations (Exercise Library)",
        "Horton Barbell",
        60
      ),
      "calisthenics:cal-polichinelo": null,
      "calisthenics:cal-flexao": entry(
        "xBrI-N44QLc",
        "How to Do a Push-Up | Chest, Triceps & Core Exercise",
        "FIT.nl",
        22
      ),
      "calisthenics:cal-agachamento": entry(
        "vkwdKKJBJXA",
        "Air Squat - Dibs Fitness - Exercise Demonstration",
        "Dibs Fitness",
        30
      ),
      "calisthenics:cal-barra-fixa": entry(
        "9A6NPVPzkqQ",
        "How to Do Wide Grip Pullups | Perfect Form in 30 Seconds",
        "All Strength Training",
        37
      ),
      "calisthenics:cal-remada-invertida": entry(
        "tKBY9DJTKAs",
        "How To Do A BENT LEG BARBELL INVERTED ROW | Exercise Demonstration Video and Guide",
        "Live Lean TV Daily Exercises",
        46
      ),
      "calisthenics:cal-mergulho": null,
      "calisthenics:cal-afundo": entry(
        "gMaGabChpD0",
        "Bodyweight Lunges (Exercise Library)",
        "Horton Barbell",
        53
      ),
      "calisthenics:cal-ponte": entry(
        "szgXdRA2R6Y",
        "Glute Bridge - OPEX Exercise Library",
        "OPEX Fitness",
        12
      ),
      "calisthenics:cal-prancha-frontal": entry(
        "mwlp75MS6Rg",
        "How to do a Plank | Proper Form & Technique | NASM",
        "National Academy of Sports Medicine (NASM)",
        14
      ),
      "calisthenics:cal-prancha-lateral": entry(
        "44ND4bOB-T0",
        "How to do a Side Plank | Proper Form & Technique | NASM",
        "National Academy of Sports Medicine (NASM)",
        16
      ),
      "calisthenics:cal-abdominal-supra": null,
      "calisthenics:cal-elevacao-pernas": null,
      "calisthenics:cal-abdominal-infra": null,
      "calisthenics:cal-burpee": entry(
        "Ozqwsv3kggA",
        "Burpee - OPEX Exercise Library",
        "OPEX Fitness",
        14
      ),
      "calisthenics:cal-mountain-climber": entry(
        "0u40V0AhzRM",
        "Mountain Climbers (Exercise Library)",
        "Horton Barbell",
        44
      ),
      "calisthenics:cal-corrida-estacionaria": entry(
        "xmkYBO85leM",
        "How To JOG IN PLACE | Exercise Demonstration Video and Guide",
        "Live Lean TV Daily Exercises",
        27
      ),

      /* Musculação (19 exercícios) */
      "weights:mus-esteira": null,
      "weights:mus-mobilidade-ombro": null,
      "weights:mus-supino-reto": entry(
        "ooEsh_qvBrE",
        "How to Do the Flat Barbell Bench Press | Perfect Form in 30 Seconds",
        "All Strength Training",
        42
      ),
      "weights:mus-agachamento-barra": entry(
        "eh9XpiZgQnw",
        "Low Bar Back Squat - OPEX Exercise Library",
        "OPEX Fitness",
        14
      ),
      "weights:mus-terra": entry(
        "TN3DHmd1Fe8",
        "Conventional Deadlift - OPEX Exercise Library",
        "OPEX Fitness",
        14
      ),
      "weights:mus-puxada-frontal": entry(
        "U3Y_NsyDq60",
        "Lat Pulldown (Exercise Library)",
        "Horton Barbell",
        51
      ),
      "weights:mus-desenvolvimento": entry(
        "1WOecdL8nrI",
        "How To Do A NEUTRAL GRIP SEATED DUMBBELL SHOULDER PRESS | Exercise Demonstration Video and Guide",
        "Live Lean TV Daily Exercises",
        37
      ),
      "weights:mus-remada-curvada": entry(
        "9Gf-Ourup_k",
        "Bent Over Barbell Row - OPEX Exercise Library",
        "OPEX Fitness",
        11
      ),
      "weights:mus-leg-press": entry(
        "cDGOn-yfKJA",
        "How to do a Leg Press | Proper Form & Technique | NASM",
        "National Academy of Sports Medicine (NASM)",
        33
      ),
      "weights:mus-rosca-direta": entry(
        "9BpYNH4nb_Q",
        "How to Do Barbell Curls | Perfect Form in 30 Seconds",
        "All Strength Training",
        43
      ),
      "weights:mus-triceps-polia": entry(
        "vPeQu_L-1n0",
        "How to Do Tricep Pushdowns with a Rope (Step-by-Step Breakdown)",
        "REP",
        39
      ),
      "weights:mus-extensora": null,
      "weights:mus-flexora": entry(
        "_2Kd0d-JEUM",
        "How to do a Seated Leg Curl | Proper Form & Technique | NASM",
        "National Academy of Sports Medicine (NASM)",
        25
      ),
      "weights:mus-elevacao-lateral": entry(
        "pzj8pmSH8d4",
        "How to Do Dumbbell Lateral Raises | Perfect Form in 30 Seconds",
        "All Strength Training",
        38
      ),
      "weights:mus-abdominal-polia": null,
      "weights:mus-prancha": entry(
        "mwlp75MS6Rg",
        "How to do a Plank | Proper Form & Technique | NASM",
        "National Academy of Sports Medicine (NASM)",
        14
      ),
      "weights:mus-elevacao-barra": null,
      "weights:mus-bicicleta": null,
      "weights:mus-farmer": entry(
        "vW81EITekU0",
        "Farmers Carry - OPEX Exercise Library",
        "OPEX Fitness",
        7
      )
    })
  });
})(window);
