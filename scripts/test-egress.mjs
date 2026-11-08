import { spawn } from 'node:child_process';
import { resolve,join,sep } from 'node:path';
import { readFileSync,mkdirSync,mkdtempSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const candidate=JSON.parse(readFileSync('executor/upstream.research.json','utf8'));
const engineImage=candidate.image+'@'+candidate.amd64_digest;
const base='node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d';
const guardianImage='security-check-guardian:lab';
const prefix='security-check-egress-'+crypto.randomUUID().slice(0,8); const containers=[]; const network=prefix+'-net';
const root=resolve('.wrangler/egress'); mkdirSync(root,{recursive:true}); const temporary=mkdtempSync(join(root,'run-'));
const fixtureDir=resolve('tests/docker'); const cases=[]; const counters=[];
async function command(args,{timeout=30000,show=false}={}) {
  return new Promise((resolveCommand,reject) => {
    const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']}); let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill(); reject(new Error('DOCKER_COMMAND_TIMEOUT'));},timeout);
    child.stdout.on('data',data=>{stdout+=data; if(show) process.stdout.write(data); if(stdout.length>2097152) child.kill();});
    child.stderr.on('data',data=>{stderr+=data; if(show) process.stderr.write(data); if(stderr.length>2097152) child.kill();});
    child.on('error',error=>{clearTimeout(timer);reject(error);}); child.on('close',code=>{clearTimeout(timer); code===0?resolveCommand((stdout+(args[0]==='logs'?stderr:'')).trim()):reject(new Error(stderr.slice(-4000)||'DOCKER_COMMAND_FAILED'));});
  });
}
async function waitReady(name,code) {
  for(let i=0;i<30;i++) {
    const logs=await command(['logs',name]); if(logs.includes(code)) return;
    const running=await command(['inspect','--format','{{.State.Running}}',name]); if(running!=='true') throw new Error('LAB_CONTAINER_SETUP_FAILED: '+await command(['logs',name]));
    await delay(100);
  }
  throw new Error('LAB_READINESS_TIMEOUT');
}
async function address(name) { return command(['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',name]); }
async function fixture(name,extra=[]) {
  containers.push(name); await command(['run','-d','--name',name,'--network',network,'--read-only','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--pids-limit','32','--memory','128m','--cpus','0.5','--mount',`type=bind,source=${fixtureDir},target=/tests,readonly`,...extra,'--entrypoint','node',engineImage,'/tests/egress-fixture.mjs']);
  await waitReady(name,'FIXTURE_READY'); return address(name);
}
async function probe(mode,allowed,blocked,{ingress=1048576,lifetime=60000}={}) {
  const name=prefix+'-'+mode; const policyDir=join(temporary,mode); mkdirSync(policyDir);
  const policy={hostname:'example.com',addresses:[allowed],expires_at:Date.now()+lifetime,maxDnsRequests:64,ingressBytes:ingress,egressBytes:1048576,maxPacketBytes:4096,shutdown_grace_ms:mode==='expired'?5000:0};
  writeFileSync(join(policyDir,'network.json'),JSON.stringify(policy)); containers.push(name);
  await command(['run','-d','--name',name,'--network',network,'--dns','127.0.0.1','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','NET_ADMIN',
    '--env','ISOLATED_TEST_FIXTURES=true','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m','--cpus','0.5','--mount',`type=bind,source=${policyDir},target=/policy,readonly`,guardianImage]);
  await waitReady(name,'GUARDIAN_READY');
  if(mode==='expired') await delay(Math.max(1,policy.expires_at-Date.now()+100));
  const engineName=name+'-engine'; containers.push(engineName);
  const output=await command(['run','--rm','--name',engineName,'--network','container:'+name,'--read-only','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--pids-limit','64','--memory','256m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',
    '--env','ALLOWED_FIXTURE='+allowed,'--env','BLOCKED_FIXTURE='+blocked,'--env','PROBE_MODE='+mode,
    '--mount',`type=bind,source=${fixtureDir},target=/tests,readonly`,'--entrypoint','node',engineImage,'/tests/egress-probe.mjs']);
  const result=JSON.parse(output.split('\n').at(-1)); cases.push(...result.cases);
  const rules=JSON.parse(await command(['exec',name,'nft','-j','list','table','inet','security_check']));
  const measured=rules.nftables.filter(r=>r.counter).map(r=>r.counter).map(({name,packets,bytes})=>({name,packets,bytes}));
  assert.ok(measured.find(c=>c.name==='in_accepted').bytes<=policy.ingressBytes);
  assert.ok(measured.find(c=>c.name==='out_accepted').bytes<=policy.egressBytes);
  if(mode==='ordinary'||mode==='expired') assert.ok(measured.find(c=>c.name==='out_blocked').packets>0);
  if(mode==='budget') assert.ok(measured.find(c=>c.name==='in_blocked').packets>0);
  counters.push({mode,counters:measured});
  await command(['rm','--force',name]);
}
try {
  console.log('Building candidate guardian image (local only).');
  await command(['build',...(process.argv.includes('--rebuild')?['--no-cache']:[]),'--build-arg','BASE_IMAGE='+base,'-f','executor/guardian/Dockerfile','-t',guardianImage,'.'],{timeout:300000,show:true});
  const publicRuleCheck="import {firewallRules} from './executor/guardian/firewall.mjs';import {spawnSync} from 'node:child_process';const rules=firewallRules({addresses:['8.8.8.8','2606:4700:4700::1111'],expires_at:Date.now()+30000,ingressBytes:65536,egressBytes:65536,maxPacketBytes:4096},Date.now(),{interface:'eth0',local_addresses:['2606:4700:4700::2'],on_link_peers:['2606:4700:4700::1111'],next_hop:null});const r=spawnSync('nft',['-f','-'],{input:rules,encoding:'utf8'});if(r.status!==0){console.error(r.stderr);process.exit(1)}console.log('PUBLIC_RULES_COMPILED_WITHOUT_NETWORK')";
  await command(['run','--rm','--network','none','--cap-drop','ALL','--cap-add','NET_ADMIN','--read-only','--security-opt','no-new-privileges','--entrypoint','node',guardianImage,'--input-type=module','-e',publicRuleCheck]);
  await command(['network','create','--internal','--subnet','192.0.2.0/24','--label','luminiware.security-check.lab=true',network]);
  assert.equal(await command(['network','inspect','--format','{{.Internal}}',network]),'true');
  const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  await new Promise((resolveTls,reject)=>{
    const child=spawn(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com','-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem')],{stdio:'ignore'});
    child.on('error',reject); child.on('close',code=>code===0?resolveTls():reject(new Error('TLS_FIXTURE_GENERATION_FAILED')));
  });
  const blockedName=prefix+'-blocked'; const blocked=await fixture(blockedName);
  const allowedName=prefix+'-allowed'; const allowed=await fixture(allowedName,['--env','BLOCKED_FIXTURE='+blocked,'--env','TLS_FIXTURE=true','--mount',`type=bind,source=${temporary},target=/tls,readonly`]);
  // Positive controls prove these fixtures/ports are reachable before the
  // guardian is applied; a timeout alone is not evidence of a firewall drop.
  await command(['exec',allowedName,'node','--input-type=module','-e',`const r=await fetch('http://${blocked}/');if(r.status!==200)process.exit(1)`]);
  await command(['exec',blockedName,'node','--input-type=module','-e',`const r=await fetch('http://${allowed}:8080/');if(r.status!==200)process.exit(1)`]);
  for(const name of [allowedName,blockedName]) await command(['exec',name,'node','--input-type=module','-e',"await fetch('http://127.0.0.1/reset')"]);
  console.log('Testing exact peer, pinned DNS, denied ports and unchanged upstream.');
  await probe('ordinary',allowed,blocked);
  console.log('Testing network byte budget.'); await probe('budget',allowed,blocked,{ingress:32768});
  // Keep the guardian alive after DNS deadline so the kernel timeout, rather
  // than namespace teardown, is what rejects this packet test.
  console.log('Testing kernel address-set expiration.');
  await probe('expired',allowed,blocked,{lifetime:5000});
  const countScript="const r=await fetch('http://127.0.0.1/counts');console.log(await r.text())";
  const rejected=JSON.parse(await command(['exec',blockedName,'node','--input-type=module','-e',countScript]));
  const accepted=JSON.parse(await command(['exec',allowedName,'node','--input-type=module','-e',countScript]));
  assert.equal(rejected.normal,0); assert.equal(accepted.forbidden_port,0);
  const report={schema:'isolated-egress-lab-v1',synthetic:true,network_internal:true,production_approved:false,engineImage,baseImage:base,cases,counters,blocked_fixture_requests:rejected.normal,forbidden_port_requests:accepted.forbidden_port,observed_at:new Date().toISOString()};
  mkdirSync('test-results',{recursive:true}); writeFileSync('test-results/egress-lab.json',JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report,null,2));
} finally {
  for(const name of containers.reverse()) { try { await command(['rm','--force',name]); } catch {} }
  try { await command(['network','rm',network]); } catch {}
  if(resolve(temporary).startsWith(root+sep)) rmSync(temporary,{recursive:true,force:true});
}
