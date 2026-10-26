import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'artifacts/forja-redesign/before'));
const widths = [320, 360, 390, 430, 768, 1280];
const pages = [
  ['inicio', ''], ['treinos', 'treino/'], ['explorar', 'explorar/'],
  ['progresso', 'progresso/'], ['perfil', 'perfil/']
];
fs.mkdirSync(output, { recursive: true });
let puppeteer = (await import('puppeteer-core')).default;
const chromium = (await import('@sparticuz/chromium')).default;
const executablePath = await chromium.executablePath();
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.replace(/^\/forja\/?/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const ext = path.extname(file);
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.json':'application/json'})[ext] || 'application/octet-stream');
    res.end(data);
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/forja/`;
const browser = await puppeteer.launch({ executablePath, args: chromium.args, headless: true });
const report = { generatedAt: new Date().toISOString(), widths, pages: {}, overflow: [] };
const now = new Date();
const iso = (daysAgo=0) => new Date(now.getTime() - daysAgo*86400000).toISOString();
const date = (daysAgo=0) => iso(daysAgo).slice(0,10);
const routine = {
  id:'redesign-forca-a', name:'Força A — peito e ombro', modality:'weights', createdAt:iso(30), updatedAt:iso(1),
  sections:{warmup:[], main:[
    {id:'supino-reto', name:'Supino reto', section:'main', sets:3, reps:'8–10', rest:90, type:'reps', measure:'reps', load:'60 kg', notes:''},
    {id:'desenvolvimento', name:'Desenvolvimento', section:'main', sets:3, reps:'10', rest:90, type:'reps', measure:'reps', load:'20 kg', notes:''}
  ],abs:[],finisher:[]}
};
const history = [21,14,7,2].map((ago, i) => ({
  id:'redesign-h'+i, date:date(ago), finishedAt:iso(ago), modality:'weights', routineName:'Força A — peito e ombro',
  durationMs:38*60000, completedSets:6, totalPlannedSets:6, status:'completed',
  exercises:[{id:'supino-reto',name:'Supino reto',sets:[{reps:8,loadKg:50+i*2.5,completed:true},{reps:8,loadKg:50+i*2.5,completed:true},{reps:7,loadKg:50+i*2.5,completed:true}]}]
}));
const goals = {version:1, updatedAt:iso(), modality:'weights', weeklySessions:3, weeklySets:12, weeklyMinutes:120};
const profile = {objetivo:'forca',nivel:'intermediario',equipamento:'academia',sexo:'',modalidadePreferida:'weights',diasPorSemana:3,duracaoMinutos:45};
const seed = {
  'forja-treino-rotinas-v1':{calisthenics:[],weights:[routine]},
  'forja-treino-historico-v1':history,
  'forja-treino-metas-v1':goals,
  'forja-perfil-v1':profile,
  'forja-preferencias-v1':{sound:false,vibrate:false}
};
try {
 for (const [pageName, pathName] of pages) {
  report.pages[pageName] = {};
  for (const width of widths) {
   const page = await browser.newPage();
   await page.setViewport({width,height:900,deviceScaleFactor:1});
   const errors=[];
   page.on('pageerror', e=>errors.push(e.message));
   await page.goto(base+pathName,{waitUntil:'networkidle0'});
   await page.evaluate(data=>Object.entries(data).forEach(([key,value])=>localStorage.setItem(key,JSON.stringify(value))),seed);
   await page.reload({waitUntil:'networkidle0'});
   await page.evaluate(()=>document.fonts.ready);
   await page.waitForTimeout(120);
   const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
   if(dimensions.scrollWidth>dimensions.width) report.overflow.push({page:pageName,width,extra:dimensions.scrollWidth-dimensions.width});
   const name=`${pageName}-${width}.png`;
   await page.screenshot({path:path.join(output,name),fullPage:true});
   report.pages[pageName][width]={file:name,...dimensions,errors};
   await page.close();
  }
 }
 fs.writeFileSync(path.join(output,'capture-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({output,overflow:report.overflow,errors:Object.values(report.pages).flatMap(p=>Object.values(p)).filter(x=>x.errors.length)},null,2));
} finally { await browser.close(); server.close(); }
