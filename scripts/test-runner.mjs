import { readFileSync,existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join,resolve,sep } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { DockerCLI,SANDBOX_LABEL,SANDBOX_OWNER,reapExpiredSandboxes } from '../executor/docker.mjs';
import { createIsolatedLabRunner } from '../executor/runner.mjs';
import { consumeOne } from '../executor/supervisor.mjs';
import { database } from '../tests/helpers.js';
import { createJob,getJob,claim,finish,jobMessage,stmt } from '../src/store.js';
import { CHECKS,VERSIONS,canonical } from '../src/contracts.js';
const candidate=JSON.parse(readFileSync('executor/upstream.research.json','utf8'));
const engineImage=candidate.image+'@'+candidate.amd64_digest;
const versions={...VERSIONS,engine:candidate.research_revision,digest:candidate.amd64_digest};
const docker=new DockerCLI(); const suffix=crypto.randomUUID().slice(0,8); const network='security-check-runner-'+suffix;
const owned=[]; const root=resolve('.wrangler/runner-lab'); mkdirSync(root,{recursive:true}); const temporary=mkdtempSync(join(root,'run-'));
const limits={wallMs:20000,checkMs:1000,memoryMiB:256,cpus:1,pids:64,ingressBytes:1048576,egressBytes:1048576,maxPacketBytes:4096,maxDnsRequests:64,maxOutputBytes:32768,callbackMarginMs:1500,
  maxRedirects:2,maxResponseBytes:65536,maxTotalBodyBytes:131072,maxHttpRequests:8};
