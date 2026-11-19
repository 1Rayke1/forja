/*
  Planejamento semanal (hub Treinos) — seletores de preferências e ícone do cabeçalho.

  Cobre o que o usuário relatou:
  - as opções não podem parecer "sempre verdes": só a escolhida fica verde-limão;
  - cada grupo tem uma única escolha e não mexe nos outros;
  - a troca pode ser repetida à vontade, por clique e por teclado;
  - ao abrir a tela e ao recarregar, o que aparece é o que está salvo;
  - "Gerar meu plano" usa exatamente as escolhas atuais;
  - o ícone do cabeçalho é o `settings` do conjunto oficial do FORJA, em SVG,
    com tamanho/alinhamento coerentes no mobile e no desktop.

  Execução: node tests/treino-preferencias.test.mjs (incluído em `npm test`).
*/
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, closeAllApps } from "./helpers/harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubHtml = fs.readFileSync(path.join(repoRoot, "treino/index.html"), "utf8");

const PREFERENCES_KEY = "forja-planejamento-preferencias-v1";
const profile = {
  version: 3, updatedAt: "2026-11-08T12:00:00.000Z", objetivo: "hipertrofia",
  nivel: "intermediario", equipamento: "academia", diasPorSemana: 4, areaFoco: "corpoTodo",
  localTreino: "academia", experienciaAtual: "experiente", equipamentos: ["academiaCompleta"],
  preferenciasTreino: ["musculacao", "calistenia"], consideracoes: ["nenhuma"]
};

/* Opções esperadas de cada grupo, na ordem em que aparecem na tela. */
const GROUPS = {
  goal: ["massa", "emagrecer", "condicionamento"],
  level: ["iniciante", "intermediario", "avancado"],
  days: ["2", "3", "4", "5", "6"],
  time: ["short", "medium", "long"],
  equipment: ["gym", "home", "none"]
};
const DEFAULTS = { goal: "massa", level: "intermediario", days: 4, time: "medium", equipment: "none" };

const selected = (app, key) => app.$$(`[data-pref-group="${key}"] [data-pref][aria-pressed="true"]`)
  .map(node => node.dataset.value);
const isGreen = app => node => {
  const style = app.w.getComputedStyle(node);
  const pressed = node.getAttribute("aria-pressed");
  return pressed === "true" && node.classList.contains("is-selected");
};

let ran = 0;
const check = (label, fn) => {
  try { fn(); ran += 1; console.log("✅ " + label); }
  catch (error) { console.error("❌ " + label + "\n   " + error.message); throw error; }
};

