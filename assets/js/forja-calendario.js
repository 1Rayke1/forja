"use strict";

/* CALENDÁRIO E MISSÕES */

const monthNames = [
  "Janeiro", "Fevereiro", "Março", "Abril",
  "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro"
];

const weekdays = ["D", "S", "T", "Q", "Q", "S", "S"];

const today = new Date();
today.setHours(0, 0, 0, 0);

let selectedDate = new Date(today);
let displayedYear = today.getFullYear();
let displayedMonth = today.getMonth();

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readTasks(date) {
  const key = "forja-missoes-" + dateKey(date);

  try {
    const saved = localStorage.getItem(key);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((task, index) => {
      if (typeof task === "string") {
        return {
          id: "old-" + index,
          text: task,
          done: false
        };
      }

      return {
        id: task.id || "task-" + index,
        text: String(task.text || task.title || ""),
        done: Boolean(task.done || task.completed)
      };
    }).filter(task => task.text.trim());
  } catch (error) {
    return [];
  }
}

function saveTasks(date, tasks) {
  try {
    localStorage.setItem(
      "forja-missoes-" + dateKey(date),
      JSON.stringify(tasks)
    );
    return true;
  } catch (error) {
    alert("Não foi possível salvar. Verifique o espaço disponível no navegador.");
    return false;
  }
}

function formatDate(date, options = {}) {
  return date.toLocaleDateString("pt-BR", options);
}

function updateTodayLabel() {
  document.getElementById("today-label").textContent =
    formatDate(today, {
      weekday: "long",
      day: "numeric",
      month: "long"
    });
}

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  document.getElementById("month-title").textContent =
    `${monthNames[displayedMonth]} ${displayedYear}`;

  weekdays.forEach((weekday, index) => {
    const label = document.createElement("div");
    label.className = "weekday";
    label.textContent = weekday;
    label.setAttribute("aria-label", [
      "Domingo", "Segunda-feira", "Terça-feira",
      "Quarta-feira", "Quinta-feira", "Sexta-feira",
      "Sábado"
    ][index]);
    grid.appendChild(label);
  });

  const firstDay = new Date(displayedYear, displayedMonth, 1).getDay();
  const daysInMonth =
    new Date(displayedYear, displayedMonth + 1, 0).getDate();

  const selectedKey = dateKey(selectedDate);
  const todayKey = dateKey(today);

  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement("button");
    blank.className = "day";
    blank.disabled = true;
    blank.tabIndex = -1;
    blank.setAttribute("aria-hidden", "true");
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(displayedYear, displayedMonth, day);
    const key = dateKey(date);
    const button = document.createElement("button");

    button.type = "button";
    button.className = "day";
    button.textContent = day;
    button.setAttribute("aria-label", formatDate(date, {
      day: "numeric", month: "long", year: "numeric"
    }));

    if (key === todayKey) button.classList.add("today");
    if (key === selectedKey) {
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
    }
    if (readTasks(date).length > 0) {
      button.classList.add("has-tasks");
    }

    button.addEventListener("click", () => {
      selectedDate = new Date(date);
      renderCalendar();
      renderMissions();
    });

    grid.appendChild(button);
  }
}

function renderMissions() {
  const tasks = readTasks(selectedDate);
  const list = document.getElementById("task-list");
  const completed = tasks.filter(task => task.done).length;
  const percent = tasks.length
    ? Math.round(completed / tasks.length * 100)
    : 0;

  document.getElementById("selected-date").textContent =
    formatDate(selectedDate, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });

  document.getElementById("progress-label").textContent =
    `${completed} de ${tasks.length} · ${percent}%`;

  document.getElementById("progress-fill").style.width = percent + "%";
  list.innerHTML = "";

  if (tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = dateKey(selectedDate) === dateKey(today)
      ? "Seu dia começa com uma decisão. Adicione sua primeira missão."
      : "Nenhuma missão para este dia. Organize seus compromissos.";
    list.appendChild(empty);
    return;
  }

  tasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "task" + (task.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", "Concluir " + task.text);

    checkbox.addEventListener("change", () => {
      const current = readTasks(selectedDate);
      const item = current.find(entry => entry.id === task.id);
      if (!item) return;

      item.done = checkbox.checked;
      saveTasks(selectedDate, current);
      renderCalendar();
      renderMissions();
    });

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Excluir " + task.text);

    remove.addEventListener("click", () => {
      const current = readTasks(selectedDate)
        .filter(entry => entry.id !== task.id);

      if (saveTasks(selectedDate, current)) {
        renderCalendar();
        renderMissions();
      }
    });

    row.append(checkbox, text, remove);
    list.appendChild(row);
  });
}

/*
  Este arquivo é carregado em todas as páginas do app, mas os elementos do
  calendário só existem na página inicial. Anexar o ouvinte sem checar o
  elemento lançava exceção nas outras telas (inclusive na tela Explorar) e
  abortava o restante deste arquivo. O guarda mantém o comportamento igual na
  Home e não quebra as demais páginas.
*/
const taskForm = document.getElementById("task-form");

if (taskForm) taskForm.addEventListener("submit", event => {
  event.preventDefault();

  const input = document.getElementById("task-input");
  const text = input.value.trim();
  if (!text) return;

  const tasks = readTasks(selectedDate);
  tasks.push({
    id: Date.now().toString() + "-" +
      Math.random().toString(36).slice(2, 8),
    text,
    done: false
  });

  if (saveTasks(selectedDate, tasks)) {
    input.value = "";
    renderCalendar();
    renderMissions();
  }
});

function changeDisplayedMonth(offset) {
  const nextMonth = new Date(
    displayedYear,
    displayedMonth + offset,
    1
  );

  displayedYear = nextMonth.getFullYear();
  displayedMonth = nextMonth.getMonth();

  const lastDay = new Date(
    displayedYear,
    displayedMonth + 1,
    0
  ).getDate();

  const day = Math.min(selectedDate.getDate(), lastDay);

  selectedDate = new Date(
    displayedYear,
    displayedMonth,
    day
  );

  renderCalendar();
  renderMissions();
}

const botaoMesAnterior = document.getElementById("prev-month");
const botaoProximoMes = document.getElementById("next-month");

if (botaoMesAnterior) {
  botaoMesAnterior.addEventListener("click", () => {
    changeDisplayedMonth(-1);
  });
}

if (botaoProximoMes) {
  botaoProximoMes.addEventListener("click", () => {
    changeDisplayedMonth(1);
  });
}


