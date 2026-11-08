import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
const counts = { normal: 0, forbidden_port: 0, tls: 0 };
function respond(request, response) {
  if (request.url === '/counts') { response.setHeader('content-type','application/json'); return response.end(JSON.stringify(counts)); }
  if (request.url === '/reset') { for (const key of Object.keys(counts)) counts[key]=0; return response.end('reset'); }
  counts.normal++;
  if (request.url === '/redirect-blocked') { response.writeHead(302,{ location: 'http://' + process.env.BLOCKED_FIXTURE + '/' }); return response.end(); }
  if (request.url === '/large') { response.writeHead(200); return response.end(Buffer.alloc(512 * 1024,97)); }
  response.writeHead(200,{ 'x-content-type-options':'nosniff','content-security-policy':"default-src 'self'" }); response.end('synthetic isolated fixture');
}
http.createServer(respond).listen(80,'0.0.0.0');
http.createServer((_request,response) => { counts.forbidden_port++; response.end('forbidden'); }).listen(8080,'0.0.0.0');
if (process.env.TLS_FIXTURE === 'true') https.createServer({ key:readFileSync('/tls/key.pem'),cert:readFileSync('/tls/cert.pem') }, (request,response) => {
  counts.tls++; respond(request,response);
}).listen(443,'0.0.0.0');
console.log('FIXTURE_READY');
