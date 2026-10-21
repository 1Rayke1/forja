/*
  FORJA — gráficos leves, feitos para tela pequena e leitor de tela.

  Deliberadamente sem biblioteca externa e sem <canvas>: o app é estático,
  roda em GitHub Pages e precisa continuar legível em 320 px. Cada gráfico:

  - recebe apenas números já calculados (nada aqui estima ou interpola);
  - tem um resumo textual em `aria-label` e uma tabela escondida visualmente,
    que é a leitura alternativa para quem não vê o desenho;
  - usa HTML/CSS para barras e heatmap (redimensionam sozinhos) e SVG só onde
    a linha não existe sem isso.

  Se não houver dados suficientes, quem chama deve mostrar um estado vazio
  explicando o critério — os builders abaixo devolvem `null` nesse caso, para
  que a página decida o que fazer.
*/
(function (global) {
  "use strict";

  const F = global.Forja;
  const doc = global.document;

  const el = F.ui.el;

  function formatValue(value, format) {
    if (typeof format === "function") return format(value);
    if (value === null || value === undefined) return "—";
    return F.formatNumber(value);
  }

  function accessibleSummary(lines) {
    const node = el("div", "ui-visually-hidden");
    node.textContent = lines.filter(Boolean).join(". ");
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* Barras horizontais (frequência, volume por semana, séries por dia)  */
  /* ------------------------------------------------------------------ */

  function bars(options) {
    const items = (options.items || []).filter(item => item && Number.isFinite(Number(item.value)));

    if (items.length === 0) return null;

    const max = items.reduce((current, item) => Math.max(current, Number(item.value)), 0) || 1;
    const wrap = el("div", "ui-bars");
    if (options.id) wrap.id = options.id;
    wrap.setAttribute("role", "img");

    const summary = items.map(item => item.label + ": " + formatValue(item.value, options.format)).join(", ");
    wrap.setAttribute("aria-label", (options.ariaLabel || "Gráfico de barras") + ". " + summary + ".");

    items.forEach(item => {
      const row = el("div", "ui-bar-row");
      const label = el("span", "ui-bar-label", item.label);
      const track = el("div", "ui-bar-track");
      const fill = el("div", "ui-bar-fill");
      const width = Math.max(Number(item.value) > 0 ? 4 : 0, Math.round((Number(item.value) / max) * 100));
      fill.style.width = width + "%";

      if (item.tone) fill.classList.add("is-" + item.tone);
      if (item.hint) fill.title = item.hint;

      track.appendChild(fill);

      const value = el("span", "ui-bar-value", formatValue(item.value, options.format));

      row.append(label, track, value);
      if (item.note) row.appendChild(el("span", "ui-bar-note", item.note));
      wrap.appendChild(row);
    });

    const figure = el("figure", "ui-chart");
    figure.appendChild(wrap);
    if (options.caption) figure.appendChild(el("figcaption", "ui-chart-caption", options.caption));

    if (options.tableRows) {
      figure.appendChild(F.ui.table({
        caption: options.tableCaption || "Valores do gráfico de barras",
        columns: options.tableColumns || ["Período", "Valor"],
        rows: options.tableRows
      }));
    }

    return figure;
  }

  /* ------------------------------------------------------------------ */
  /* Barras verticais semanais (usado no calendário de frequência)        */
  /* ------------------------------------------------------------------ */

  function columns(options) {
    const items = (options.items || []).filter(Boolean);
    if (items.length === 0) return null;

    const max = items.reduce((current, item) => Math.max(current, Number(item.value) || 0), 0) || 1;
    const wrap = el("div", "ui-columns");
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", (options.ariaLabel || "Gráfico de colunas") + ". " +
      items.map(item => item.label + ": " + formatValue(item.value, options.format)).join(", ") + ".");

    items.forEach(item => {
      const column = el("div", "ui-column");
      const bar = el("div", "ui-column-bar");
      const value = Math.max(0, Number(item.value) || 0);
      const height = value > 0 ? Math.max(8, Math.round((value / max) * 100)) : 2;

      bar.style.height = height + "%";
      if (item.tone) bar.classList.add("is-" + item.tone);
      bar.title = item.label + " · " + formatValue(value, options.format);

      column.appendChild(bar);
      column.appendChild(el("span", "ui-column-value", formatValue(value, options.format)));
      column.appendChild(el("span", "ui-column-label", item.label));
      wrap.appendChild(column);
    });

    const figure = el("figure", "ui-chart ui-chart-columns");
    figure.appendChild(wrap);
    if (options.caption) figure.appendChild(el("figcaption", "ui-chart-caption", options.caption));
    return figure;
  }

  /* ------------------------------------------------------------------ */
  /* Linha de evolução (carga máxima, repetições ao longo do tempo)       */
  /* ------------------------------------------------------------------ */

  const SVG_NS = "http://www.w3.org/2000/svg";

  function line(options) {
    const points = (options.points || []).filter(point => point && Number.isFinite(Number(point.y)));
    if (points.length < 2) return null;

    const width = 320;
    const height = 120;
    const padding = { top: 12, right: 10, bottom: 20, left: 10 };

    const xs = points.map((point, index) => (points.length === 1
      ? width / 2
      : padding.left + (index * (width - padding.left - padding.right)) / (points.length - 1)));
    const ys = points.map(point => Number(point.y));
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY || 1;

    const scaleY = value => padding.top +
      (1 - (value - minY) / span) * (height - padding.top - padding.bottom);

    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "ui-line-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", (options.ariaLabel || "Gráfico de linha") + ". " +
      points.map((point, index) => point.label + ": " + formatValue(point.y, options.format)).join(", ") + ".");

    const title = doc.createElementNS(SVG_NS, "title");
    title.textContent = options.ariaLabel || "Evolução";
    svg.appendChild(title);

    /* Linha de base do eixo X, discreta. */
    const axis = doc.createElementNS(SVG_NS, "line");
    axis.setAttribute("x1", padding.left);
    axis.setAttribute("x2", width - padding.right);
    axis.setAttribute("y1", height - padding.bottom);
    axis.setAttribute("y2", height - padding.bottom);
    axis.setAttribute("class", "ui-line-axis");
    svg.appendChild(axis);

    const path = points.map((point, index) =>
      (index === 0 ? "M" : "L") + xs[index].toFixed(1) + " " + scaleY(point.y).toFixed(1)
    ).join(" ");

    const area = doc.createElementNS(SVG_NS, "path");
    area.setAttribute("d", path + " L" + xs[xs.length - 1].toFixed(1) + " " + (height - padding.bottom) +
      " L" + xs[0].toFixed(1) + " " + (height - padding.bottom) + " Z");
    area.setAttribute("class", "ui-line-area");
    svg.appendChild(area);

    const lineNode = doc.createElementNS(SVG_NS, "path");
    lineNode.setAttribute("d", path);
    lineNode.setAttribute("class", "ui-line-path");
    svg.appendChild(lineNode);

    points.forEach((point, index) => {
      const dot = doc.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", xs[index].toFixed(1));
      dot.setAttribute("cy", scaleY(point.y).toFixed(1));
      dot.setAttribute("r", "3.4");
      dot.setAttribute("class", "ui-line-dot");

      const dotTitle = doc.createElementNS(SVG_NS, "title");
      dotTitle.textContent = point.label + " · " + formatValue(point.y, options.format) +
        (point.note ? " · " + point.note : "");
      dot.appendChild(dotTitle);
      svg.appendChild(dot);
    });

    const wrap = el("div", "ui-line");
    wrap.appendChild(svg);

    const edges = el("div", "ui-line-edge");
    edges.append(el("span", null, points[0].label), el("span", null, points[points.length - 1].label));
    wrap.appendChild(edges);

    const figure = el("figure", "ui-chart");
    figure.appendChild(wrap);

    if (options.caption) figure.appendChild(el("figcaption", "ui-chart-caption", options.caption));

    if (options.showTable !== false) {
      figure.appendChild(F.ui.table({
        caption: options.tableCaption || "Valores do gráfico de linha",
        columns: options.tableColumns || ["Data", "Valor"],
        rows: points.map(point => [point.label, formatValue(point.y, options.format) + (point.note ? " · " + point.note : "")])
      }));
    }

    return figure;
  }

  /* ------------------------------------------------------------------ */
  /* Heatmap de frequência (dias treinados por semana)                    */
  /* ------------------------------------------------------------------ */

  function heatmap(options) {
    const days = options.days || [];
    if (days.length === 0) return null;

    const grid = el("div", "ui-heatmap");
    grid.setAttribute("role", "img");

    const trained = days.filter(day => Number(day.count) > 0).length;
    const maxCount = days.reduce((current, day) => Math.max(current, Number(day.count) || 0), 0);

    grid.setAttribute("aria-label",
      (options.ariaLabel || "Calendário de treinos") + ". " +
      days.length + " dias, " + trained + " com treino registrado, até " +
      maxCount + " série(s) no dia mais forte.");

    const body = el("div", "ui-heatmap-body");

    /* Uma linha por dia da semana, uma coluna por semana (segunda a domingo). */
    const dayLabels = options.dayLabels || ["S", "T", "Q", "Q", "S", "S", "D"];

    dayLabels.forEach((label, index) => {
      const rowLabel = el("span", "ui-heatmap-row-label", label);
      rowLabel.setAttribute("aria-hidden", "true");
      rowLabel.title = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
        "Quinta-feira", "Sexta-feira", "Sábado"][index];
      body.appendChild(rowLabel);
    });

    days.forEach(day => {
      const cell = el("span", "ui-heatmap-cell");
      const count = Number(day.count) || 0;
      const level = count === 0 ? 0 : count >= 12 ? 4 : count >= 8 ? 3 : count >= 4 ? 2 : 1;

      cell.classList.add("level-" + level);
      cell.setAttribute("data-date", day.date);
      cell.setAttribute("title", day.label + (count > 0 ? " · " + (count === 1 ? "1 série" : count + " séries") : " · sem treino"));
      cell.setAttribute("aria-label", day.label + ": " + (count > 0 ? count + " série(s)" : "sem treino"));
      body.appendChild(cell);
    });

    /*
      Layout em CSS: sete linhas (dias da semana) preenchidas de cima para
      baixo, uma coluna por semana. `days` vem por semana, começando na
      segunda-feira — quem monta os dados garante as sete entradas.
    */

    const figure = el("figure", "ui-chart ui-chart-heatmap");
    figure.appendChild(grid);
    grid.appendChild(body);

    const legend = el("div", "ui-heatmap-legend");
    legend.appendChild(el("span", null, options.legendStart || "menos"));
    [0, 1, 2, 3, 4].forEach(level => {
      const swatch = el("span", "ui-heatmap-swatch level-" + level);
      swatch.setAttribute("aria-hidden", "true");
      legend.appendChild(swatch);
    });
    legend.appendChild(el("span", null, options.legendEnd || "mais"));
    grid.appendChild(legend);

    if (options.caption) figure.appendChild(el("figcaption", "ui-chart-caption", options.caption));
    figure.appendChild(accessibleSummary([
      "Dias com treino: " + days.filter(day => Number(day.count) > 0)
        .map(day => day.label)
        .slice(-8)
        .join(", ")
    ]));

    return figure;
  }

  /* ------------------------------------------------------------------ */
  /* Anel de progresso (metas)                                            */
  /* ------------------------------------------------------------------ */

  function ring(options) {
    const percent = Math.max(0, Math.min(100, Math.round(Number(options.percent) || 0)));
    const size = 88;
    const radius = 38;
    const circumference = 2 * Math.PI * radius;

    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("class", "ui-ring-svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", (options.label || "Progresso") + ": " + percent + "%" +
      (options.valueText ? " (" + options.valueText + ")" : ""));

    const track = doc.createElementNS(SVG_NS, "circle");
    track.setAttribute("cx", size / 2);
    track.setAttribute("cy", size / 2);
    track.setAttribute("r", radius);
    track.setAttribute("class", "ui-ring-track");
    track.setAttribute("fill", "none");
    track.setAttribute("stroke-width", "9");

    const value = doc.createElementNS(SVG_NS, "circle");
    value.setAttribute("cx", size / 2);
    value.setAttribute("cy", size / 2);
    value.setAttribute("r", radius);
    value.setAttribute("class", "ui-ring-value");
    value.setAttribute("fill", "none");
    value.setAttribute("stroke-width", "9");
    value.setAttribute("stroke-linecap", "round");
    value.setAttribute("stroke-dasharray", (circumference * percent / 100).toFixed(2) + " " + circumference.toFixed(2));
    value.setAttribute("transform", "rotate(-90 " + size / 2 + " " + size / 2 + ")");

    svg.append(track, value);

    const wrap = el("div", "ui-ring");
    wrap.appendChild(svg);

    const center = el("div", "ui-ring-center");
    center.appendChild(el("strong", "ui-ring-percent", percent + "%"));
    if (options.valueText) center.appendChild(el("span", "ui-ring-value-text", options.valueText));
    wrap.appendChild(center);

    if (options.label) wrap.appendChild(el("p", "ui-ring-label", options.label));
    if (options.note) wrap.appendChild(el("p", "ui-ring-note", options.note));

    return wrap;
  }

  F.charts = {
    bars,
    columns,
    line,
    heatmap,
    ring
  };
})(window);