let databaseSession;
async function absent(name) {
  const {stdout}=await docker.run(['ps','-aq','--filter','name=^/'+name+'$']); assert.equal(stdout,'');
}
function attempt(extra={}) {
  const now=Date.now(); return {job_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),target:'https://example.com/',allowed_checks:CHECKS,
    deadline_at:new Date(now+60000).toISOString(),lease_until:now+30000,versions,...extra};
}
try {
  console.log('Building and inspecting candidate runner artifacts.');
  await docker.run(['build','-f','executor/guardian/Dockerfile','-t','security-check-guardian:lab','.'],{timeoutMs:300000,maxBytes:1048576});
  const guardImage=await docker.inspect('image','security-check-guardian:lab');
  const {stdout:networkId}=await docker.run(['network','create','--internal','--subnet','192.0.2.0/24','--label','luminiware.security-check.lab=true',network]);
  const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  await new Promise((resolveTls,reject)=>{
    const child=spawn(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com',
      '-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem')],{stdio:'ignore',windowsHide:true});
    child.on('error',reject); child.on('close',code=>code===0?resolveTls():reject(new Error('TLS_FIXTURE_FAILED')));
  });
  const fixture='security-check-runner-fixture-'+suffix; owned.push(fixture);
  await docker.run(['run','-d','--name',fixture,'--network',networkId,'--read-only','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--memory','128m','--pids-limit','32','--env','TLS_FIXTURE=true','--mount',`type=bind,source=${temporary},target=/tls,readonly`,
    '--entrypoint','node',engineImage,'--input-type=module','-e',readFileSync('tests/docker/egress-fixture.mjs','utf8')]);
  const fixtureState=await docker.inspect('container',fixture); const fixtureAddress=Object.values(fixtureState.NetworkSettings.Networks)[0].IPAddress;
  const config={engineImage,guardianImage:guardImage.Id,networkId,limits,docker,
    resolveTarget:async()=>({hostname:'example.com',addresses:[fixtureAddress],expires_at:Date.now()+60000})};
  const runner=createIsolatedLabRunner(config); assert.equal(await runner.health(),true);
  console.log('Testing durable D1 claim → guarded upstream → normalized callback → ack.');
  databaseSession=await database(); const env=databaseSession.env;
  const {job}=await createJob(env,'synthetic-runner-session',crypto.randomUUID(),'synthetic-request','https://example.com/',null,Date.now());
  await stmt(env,'UPDATE jobs SET versions_json=? WHERE id=?',canonical(versions),job.id).run();
  let acks=0;
  const message={body:Buffer.from(JSON.stringify(jobMessage(await getJob(env,job.id)))).toString('base64'),lease_id:'synthetic-lease',metadata:{'CF-Content-Type':'json'}};
  await consumeOne({message,runner,control:{claim:id=>claim(env,id,'synthetic-runner'),result:(id,body,lease)=>finish(env,id,'synthetic-runner',lease,body)},
    queue:{ack:async()=>{assert.equal((await getJob(env,job.id)).state,'concluído');acks++;}}});
  assert.equal(acks,1); const completed=await getJob(env,job.id); const report=JSON.parse(completed.result_json);
  assert.equal(report.score,null); assert.equal(report.coverage,.60); assert.equal(report.checks.find(c=>c.id==='ssl').evidence.identity_valid,false);
  assert.equal(report.checks.find(c=>c.id==='http-security').evidence.http_reaches_https,false);
  assert.equal(report.versions.engine,candidate.research_revision);assert.equal(report.versions.digest,candidate.amd64_digest);assert.equal(report.versions.result,VERSIONS.result);
  assert.equal(report.checks.find(c=>c.id==='dns').collection,'ok'); assert.notEqual(report.checks.find(c=>c.id==='headers').collection,'ok');
  const cases=['d1-claim-upstream-callback-ack','pinned-real-engine-revision','insufficient-provenance-suppresses-score','invalid-tls-kept-as-evidence','workload-no-control-secrets'];
  console.log('Testing hard deadline against a busy process and descendant.');
  let engineStarted; const startedSignal=new Promise(resolveStarted=>{engineStarted=resolveStarted;});
  const observingDocker={inspect:(...args)=>docker.inspect(...args),run:(args,options)=>{
    if(args[0]==='start'&&args.includes('--attach')) engineStarted(args.at(-1)); return docker.run(args,options);
  }};
  const stuck=createIsolatedLabRunner({...config,docker:observingDocker,limits:{...limits,wallMs:7000}},{fault:'unresponsive'});
  const start=Date.now(); const outcome=stuck(attempt()).then(()=>({ok:true}),error=>({error}));
  const engineName=await startedSignal;
  for(let i=0;i<15;i++) {
    try {
      const marker=await docker.run(['exec',engineName,'cat','/tmp/workload-started'],{timeoutMs:1000});
      assert.ok(Number.isInteger(JSON.parse(marker.stdout).child_pid));
      const processes=await docker.run(['top',engineName,'-eo','pid,ppid,comm']);
      assert.ok(processes.stdout.split('\n').filter(line=>/\bnode\s*$/u.test(line)).length>=2); break;
    }
    catch { if(i===14) throw new Error('FAULT_WORKLOAD_DID_NOT_START'); await delay(75); }
  }
  const stopped=await outcome; assert.ok(['SANDBOX_ABORTED','DOCKER_TIMEOUT','RUNNER_DEADLINE_EXPIRED'].includes(stopped.error?.message),JSON.stringify({code:stopped.error?.message,cleanup_codes:stopped.error?.cleanup_codes}));
  assert.ok(Date.now()-start>=6500 && Date.now()-start<16000); await absent(engineName); await absent(engineName.replace(/-engine$/u,'-guard'));
  cases.push('hard-deadline-kills-busy-process-and-child','namespace-cleaned-after-timeout');
  console.log('Testing bounded output and explicit cancellation.');
  const noisy=createIsolatedLabRunner(config,{fault:'output'});
  await assert.rejects(noisy(attempt()),/DOCKER_OUTPUT_LIMIT/u); cases.push('workload-output-limit-cleans-resources');
  console.log('Testing cgroup memory exhaustion and cleanup.');
  let oomObserved=false,oomEngine;
  const memoryDocker={run:(...args)=>docker.run(...args),inspect:async(kind,id,options)=>{
    const state=await docker.inspect(kind,id,options);
    if(kind==='container'&&state.State?.OOMKilled) {
      assert.equal(state.HostConfig.Memory,64*1024*1024);assert.equal(state.HostConfig.MemorySwap,64*1024*1024);
      oomObserved=true;oomEngine=id;
    }
    return state;
  }};
  const hungry=createIsolatedLabRunner({...config,docker:memoryDocker,limits:{...limits,memoryMiB:64}},{fault:'memory'});
  await assert.rejects(hungry(attempt()),/WORKLOAD_OOM/u);assert.equal(oomObserved,true);
  await absent(oomEngine);await absent(oomEngine.replace(/-engine$/u,'-guard'));
  assert.equal(await hungry.health(),true);cases.push('cgroup-oom-observed-and-classified','namespace-cleaned-after-oom');
  const controller=new AbortController(); controller.abort(); await assert.rejects(runner(attempt(),controller.signal)); cases.push('pre-cancelled-job-creates-no-sandbox');
  console.log('Testing independent cleanup after the supervisor process is killed.');
  const crashProcess=spawn(process.execPath,['tests/docker/crash-runner.mjs'],{stdio:['pipe','pipe','ignore'],windowsHide:true});
  const crashStarted=new Promise((resolveStarted,reject)=>{
    let buffer='';crashProcess.stdout.on('data',data=>{
      buffer+=data;const line=buffer.split('\n').find(value=>value.includes('ENGINE_STARTING'));
      if(line){try {resolveStarted(JSON.parse(line).name);}catch{reject(new Error('CRASH_FIXTURE_INVALID'));}}
    });crashProcess.on('error',reject);crashProcess.on('exit',()=>reject(new Error('CRASH_FIXTURE_STOPPED_EARLY')));
  });
  const crashExit=new Promise(resolveExit=>crashProcess.on('exit',resolveExit));
  crashProcess.stdin.end(JSON.stringify({config:{engineImage,guardianImage:guardImage.Id,networkId,limits:{...limits,wallMs:7000}},address:fixtureAddress,attempt:attempt()}));
  const crashEngine=await crashStarted;
  for(let i=0;i<15;i++) {
    try {await docker.run(['exec',crashEngine,'cat','/tmp/workload-started'],{timeoutMs:1000});break;}
    catch{if(i===14)throw new Error('CRASH_WORKLOAD_DID_NOT_START');await delay(75);}
  }
  const crashGuard=await docker.inspect('container',crashEngine.replace(/-engine$/u,'-guard'));
  const crashPolicy=crashGuard.Mounts.find(mount=>mount.Destination==='/policy')?.Source;
  // Docker Desktop rewrites a Windows bind source inside its Linux VM. Use the
  // UUID owner file to locate the matching host directory, without deleting it.
  const { POLICY_ROOT }=await import('../executor/policy-files.mjs');
  const { readdir,readFile }=await import('node:fs/promises');
  const crashRunId=crashEngine.slice('sc-sandbox-'.length,-'-engine'.length);
  let hostPolicy;
  for(const entry of await readdir(POLICY_ROOT,{withFileTypes:true})) {
    if(!entry.isDirectory()||!/^sandbox-[a-zA-Z0-9]{6}$/u.test(entry.name))continue;
    const directory=join(POLICY_ROOT,entry.name);
    try {if(JSON.parse(await readFile(join(directory,'owner.json'),'utf8')).run_id===crashRunId)hostPolicy=directory;}catch{}
  }
  assert.ok(crashPolicy&&hostPolicy,'CRASH_POLICY_NOT_FOUND');await access(hostPolicy);
  crashProcess.kill('SIGKILL');await crashExit;
  const cleanupDeadline=Date.now()+12000;
  for(;;) {
    const state=await docker.run(['ps','-aq','--filter','name=^/'+crashEngine.replace(/-engine$/u,'')+'-']);
    const policyPresent=await access(hostPolicy).then(()=>true,()=>false);
    if(!state.stdout&&!policyPresent)break;if(Date.now()>cleanupDeadline)throw new Error('WATCHDOG_DID_NOT_CLEAN_UP');await delay(250);
  }
  await absent(crashEngine.replace(/-engine$/u,'-guard'));
  cases.push('detached-watchdog-survives-supervisor-crash','policy-files-cleaned-after-supervisor-crash');
  console.log('Testing stale-sandbox recovery without touching unrelated resources.');
  const staleId=crypto.randomUUID(),stale='sc-sandbox-'+staleId+'-engine'; owned.push(stale);
  await docker.run(['create','--name',stale,'--network','none','--label',`${SANDBOX_LABEL}=${SANDBOX_OWNER}`,'--label',`luminiware.security-check.run_id=${staleId}`,
    '--label','luminiware.security-check.kind=engine','--label',`luminiware.security-check.expires_at=${Date.now()-1000}`,
    '--read-only','--user','65532:65532','--cap-drop','ALL','--memory','64m','--cpus','0.1','--pids-limit','16','--entrypoint','node',engineImage,'-e','setInterval(()=>{},1000)']);
  await docker.run(['start',stale]); assert.equal(await reapExpiredSandboxes(docker),1); await absent(stale);
  assert.equal((await docker.inspect('container',fixture)).State.Running,true); cases.push('expired-owned-sandbox-reaped','unrelated-fixture-preserved');
  const remaining=await docker.run(['ps','-aq','--filter',`label=${SANDBOX_LABEL}=${SANDBOX_OWNER}`]); assert.equal(remaining.stdout,'');
  const evidence={schema:'isolated-runner-lab-v1',synthetic:true,network_internal:true,production_approved:false,engineImage,guardianImage:guardImage.Id,cases,
    durable_state:completed.state,score:report.score,coverage:report.coverage,observed_at:new Date().toISOString()};
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/runner-lab.json',JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence,null,2));
} finally {
  for(const name of owned.reverse()) {try {await docker.run(['rm','--force',name]);}catch{}}
  try {await docker.run(['network','rm',network]);}catch{}
  await databaseSession?.dispose();
  if(resolve(temporary).startsWith(root+sep)) rmSync(temporary,{recursive:true,force:true});
}
