/*
  FORJA — biblioteca de exercícios sugeridos (somente dados).

  Cada item tem o mesmo formato de um exercício de rotina (ver
  docs/forja-rotinas-e-backup.md). Ao adicionar um item a uma rotina, o
  módulo de treino copia os campos e gera um id novo; nada aqui é alterado
  pelo uso. Exercícios personalizados ficam em forja-treino-biblioteca-v1.
*/
(function (global) {
  "use strict";

  const F = global.Forja;

  function item(id, name, section, fields) {
    return Object.assign({
      id,
      name,
      section,
      type: "reps",
      sets: 3,
      reps: "10",
      duration: 45,
      rest: 60,
      load: "",
      notes: ""
    }, fields);
  }

  F.EXERCISE_LIBRARY = Object.freeze({
    calisthenics: Object.freeze([
      item("cal-rotacao-ombros", "Rotação de ombros", "warmup", { type: "duration", sets: 2, duration: 30, rest: 15 }),
      item("cal-mobilidade-quadril", "Mobilidade de quadril", "warmup", { type: "duration", sets: 2, duration: 30, rest: 15 }),
      item("cal-polichinelo", "Polichinelo", "warmup", { sets: 2, reps: "20", rest: 30 }),
      item("cal-flexao", "Flexão de braço", "main", { sets: 4, reps: "10", rest: 60 }),
      item("cal-agachamento", "Agachamento livre", "main", { sets: 4, reps: "15", rest: 60 }),
      item("cal-barra-fixa", "Barra fixa (pegada pronada)", "main", { sets: 4, reps: "6", rest: 90 }),
      item("cal-remada-invertida", "Remada invertida", "main", { sets: 4, reps: "8", rest: 90 }),
      item("cal-mergulho", "Paralela (mergulho)", "main", { sets: 3, reps: "8", rest: 75 }),
      item("cal-afundo", "Afundo alternado", "main", { sets: 3, reps: "10 por perna", rest: 60 }),
      item("cal-ponte", "Ponte de glúteo", "main", { sets: 3, reps: "15", rest: 45 }),
      item("cal-prancha-frontal", "Prancha frontal", "abs", { type: "duration", sets: 3, duration: 30, rest: 45 }),
      item("cal-prancha-lateral", "Prancha lateral", "abs", { type: "duration", sets: 2, duration: 30, rest: 30 }),
      item("cal-abdominal-supra", "Abdominal supra", "abs", { sets: 3, reps: "15", rest: 45 }),
      item("cal-elevacao-pernas", "Elevação de pernas", "abs", { sets: 3, reps: "10", rest: 45 }),
      item("cal-abdominal-infra", "Abdominal infra", "abs", { sets: 3, reps: "12", rest: 45 }),
      item("cal-burpee", "Burpee", "finisher", { sets: 3, reps: "10", rest: 45 }),
      item("cal-mountain-climber", "Mountain climber", "finisher", { type: "duration", sets: 3, duration: 40, rest: 30 }),
      item("cal-corrida-estacionaria", "Corrida estacionária", "finisher", { type: "duration", sets: 2, duration: 45, rest: 30 })
    ]),
    weights: Object.freeze([
      item("mus-esteira", "Esteira em ritmo leve", "warmup", { type: "duration", sets: 1, duration: 300, rest: 0 }),
      item("mus-mobilidade-ombro", "Mobilidade de ombro com elástico", "warmup", { type: "duration", sets: 2, duration: 60, rest: 15 }),
      item("mus-supino-reto", "Supino reto com barra", "main", { sets: 4, reps: "10", rest: 90 }),
      item("mus-agachamento-barra", "Agachamento livre com barra", "main", { sets: 4, reps: "8", rest: 120 }),
      item("mus-terra", "Levantamento terra", "main", { sets: 3, reps: "5", rest: 150 }),
      item("mus-puxada-frontal", "Puxada frontal", "main", { sets: 4, reps: "10", rest: 90 }),
      item("mus-desenvolvimento", "Desenvolvimento com halteres", "main", { sets: 3, reps: "10", rest: 75 }),
      item("mus-remada-curvada", "Remada curvada com barra", "main", { sets: 4, reps: "10", rest: 90 }),
      item("mus-leg-press", "Leg press 45°", "main", { sets: 3, reps: "12", rest: 90 }),
      item("mus-rosca-direta", "Rosca direta", "main", { sets: 3, reps: "12", rest: 60 }),
      item("mus-triceps-polia", "Tríceps na polia", "main", { sets: 3, reps: "12", rest: 60 }),
      item("mus-extensora", "Cadeira extensora", "main", { sets: 3, reps: "12", rest: 60 }),
      item("mus-flexora", "Mesa flexora", "main", { sets: 3, reps: "12", rest: 60 }),
      item("mus-elevacao-lateral", "Elevação lateral", "main", { sets: 3, reps: "15", rest: 45 }),
      item("mus-abdominal-polia", "Abdominal na polia", "abs", { sets: 3, reps: "12", rest: 45 }),
      item("mus-prancha", "Prancha frontal", "abs", { type: "duration", sets: 3, duration: 40, rest: 45 }),
      item("mus-elevacao-barra", "Elevação de pernas na barra", "abs", { sets: 3, reps: "10", rest: 60 }),
      item("mus-bicicleta", "Bicicleta ergométrica", "finisher", { type: "duration", sets: 1, duration: 300, rest: 0 }),
      item("mus-farmer", "Farmer walk", "finisher", { type: "duration", sets: 3, duration: 40, rest: 60 })
    ])
  });
})(window);
