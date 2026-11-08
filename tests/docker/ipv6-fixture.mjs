import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import { readFileSync } from 'node:fs';
const counts={normal:0,forbidden_port:0,tls:0,udp_bytes:0};
const udp=dgram.createSocket('udp6');udp.on('message',message=>{counts.udp_bytes+=message.byteLength;});udp.bind(9090,'::');
function respond(request,response) {
  if(request.url==='/counts')return response.end(JSON.stringify(counts));
  if(request.url==='/reset'){for(const key of Object.keys(counts))counts[key]=0;return response.end('reset');}
  counts.normal++;
  if(request.url==='/large')return response.end(Buffer.alloc(512*1024,97));
  response.writeHead(200,{'x-content-type-options':'nosniff','content-security-policy':"default-src 'self'"});response.end('synthetic IPv6 fixture');
}
http.createServer(respond).listen(80,'::');
http.createServer((_request,response)=>{counts.forbidden_port++;response.end('synthetic forbidden port');}).listen(8080,'::');
https.createServer({key:readFileSync('/tls/key.pem'),cert:readFileSync('/tls/cert.pem')},(request,response)=>{counts.tls++;respond(request,response);}).listen(443,'::');
console.log('FIXTURE_READY');
