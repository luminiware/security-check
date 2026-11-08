import net from 'node:net';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tcpDnsExchange,resolutionCollector } from '../../executor/resolver.mjs';
import { decodeQuery,response } from '../dns-fixture.mjs';
assert.notEqual(process.getuid(),0);
assert.match(readFileSync('/proc/self/status','utf8'),/^CapEff:\s+0000000000000000$/mu);
assert.ok(!readFileSync('/proc/net/route','utf8').split('\n').slice(1).some(line=>line.trim().split(/\s+/u)[1]==='00000000'));
let mode='normal',queries=0;const sockets=new Set();
const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let pending=Buffer.alloc(0);
  socket.on('data',async chunk=>{
    pending=Buffer.concat([pending,chunk]);if(pending.length<2||pending.length!==pending.readUInt16BE()+2)return;
    queries++;const query=pending.subarray(2),q=decodeQuery(query);
    if(mode==='silent')return;
    if(mode==='close')return socket.end();
    if(mode==='oversized'){const prefix=Buffer.alloc(2);prefix.writeUInt16BE(4097);return socket.end(prefix);}
    let answers=q.type===1?[{value:'8.8.8.8'}]:q.type===28?[{value:'2001:4860:4860::8888'}]:[];
    if(q.type===5&&q.name==='example.com')answers=[{type:5,value:'edge.example.net',ttl:2}];
    if(mode==='mixed'&&q.type===1)answers.push({value:'169.254.169.254'});
    const packet=response(query,{answers});if(mode==='wrong-id')packet.writeUInt16BE(q.id^0xffff);
    const prefix=Buffer.alloc(2);prefix.writeUInt16BE(packet.length);
    // Exercise partial prefixes and payloads rather than assuming TCP chunks.
    socket.write(prefix.subarray(0,1));await delay(5);if(socket.destroyed)return;
    socket.write(Buffer.concat([prefix.subarray(1),packet.subarray(0,7)]));await delay(5);if(!socket.destroyed)socket.end(packet.subarray(7));
  });
});
server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
const limits={maxAddresses:4,maxCnames:3,maxTtlMs:30000,timeoutMs:2000,queryTimeoutMs:500,maxBytes:4096};
const exchange=(packet,signal)=>tcpDnsExchange({server:'127.0.0.1',port,timeoutMs:500},packet,signal);
const resolve=resolutionCollector(exchange,limits),cases=[];
try {
  const start=Date.now(),reservation=await resolve('https://example.com/');
  assert.equal(reservation.hostname,'example.com');assert.equal(reservation.addresses.length,2);assert.equal(queries,4);
  assert.ok(reservation.expires_at<=Date.now()+2000&&reservation.expires_at>=start+1900);cases.push('tcp-framing-fragmented','bounded-cname-and-dual-family','smallest-chain-ttl');
  mode='mixed';await assert.rejects(resolve('https://example.com/'),/DESTINATION_BLOCKED/u);cases.push('mixed-metadata-answer-rejected');
  mode='wrong-id';await assert.rejects(resolve('https://example.com/'),/DNS_PACKET_INVALID/u);cases.push('mismatched-response-rejected');
  mode='oversized';await assert.rejects(resolve('https://example.com/'),/DNS_PACKET_LIMIT/u);cases.push('oversized-frame-rejected');
  mode='close';await assert.rejects(resolve('https://example.com/'),/DNS_PACKET_INVALID/u);cases.push('partial-stream-rejected');
  mode='silent';await assert.rejects(resolve('https://example.com/'),/DNS_TIMEOUT/u);cases.push('silent-resolver-deadline');
  const controller=new AbortController(),pending=resolve('https://example.com/',controller.signal);setTimeout(()=>controller.abort(),30);
  await assert.rejects(pending,/DNS_CANCELLED/u);cases.push('cancellation-closes-stream');
  console.log(JSON.stringify({schema:'isolated-resolver-lab-v1',synthetic:true,network_none:true,production_approved:false,cases,observed_at:new Date().toISOString()}));
} finally {for(const socket of sockets)socket.destroy();await new Promise(done=>server.close(done));}
