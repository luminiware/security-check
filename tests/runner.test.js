import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDockerRunner,createIsolatedLabRunner,validateWorkload } from '../executor/runner.mjs';
import { guardianState } from '../executor/guardian-state.mjs';
import { removeOwnedSandbox,reapExpiredSandboxes,SANDBOX_LABEL,SANDBOX_OWNER } from '../executor/docker.mjs';
import { CHECKS,VERSIONS } from '../src/contracts.js';
import { watchSandbox } from '../executor/watchdog.mjs';
import { POLICY_ROOT,removeOwnedPolicyDirectory } from '../executor/policy-files.mjs';
import { mkdir,mkdtemp,writeFile,access } from 'node:fs/promises';
import { join } from 'node:path';
const digest='sha256:'+'a'.repeat(64), image='example/engine@'+digest, revision='b'.repeat(40);
const limits={wallMs:10000,checkMs:500,memoryMiB:256,cpus:1,pids:64,ingressBytes:65536,egressBytes:65536,maxPacketBytes:4096,maxDnsRequests:32,maxOutputBytes:32768,callbackMarginMs:1000,
  maxRedirects:2,maxResponseBytes:65536,maxTotalBodyBytes:131072,maxHttpRequests:8};
function config(extra={}) {return {engineImage:image,guardianImage:'sha256:'+'c'.repeat(64),networkId:'d'.repeat(64),limits,
  resolveTarget:async()=>({hostname:'example.com',addresses:['8.8.8.8'],expires_at:Date.now()+10000}),...extra};}
function attempt(extra={}) {return {job_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),target:'https://example.com/',allowed_checks:CHECKS,
  versions:{...VERSIONS,engine:revision,digest},deadline_at:new Date(Date.now()+30000).toISOString(),lease_until:Date.now()+20000,...extra};}
