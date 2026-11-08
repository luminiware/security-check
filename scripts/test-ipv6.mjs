import { readFileSync,mkdirSync,mkdtempSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { resolve,join,sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import ipaddr from 'ipaddr.js';
import { DockerCLI } from '../executor/docker.mjs';
import { createIsolatedLabRunner } from '../executor/runner.mjs';
import { CHECKS,VERSIONS } from '../src/contracts.js';
import { validateResult,makeReport } from '../src/report.js';
const candidate=JSON.parse(readFileSync('executor/upstream.research.json','utf8')),engineImage=candidate.image+'@'+candidate.amd64_digest;
const docker=new DockerCLI(),prefix='security-check-ipv6-'+crypto.randomUUID().slice(0,8),network=prefix+'-net',containers=[],cases=[],snapshots=[];
const root=resolve('.wrangler/ipv6-lab');mkdirSync(root,{recursive:true});const temporary=mkdtempSync(join(root,'run-'));
let networkId,guardianImage,guardOrdinal=256;
async function makeGuard(guard,directory,allowed,{ingress=1048576,lifetime=60000,grace=0}={}) {
  mkdirSync(directory);const policy={hostname:'example.com',addresses:[allowed],expires_at:Date.now()+lifetime,maxDnsRequests:64,ingressBytes:ingress,egressBytes:1048576,maxPacketBytes:4096,shutdown_grace_ms:grace};
  writeFileSync(join(directory,'network.json'),JSON.stringify(policy));containers.push(guard);
  const localAddress='2001:db8:5c::'+(++guardOrdinal).toString(16);
  await docker.run(['run','-d','--name',guard,'--network',networkId,'--ip6',localAddress,'--dns','127.0.0.1','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','NET_ADMIN','--security-opt','no-new-privileges',
    '--pids-limit','32','--memory','128m','--env','ISOLATED_TEST_FIXTURES=true','--mount',`type=bind,source=${directory},target=/policy,readonly`,guardianImage]);
  await ready(guard,'GUARDIAN_READY');return policy;
}
async function guardCounters(guard) {
  const state=JSON.parse((await docker.run(['exec',guard,'nft','-j','list','table','inet','security_check'])).stdout);
  return {state,counters:state.nftables.filter(item=>item.counter).map(item=>item.counter)};
}
async function ready(name,code) {
  for(let i=0;i<40;i++) {
    const logs=await docker.run(['logs',name]);if(logs.stdout.includes(code))return;
    if(!(await docker.inspect('container',name)).State.Running)throw new Error('IPV6_FIXTURE_SETUP_FAILED: '+logs.stderr);
    await delay(100);
  }throw new Error('IPV6_FIXTURE_TIMEOUT');
}
async function fixture(name) {
  containers.push(name);await docker.run(['run','-d','--name',name,'--network',networkId,'--read-only','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m',
    '--mount',`type=bind,source=${temporary},target=/tls,readonly`,'--entrypoint','node',engineImage,'--input-type=module','-e',readFileSync('tests/docker/ipv6-fixture.mjs','utf8')]);
  await ready(name,'FIXTURE_READY');const item=await docker.inspect('container',name);return Object.values(item.NetworkSettings.Networks)[0].GlobalIPv6Address;
}
async function probe(mode,allowed,blocked,{ingress=1048576,lifetime=60000}={}) {
  console.log('IPv6 phase: '+mode);
  const guard=prefix+'-'+mode,directory=join(temporary,mode);
  const policy=await makeGuard(guard,directory,allowed,{ingress,lifetime,grace:mode==='expired'?5000:0});
  if(mode==='expired')await delay(Math.max(1,policy.expires_at-Date.now()+100));
  const engine=guard+'-probe';containers.push(engine);
  const output=await docker.run(['run','--rm','--name',engine,'--network','container:'+guard,'--read-only','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m',
    '--env','ALLOWED_FIXTURE='+allowed,'--env','BLOCKED_FIXTURE='+blocked,'--env','PROBE_MODE='+mode,'--entrypoint','node',engineImage,'--input-type=module','-e',readFileSync('tests/docker/ipv6-probe.mjs','utf8')],{timeoutMs:10000});
  const result=JSON.parse(output.stdout);assert.equal(result.failure,undefined,result.failure);cases.push(...result.cases);
  const {state,counters}=await guardCounters(guard);const count=name=>counters.find(item=>item.name===name);
  assert.ok(count('in_accepted').bytes<=policy.ingressBytes);assert.ok(count('out_accepted').bytes<=policy.egressBytes);
  if(mode==='ordinary'){assert.ok(count('in_ndp').packets>0);assert.ok(count('out_ndp').packets>0);assert.ok(count('out_blocked').packets>0);cases.push('cold-link-ndp-counted-and-budgeted');}
  if(mode==='budget')assert.ok(count('in_blocked').packets>0);
  if(mode==='expired') {
    assert.ok(count('out_blocked').packets>0);
    for(const name of ['ipv6_peers','ipv6_link_local','ipv6_link_neighbors'])assert.ok(!state.nftables.find(item=>item.set?.name===name).set.elem?.length);
  }
  snapshots.push({mode,counters});await docker.run(['rm','--force',guard]);
}
async function malformedNeighbors(allowedName,allowed,blocked) {
  const forger=prefix+'-packet-control';containers.push(forger);
  await docker.run(['run','-d','--name',forger,'--network','container:'+allowedName,'--read-only','--cap-drop','ALL','--cap-add','NET_ADMIN','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m',
    '--entrypoint','node',guardianImage,'-e','setInterval(()=>{},1000)']);
  // This is a trusted laboratory control, not a capability granted to Web-Check.
  const modes={valid:'',hoplimit:'ip6 hoplimit set 254',code:'icmpv6 code set 1',target:'@th,64,128 set 0x'+ipaddr.parse(blocked).toByteArray().map(byte=>byte.toString(16).padStart(2,'0')).join('')};
  for(const kind of ['solicit','advert'])for(const [mode,mutation] of Object.entries(modes)) {
    console.log('IPv6 phase: '+kind+'-'+mode);
    const label=kind+'-'+mode,guard=prefix+'-bad-'+label;await makeGuard(guard,join(temporary,'bad-'+label),allowed);
    const state=await docker.inspect('container',guard),destination=Object.values(state.NetworkSettings.Networks)[0].GlobalIPv6Address;
    const rules=`table ip6 isolated_ndp_mutation {
counter emitted { }
chain output {
type filter hook output priority -150; policy accept;
ip6 nexthdr 58 icmpv6 type nd-neighbor-${kind} ${mutation} counter name "emitted"
}
}\n`;
    // Only synthetic packet mutations are printed on failure by this harness.
    const applied=spawnSync('docker',['exec','--interactive',forger,'nft','-f','-'],{input:rules,encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:8192});
    assert.equal(applied.status,0,applied.stderr);
    const send="const net=await import('node:net');await new Promise(resolve=>{const s=net.connect({host:process.argv[1],port:80,family:6});s.setTimeout(400,()=>{s.destroy();resolve()});s.on('error',resolve);s.on('connect',()=>{s.destroy();resolve()})});";
    try {
      await docker.run(['exec',kind==='solicit'?allowedName:guard,'node','--input-type=module','-e',send,kind==='solicit'?destination:allowed]);
      const mutationState=JSON.parse((await docker.run(['exec',forger,'nft','-j','list','table','ip6','isolated_ndp_mutation'])).stdout);
      assert.ok(mutationState.nftables.find(item=>item.counter?.name==='emitted').counter.packets>0);
      const observed=await guardCounters(guard);
      if(mode==='valid')assert.ok(observed.counters.find(item=>item.name==='in_ndp').packets>0);
      else {assert.equal(observed.counters.find(item=>item.name==='in_ndp').packets,0);assert.ok(observed.counters.find(item=>item.name==='in_blocked').packets>0);}
      snapshots.push({mode:'ndp-'+label,counters:observed.counters});cases.push(mode==='valid'?'ndp-'+kind+'-positive-control':'ndp-'+kind+'-invalid-'+mode+'-dropped');
    } finally {await docker.run(['exec',forger,'nft','delete','table','ip6','isolated_ndp_mutation']);await docker.run(['rm','--force',guard]);}
  }
}
async function fragmentedDatagram(allowedName,allowed) {
  console.log('IPv6 phase: fragments');
  const guard=prefix+'-fragments';await makeGuard(guard,join(temporary,'fragments'),allowed);
  const state=await docker.inspect('container',guard),destination=Object.values(state.NetworkSettings.Networks)[0].GlobalIPv6Address;
  const send="import dgram from 'node:dgram';const s=dgram.createSocket('udp6');await new Promise((resolve,reject)=>s.send(Buffer.alloc(6000,97),9090,process.argv[1],error=>{s.close();error?reject(error):resolve()}));";
  await docker.run(['exec',allowedName,'node','--input-type=module','-e',send,destination]);
  let observed;
  for(let i=0;i<15;i++) {
    observed=await guardCounters(guard);if(observed.counters.find(item=>item.name==='in_fragments').packets>0)break;
    if(i===14)throw new Error('IPV6_FRAGMENTS_NOT_OBSERVED');await delay(75);
  }
  const chain=observed.state.nftables.find(item=>item.chain?.name==='ipv6_fragments').chain;
  assert.equal(chain.prio,-450);assert.ok(observed.counters.find(item=>item.name==='in_blocked').packets>0);
  snapshots.push({mode:'fragments',counters:observed.counters});cases.push('ipv6-fragments-dropped-before-defragmentation');await docker.run(['rm','--force',guard]);
}
try {
  console.log('Building guardian and creating an isolated IPv6-only documentation network.');
  await docker.run(['build','-f','executor/guardian/Dockerfile','-t','security-check-guardian:lab','.'],{timeoutMs:300000,maxBytes:1048576});
  guardianImage=(await docker.inspect('image','security-check-guardian:lab')).Id;
  networkId=(await docker.run(['network','create','--internal','--ipv6','--ipv4=false','--subnet','2001:db8:5c::/64','--label','luminiware.security-check.lab=true',network])).stdout;
  const n=await docker.inspect('network',networkId);assert.equal(n.Internal,true);assert.equal(n.EnableIPv6,true);assert.equal(n.EnableIPv4,false);
  const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const certificate=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com','-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem')],{stdio:'ignore',windowsHide:true});
  assert.equal(certificate.status,0,'TLS_FIXTURE_FAILED');
  const allowedName=prefix+'-allowed',blockedName=prefix+'-blocked',allowed=await fixture(allowedName),blocked=await fixture(blockedName);
  await docker.run(['exec',allowedName,'node','--input-type=module','-e',`if((await fetch('http://[${blocked}]/')).status!==200)process.exit(1);if((await fetch('http://[${allowed}]:8080/')).status!==200)process.exit(1)`]);
  const datagram="import dgram from 'node:dgram';import{readFileSync}from'node:fs';if(Number(readFileSync('/sys/class/net/eth0/mtu','utf8'))>=6048)process.exit(1);const s=dgram.createSocket('udp6');await new Promise((resolve,reject)=>s.send(Buffer.alloc(6000,97),9090,process.argv[1],error=>{s.close();error?reject(error):resolve()}));";
  await docker.run(['exec',allowedName,'node','--input-type=module','-e',datagram,blocked]);
  const positiveUdp=JSON.parse((await docker.run(['exec',blockedName,'node','--input-type=module','-e',"console.log(await(await fetch('http://[::1]/counts')).text())"])).stdout);assert.equal(positiveUdp.udp_bytes,6000);
  for(const name of [allowedName,blockedName])await docker.run(['exec',name,'node','--input-type=module','-e',"await fetch('http://[::1]/reset')"]);
  cases.push('positive-controls-before-firewall');console.log('Testing AAAA, NDP, exact peer, TLS and forbidden connections.');
  await probe('ordinary',allowed,blocked);
  console.log('Testing IPv6 ingress quota and kernel expiration.');await probe('budget',allowed,blocked,{ingress:32768});await probe('expired',allowed,blocked,{lifetime:5000});
  console.log('Testing malformed NDP packets and early IPv6 fragment rejection.');await malformedNeighbors(allowedName,allowed,blocked);await fragmentedDatagram(allowedName,allowed);
  console.log('Testing unchanged upstream through the actual IPv6 runner.');
  const limits={wallMs:20000,checkMs:1000,memoryMiB:256,cpus:1,pids:64,ingressBytes:1048576,egressBytes:1048576,maxPacketBytes:4096,maxDnsRequests:64,maxOutputBytes:32768,callbackMarginMs:1500,maxRedirects:2,maxResponseBytes:65536,maxTotalBodyBytes:131072,maxHttpRequests:8};
  const runner=createIsolatedLabRunner({engineImage,guardianImage,networkId,limits,resolveTarget:async()=>({hostname:'example.com',addresses:[allowed],expires_at:Date.now()+60000})});
  const now=Date.now(),versions={...VERSIONS,engine:candidate.research_revision,digest:candidate.amd64_digest};
  const attempt={job_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),target:'https://example.com/',allowed_checks:CHECKS,lease_until:now+30000,deadline_at:new Date(now+60000).toISOString(),versions};
  const body=await runner(attempt);validateResult(body,{id:attempt.job_id,attempt_id:attempt.attempt_id,target:attempt.target,created_at:now,versions_json:JSON.stringify(versions)},Date.now());
  const report=makeReport(body.checks,attempt.target,new Date().toISOString(),versions);assert.equal(report.coverage,.6);assert.equal(report.score,null);assert.equal(report.checks.find(check=>check.id==='dns').evidence.public_address_count,1);
  cases.push('ipv6-upstream-runner-normalization');
  const counts=async name=>JSON.parse((await docker.run(['exec',name,'node','--input-type=module','-e',"console.log(await(await fetch('http://[::1]/counts')).text())"])).stdout);
  const a=await counts(allowedName),b=await counts(blockedName);assert.equal(a.forbidden_port,0);assert.equal(b.normal,0);assert.equal(b.udp_bytes,0);
  const evidence={schema:'isolated-ipv6-lab-v1',synthetic:true,network_internal:true,ipv4_disabled:true,production_approved:false,engineImage,guardianImage,versions,cases,
    snapshots:snapshots.map(snapshot=>({...snapshot,counters:snapshot.counters.map(({name,packets,bytes})=>({name,packets,bytes}))})),
    blocked_fixture_requests:b.normal,forbidden_port_requests:a.forbidden_port,coverage:report.coverage,score:report.score,observed_at:new Date().toISOString()};
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/ipv6-lab.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({schema:evidence.schema,cases,blocked_fixture_requests:b.normal,forbidden_port_requests:a.forbidden_port,coverage:report.coverage,score:report.score,observed_at:evidence.observed_at},null,2));
} finally {
  for(const name of containers.reverse()){try{await docker.run(['rm','--force',name]);}catch{}}
  try{await docker.run(['network','rm',network]);}catch{}
  const directory=resolve(temporary);if(!directory.startsWith(root+sep))throw new Error('IPV6_LAB_PATH_OUT_OF_SCOPE');rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
