import { readFileSync,mkdirSync,mkdtempSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { resolve,join,sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { DockerCLI } from '../executor/docker.mjs';
import { createIsolatedLabRunner } from '../executor/runner.mjs';
import { hasIpv6DefaultRoute } from '../executor/guardian/ipv6.mjs';
import { CHECKS,VERSIONS } from '../src/contracts.js';
import { validateResult,makeReport } from '../src/report.js';
const candidate=JSON.parse(readFileSync('executor/upstream.research.json','utf8')),engineImage=candidate.image+'@'+candidate.amd64_digest;
const docker=new DockerCLI(),prefix='security-check-route6-'+crypto.randomUUID().slice(0,8),containers=[],networks=[],cases=[];
const root=resolve('.wrangler/ipv6-routed-lab');mkdirSync(root,{recursive:true});const temporary=mkdtempSync(join(root,'run-'));
const target='2001:db8:5d:2::2',blocked='2001:db8:5d:2::3',gateway='2001:db8:5d:1::fe';let labImage,guardianImage;
const isolation=['--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','128m'];
async function ready(name,code) {
  for(let i=0;i<50;i++) {
    const logs=await docker.run(['logs',name]);if(logs.stdout.includes(code))return;
    if(!(await docker.inspect('container',name)).State.Running)throw new Error('ROUTED_FIXTURE_SETUP_FAILED: '+logs.stderr);
    await delay(100);
  }throw new Error('ROUTED_FIXTURE_TIMEOUT');
}
async function internalNetwork(suffix,subnet) {
  const name=prefix+suffix;networks.push(name);
  const id=(await docker.run(['network','create','--internal','--ipv6','--ipv4=false','--subnet',subnet,'--label','luminiware.security-check.lab=true',name])).stdout;
  const state=await docker.inspect('network',id);assert.equal(state.Internal,true);assert.equal(state.EnableIPv6,true);assert.equal(state.EnableIPv4,false);return id;
}
async function fixture(name,address,network) {
  containers.push(name);await docker.run(['run','-d','--name',name,'--network',network,'--ip6',address,...isolation,'--user','65532:65532',
    '--mount',`type=bind,source=${temporary},target=/tls,readonly`,'--entrypoint','node',engineImage,'--input-type=module','-e',readFileSync('tests/docker/ipv6-fixture.mjs','utf8')]);
  await ready(name,'FIXTURE_READY');
  await docker.run(['run','--rm','--network','container:'+name,...isolation,'--cap-add','NET_ADMIN','--entrypoint','ip',labImage,'-6','route','replace','2001:db8:5d:1::/64','via','2001:db8:5d:2::fe','dev','eth0']);
}
const counters=async name=>JSON.parse((await docker.run(['exec',name,'node','--input-type=module','-e',"console.log(await(await fetch('http://[::1]/counts')).text())"])).stdout);
try {
  console.log('Building guardian and lab-only route preparation image.');
  await docker.run(['build','-f','executor/guardian/Dockerfile','-t','security-check-guardian:lab','.'],{timeoutMs:300000,maxBytes:1048576});
  guardianImage=(await docker.inspect('image','security-check-guardian:lab')).Id;
  await docker.run(['build','-f','tests/docker/routed.Dockerfile','--build-arg','GUARDIAN_IMAGE=security-check-guardian:lab','-t','security-check-routed:lab','.'],{timeoutMs:300000,maxBytes:1048576});
  assert.equal((await docker.inspect('image','security-check-guardian:lab')).Id,guardianImage);
  labImage=(await docker.inspect('image','security-check-routed:lab')).Id;
  const a=await internalNetwork('-a','2001:db8:5d:1::/64'),b=await internalNetwork('-b','2001:db8:5d:2::/64');
  const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=example.com','-addext','subjectAltName=DNS:example.com','-keyout',join(temporary,'key.pem'),'-out',join(temporary,'cert.pem')],{stdio:'ignore',windowsHide:true}).status,0);
  console.log('Creating router, target and blocked fixture on two internal IPv6-only bridges.');
  const router=prefix+'-router';containers.push(router);
  const routerCode="import http from 'node:http';let requests=0;http.createServer((q,s)=>{if(q.url==='/counts')return s.end(String(requests));if(q.url==='/reset'){requests=0;return s.end('reset');}requests++;s.end('synthetic gateway');}).listen(80,'::',()=>console.log('ROUTER_READY'));";
  await docker.run(['run','-d','--name',router,'--network',a,'--ip6',gateway,...isolation,'--sysctl','net.ipv6.conf.all.forwarding=1','--entrypoint','node',labImage,'--input-type=module','-e',routerCode]);
  await docker.run(['network','connect','--ip6','2001:db8:5d:2::fe',b,router]);await ready(router,'ROUTER_READY');
  const targetName=prefix+'-target',blockedName=prefix+'-blocked';await fixture(targetName,target,b);await fixture(blockedName,blocked,b);
  for(const name of [router,targetName,blockedName]) {
    const routes=JSON.parse((await docker.run(['exec',name,'node','--input-type=module','-e',"import{readFileSync}from'node:fs';console.log(JSON.stringify({v4:readFileSync('/proc/net/route','utf8'),v6:readFileSync('/proc/net/ipv6_route','utf8')}));"])).stdout);
    assert.equal(hasIpv6DefaultRoute(routes.v6),false);assert.equal(routes.v4.split('\n').some(line=>/^\S+\s+00000000\s/u.test(line)),false);
  }
  const control=prefix+'-control';containers.push(control);
  const controlCode="import{spawnSync}from'node:child_process';import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(spawnSync('ip',['-6','route','replace','2001:db8:5d:2::/64','via','2001:db8:5d:1::fe','dev','eth0']).status,0);for(const u of ['http://[2001:db8:5d:2::2]/','http://[2001:db8:5d:2::3]/','http://[2001:db8:5d:2::2]:8080/','http://[2001:db8:5d:1::fe]/'])assert.equal((await fetch(u,{signal:AbortSignal.timeout(2000)})).status,200);console.log(JSON.stringify({routes:readFileSync('/proc/net/ipv6_route','utf8')}));process.stdout.write('',()=>process.exit(0));";
  await docker.run(['run','--rm','--name',control,'--network',a,'--ip6','2001:db8:5d:1::100',...isolation,'--cap-add','NET_ADMIN','--entrypoint','node',labImage,'--input-type=module','-e',controlCode]);
  cases.push('routed-positive-controls-before-firewall');
  for(const name of [targetName,blockedName,router])await docker.run(['exec',name,'node','--input-type=module','-e',"await fetch('http://[::1]/reset')"]);
  const guard=prefix+'-guard',directory=join(temporary,'policy');mkdirSync(directory);
  const policy={hostname:'example.com',addresses:[target],expires_at:Date.now()+60000,maxDnsRequests:64,ingressBytes:1048576,egressBytes:1048576,maxPacketBytes:4096};writeFileSync(join(directory,'network.json'),JSON.stringify(policy));
  containers.push(guard);await docker.run(['run','-d','--name',guard,'--network',a,'--ip6','2001:db8:5d:1::101',...isolation,'--cap-add','NET_ADMIN','--dns','127.0.0.1','--env','ISOLATED_TEST_FIXTURES=true','--mount',`type=bind,source=${directory},target=/policy,readonly`,labImage]);await ready(guard,'GUARDIAN_READY');
  const topology=JSON.parse((await docker.run(['exec',guard,'node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{networkInterfaces}from'node:os';import{deriveIpv6Link,hasIpv6DefaultRoute}from'./executor/guardian/ipv6.mjs';const routeText=readFileSync('/proc/net/ipv6_route','utf8');if(hasIpv6DefaultRoute(routeText))process.exit(1);console.log(JSON.stringify(deriveIpv6Link(['2001:db8:5d:2::2'],{routeText,interfaces:networkInterfaces(),addressText:readFileSync('/proc/net/if_inet6','utf8')})));" ])).stdout);
  assert.deepEqual(topology.on_link_peers,[]);assert.equal(topology.next_hop,gateway);cases.push('specific-kernel-route-selects-only-gateway');
  console.log('Testing routed HTTP/TLS and denial of gateway services, peer and port.');
  const probe=prefix+'-probe';containers.push(probe);
  const result=JSON.parse((await docker.run(['run','--rm','--name',probe,'--network','container:'+guard,...isolation,'--user','65532:65532','--entrypoint','node',engineImage,'--input-type=module','-e',readFileSync('tests/docker/routed-probe.mjs','utf8')],{timeoutMs:10000})).stdout);
  assert.equal(result.failure,undefined,result.failure);cases.push(...result.cases);
  const state=JSON.parse((await docker.run(['exec',guard,'nft','-j','list','table','inet','security_check'])).stdout);
  const ndp=state.nftables.filter(item=>item.counter&&/^(in|out)_ndp$/u.test(item.counter.name)).map(item=>item.counter);assert.ok(ndp.every(counter=>counter.packets>0));
  const neighbors=state.nftables.find(item=>item.set?.name==='ipv6_link_neighbors').set.elem;assert.equal(neighbors.length,1);assert.ok(JSON.stringify(neighbors).includes(gateway));cases.push('gateway-ndp-only-counted-and-budgeted');
  await docker.run(['rm','--force',guard]);
  console.log('Testing unchanged upstream through the actual routed IPv6 runner.');
  const limits={wallMs:20000,checkMs:1000,memoryMiB:256,cpus:1,pids:64,ingressBytes:1048576,egressBytes:1048576,maxPacketBytes:4096,maxDnsRequests:64,maxOutputBytes:32768,callbackMarginMs:1500,maxRedirects:2,maxResponseBytes:65536,maxTotalBodyBytes:131072,maxHttpRequests:8};
  const runner=createIsolatedLabRunner({engineImage,guardianImage:labImage,networkId:a,limits,resolveTarget:async()=>({hostname:'example.com',addresses:[target],expires_at:Date.now()+60000})});
  const now=Date.now(),versions={...VERSIONS,engine:candidate.research_revision,digest:candidate.amd64_digest};
  const attempt={job_id:crypto.randomUUID(),attempt_id:crypto.randomUUID(),target:'https://example.com/',allowed_checks:CHECKS,lease_until:now+30000,deadline_at:new Date(now+60000).toISOString(),versions};
  const body=await runner(attempt);validateResult(body,{id:attempt.job_id,attempt_id:attempt.attempt_id,target:attempt.target,created_at:now,versions_json:JSON.stringify(versions)},Date.now());
  const report=makeReport(body.checks,attempt.target,new Date().toISOString(),versions);assert.equal(report.coverage,.6);assert.equal(report.score,null);cases.push('routed-upstream-runner-normalization');
  const tc=await counters(targetName),bc=await counters(blockedName),gatewayRequests=Number((await docker.run(['exec',router,'node','--input-type=module','-e',"console.log(await(await fetch('http://[::1]/counts')).text())"])).stdout);
  assert.equal(tc.forbidden_port,0);assert.equal(bc.normal,0);assert.equal(gatewayRequests,0);
  const evidence={schema:'isolated-routed-ipv6-lab-v1',synthetic:true,networks_internal:true,ipv4_disabled:true,production_approved:false,engineImage,guardianImage,labImage,versions,cases,topology,
    ndp:ndp.map(({name,packets,bytes})=>({name,packets,bytes})),blocked_fixture_requests:bc.normal,forbidden_port_requests:tc.forbidden_port,gateway_requests:gatewayRequests,coverage:report.coverage,score:report.score,observed_at:new Date().toISOString()};
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/ipv6-routed-lab.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({cases,coverage:report.coverage,score:report.score,observed_at:evidence.observed_at},null,2));
}finally {
  for(const name of containers.reverse()){try{await docker.run(['rm','--force',name]);}catch{}}
  for(const name of networks.reverse()){try{await docker.run(['network','rm',name]);}catch{}}
  const directory=resolve(temporary);if(!directory.startsWith(root+sep))throw new Error('ROUTED_LAB_PATH_OUT_OF_SCOPE');rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
