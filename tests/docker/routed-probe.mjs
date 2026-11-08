import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const target='2001:db8:5d:2::2',blocked='2001:db8:5d:2::3',gateway='2001:db8:5d:1::fe';
const cases=[];
async function denied(host,port) {
  const connected=await new Promise(resolve=>{
    const socket=net.connect({host,port,family:6});socket.setTimeout(500,()=>{socket.destroy();resolve(false);});
    socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));
  });assert.equal(connected,false,host+':'+port);
}
try {
  assert.notEqual(process.getuid(),0);assert.match(readFileSync('/proc/self/status','utf8'),/^CapEff:\s+0+$/mu);
  const response=await fetch('http://example.com/',{signal:AbortSignal.timeout(2000)});assert.match(await response.text(),/synthetic IPv6/u);cases.push('routed-ipv6-http');
  const peer=await new Promise((resolve,reject)=>{
    const socket=tls.connect({host:'example.com',port:443,servername:'example.com',rejectUnauthorized:false},()=>{
      resolve({address:socket.remoteAddress,cn:socket.getPeerCertificate().subject.CN,authorized:socket.authorized});socket.end();
    });socket.on('error',reject);socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('TLS_FIXTURE_TIMEOUT'));});
  });assert.deepEqual(peer,{address:target,cn:'example.com',authorized:false});cases.push('routed-original-tls-certificate');
  await denied(blocked,80);cases.push('routed-unreserved-peer-blocked');
  await denied(target,8080);cases.push('routed-extra-port-blocked');
  await denied(gateway,80);cases.push('gateway-service-blocked');
  console.log(JSON.stringify({cases}));
}catch(error){console.log(JSON.stringify({failure:error.stack}));}
process.stdout.write('',()=>process.exit(0));
