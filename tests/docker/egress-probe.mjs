import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
assert.notEqual(process.getuid(),0); assert.match(readFileSync('/proc/self/status','utf8'),/^CapEff:\s+0+$/mu);
for(const key of ['EXECUTOR_KEY','QUEUE_TOKEN','HUBSPOT_ACCESS_TOKEN']) assert.equal(process.env[key],undefined);
const allowed = process.env.ALLOWED_FIXTURE; const blocked = process.env.BLOCKED_FIXTURE;
const mode = process.env.PROBE_MODE;
const resolver = new dns.Resolver({ timeout: 1000, tries: 1 }); resolver.setServers(['127.0.0.1']);
async function blockedConnection(host, port) {
  const reached = await new Promise(resolve => {
    const socket = net.connect({ host,port }); socket.setTimeout(600,() => { socket.destroy(); resolve(false); });
    socket.on('connect',() => { socket.destroy(); resolve(true); }); socket.on('error',() => resolve(false));
  });
  assert.equal(reached,false,`Unexpected connection to fixture ${host}:${port}`);
}
if (mode === 'ordinary') {
  assert.deepEqual(await resolver.resolve4('example.com'),[allowed]);
  await assert.rejects(resolver.resolve4('other.example.com'));
  // System resolver must use the guardian too; no fallback to Docker DNS.
  assert.equal((await dns.lookup('example.com')).address,allowed);
  const response = await fetch('http://example.com/', { signal:AbortSignal.timeout(2000) }); assert.equal(response.status,200);
  assert.match(await response.text(),/synthetic isolated/u);
  await blockedConnection(blocked,80); await blockedConnection(allowed,8080);
  // Direct handler invocation does not require an API listener. A loopback
  // service must remain unreachable even when a workload creates one itself.
  let localAccepted=0;const canary=net.createServer(socket=>{localAccepted++;socket.destroy();});
  await new Promise((resolve,reject)=>canary.once('error',reject).listen(3000,'127.0.0.1',resolve));
  await blockedConnection('127.0.0.1',3000);assert.equal(localAccepted,0);await new Promise(resolve=>canary.close(resolve));
  const dockerResolver=new dns.Resolver({timeout:1000,tries:1}); dockerResolver.setServers(['127.0.0.11']);
  assert.deepEqual(await dockerResolver.resolve4('example.com'),[allowed]);
  await assert.rejects(dockerResolver.resolve4('other.example.com')); // Redirected to the pinned resolver; no external forward.
  await assert.rejects(fetch('http://example.com/redirect-blocked',{ signal:AbortSignal.timeout(1500) }));
  const peer = await new Promise((resolve,reject) => {
    const socket = tls.connect({ host:'example.com',port:443,servername:'example.com',rejectUnauthorized:false },() => {
      resolve({ address:socket.remoteAddress,subject:socket.getPeerCertificate().subject.CN,authorized:socket.authorized }); socket.end();
    }); socket.on('error',reject); socket.setTimeout(2000,() => { socket.destroy(); reject(new Error('TLS_TIMEOUT')); });
  });
  assert.equal(peer.address,allowed); assert.equal(peer.subject,'example.com'); assert.equal(peer.authorized,false);
  process.env.PLATFORM='NODE'; process.env.PUBLIC_API_TIMEOUT_LIMIT='1500';
  process.env.API_ENABLED_CHECKS='headers,http-security,ssl,dns'; process.env.API_DISABLED_CHECKS='get-ip';
  async function invoke(id,target) {
    const handler=(await import('/app/api/' + id + '.js')).default; let body;
    await handler({ url:'/api/' + id,query:{ url:target } },{ status(){return this;},json(value){body=value;} }); return body;
  }
  const headers=await invoke('headers','http://example.com/'); assert.equal(headers['x-content-type-options'],'nosniff');
  const ssl=await invoke('ssl','https://example.com/'); assert.equal(ssl.isValid,false); assert.ok(ssl.authError);
  const records=await invoke('dns','https://example.com/'); assert.deepEqual(records.A,[allowed]);
  const blockedRedirect=await invoke('headers','http://example.com/redirect-blocked'); assert.equal(typeof blockedRedirect.error,'string');
  console.log(JSON.stringify({ cases:['pinned-dns','system-dns-pinned','unknown-dns-blocked','exact-peer-http','other-peer-blocked','extra-port-blocked','loopback-api-port-blocked','docker-dns-forced-through-pinned-resolver','outside-redirect-blocked','original-tls-certificate','upstream-headers-guarded','upstream-tls-guarded','upstream-dns-guarded','upstream-redirect-escape-blocked'],peer_verified:true }));
} else if (mode === 'budget') {
  let received = 0; let completed = false;
  try {
    const response = await fetch('http://example.com/large',{ signal:AbortSignal.timeout(2000) });
    const reader = response.body.getReader(); for (;;) { const chunk = await reader.read(); if (chunk.done) { completed=true; break; } received += chunk.value.length; }
  } catch { /* Budget may drop before HTTP headers; this is not a successful collection. */ }
  assert.equal(completed,false); assert.ok(received <= 32768); console.log(JSON.stringify({ cases:['ingress-budget-bounds-fixture-body'],received }));
} else if (mode === 'expired') {
  await blockedConnection(allowed,80); console.log(JSON.stringify({ cases:['expired-peer-reservation-blocked'] }));
} else throw new Error('UNKNOWN_PROBE_MODE');
