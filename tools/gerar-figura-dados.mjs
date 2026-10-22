/*
  Gera assets/js/forja-figura-dados.js a partir de assets/anatomia/male-muscle-map.svg
  (Open Muscle Map, MIT — ver assets/anatomia/NOTICE.md).

  Extrai só o que o runtime precisa: silhuetas (anterior/posterior) e painéis
  musculares com id, músculo, lado, vista, tipo e caminhos. Os caminhos não são
  redesenhados.

  Uso:  node tools/gerar-figura-dados.mjs
  Requer jsdom (devDependency).
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const src = path.join(repo, "assets", "anatomia", "male-muscle-map.svg");
const out = path.join(repo, "assets", "js", "forja-figura-dados.js");

const dom = new JSDOM(fs.readFileSync(src, "utf8"), { contentType: "image/svg+xml" });
const doc = dom.window.document;

const silhouettes = [];
const panels = [];

doc.querySelectorAll("g[id]").forEach(group => {
  const id = group.getAttribute("id");
  const transform = group.getAttribute("transform") || "";
  /* Cada <path> pode ter transform próprio (translate). A posição final é o
     transform do grupo aplicado ao do caminho: group ∘ path. */
  const paths = Array.from(group.querySelectorAll(":scope > path")).map(p => ({
    d: p.getAttribute("d"),
    t: [transform, p.getAttribute("transform") || ""].filter(Boolean).join(" ")
  })).filter(item => item.d);
  if (!paths.length) return;

  if (/silhouette/.test(id)) {
    silhouettes.push({ id, view: id.includes("-back-") || id.includes("-rear-") ? "back" : "front", paths });
    return;
  }

  if (group.hasAttribute("data-region-id")) {
    const view = group.getAttribute("data-view") === "rear" ? "back" : group.getAttribute("data-view");
    panels.push({
      id: group.getAttribute("data-region-id"),
      muscle: group.getAttribute("data-muscle-id"),
      name: group.getAttribute("data-muscle-name"),
      group: group.getAttribute("data-muscle-group"),
      side: group.getAttribute("data-side"),
      view,
      kind: group.getAttribute("data-kind"),
      selectable: group.getAttribute("data-selectable") === "true",
      paths
    });
  }
});

if (silhouettes.length !== 2) throw new Error("Esperava 2 silhuetas, achei " + silhouettes.length);

/*
  Limites de cada vista: união das caixas de todas as coordenadas dos caminhos,
  já com a transformação do grupo. Os pontos de controle das Béziers ficam dentro
  do envoltório convexo, então a caixa é conservadora (nunca corta o desenho).
*/
/* Aplica uma cadeia de transform SVG (translate/scale) a um ponto; a última op é aplicada primeiro. */
function applyChain(chain, x, y) {
  const ops = [];
  const re = /(translate|scale)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(chain || ""))) {
    const v = m[2].split(/[ ,]+/).filter(Boolean).map(Number);
    ops.push({ name: m[1], v });
  }
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (op.name === "translate") { x += op.v[0]; y += op.v[1] || 0; }
    else { const k = op.v[0]; const k2 = op.v.length > 1 ? op.v[1] : k; x *= k; y *= k2; }
  }
  return [x, y];
}

function boundsOf(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  items.forEach(item => {
    item.paths.forEach(({ d, t }) => {
      /* Só pontos finais: M e o último par de cada C (os de controle podem sair do desenho). */
      const tokens = d.match(/[MCZ]|-?\d*\.?\d+/g) || [];
      let cmd = null, nums = [];
      const flush = () => {
        if (cmd === "M" && nums.length >= 2) add(...applyChain(t, nums[0], nums[1]));
        if (cmd === "C") for (let i = 0; i + 5 < nums.length; i += 6) add(...applyChain(t, nums[i + 4], nums[i + 5]));
        nums = [];
      };
      tokens.forEach(tok => {
        if (/^[MCZ]$/.test(tok)) { flush(); cmd = tok; }
        else nums.push(parseFloat(tok));
      });
      flush();
    });
  });
  return { minX, minY, maxX, maxY };
}
const VIEW_BOXES_SRC = { front: "0 0 627 1254", back: "627 0 627 1254" };
const bounds = {};
["front", "back"].forEach(view => {
  const items = silhouettes.filter(item => item.view === view).concat(panels.filter(p => p.view === view));
  bounds[view] = boundsOf(items);
});

const payload = { source: "Open Muscle Map (MIT) — male-muscle-map.svg", viewBoxes: VIEW_BOXES_SRC, bounds, silhouettes, panels };
const js = "/* Gerado por tools/gerar-figura-dados.mjs. Não editar à mão. */\n" +
  "(function (global) {\n  \"use strict\";\n  const F = global.Forja = global.Forja || {};\n  F.figuraDados = " +
  JSON.stringify(payload) + ";\n})(window);\n";

fs.writeFileSync(out, js);
console.log("limites:", JSON.stringify(bounds));
console.log("silhuetas:", silhouettes.length, "painéis:", panels.length, "tamanho:", js.length, "bytes");
const byView = panels.reduce((acc, p) => ((acc[p.view] = (acc[p.view] || 0) + 1), acc), {});
console.log("painéis por vista:", byView);
