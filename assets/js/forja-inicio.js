/*
  FORJA — página inicial (index.html).

  A home responde, nesta ordem, a três perguntas:

  1. Qual é a minha próxima ação?      → bloco de treino (topo, uma ação primária)
  2. Como está meu progresso?          → resumo da semana + metas, em uma faixa
  3. Onde continuo de onde parei?      → três registros recentes em linhas compactas

  Calendário e missões continuam sendo o código de `forja-calendario.js`,
  chamado aqui sem alterações (o arquivo é travado por hash nas suítes), agora
  em superfície mais discreta para não competir com o treino.

  Regras deste módulo, deliberadas:

  - Nenhuma gravação ao abrir, navegar ou redesenhar. Só há escrita quando o
    usuário aperta "Iniciar treino" — e a escrita é a sessão ativa, feita por
    `F.startRoutine` (módulo de sessão), não por este arquivo.
  - Toda conta vem de `F.metricas` (módulo puro). Nada é recalculado aqui.
  - Ausência de dado não vira zero: tempo sem registro aparece como "—" e a
    tela diz o motivo; "0 treinos nesta semana" só aparece quando existe
    histórico e a semana está realmente vazia.
  - O modelo não guarda "rotina programada para hoje". A sugestão do topo é a
    rotina usada mais recentemente (ou a primeira cadastrada) e isso é dito em
    uma linha — não existe treino do dia inventado.
  - Uma única ação primária por tela: "Iniciar <rotina>" quando há rotina com
    exercícios; "Abrir área de treino" quando ainda não há. Com sessão ativa, a
    ação é a do banner no topo ("Retomar"), então o bloco de treino se retira.
  - Todo texto do usuário entra por `textContent` (nunca HTML concatenado).
  - Nenhum temporizador é criado aqui: o único intervalo do app continua em
    `forja-app.js`.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const MODALITIES = ["calisthenics", "weights"];
  const RECENT_LIMIT = 3;

  /* ------------------------------------------------------------------ */
  /* Utilitários                                                         */
  /* ------------------------------------------------------------------ */

  function make(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function byIdSafe(id) {
    return doc.getElementById(id);
  }

  function records() {
    const list = Array.isArray(F.state.history) ? F.state.history : [];
    return list.filter(record => F.isPlainObject(record));
  }

  function routinesOf(modality) {
    const store = F.state.routines;
    const list = store && Array.isArray(store[modality]) ? store[modality] : [];
    return list.filter(routine => F.isPlainObject(routine) && typeof routine.name === "string");
  }

  function totalRoutineCount() {
    return MODALITIES.reduce((sum, modality) => sum + routinesOf(modality).length, 0);
  }

  function exerciseCount(routine) {
    return F.SECTION_ORDER.reduce((sum, section) => {
      const list = routine.sections && Array.isArray(routine.sections[section])
        ? routine.sections[section]
        : [];
      return sum + list.length;
    }, 0);
  }

  /* Data de um registro, sem inventar (finishedAt válido, senão `date`). */
  function sortedByDateDesc(list) {
    return list.slice().sort((a, b) => {
      const dateA = F.metricas.recordDate(a);
      const dateB = F.metricas.recordDate(b);

      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB - dateA;
    });
  }

  /*
    Última vez que cada rotina apareceu no histórico. Usa `routineId` (gravado
    desde a etapa 2); registros antigos sem id são associados pelo nome exato.
  */
  function lastUseByRoutine(history) {
    const map = new Map();

    history.forEach(record => {
      const date = F.metricas.recordDate(record);
      if (!date) return;

      const keys = [];

      if (typeof record.routineId === "string" && record.routineId) {
        keys.push(record.modality + "|id|" + record.routineId);
      }
      if (typeof record.routineName === "string" && record.routineName) {
        keys.push(record.modality + "|name|" + record.routineName);
      }

      keys.forEach(key => {
        const current = map.get(key);
        if (!current || date > current) map.set(key, date);
      });
    });

    return map;
  }

  function lastUsedFor(map, modality, routine) {
    return map.get(modality + "|id|" + routine.id) ||
      map.get(modality + "|name|" + routine.name) ||
      null;
  }

  function primaryButton(label, onClick, modifier) {
    const node = make("button", "primary-button" + (modifier ? " " + modifier : ""), label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* 1. Ação principal (treino)                                          */
  /* ------------------------------------------------------------------ */

  /*
    Escolhe a rotina sugerida: a treinada mais recentemente, entre as que têm
    exercícios. Sem histórico, a primeira de cada modalidade (calistenia antes
    de musculação), em ordem estável de cadastro.
  */
  function suggestedRoutine(history) {
    const lastUse = lastUseByRoutine(history);
    const candidates = [];

    MODALITIES.forEach(modality => {
      routinesOf(modality).forEach((routine, index) => {
        if (exerciseCount(routine) === 0) return;
        candidates.push({ modality, routine, index, lastUsed: lastUsedFor(lastUse, modality, routine) });
      });
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const timeA = a.lastUsed ? a.lastUsed.getTime() : -1;
      const timeB = b.lastUsed ? b.lastUsed.getTime() : -1;
      if (timeA !== timeB) return timeB - timeA;
      return a.index - b.index;
    });

    const best = candidates[0];
    best.exerciseCount = exerciseCount(best.routine);
    best.setCount = typeof F.getRoutineTotalSets === "function" ? F.getRoutineTotalSets(best.routine) : 0;
    return best;
  }

  function routineMetaText(entry) {
    const parts = [F.MODE_NAMES[entry.modality]];
    parts.push(F.pluralize(entry.exerciseCount, "exercício", "exercícios"));
    if (entry.setCount > 0) parts.push(F.pluralize(entry.setCount, "série", "séries"));
    if (entry.lastUsed) parts.push("última vez " + F.relativeDayText(entry.lastUsed));
    return parts.join(" · ");
  }

  function renderAction(history) {
    const host = byIdSafe("home-action");
    const square = doc.querySelector("a.treino-square");
    const guide = byIdSafe("home-guide");
    if (!host) return;

    host.innerHTML = "";
    host.hidden = false;
    if (square) {
      square.classList.remove("is-primary");
      square.hidden = false;
    }

    const hasHistory = history.length > 0;
    const routineCount = totalRoutineCount();
    const session = F.state.activeWorkout;

    /* Sessão ativa: o banner no topo já é a ação primária (Retomar). */
    if (session && session.routineName) {
      host.hidden = true;
      if (guide) {
        guide.hidden = false;
        guide.textContent = "Seu treino está em andamento — retome pelo aviso acima.";
      }
      return;
    }

    const suggestion = suggestedRoutine(history);

    if (!suggestion) {
      /*
        Sem rotina com exercícios: a única ação é abrir a área de treino, que
        é o mesmo elemento `a.treino-square` de sempre (sem duplicar CTA).
      */
      if (square) square.classList.add("is-primary");

      if (guide) {
        guide.hidden = false;

        if (routineCount > 0) {
          guide.textContent = "Suas rotinas ainda não têm exercícios. Abra a área de treino para adicionar os primeiros.";
        } else if (hasHistory) {
          guide.textContent = "Você ainda não tem rotinas. Crie uma em calistenia ou musculação — seu histórico continua aqui.";
        } else {
          guide.textContent = "Primeira vez aqui? Escolha calistenia ou musculação e crie sua primeira rotina — sem cadastro.";
        }
      }

      return;
    }

    const button = primaryButton("Iniciar " + suggestion.routine.name, () => {
      F.startRoutine(suggestion.modality, suggestion.routine.id);
    }, "home-primary");

    const meta = make("p", "home-action-meta", routineMetaText(suggestion));

    host.append(button, meta);

    if (guide) {
      /*
        Uma frase, só quando ela muda algo: estreia absoluta explica o passo
        seguinte; com histórico, a tela fala por si.
      */
      if (!hasHistory) {
        guide.hidden = false;
        guide.textContent = "Esse é o seu próximo treino. Ao encerrar a sessão, sua semana aparece aqui.";
      } else {
        guide.hidden = true;
        guide.textContent = "";
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2. Resumo da semana e metas                                         */
  /* ------------------------------------------------------------------ */

  function weekSnapshot(now) {
    const today = now instanceof Date ? now : new Date();
    const week = F.metricas.resolvePeriod("week", { now: today });
    const history = records();

    return {
      week,
      hasHistory: history.length > 0,
      summary: F.metricas.summarize(F.metricas.filterByPeriod(history, week)),
      goals: F.metricas.goalProgress(history, F.state.goals, { now: today })
    };
  }

  function metric(value, label) {
    const item = make("div", "home-metric");
    item.appendChild(make("span", "home-metric-value", value));
    item.appendChild(make("span", "home-metric-label", label));
    return item;
  }

  function timeText(summary) {
    if (!summary || !(summary.durationMs > 0)) return null;
    const minutes = Math.round(summary.durationMs / 60000);
    return minutes < 1 ? "< 1 min" : F.formatMinutes(minutes);
  }

  function goalUnit(unit, count) {
    if (unit === "sessions") return count === 1 ? "treino" : "treinos";
    if (unit === "sets") return count === 1 ? "série" : "séries";
    return count === 1 ? "minuto" : "minutos";
  }

  function renderGoals(goals) {
    if (!goals || !goals.active) return null;

    const block = make("div", "home-goals");
    const active = goals.items.filter(item => item.active);

    active.forEach(item => {
      const row = make("div", "home-goal");

      const head = make("div", "home-goal-head");
      head.appendChild(make("span", "home-goal-label", item.label));
      head.appendChild(make("span", "home-goal-value", item.current + "/" + item.target));

      const track = make("div", "home-goal-bar");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, item.percent))));
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-label", item.label + " da semana: " + item.current + " de " + item.target);
      const fill = make("span", "home-goal-fill");
      fill.style.width = Math.max(0, Math.min(100, item.percent)) + "%";
      track.appendChild(fill);

      row.append(head, track);

      if (!item.met) {
        row.title = "Faltam " + item.remaining + " " + goalUnit(item.unit, item.remaining);
      }

      block.appendChild(row);
    });

    const summary = make("p", "home-goals-note");
    const met = active.filter(item => item.met).length;
    summary.textContent = met + "/" + active.length + " metas batidas";
    block.appendChild(summary);

    return block;
  }

  function renderWeek() {
    const body = byIdSafe("home-week-body");
    const range = byIdSafe("home-week-range");
    if (!body) return;

    const snapshot = weekSnapshot();
    const { week, summary, goals } = snapshot;

    if (range) {
      range.textContent = F.metricas.formatDayMonth(week.from) + " – " +
        F.metricas.formatDayMonth(week.to);
    }

    body.innerHTML = "";

    if (!snapshot.hasHistory) {
      body.appendChild(make(
        "p",
        "home-empty",
        "Nenhum treino registrado ainda. Sua semana aparece aqui depois da primeira sessão."
      ));

      /* Meta configurada é dado real: aparece com progresso zero, sem inventar. */
      const goalsBlock = renderGoals(goals);
      if (goalsBlock) body.appendChild(goalsBlock);
      return;
    }

    const time = timeText(summary);
    const metrics = make("div", "home-metrics");
    metrics.appendChild(metric(String(summary.sessions), "treinos"));
    metrics.appendChild(metric(String(summary.sets), "séries"));
    metrics.appendChild(metric(time === null ? "—" : time, "tempo"));
    body.appendChild(metrics);

    const notes = [];

    if (summary.sessions === 0) {
      notes.push("Nenhum treino nesta semana ainda — a última atividade está no histórico abaixo.");
    } else if (summary.partial > 0) {
      notes.push(F.pluralize(summary.partial, "treino parcial", "treinos parciais"));
    }

    if (time === null) notes.push("tempo não registrado nas sessões");

    if (summary.hasVolume) {
      notes.push(F.formatKg(summary.volumeKg) + " de volume");
    }

    if (notes.length > 0) {
      body.appendChild(make("p", "home-week-note", notes.join(" · ")));
    }

    const goalsBlock = renderGoals(goals);
    if (goalsBlock) body.appendChild(goalsBlock);
  }

  /* ------------------------------------------------------------------ */
  /* 3. Continuidade (histórico recente compacto)                        */
  /* ------------------------------------------------------------------ */

  function renderRecent() {
    const body = byIdSafe("home-recent-body");
    if (!body) return;

    const history = sortedByDateDesc(records());
    body.innerHTML = "";

    if (history.length === 0) {
      body.appendChild(make(
        "p",
        "home-empty",
        "Seus treinos aparecem aqui depois do primeiro registro."
      ));
      return;
    }

    const list = make("ul", "home-history-list");

    history.slice(0, RECENT_LIMIT).forEach(record => {
      const item = make("li", "home-history-item");
      item.setAttribute("data-home-history", record.id || "record");

      const head = make("div", "home-history-head");
      head.appendChild(make("strong", "home-history-name", record.routineName || "Treino"));

      const status = make(
        "span",
        "home-history-status is-" + (record.status === "completed" ? "done" : "partial"),
        record.status === "completed" ? "Concluído" : "Parcial"
      );
      head.appendChild(status);

      const meta = make("p", "home-history-meta");
      const completed = Number(record.completedSets);
      const planned = Number(record.totalPlannedSets);
      const parts = [
        F.metricas.formatRecordDate(record, { day: "2-digit", month: "2-digit" }),
        F.MODE_NAMES[record.modality] || "Modalidade não registrada",
        (Number.isFinite(completed) ? completed : 0) + "/" +
          (Number.isFinite(planned) ? planned : 0) + " séries"
      ];
      if (record.durationMs > 0) parts.push(F.formatDurationLong(record.durationMs));
      meta.textContent = parts.join(" · ");

      item.append(head, meta);
      list.appendChild(item);
    });

    body.appendChild(list);
  }

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  function renderDashboard() {
    const history = records();
    renderAction(history);
    renderWeek();
    renderRecent();
  }

  function renderHome() {
    /* Calendário e missões: código existente, chamado sem alterações. */
    if (typeof global.renderCalendar === "function") global.renderCalendar();
    if (typeof global.renderMissions === "function") global.renderMissions();

    renderDashboard();
  }

  /*
    Redesenho sem gravar: qualquer escrita feita pelo store (dentro ou fora da
    home) atualiza o painel. Nenhum ouvinte chama `saveJSON`.
  */
  function watchStore() {
    if (!F.store || typeof F.store.onChange !== "function") return;

    F.store.onChange(key => {
      if (!F.pageName || F.pageName() !== "inicio") return;
      if (key && [
        F.KEYS.routines,
        F.KEYS.history,
        F.KEYS.active,
        F.KEYS.goals,
        F.KEYS.legacyExercises
      ].indexOf(key) === -1) {
        return;
      }
      renderDashboard();
    });
  }

  F.pages = F.pages || {};
  F.pages.inicio = function initInicio() {
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    renderHome();
  };

  /* Recarga de dados do backup e desfazer continuam redesenhando a home. */
  F.onDataChanged(renderHome);

  watchStore();

  /*
    Superfície mínima para testes e para depuração: redesenha a partir do
    estado atual, sem tocar no armazenamento.
  */
  F.home = {
    refresh: renderDashboard,
    snapshot: weekSnapshot,
    suggestion: () => suggestedRoutine(records()),
    limits: { recent: RECENT_LIMIT }
  };
})(window);
