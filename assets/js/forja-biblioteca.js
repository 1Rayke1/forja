/*
  FORJA — adaptador de compatibilidade do catálogo central.

  A fonte oficial é F.exerciseCatalog (forja-catalogo-central.js). Este módulo
  apenas materializa o formato histórico consumido por rotinas, atlas, plano,
  demonstrações e editor. Não grava nem migra localStorage.

  - academia      -> weights
  - calistenia    -> calisthenics
  - peso-corporal -> calisthenics (somente na saída legada; os modelos centrais
                     permanecem independentes e seus equipamentos não se misturam)

  Exercícios personalizados continuam em forja-treino-biblioteca-v1 e são
  acrescentados por F.catalog.items(), exatamente como antes.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  if (!F.exerciseCatalog) throw new Error("Carregue o catálogo central antes da biblioteca de compatibilidade.");

  const library = { calisthenics: [], weights: [] };
  F.exerciseCatalog.exercises.forEach(record => {
    const legacy = F.exerciseCatalog.toLegacyExercise(record);
    if (!legacy) throw new Error("Exercício sem modalidade de compatibilidade: " + record.id);
    const mode = F.exerciseCatalog.modalityById(record.modality).legacyMode;
    Object.freeze(legacy.roles.primary);
    Object.freeze(legacy.roles.secondary);
    Object.freeze(legacy.roles.stabilizers);
    Object.freeze(legacy.roles);
    Object.freeze(legacy.aliases);
    Object.freeze(legacy.equipment);
    Object.freeze(legacy.ranking);
    Object.freeze(legacy);
    library[mode].push(legacy);
  });

  /* Mantém os registros históricos nos lugares já conhecidos pelos usuários;
     a expansão vem depois, sem alterar seus IDs ou padrões de treino. */
  const legacyOrder = [
    "cal-rotacao-ombros", "cal-mobilidade-quadril", "cal-polichinelo", "cal-flexao",
    "cal-agachamento", "cal-barra-fixa", "cal-remada-invertida", "cal-mergulho",
    "cal-afundo", "cal-ponte", "cal-prancha-frontal", "cal-prancha-lateral",
    "cal-abdominal-supra", "cal-elevacao-pernas", "cal-abdominal-infra", "cal-burpee",
    "cal-mountain-climber", "cal-corrida-estacionaria", "mus-esteira",
    "mus-mobilidade-ombro", "mus-supino-reto", "mus-agachamento-barra", "mus-terra",
    "mus-puxada-frontal", "mus-desenvolvimento", "mus-remada-curvada", "mus-leg-press",
    "mus-rosca-direta", "mus-triceps-polia", "mus-extensora", "mus-flexora",
    "mus-elevacao-lateral", "mus-abdominal-polia", "mus-elevacao-barra", "mus-bicicleta", "mus-farmer"
  ];
  Object.values(library).forEach(list => list.sort((a, b) => {
    const ai = legacyOrder.indexOf(a.id), bi = legacyOrder.indexOf(b.id);
    return (ai < 0 ? 1000 : ai) - (bi < 0 ? 1000 : bi);
  }));

  Object.freeze(library.calisthenics);
  Object.freeze(library.weights);
  F.EXERCISE_LIBRARY = Object.freeze(library);
})(typeof window !== "undefined" ? window : globalThis);
