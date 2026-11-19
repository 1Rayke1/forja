from pathlib import Path
import subprocess,sys,os,json,hashlib,time,signal,datetime,re
W=Path(__file__).resolve().parent.parent;source=Path('/home/user/forja');root=W/'.cache/checkout';base=json.loads((W/'evidence/baseline-files.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest();utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def fingerprint(values):return sha(json.dumps(values,sort_keys=True,separators=(',',':')).encode())
def hashes(at):return{p:sha((at/p).read_bytes())if(at/p).is_file()else None for p in base}
def environment(name,phase):
 env={'PATH':os.environ['PATH'],'HOME':str(W/'.cache/home'),'TMPDIR':str(W/'.cache/tmp'),'XDG_CACHE_HOME':str(W/'.cache/xdg'),'LANG':'C.UTF-8','TZ':'UTC','PYTHONDONTWRITEBYTECODE':'1','NODE_DISABLE_COMPILE_CACHE':'1','NODE_OPTIONS':'--require='+str(W/'instruments/policy.cjs'),'FORJA_VALIDATION_PHASE':phase,'FORJA_POLICY_LOG':str(W/'logs'/f'{name}.policy.jsonl'),'GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','npm_config_cache':str(W/'.cache/npm'),'npm_config_prefix':str(W/'.cache/prefix'),'npm_config_userconfig':str(W/'.cache/npm-user.rc'),'npm_config_globalconfig':str(W/'.cache/npm-global.rc'),'npm_config_registry':'https://registry.npmjs.org/','npm_config_update_notifier':'false','npm_config_audit':'false','npm_config_fund':'false','npm_config_ignore_scripts':'true','npm_config_offline':'false'if phase=='install'else'true'}
 browser=W/'evidence/browser-environment.json'
 if phase!='install'and browser.exists():
  values=json.loads(browser.read_text());env['PUPPETEER_EXECUTABLE_PATH']=values['wrapper'];env['LD_LIBRARY_PATH']=values['libraryPath']
  env['FORJA_BROWSER_OBSERVER']=str(W/'logs'/f'{name}.browser.jsonl');env['NODE_OPTIONS']+=' --import='+str(W/'instruments/browser-observer.mjs')
 return env
name,phase=sys.argv[1:3];command=sys.argv[3:];log=W/'logs'/f'{name}.log';metadata=W/'logs'/f'{name}.json';assert not log.exists()and not metadata.exists(),'Refusing overwrite';a=hashes(root);s0=hashes(source);assert a==base and s0==base,'Source drift before execution';env=environment(name,phase);started=utc();t=time.monotonic();limit=600 if phase=='install'else 1200;timedout=False
print(json.dumps({'event':'start','name':name,'atUtc':started,'command':command,'cwd':str(root),'phase':phase,'fingerprint':fingerprint(a)},ensure_ascii=False),flush=True)
with log.open('w')as stream:
 p=subprocess.Popen(command,cwd=root,env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
 try:rc=p.wait(timeout=limit)
 except subprocess.TimeoutExpired:
  timedout=True;os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  rc=124
 elapsed=round(time.monotonic()-t,6);ended=utc();stream.write(f'\nVALIDATION RUN exit={rc} seconds={elapsed} watchdog={timedout}\n')
b=hashes(root);s1=hashes(source);text=log.read_text(errors='replace');lines=text.splitlines()
policyPath=W/'logs'/f'{name}.policy.jsonl';policy=[json.loads(l)for l in policyPath.read_text().splitlines()]if policyPath.exists()else[]
browserPath=W/'logs'/f'{name}.browser.jsonl';browserEvents=[json.loads(l)for l in browserPath.read_text().splitlines()]if browserPath.exists()else[]
denied=[v for v in policy if any(k in v for k in ['deniedWrite','blockedNetwork','blockedCommand'])]
unsafeFlags=[v for v in policy+browserEvents if v.get('unsafe')]
changed=[p for p in base if a[p]!=b[p]];sourceChanged=[p for p in base if s0[p]!=s1[p]]
critical=[l for l in lines if any(s in l for s in ['ERR_MODULE_NOT_FOUND','Failed to launch the browser','error while loading shared libraries','Could not find Chrome','Browser was not found'])]
failures=[l for l in lines if l.startswith(('❌','✗','FAIL '))];summaries=[l for l in lines if re.search(r'(?:—|Resultado|APROVAD|aprovad|passed|tests)\s*[:—-]?\s*\d+\s*/\s*\d+',l)or re.search(r'\d+ testes aprovados',l)];passed=[l for l in lines if l.startswith(('✅','✓'))]
blocked=timedout or bool(denied or unsafeFlags or changed or sourceChanged or critical)or phase=='install'and rc!=0
r={'name':name,'newExecution':True,'historicalResultReused':False,'phase':phase,'command':command,'cwd':str(root),'startedAtUtc':started,'finishedAtUtc':ended,'elapsedSeconds':elapsed,'exitCode':rc,'processWatchdogSeconds':limit,'processWatchdogTriggered':timedout,'testTimeoutsChanged':False,'sourceFingerprintBefore':fingerprint(a),'sourceFingerprintAfter':fingerprint(b),'originalFingerprintBefore':fingerprint(s0),'originalFingerprintAfter':fingerprint(s1),'changedTestedSourceFiles':changed,'changedOriginalSourceFiles':sourceChanged,'fileHashesBefore':a,'fileHashesAfter':b,'environment':{'node':'v22.22.3','npm':'10.9.8','os':'Debian GNU/Linux 12','architecture':'x86_64','timezone':'UTC','environmentVariables':env},'testCounts':{'passedCaseMarkers':len(passed),'failedCaseMarkers':len(failures),'summaries':summaries,'note':'Printed case counts, not assertion counts; failures and exits are not suppressed.'},'failures':failures,'blockingErrors':critical,'policyDenials':denied,'chromiumLaunches':len([e for e in browserEvents if e.get('event')=='spawn']),'unsafeBrowserFlagsObserved':unsafeFlags,'status':'BLOCKED_STOP'if blocked else'PASSED'if rc==0 else'FAILED_COMPLETED','log':str(log.relative_to(W)),'logSha256':sha(log.read_bytes()),'policyLog':str(policyPath.relative_to(W))if policyPath.exists()else None,'policyLogSha256':sha(policyPath.read_bytes())if policyPath.exists()else None,'browserLog':str(browserPath.relative_to(W))if browserPath.exists()else None,'browserLogSha256':sha(browserPath.read_bytes())if browserPath.exists()else None}
metadata.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items()if k not in ['fileHashesBefore','fileHashesAfter','environment']},ensure_ascii=False),flush=True);print('\n'.join(l[:1500]for l in lines[-18:]),flush=True);sys.exit(99 if blocked else rc)
