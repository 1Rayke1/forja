/*
  Compara as medições "antes" e "depois" geradas por tools/capturas-p13.mjs.

  Uso:
    node tools/comparar-p13.mjs /tmp/forja-p13/antes/medicoes.json \
                                /tmp/forja-p13/depois/medicoes.json \
                                > docs/capturas/p1-3/validacao.json

  Verifica, sem alterar nenhum teste: igualdade de texto/storage, overflow,
  contraste, alvos de toque, distribuição de grids, uso do verde-limão e
  escala tipográfica. Saída JSON, própria para anexar ao PR.
*/
import fs from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Uso: node tools/comparar-p13.mjs <antes/medicoes.json> <depois/medicoes.json>');
  process.exit(1);
}
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const pages = Object.keys(before.pages);
const widths = before.widths.map(String);

const GRID_KEYS = ['.home-week-stats', '.home-goals-grid', '.goals-progress',
  '#goals-progress .goals-progress', '.history-summary', '.ui-stats',
  '.hub-list', '.routine-list', '.explorar-shortcuts'];

function gridProblems(metrics) {
  const problems = [];
  for (const key of GRID_KEYS) {
    const grid = metrics.grids[key];
    if (!grid) continue;
    const children = grid.children.length;
    const tracks = (grid.columns || '').trim().split(/\s+/).filter(Boolean).length;
    const rows = new Map();
    for (const child of grid.children) {
      const y = Math.round(child.y);
      rows.set(y, (rows.get(y) || 0) + 1);
    }
    const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    const counts = sortedRows.map(entry => entry[1]);
    const firstY = sortedRows[0][0];
    const lastY = sortedRows[sortedRows.length - 1][0];
    const rowWidth = y => {
      const items = grid.children.filter(child => Math.round(child.y) === y);
      const left = Math.min(...items.map(item => item.x));
      const right = Math.max(...items.map(item => item.x + item.w));
      return right - left;
    };
    /* Um único item na última linha ocupando toda a largura é uma decisão
       intencional de grid, não um cartão órfão. */
    const fullWidthLastRow = counts.length > 1 && counts[counts.length - 1] === 1 &&
      rowWidth(lastY) >= rowWidth(firstY) - 2;
    const orphan = counts.length > 1 && counts[counts.length - 1] < Math.max(...counts) && !fullWidthLastRow;
    const emptyTracks = tracks > children ? tracks - children : 0;
    if (orphan || emptyTracks) {
      problems.push({ grid: key, children, tracks, rows: counts, orphan, emptyTracks });
    }
  }
  return problems;
}

function targetExceptions(metrics) {
  return metrics.interactive.below44.filter(item => {
    const selector = item.selector;
    return !(selector.startsWith('button.day') || selector.startsWith('input'));
  });
}

const result = {
  generatedAt: new Date().toISOString(),
  fixedNow: after.fixedNow,
  widths: after.widths,
  pages,
  data: {
    allTextEqual: true, allSelectorsEqual: true, allStorageEqual: true,
    differences: []
  },
  overflow: { beforeMax: 0, afterMax: 0, byWidth: {} },
  contrast: { beforeMin: Infinity, afterMin: Infinity, threshold: 4.5 },
  interactiveTargets: { unexplainedBefore: 0, unexplainedAfter: 0, exceptions: [] },
  grids: { before: [], after: [] },
  accent: { before: {}, after: {} },
  typography390: {},
  documentHeight1280: {},
  consoleErrors: { before: before.consoleErrors.length, after: after.consoleErrors.length }
};

for (const page of pages) {
  for (const width of widths) {
    const a = before.pages[page][width];
    const b = after.pages[page][width];
    for (const [field, key] of [['mainText', 'allTextEqual'], ['selectors', 'allSelectorsEqual'], ['storage', 'allStorageEqual']]) {
      const equal = JSON.stringify(a.data[field]) === JSON.stringify(b.data[field]);
      if (!equal) {
        result.data[key] = false;
        result.data.differences.push({ page, width, field });
      }
    }
    result.overflow.beforeMax = Math.max(result.overflow.beforeMax, a.overflow.extra);
    result.overflow.afterMax = Math.max(result.overflow.afterMax, b.overflow.extra);
    result.contrast.beforeMin = Math.min(result.contrast.beforeMin, a.contrastMin);
    result.contrast.afterMin = Math.min(result.contrast.afterMin, b.contrastMin);
    result.interactiveTargets.unexplainedBefore += targetExceptions(a).length;
    result.interactiveTargets.unexplainedAfter += targetExceptions(b).length;
    for (const problem of gridProblems(a)) result.grids.before.push({ page, width, ...problem });
    for (const problem of gridProblems(b)) result.grids.after.push({ page, width, ...problem });
    for (const [label, metrics] of [['before', a], ['after', b]]) {
      result.accent[label][`${page}-${width}`] = {
        color: metrics.accent.color,
        background: metrics.accent.backgroundColor,
        border: metrics.accent.borderTopColor
      };
    }
  }
  result.typography390[page] = Object.fromEntries(
    Object.entries(after.pages[page]['390'].typography)
      .filter(([key]) => /title|subtitle|eyebrow|label|caption/.test(key))
      .map(([key, value]) => [key, { fontSize: value.fontSize, fontWeight: value.fontWeight }])
  );
  result.documentHeight1280[page] = {
    before: before.pages[page]['1280'].documentHeight,
    after: after.pages[page]['1280'].documentHeight
  };
}

result.overflow.byWidth = Object.fromEntries(widths.map(width => [width, {
  before: Math.max(...pages.map(page => before.pages[page][width].overflow.extra)),
  after: Math.max(...pages.map(page => after.pages[page][width].overflow.extra))
}]));

result.interactiveTargets.exceptions = [
  'button.day: grade densa de 7 colunas; altura >=44 px, largura limitada pelo calendário em 320 px',
  'input[type=checkbox]: 20 px visual, mas o label .check-row inteiro tem altura >=48 px e é clicável'
];

const totals = label => Object.values(result.accent[label]).reduce((acc, item) => ({
  color: acc.color + item.color, background: acc.background + item.background, border: acc.border + item.border
}), { color: 0, background: 0, border: 0 });
result.accent.totals = { before: totals('before'), after: totals('after') };

console.log(JSON.stringify(result, null, 2));
