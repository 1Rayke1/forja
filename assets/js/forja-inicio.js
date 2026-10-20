/*
  FORJA — página inicial (index.html): inicializa o calendário e as missões.
  O código do calendário e das missões fica em forja-calendario.js, sem
  alterações; aqui apenas se chama o que aquele arquivo define.
*/
(function (global) {
  "use strict";

  const F = global.Forja;

  function renderHome() {
    if (typeof global.renderCalendar === "function") global.renderCalendar();
    if (typeof global.renderMissions === "function") global.renderMissions();
  }

  F.pages.inicio = function initInicio() {
    if (typeof global.updateTodayLabel === "function") global.updateTodayLabel();
    renderHome();
  };

  F.onDataChanged(renderHome);
})(window);
