import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.FORJA_ROOT || scriptRoot);
const output = path.resolve(process.argv[2] || path.join(root, 'artifacts/forja-redesign/before'));
const widths = [320, 360, 390, 430, 768, 1280];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
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
const now = new Date(process.env.FORJA_CAPTURE_NOW || Date.now());
const report = { generatedAt: new Date().toISOString(), fixture:'redesign-visual-sample-v1', fixtureTime:now.toISOString(), viewportHeight:900, screenshotMode:'viewport', widths, pages: {}, overflow: [] };
const iso = (daysAgo=0) => new Date(now.getTime() - daysAgo*86400000).toISOString();
const date = (daysAgo=0) => {
  const d = new Date(now.getTime() - daysAgo*86400000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const routine = {
  id:'redesign-forca-a', name:'Força A — peito e ombro', modality:'weights', createdAt:iso(30), updatedAt:iso(1),
  sections:{warmup:[], main:[
    {id:'supino-reto', name:'Supino reto', section:'main', sets:3, reps:'8–10', rest:90, type:'reps', measure:'reps', load:'60 kg', notes:''},
    {id:'desenvolvimento', name:'Desenvolvimento', section:'main', sets:3, reps:'10', rest:90, type:'reps', measure:'reps', load:'20 kg', notes:''}
  ],abs:[],finisher:[]}
};
const routineB = {...routine,id:'redesign-forca-b',name:'Força B — costas e bíceps',updatedAt:iso(2),sections:{warmup:[],main:[
  {id:'remada-curvada',name:'Remada curvada',section:'main',sets:4,reps:'8–10',rest:90,type:'reps',measure:'reps',load:'45 kg',notes:''},
  {id:'rosca-direta',name:'Rosca direta',section:'main',sets:3,reps:'10–12',rest:60,type:'reps',measure:'reps',load:'15 kg',notes:''}
],abs:[],finisher:[]}};
const routineC = {...routine,id:'redesign-forca-c',name:'Força C — pernas e core',updatedAt:iso(3),sections:{warmup:[],main:[
  {id:'agachamento-livre',name:'Agachamento livre',section:'main',sets:4,reps:'8',rest:120,type:'reps',measure:'reps',load:'70 kg',notes:''}
],abs:[{id:'prancha',name:'Prancha',section:'abs',sets:3,reps:'30 s',rest:45,type:'duration',measure:'time',duration:30,notes:''}],finisher:[]}};
const exerciseRecord = (name, id, loads) => ({
  id, name, section:'main', plannedSets:loads.length, completedSets:loads.length, reps:'8', duration:45,
  type:'reps', measure:'reps', rest:90, load:'', notes:'', distance:null, distanceUnit:'m',
  logs:loads.map((load,index)=>({set:index+1,reps:'8',load:String(load),seconds:0,distance:null,rpe:null,editedAt:null})),
  timedSeconds:0
});
const history = [21,14,7,0].map((ago, i) => {
  const load = 50 + i*2.5;
  const exercises = [exerciseRecord('Supino reto','supino-reto',[load,load,load]), exerciseRecord('Desenvolvimento','desenvolvimento',[17.5+i*2.5,17.5+i*2.5,17.5+i*2.5])];
  return {
    id:'redesign-h'+i, date:date(ago), finishedAt:iso(ago), modality:'weights', routineName:'Força A — peito e ombro',
    durationMs:38*60000, completedSets:6, totalPlannedSets:6, status:'completed', exercises,
    totals:{volumeKg:exercises.flatMap(x=>x.logs).reduce((sum,x)=>sum+Number(x.reps)*Number(x.load),0),reps:48,seconds:0,distanceMeters:0,setsLogged:6,setsWithoutVolume:0},
    feedback:{rpe:null,note:''}
  };
});
const goals = {version:1, updatedAt:iso(), modality:'weights', weeklySessions:3, weeklySets:12, weeklyMinutes:120};
const profile = {version:2,objetivo:'forca',nivel:'intermediario',equipamento:'academia',sexo:'',modalidadePreferida:'weights',diasPorSemana:3,duracaoMinutos:45};
const seed = {
  'forja-treino-rotinas-v1':{calisthenics:[],weights:[routine,routineB,routineC]},
  'forja-treino-historico-v1':history,
  'forja-treino-metas-v1':goals,
  'forja-perfil-v1':profile,
  'forja-preferencias-v1':{soundOnRest:false,vibrateOnRest:false}
};
try {
 for (const [pageName, pathName] of pages) {
  report.pages[pageName] = {};
  for (const width of widths) {
   const page = await browser.newPage();
   await page.setViewport({width,height:900,deviceScaleFactor:1});
   const errors=[];
   page.on('pageerror', e=>errors.push('pageerror: '+e.message));
   page.on('console', message=>{if(message.type()==='error') errors.push('console: '+message.text());});
   page.on('requestfailed', request=>errors.push('requestfailed: '+request.url()+' ('+request.failure()?.errorText+')'));
   await page.goto(base+pathName,{waitUntil:'networkidle0'});
   await page.evaluate(data=>{for(let i=localStorage.length-1;i>=0;i--)localStorage.removeItem(localStorage.key(i));Object.entries(data).forEach(([key,value])=>localStorage.setItem(key,JSON.stringify(value)));},seed);
   await page.reload({waitUntil:'networkidle0'});
   await page.evaluate(()=>document.fonts.ready);
   await pause(120);
   const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
   if(dimensions.scrollWidth>dimensions.width) report.overflow.push({page:pageName,width,extra:dimensions.scrollWidth-dimensions.width});
   const name=`${pageName}-${width}.png`;
   await page.screenshot({path:path.join(output,name),fullPage:false});
   report.pages[pageName][width]={file:name,...dimensions,errors};
   await page.close();
  }
 }
 fs.writeFileSync(path.join(output,'capture-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({output,overflow:report.overflow,errors:Object.values(report.pages).flatMap(p=>Object.values(p)).filter(x=>x.errors.length)},null,2));
} finally { await browser.close(); server.close(); }
