import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const allowed=process.env.ALLOWED_FIXTURE,blocked=process.env.BLOCKED_FIXTURE,mode=process.env.PROBE_MODE;
async function denied(host,port) {
  const connected=await new Promise(resolve=>{
    const socket=net.connect({host,port,family:6});socket.setTimeout(650,()=>{socket.destroy();resolve(false);});
    socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));
  });assert.equal(connected,false);
}
try {
  assert.notEqual(process.getuid(),0);assert.match(readFileSync('/proc/self/status','utf8'),/^CapEff:\s+0+$/mu);
  for(const key of ['EXECUTOR_KEY','QUEUE_TOKEN','HUBSPOT_ACCESS_TOKEN'])assert.equal(process.env[key],undefined);
  if(mode==='ordinary') {
    const resolver=new dns.Resolver({timeout:500,tries:1});resolver.setServers(['127.0.0.1']);
    assert.deepEqual(await resolver.resolve6('example.com'),[allowed]);await assert.rejects(resolver.resolve6('other.example.com'));
    assert.equal((await dns.lookup('example.com',{family:6})).address,allowed);
    const response=await fetch('http://example.com/',{signal:AbortSignal.timeout(2000)});assert.match(await response.text(),/synthetic IPv6/u);
    const peer=await new Promise((resolve,reject)=>{
      const socket=tls.connect({host:'example.com',port:443,servername:'example.com',rejectUnauthorized:false},()=>{
        resolve({address:socket.remoteAddress,family:socket.remoteFamily,cn:socket.getPeerCertificate().subject.CN,authorized:socket.authorized});socket.end();
      });socket.on('error',reject);socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('TLS_FIXTURE_TIMEOUT'));});
    });assert.equal(peer.address,allowed);assert.equal(peer.family,'IPv6');assert.equal(peer.cn,'example.com');assert.equal(peer.authorized,false);
    await denied(blocked,80);await denied(allowed,8080);
    console.log(JSON.stringify({cases:['ipv6-only-namespace','aaaa-pinned-and-system-lookup','unknown-dns-blocked','exact-ipv6-http-peer','original-ipv6-tls-certificate','unreserved-ipv6-peer-blocked','extra-ipv6-port-blocked']}));
  } else if(mode==='budget') {
    let received=0,completed=false;
    try {
      const response=await fetch('http://example.com/large',{signal:AbortSignal.timeout(1500)}),reader=response.body.getReader();
      for(;;){const {value,done}=await reader.read();if(done){completed=true;break;}received+=value.byteLength;}
    }catch{}
    assert.equal(completed,false);assert.ok(received<=32768);console.log(JSON.stringify({cases:['ipv6-ingress-budget-includes-control-and-data'],received}));
  } else if(mode==='expired') {await denied(allowed,80);console.log(JSON.stringify({cases:['ipv6-peer-and-ndp-reservation-expire']}));}
  else throw new Error('UNKNOWN_FIXTURE_MODE');
} catch(error) {console.log(JSON.stringify({failure:error.stack}));}
// A dropped TCP flow can keep Undici cleanup handles alive after the asserted
// result. Flush the result and terminate this disposable probe's PID 1.
process.stdout.write('',()=>process.exit(0));