test('runner refuses missing limits, mutable image references and unsupported claims before Docker writes',async()=>{
  assert.throws(()=>createDockerRunner(config({engineImage:'example/engine:latest'})),/RUNNER_CONFIGURATION_REQUIRED/u);
  assert.throws(()=>createDockerRunner(config({limits:{...limits,cpus:0}})),/RUNNER_LIMITS_REQUIRED/u);
  assert.throws(()=>createDockerRunner(config({limits:{...limits,cpus:NaN}})),/RUNNER_LIMITS_REQUIRED/u);
  let writes=0; const docker={run:async()=>{writes++;throw new Error('must-not-run');},inspect:async()=>{throw new Error('not-needed');}};
  const run=createDockerRunner(config({docker}));
  await assert.rejects(run(attempt({allowed_checks:['tech-stack']})),/RUNNER_CLAIM_INVALID/u);
  await assert.rejects(run(attempt({lease_until:Date.now()-1})),/RUNNER_DEADLINE_EXPIRED/u);
  assert.equal(writes,0);
});
test('workload boundary rejects unknown fields, invalid state, null checks and stale evidence',()=>{
  const now=Date.now();const payload={schema_version:'workload-v1-proposal',duration_ms:10,
    checks:CHECKS.map(id=>({id,collection:'erro',data:null,http:null,observed_at:new Date(now).toISOString(),duration_ms:1}))};
  assert.equal(validateWorkload(payload,now-100,now),payload);
  for (const mutate of [p=>p.score=100,p=>p.checks[0]=null,p=>p.checks[0].collection='adequado',p=>p.checks[0].data={synthetic:true},
    p=>p.checks[0].observed_at='2000-01-01T00:00:00Z',p=>p.duration_ms=Infinity,
    p=>p.checks[0].http={http_status:503,interstitial:false,final_https:true,redirect_count:0,http_reaches_https:true},
    p=>p.checks[2].http={http_status:200,interstitial:false,final_https:true,redirect_count:0,http_reaches_https:null}]) {
    const copy=structuredClone(payload);mutate(copy);assert.throws(()=>validateWorkload(copy,now-100,now),/WORKLOAD_CONTRACT_INVALID/u);
  }
});
test('public and lab runners cannot exchange address/network exceptions',async()=>{
  const network={Driver:'bridge',Scope:'local',Internal:true,Labels:{'luminiware.security-check.lab':'true'}};
  const docker={inspect:async kind=>kind==='network'?network:{Config:{Labels:{'org.opencontainers.image.revision':revision}},RepoDigests:[image]},run:async()=>{throw new Error('must-not-write');}};
  const privateResolve=async()=>({hostname:'example.com',addresses:['192.0.2.2'],expires_at:Date.now()+10000});
  await assert.rejects(createDockerRunner(config({docker,resolveTarget:privateResolve}))(attempt()),/DESTINATION_BLOCKED/u);
  await assert.rejects(createIsolatedLabRunner(config({docker}))(attempt()),/DOCUMENTATION_FIXTURE_REQUIRED/u);
  network.Internal=false;
  await assert.rejects(createIsolatedLabRunner(config({docker,resolveTarget:privateResolve}))(attempt()),/RUNNER_ARTIFACT_OR_NETWORK_MISMATCH/u);
});
function snapshot() {
  return {nftables:[{table:{family:'inet',name:'security_check'}},
    ...['input','output','forward'].map(name=>({chain:{name,type:'filter',hook:name,policy:'drop',prio:0}})),
    {chain:{name:'pinned_docker_dns',type:'nat',hook:'output',prio:-110}},
    {set:{name:'ipv4_peers',flags:['timeout'],elem:[{elem:{val:'8.8.8.8',timeout:10,expires:9}}]}},
    ...['in','out'].flatMap(direction=>[{quota:{name:direction+'_bytes',bytes:61440,inv:false,used:0}},{counter:{name:direction+'_accepted',bytes:100,packets:1}}]) ]};
}
test('guardian snapshot rejects missing/changed peers, open policy and exhausted budget',()=>{
  const base=snapshot(), reservation={addresses:['8.8.8.8']};
  const stable=guardianState(base,reservation,limits); const accounting=structuredClone(base);
  accounting.nftables.find(e=>e.counter).counter.bytes++; accounting.nftables.find(e=>e.set).set.elem[0].elem.expires--;
  assert.equal(guardianState(accounting,reservation,limits),stable);
  const open=structuredClone(base);open.nftables.find(e=>e.chain?.name==='output').chain.policy='accept'; assert.throws(()=>guardianState(open,reservation,limits));
  assert.throws(()=>guardianState({nftables:[]},reservation,limits));
  assert.throws(()=>guardianState(base,{addresses:['1.1.1.1']},limits),/GUARDIAN_PEER_MISMATCH/u);
  const overflow=structuredClone(base);overflow.nftables.find(e=>e.counter).counter.bytes=65537; assert.throws(()=>guardianState(overflow,reservation,limits),/GUARDIAN_BUDGET_INVALID/u);
});
test('IPv6 snapshot requires early fragment rejection and live unicast link-control sets',()=>{
  const base=snapshot(),peer='2001:db8:5c::2';
  const set=base.nftables.find(entry=>entry.set).set;set.name='ipv6_peers';set.elem[0].elem.val=peer;
  base.nftables.push({chain:{name:'ipv6_fragments',type:'filter',hook:'prerouting',policy:'accept',prio:-450}},
    ...[['ipv6_link_local','2001:db8:5c::3'],['ipv6_link_neighbors',peer]].map(([name,val])=>({set:{name,type:'ipv6_addr',flags:['timeout'],elem:[{elem:{val,timeout:10,expires:9}}]}})));
  assert.equal(typeof guardianState(base,{addresses:[peer]},limits),'string');
  const late=structuredClone(base);late.nftables.find(entry=>entry.chain?.name==='ipv6_fragments').chain.prio=-300;
  assert.throws(()=>guardianState(late,{addresses:[peer]},limits),/GUARDIAN_ATTESTATION_INVALID/u);
  const expired=structuredClone(base);expired.nftables.find(entry=>entry.set?.name==='ipv6_link_local').set.elem[0].elem.expires=0;
  assert.throws(()=>guardianState(expired,{addresses:[peer]},limits),/GUARDIAN_RESERVATION_EXPIRED/u);
  const multicast=structuredClone(base);multicast.nftables.find(entry=>entry.set?.name==='ipv6_link_neighbors').set.elem[0].elem.val='ff02::1';
  assert.throws(()=>guardianState(multicast,{addresses:[peer]},limits),/GUARDIAN_ATTESTATION_INVALID/u);
});
test('cleanup and reaper only remove resources with matching owner/run/deadline',async()=>{
  const name='sc-sandbox-'+crypto.randomUUID()+'-engine';let removed=0;
  const docker={run:async args=>{if(args[0]==='rm'){removed++;return{stdout:''};}return{stdout:'a'.repeat(12)};},
    inspect:async()=>({Name:'/'+name,Config:{Labels:{[SANDBOX_LABEL]:'other','luminiware.security-check.run_id':'synthetic','luminiware.security-check.expires_at':'1'}}})};
  await assert.rejects(removeOwnedSandbox(docker,name,'synthetic'),/SANDBOX_OWNERSHIP_MISMATCH/u);assert.equal(removed,0);
  assert.equal(await reapExpiredSandboxes(docker),0);assert.equal(removed,0);
  docker.inspect=async()=>({Name:'/'+name,Config:{Labels:{[SANDBOX_LABEL]:SANDBOX_OWNER,'luminiware.security-check.run_id':'synthetic','luminiware.security-check.expires_at':'1','luminiware.security-check.kind':'engine'}}});
  assert.equal(await reapExpiredSandboxes(docker),1);assert.equal(removed,1);
});
test('watchdog cleans only its UUID reservation in engine-before-guardian order',async()=>{
  const runId=crypto.randomUUID(),removed=[];
  const docker={run:async args=>{if(args[0]==='rm'){removed.push(args.at(-1));return{stdout:''};}return{stdout:'a'.repeat(12)};},
    inspect:async()=>({Config:{Labels:{[SANDBOX_LABEL]:SANDBOX_OWNER,'luminiware.security-check.run_id':runId}}})};
  await watchSandbox(runId,Date.now()-1,docker);
  assert.deepEqual(removed,['sc-sandbox-'+runId+'-engine','sc-sandbox-'+runId+'-guard']);
  await assert.rejects(watchSandbox('../other',Date.now(),docker),/INVALID_WATCHDOG_RESERVATION/u);
});
test('cleanup waits for an already-started concurrent removal instead of declaring a leak',async()=>{
  const runId=crypto.randomUUID(),name='sc-sandbox-'+runId+'-engine';let polls=0;
  const docker={run:async args=>{
    if(args[0]==='rm')throw new Error('DOCKER_OPERATION_FAILED');
    return{stdout:++polls<3?'a'.repeat(12):''};
  },inspect:async()=>({Config:{Labels:{[SANDBOX_LABEL]:SANDBOX_OWNER,'luminiware.security-check.run_id':runId}}})};
  await removeOwnedSandbox(docker,name,runId);assert.equal(polls,3);
});
test('temporary policy removal verifies the application root and UUID owner',async()=>{
  await mkdir(POLICY_ROOT,{recursive:true});const directory=await mkdtemp(join(POLICY_ROOT,'sandbox-'));const runId=crypto.randomUUID();
  await writeFile(join(directory,'owner.json'),JSON.stringify({run_id:runId}));
  await assert.rejects(removeOwnedPolicyDirectory(directory,crypto.randomUUID()),/SANDBOX_OWNERSHIP_MISMATCH/u);await access(directory);
  await assert.rejects(removeOwnedPolicyDirectory(POLICY_ROOT,runId),/POLICY_DIRECTORY_OUT_OF_SCOPE/u);
  await removeOwnedPolicyDirectory(directory,runId);await assert.rejects(access(directory));
});