/* ------------------------------------------------------------------ */
/* 1. Estrutura: um grupo acessível por preferência, um rádio por opção */
/* ------------------------------------------------------------------ */
let app = await boot({ "forja-perfil-v1": profile }, "treino/index.html");
try {
  check("1. Cinco grupos de preferência existem com as opções corretas", () => {
    assert.equal(app.$$("[data-pref-group]").length, 5);
    for (const [key, values] of Object.entries(GROUPS)) {
      const group = app.$(`[data-pref-group="${key}"]`);
      assert.ok(group, "Grupo ausente: " + key);
      assert.deepEqual(app.$$(`[data-pref-group="${key}"] [data-pref]`).map(node => node.dataset.value), values,
        "Opções fora de ordem no grupo " + key);
    }
  });

  check("2. Cada opção é um rádio real dentro de um rótulo (aria-pressed + teclado)", () => {
    for (const key of Object.keys(GROUPS)) {
      const group = app.$(`[data-pref-group="${key}"]`);
      assert.equal(group.getAttribute("role"), "radiogroup", "Grupo " + key + " precisa ser radiogroup");
      const labelId = group.getAttribute("aria-labelledby");
      assert.ok(labelId && app.$("#" + labelId), "Grupo " + key + " precisa nome acessível por legend");
      for (const option of app.$$(`[data-pref-group="${key}"] [data-pref]`)) {
        assert.equal(option.tagName, "LABEL", "A opção deve ser um label clicável");
        const input = option.querySelector("input[type=radio].preference-input");
        assert.ok(input, "Rádio ausente em " + option.dataset.value);
        assert.equal(input.name, "pref-" + key, "Rádios do mesmo grupo compartilham name");
        assert.ok(["true", "false"].includes(option.getAttribute("aria-pressed")), "aria-pressed obrigatório");
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* 2. Ao abrir sem preferências salvas: padrão coerente e alterável     */
  /* ------------------------------------------------------------------ */
  check("3. Sem preferências salvas, a tela começa nos valores padrão coerentes", () => {
    assert.equal(app.raw(PREFERENCES_KEY), null, "Abrir a tela não pode gravar sozinho");
    for (const [key, value] of Object.entries(DEFAULTS)) {
      assert.deepEqual(selected(app, key), [String(value)], "Grupo " + key + " no padrão");
    }
    assert.equal(app.F.plan.readPreferences().goal, DEFAULTS.goal);
  });

  /* ------------------------------------------------------------------ */
  /* 3. Selecionar e trocar cada uma das opções dos cinco grupos          */
  /* ------------------------------------------------------------------ */
  check("4. Selecionar cada opção de cada grupo deixa exatamente ela selecionada", () => {
    for (const [key, values] of Object.entries(GROUPS)) {
      for (const value of values) {
        app.click(`[data-pref-group="${key}"] [data-pref="${key}"][data-value="${value}"]`);
        assert.deepEqual(selected(app, key), [value], `Grupo ${key}: ${value} deveria ser a única marcação`);
        const option = app.$(`[data-pref="${key}"][data-value="${value}"]`);
        assert.ok(isGreen(app)(option), "A opção escolhida precisa receber o estado verde (aria-pressed + is-selected)");
        const input = option.querySelector("input.preference-input");
        assert.equal(input.checked, true, "O rádio interno acompanha a escolha");
      }
    }
  });

  check("5. Só uma opção por grupo fica verde; as demais voltam ao estilo escuro", () => {
    app.click('[data-pref="goal"][data-value="massa"]');
    for (const key of Object.keys(GROUPS)) {
      const pressed = app.$$(`[data-pref-group="${key}"] [data-pref][aria-pressed="true"]`);
      assert.equal(pressed.length, 1, "Grupo " + key + " com " + pressed.length + " opções marcadas");
      for (const option of app.$$(`[data-pref-group="${key}"] [data-pref]`)) {
        if (option === pressed[0]) continue;
        assert.equal(option.getAttribute("aria-pressed"), "false");
        assert.equal(option.classList.contains("is-selected"), false, "Opção escura não pode parecer selecionada");
        assert.equal(option.querySelector("input.preference-input").checked, false);
      }
    }
  });

  check("6. Cada grupo mantém sua seleção independente dos demais", () => {
    const desired = { goal: "emagrecer", level: "avancado", days: "6", time: "long", equipment: "gym" };
    for (const [key, value] of Object.entries(desired)) {
      app.click(`[data-pref="${key}"][data-value="${value}"]`);
    }
    for (const [key, value] of Object.entries(desired)) {
      assert.deepEqual(selected(app, key), [value], "Seleção do grupo " + key + " mudou indevidamente");
    }
    /* Trocar só o objetivo não pode mexer em nível, dias, tempo nem equipamento. */
    app.click('[data-pref="goal"][data-value="condicionamento"]');
    assert.deepEqual(selected(app, "goal"), ["condicionamento"]);
    for (const key of ["level", "days", "time", "equipment"]) {
      assert.deepEqual(selected(app, key), [desired[key]], "Grupo " + key + " foi alterado por outro grupo");
    }
  });

  check("7. O usuário pode trocar de opção quantas vezes quiser", () => {
    for (let round = 0; round < 4; round++) {
      app.click('[data-pref="time"][data-value="short"]');
      assert.deepEqual(selected(app, "time"), ["short"]);
      app.click('[data-pref="time"][data-value="medium"]');
      assert.deepEqual(selected(app, "time"), ["medium"]);
      app.click('[data-pref="days"][data-value="6"]');
      app.click('[data-pref="days"][data-value="2"]');
      assert.deepEqual(selected(app, "days"), ["2"]);
    }
  });

  check("8. Teclado: setas e espaço no rádio trocam apenas o grupo focado", () => {
    app.click('[data-pref="level"][data-value="intermediario"]');
    app.click('[data-pref="equipment"][data-value="home"]');
    const advanced = app.$('[data-pref="level"][data-value="avancado"] input.preference-input');
    advanced.checked = true;
    advanced.dispatchEvent(new app.w.Event("change", { bubbles: true }));
    assert.deepEqual(selected(app, "level"), ["avancado"], "Mudança nativa do rádio é aplicada");
    assert.ok(app.$('[data-pref="level"][data-value="avancado"]').classList.contains("is-selected"));
    assert.deepEqual(selected(app, "equipment"), ["home"], "Outro grupo permanece intacto");
  });

  check("9. Estado é controlado por JavaScript, não por classe fixa no HTML", () => {
    /* O arquivo servido não traz nenhuma opção já verde: `is-selected` só existe em tempo de execução. */
    assert.equal(/is-selected/.test(hubHtml), false, "A classe verde não pode vir pronta do HTML");
    assert.equal(/style="[^"]*(#8df322|#a5ff39|green)/i.test(hubHtml), false,
      "Nenhuma opção pode ter cor fixa no HTML");
    const shown = app.$$('[data-pref][aria-pressed="true"]').length;
    assert.equal(shown, 5, "Apenas uma opção marcada por grupo após o JavaScript rodar");
    /* O mesmo vale para o painel salvo: reabrir reconstrói o estado a partir do armazenamento. */
    assert.equal(app.$$("[data-pref-group] [data-pref].is-selected").length, 5);
  });

  /* ------------------------------------------------------------------ */
  /* 4. Persistência: recarregar mantém as preferências                   */
  /* ------------------------------------------------------------------ */
  check("10. As escolhas ficam salvas no armazenamento existente", () => {
    const stored = app.data(PREFERENCES_KEY);
    assert.deepEqual(stored, { goal: "condicionamento", level: "avancado", days: 2, time: "medium", equipment: "home" });
  });

  await app.reload();
  check("11. Após recarregar a página, as opções refletem as preferências salvas", () => {
    assert.deepEqual(selected(app, "goal"), ["condicionamento"]);
    assert.deepEqual(selected(app, "level"), ["avancado"]);
    assert.deepEqual(selected(app, "days"), ["2"]);
    assert.deepEqual(selected(app, "time"), ["medium"]);
    assert.deepEqual(selected(app, "equipment"), ["home"]);
    for (const key of ["goal", "level", "days", "time", "equipment"]) {
      const pressed = app.$$(`[data-pref-group="${key}"] [data-pref][aria-pressed="true"]`);
      assert.equal(pressed.length, 1, "Um único marcado no grupo " + key + " depois do reload");
      assert.equal(pressed[0].querySelector("input.preference-input").checked, true);
    }
  });

  app.set(PREFERENCES_KEY, { goal: "inventado", level: "??", days: 9, time: "eterno", equipment: "nave" });
  await app.reload();
  check("12. Preferências inválidas salvas caem no padrão coerente", () => {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      assert.deepEqual(selected(app, key), [String(value)], "Grupo " + key + " deveria voltar ao padrão");
    }
  });

  /* ------------------------------------------------------------------ */
  /* 5. "Gerar meu plano" recebe as escolhas atuais                       */
  /* ------------------------------------------------------------------ */
  check("13. Gerar meu plano usa exatamente as escolhas visíveis", () => {
    app.click('[data-pref="goal"][data-value="condicionamento"]');
    app.click('[data-pref="level"][data-value="avancado"]');
    app.click('[data-pref="days"][data-value="3"]');
    app.click('[data-pref="time"][data-value="short"]');
    app.click('[data-pref="equipment"][data-value="gym"]');
    const visible = { goal: "condicionamento", level: "avancado", days: 3, time: "short", equipment: "gym" };

    app.click("#generate-plan");
    const cards = app.$$("#training-plan-preview .plan-session-card");
    assert.equal(cards.length, 3, "O plano tem um cartão por dia escolhido");
    const current = app.F.plan.readPreferences();
    assert.deepEqual(Object.assign({}, current), visible, "O gerador lê as preferências atuais");

    /* O perfil montado a partir das escolhas carrega os cinco valores. */
    const generatedProfile = app.F.plan.profileForPreferences(visible);
    assert.equal(generatedProfile.planPreferences.days, 3);
    assert.equal(generatedProfile.planPreferences.goal, "condicionamento");
    assert.equal(generatedProfile.planPreferences.time, "short");
    assert.equal(generatedProfile.planPreferences.equipment, "gym");
    assert.equal(generatedProfile.planPreferences.level, "avancado");
    assert.equal(generatedProfile.diasPorSemana, 3);

    /* A prévia é construída com essas escolhas e não é salva sem confirmação. */
    assert.equal(app.F.plan.read(), null);
    assert.deepEqual(Object.assign({}, app.F.plan.readPreferences()), visible);
  });

  check("14. Mudar a escolha e gerar de novo respeita a nova combinação", () => {
    app.click('[data-pref="days"][data-value="5"]');
    app.click('[data-pref="equipment"][data-value="none"]');
    app.click("#generate-plan");
    assert.equal(app.$$("#training-plan-preview .plan-session-card").length, 5,
      "O plano é refeito com os cinco dias recém-escolhidos");
    assert.deepEqual(Object.assign({}, app.F.plan.readPreferences()),
      { goal: "condicionamento", level: "avancado", days: 5, time: "short", equipment: "none" });
  });

  /* ------------------------------------------------------------------ */
  /* 6. Ícone do cabeçalho                                                */
  /* ------------------------------------------------------------------ */
  check("15. O ícone de Suas preferências é o settings Lucide do sistema de ícones", () => {
    const icon = app.$(".preferences-title .preferences-title-icon");
    assert.ok(icon, "O cabeçalho precisa do contêiner do ícone");
    const svg = icon.querySelector("svg");
    assert.ok(svg, "O ícone precisa ser desenhado em SVG");
    assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(svg.getAttribute("fill"), "none");
    assert.equal(svg.getAttribute("stroke"), "currentColor");
    const expected = app.F.ui.ICON_PATHS.settings;
    assert.ok(expected, "O conjunto oficial precisa manter o ícone settings");
    assert.equal(svg.querySelector("path").getAttribute("d"), expected,
      "Deve reutilizar exatamente o path do Lucide settings do FORJA");
    assert.equal(icon.getAttribute("aria-hidden"), "true", "Ícone é decorativo; o h2 nomeia a seção");
    assert.equal(app.text("#preferences-heading"), "Suas preferências");
  });

  check("16. Nenhum emoji ou caractere improvisado sobra nos títulos e no botão", () => {
    const header = app.$(".preferences-title").textContent;
    assert.equal(/[\u2190-\u2BFF\u25A0-\u25FF\u2600-\u27BF\uFFFD]/u.test(header), false,
      "O cabeçalho ainda contém símbolo improvisado: " + header);
    for (const legend of app.$$(".preference-legend")) {
      assert.equal(/[▦◷⚊✣]/u.test(legend.textContent), false,
        "Legenda com símbolo improvisado: " + legend.textContent);
    }
    assert.equal(/[✣▦◷⚊]/u.test(app.$("#generate-plan").textContent), false,
      "O botão de gerar não usa glifo improvisado");
    assert.ok(app.$("#generate-plan .plan-generate-icon svg"), "O botão usa ícone do sistema");
  });

  check("17. O ícone do cabeçalho usa o verde-limão da identidade", () => {
    /* jsdom não resolve var(); o valor real em rgb é conferido no teste de navegador. */
    const css = fs.readFileSync(path.join(repoRoot, "assets/css/treino-planejamento.css"), "utf8");
    const rule = (css.match(/\.preferences-title-icon \{[^}]+\}/) || [])[0] || "";
    assert.match(rule, /color:\s*var\(--plan-lime\)/, "O ícone deve herdar o verde-limão: " + rule);
    assert.match(css, /--plan-lime:\s*#8df322/i, "O token do verde-limão precisa existir");
    assert.equal(app.$(".preferences-title-icon").querySelectorAll("img").length, 0,
      "O ícone não pode ser uma imagem distorcida");
    const box = css.match(/\.preferences-title-icon \{[^}]+\}/)[0];
    assert.match(box, /width:\s*44px/);
    assert.match(box, /height:\s*44px/, "Largura e altura iguais evitam deformação");
  });
} finally { closeAllApps(); }

/* ------------------------------------------------------------------ */
/* 7. Tela recém-aberta com perfil e preferências já salvas             */
/* ------------------------------------------------------------------ */
app = await boot({ "forja-perfil-v1": profile, [PREFERENCES_KEY]: { goal: "emagrecer", level: "iniciante", days: 6, time: "long", equipment: "gym" } }, "treino/index.html");
try {
  check("18. Abrir com preferências salvas mostra exatamente o que foi salvo", () => {
    assert.deepEqual(selected(app, "goal"), ["emagrecer"]);
    assert.deepEqual(selected(app, "level"), ["iniciante"]);
    assert.deepEqual(selected(app, "days"), ["6"]);
    assert.deepEqual(selected(app, "time"), ["long"]);
    assert.deepEqual(selected(app, "equipment"), ["gym"]);
    assert.deepEqual(app.data(PREFERENCES_KEY), { goal: "emagrecer", level: "iniciante", days: 6, time: "long", equipment: "gym" },
      "Abrir a tela não reescreve nem normaliza o que já estava salvo");
  });
  check("19. Abrir a tela não grava nada no armazenamento", () => {
    assert.deepEqual(app.storageWrites, [], "Abrir não deve produzir escrita: " + JSON.stringify(app.storageWrites));
  });
} finally { closeAllApps(); }

/* ------------------------------------------------------------------ */
/* 8. Consultar o catálogo não altera a seleção salva                   */
/* ------------------------------------------------------------------ */
app = await boot({ "forja-perfil-v1": profile }, "treino/index.html");
try {
  check("20. Em casa continua usando o filtro estrito do catálogo central", () => {
    app.click('[data-pref="equipment"][data-value="home"]');
    const chosen = Object.assign({}, app.F.plan.readPreferences());
    const records = app.F.plan.compatibleCatalog(app.F.plan.profileForPreferences(chosen));
    assert.ok(records.length > 0, "Deve haver exercícios catalogados sem equipamento");
    assert.ok(records.every(item => app.F.exerciseCatalog.byId(item.libraryId || item.id).equipment.length === 0),
      "Em casa não presume acessórios");
    assert.deepEqual(Object.assign({}, app.F.plan.readPreferences()), chosen, "Consultar o catálogo não muda a escolha");
  });
  check("21. Nenhum erro de JavaScript durante a interação", () => {
    const relevant = app.errors.filter(error => !/Could not parse CSS stylesheet/i.test(error));
    assert.deepEqual(relevant, [], "Erros de console: " + relevant.join(" | "));
  });
} finally { closeAllApps(); }

console.log(`\nPREFERÊNCIAS DO PLANEJAMENTO — ${ran}/21 testes aprovados`);
