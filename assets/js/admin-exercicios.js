(function () {
  "use strict";
  const catalog = window.Forja.exerciseCatalog;
  const API_URL = /(^|\.)netlify\.app$/.test(location.hostname)
    ? "/.netlify/functions/youtube-videos"
    : "https://prismatic-parfait-be3644.netlify.app/.netlify/functions/youtube-videos";
  const $ = selector => document.querySelector(selector);
  const labels = { pending: "Pendente", review: "Em análise", validated: "Aprovado", rejected: "Rejeitado", unavailable: "Indisponível" };
  let credential = null;
  let current = null;
  let selected = null;
  let associations = new Map();

  function text(tag, value, className) {
    const node = document.createElement(tag); if (className) node.className = className;
    node.textContent = value == null ? "" : String(value); return node;
  }
  function clear(selector) { $(selector).replaceChildren(); }
  function status(message, isError) { const node = $("#operation-status"); node.textContent = message; node.style.color = isError ? "var(--danger)" : "var(--lime)"; }

  async function request(action, body = {}) {
    if (!credential) throw new Error("Inicie uma sessão administrativa.");
    const response = await fetch(API_URL, {
      method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json", authorization: "Bearer " + credential, accept: "application/json" },
      body: JSON.stringify({ action, ...body })
    });
    let payload;
    try { payload = await response.json(); } catch (_) { payload = { error: "Resposta inválida do backend." }; }
    if (!response.ok) {
      if (response.status === 401) { credential = null; setAuthenticated(false); }
      throw new Error(payload.error || "Operação administrativa não concluída.");
    }
    return payload;
  }

  function setAuthenticated(value) {
    $("#refresh-dashboard").disabled = !value;
    $("#video-search-form button").disabled = !value;
    $("#session-status").textContent = value
      ? "Sessão ativa somente nesta aba. A credencial não foi armazenada."
      : "Sessão não iniciada ou encerrada após credencial inválida.";
    renderAssociation();
  }

  function statusFor(id) { return associations.get(id)?.status || "pending"; }

  function renderExercises() {
    const query = $("#exercise-search").value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const muscle = $("#muscle-filter").value, modality = $("#modality-filter").value, state = $("#status-filter").value;
    const list = catalog.exercises.filter(record => {
      const searchable = [record.id, record.name, ...record.aliases].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return (!query || searchable.includes(query)) && (!muscle || record.primaryMuscle === muscle) &&
        (!modality || record.modality === modality) && (!state || statusFor(record.id) === state);
    });
    clear("#admin-exercise-items");
    $("#exercise-count").textContent = list.length + " de " + catalog.exercises.length + " exercícios";
    list.forEach(record => {
      const button = text("button", "", "exercise-item"); button.type = "button";
      button.setAttribute("aria-pressed", String(current?.id === record.id));
      const content = document.createElement("span"); content.append(text("strong", record.name), document.createElement("br"), text("small", record.id));
      button.append(content, text("span", labels[statusFor(record.id)], "status status-" + statusFor(record.id)));
      button.addEventListener("click", () => selectExercise(record));
      $("#admin-exercise-items").appendChild(button);
    });
  }

  function row(dl, name, value) { dl.append(text("dt", name), text("dd", Array.isArray(value) ? value.join("; ") : value || "—")); }
  function selectExercise(record) {
    current = record; selected = null;
    clear("#video-results"); clear("#preview"); $("#review-form").hidden = true;
    const dl = document.createElement("dl");
    row(dl, "ID", record.id); row(dl, "Nome", record.name); row(dl, "Aliases", record.aliases);
    row(dl, "Descrição", record.description); row(dl, "Músculo principal", record.primaryMuscle);
    row(dl, "Secundários", record.secondaryMuscles); row(dl, "Estabilizadores", record.stabilizers);
    row(dl, "Modalidade", record.modality); row(dl, "Equipamentos", record.equipment.length ? record.equipment : "Nenhum");
    row(dl, "Dificuldade", record.difficulty); row(dl, "Tipo", record.exerciseType); row(dl, "Padrão", record.movementPattern);
    row(dl, "Instruções", record.instructions); row(dl, "Técnica", record.technique); row(dl, "Segurança", record.cautions);
    row(dl, "Ranking editorial", record.ranking.position + " · critérios v" + record.ranking.criteriaVersion);
    clear("#exercise-detail"); $("#exercise-detail").appendChild(dl);
    $("#video-query").value = record.name + (record.aliases[0] ? " " + record.aliases[0] : "") + " demonstração";
    renderAssociation(); renderExercises(); status("");
  }

  function renderAssociation() {
    clear("#current-association"); if (!current) return;
    const association = associations.get(current.id);
    if (!association) { $("#current-association").append(text("p", "Estado: Pendente. Nenhuma associação persistida.")); return; }
    const box = document.createElement("div"); box.className = "current-video";
    box.append(text("h3", labels[association.status] + " · " + association.title), text("p", association.channelTitle + " · " + association.durationSeconds + " s · " + association.videoId));
    const link = text("a", "Abrir vídeo"); link.href = association.youtubeUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; box.appendChild(link);
    const actions = document.createElement("div"); actions.className = "current-actions";
    const preview = text("button", "Reproduzir prévia", "secondary"); preview.type = "button"; preview.disabled = !credential;
    preview.addEventListener("click", () => showPreview(association)); actions.appendChild(preview);
    const refresh = text("button", "Verificar disponibilidade", "secondary"); refresh.type = "button"; refresh.disabled = !credential;
    refresh.addEventListener("click", async () => { try { await request("refresh", { exerciseId: current.id }); await dashboard(); status("Disponibilidade verificada no YouTube."); } catch (error) { status(error.message, true); } }); actions.appendChild(refresh);
    const remove = text("button", "Remover associação", "danger"); remove.type = "button"; remove.disabled = !credential;
    remove.addEventListener("click", async () => {
      if (!confirm("Remover a associação deste exercício? O estado voltará para Pendente.")) return;
      try { await request("remove", { exerciseId: current.id }); await dashboard(); status("Associação removida. O exercício está pendente."); } catch (error) { status(error.message, true); }
    }); actions.appendChild(remove); box.appendChild(actions); $("#current-association").appendChild(box);
  }

  function showPreview(video) {
    clear("#preview"); const frame = document.createElement("div"); frame.className = "preview-frame";
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + video.videoId + "?autoplay=1&mute=1&controls=1&playsinline=1&rel=0";
    iframe.title = "Prévia administrativa: " + video.title; iframe.allow = "autoplay; encrypted-media; picture-in-picture"; iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin"; frame.appendChild(iframe); $("#preview").appendChild(frame);
  }

  function selectVideo(video) {
    selected = video; $("#review-form").hidden = false;
    $("#review-form").querySelectorAll("input[type=checkbox]").forEach(input => { input.checked = false; });
    $("#selected-video").textContent = video.title + " · " + video.channelTitle + " · " + video.durationSeconds + " s";
    $("#save-review").disabled = !video.eligible || !credential;
    $("#approve-video").disabled = !video.eligible || !credential;
    $("#reject-video").disabled = !credential;
    document.querySelectorAll(".video-card").forEach(card => card.setAttribute("aria-selected", String(card.dataset.videoId === video.videoId)));
  }

  function renderResults(items) {
    clear("#video-results");
    if (!items.length) { $("#video-results").append(text("p", "Nenhum resultado válido retornado pelo YouTube.")); return; }
    items.forEach(video => {
      const card = document.createElement("article"); card.className = "video-card"; card.dataset.videoId = video.videoId;
      const image = document.createElement("img"); image.src = video.thumbnailUrl; image.alt = "Miniatura de " + video.title; image.loading = "lazy"; card.appendChild(image);
      const body = document.createElement("div"); body.className = "video-card-content";
      body.append(text("h3", video.title), text("p", video.channelTitle + " · " + video.durationSeconds + " s · " + video.visibility));
      if (!video.eligible) body.append(text("p", video.rejectionReasons.join(" "), "reasons"));
      const actions = document.createElement("div"); actions.className = "video-card-actions";
      const preview = text("button", "Prévia", "secondary"); preview.type = "button"; preview.addEventListener("click", () => showPreview(video)); actions.appendChild(preview);
      const select = text("button", "Revisar", "primary"); select.type = "button"; select.addEventListener("click", () => selectVideo(video)); actions.appendChild(select);
      body.appendChild(actions); card.appendChild(body); $("#video-results").appendChild(card);
    });
  }

  function reviewData() {
    const data = {}; new FormData($("#review-form")).forEach((value, key) => { data[key] = value === "on"; }); return data;
  }
  async function save(statusValue) {
    if (!current || !selected) return;
    try {
      status("Validando dados no YouTube e persistindo…");
      await request("save", { exerciseId: current.id, videoId: selected.videoId, status: statusValue, review: reviewData() });
      await dashboard(); status(statusValue === "validated" ? "Associação aprovada e persistida." : statusValue === "review" ? "Vídeo salvo em análise." : "Vídeo rejeitado e persistido.");
    } catch (error) { status(error.message, true); }
  }

  async function dashboard() {
    const payload = await request("dashboard"); associations = new Map(payload.associations.map(item => [item.exerciseId, item]));
    renderReport(payload.report); renderExercises(); renderAssociation();
  }
  function renderReport(report) {
    clear("#report");
    const metrics = [["Total", report.total], ["Aprovados", report.approved], ["Pendentes", report.pending], ["Em análise", report.review], ["Rejeitados", report.rejected], ["Indisponíveis", report.unavailable], ["Cobertura", report.coveragePercent + "%"], ["Inconsistências", report.inconsistencies.length]];
    metrics.forEach(([name, value]) => { const box = document.createElement("div"); box.className = "metric"; box.append(text("strong", value), text("span", name)); $("#report").appendChild(box); });
    clear("#missing-list"); report.withoutVideo.forEach(id => $("#missing-list").append(text("code", id)));
  }

  $("#auth-form").addEventListener("submit", async event => {
    event.preventDefault(); credential = $("#admin-credential").value; $("#admin-credential").value = "";
    try { await dashboard(); setAuthenticated(true); } catch (error) { credential = null; setAuthenticated(false); $("#session-status").textContent = error.message; }
  });
  $("#refresh-dashboard").addEventListener("click", () => dashboard().catch(error => status(error.message, true)));
  ["#exercise-search", "#muscle-filter", "#modality-filter", "#status-filter"].forEach(selector => $(selector).addEventListener("input", renderExercises));
  $("#video-search-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!current) { status("Selecione um exercício primeiro.", true); return; }
    try { status("Pesquisando no YouTube…"); const result = await request("search", { exerciseId: current.id, query: $("#video-query").value }); renderResults(result.items); status(result.cached ? "Resultados recuperados do cache de 12 horas." : "Pesquisa concluída. Revise cada vídeo manualmente."); }
    catch (error) { status(error.message, true); }
  });
  $("#save-review").addEventListener("click", () => save("review"));
  $("#reject-video").addEventListener("click", () => save("rejected"));
  $("#review-form").addEventListener("submit", event => { event.preventDefault(); save("validated"); });
  addEventListener("pagehide", () => { credential = null; });
  addEventListener("pageshow", event => { if (event.persisted) { credential = null; setAuthenticated(false); } });

  catalog.muscleGroups.forEach(group => $("#muscle-filter").append(new Option(group.name, group.id)));
  catalog.modalities.forEach(mode => $("#modality-filter").append(new Option(mode.name, mode.id)));
  renderExercises(); setAuthenticated(false);
})();
