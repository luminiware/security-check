import http from 'node:http';
import https from 'node:https';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createBoundedFetch } from '../bounded-fetch.mjs';
assert.notEqual(process.getuid(),0);assert.match(readFileSync('/proc/self/status','utf8'),/^CapEff:\s+0000000000000000$/mu);
assert.ok(!readFileSync('/proc/net/route','utf8').split('\n').some(line=>/^\S+\s+00000000\s/u.test(line)));
const originalFetch=globalThis.fetch.bind(globalThis),cases=[];let mode='redirect',forbidden=0,requests=0;
const compressed=gzipSync(Buffer.alloc(1024*1024,97));assert.ok(compressed.length<4096);
function serve(request,response) {
  requests++;if(request.headers.host==='other.example.net'){forbidden++;return response.end('synthetic reachable control');}
  if(mode==='timeout'){response.writeHead(200);response.write('synthetic');return;}
  if(mode==='redirect-blocked'){response.writeHead(302,{location:'http://other.example.net/'});return response.end();}
  if(mode==='redirect-loop'){response.writeHead(302,{location:request.url+'next/'});return response.end();}
  if(mode==='redirect'&&!request.socket.encrypted){response.writeHead(301,{location:'https://example.com/final'});return response.end();}
  if(mode==='compressed'){response.writeHead(200,{'content-encoding':'gzip','content-length':compressed.length});return response.end(compressed);}
  if(mode==='total'){response.writeHead(200);return response.end(Buffer.alloc(40000,97));}
  const headers={'content-security-policy':"default-src 'self'",'strict-transport-security':'max-age=86400','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  if(mode==='antibot')headers['cf-mitigated']='challenge';
  response.writeHead(mode==='error'?503:200,headers);
  if(mode==='body-antibot')return response.end(Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('_sec/verify?provider=interstitial','utf16le')]));
  response.end('synthetic bounded fixture');
}
const plain=http.createServer(serve),secure=https.createServer({key:readFileSync('/tls/key.pem'),cert:readFileSync('/tls/cert.pem')},serve);
plain.listen(80,'0.0.0.0');secure.listen(443,'0.0.0.0');await Promise.all([once(plain,'listening'),once(secure,'listening')]);
process.env.PLATFORM='NODE';process.env.WC_SERVER='true';process.env.API_ENABLED_CHECKS='headers,http-security';process.env.API_DISABLED_CHECKS='get-ip';process.env.PUBLIC_API_TIMEOUT_LIMIT='1500';
const limits={maxRedirects:2,maxResponseBytes:65536,maxTotalBytes:131072,maxRequests:8,timeoutMs:500};
const {default:headersHandler}=await import('/app/api/headers.js');const {default:securityHandler}=await import('/app/api/http-security.js');
async function collect(handler,url,custom={}) {
  const guard=createBoundedFetch({hostname:'example.com',limits:{...limits,...custom},fetcher:originalFetch});globalThis.fetch=guard.fetch;
  const scope=guard.begin();let value,apiStatus;
  await handler({url:handler===headersHandler?'/api/headers':'/api/http-security',query:{url}}, {status(code){apiStatus=code;return this;},json(result){value=result;}});
  return {value,apiStatus,http:scope.finish(),error:scope.error()};
}
try {
  let result=await collect(headersHandler,'https://example.com/');assert.equal(result.apiStatus,200);assert.equal(result.http.final_https,true);assert.equal(result.value['x-content-type-options'],'nosniff');
  cases.push('unchanged-upstream-valid-tls-headers');
  result=await collect(securityHandler,'http://example.com/');assert.equal(result.http.http_reaches_https,true);assert.equal(result.http.redirect_count,1);cases.push('observed-http-to-https-redirect');
  mode='direct';result=await collect(securityHandler,'http://example.com/');assert.equal(result.http.http_reaches_https,false);cases.push('http-without-upgrade-observed');
  mode='error';result=await collect(headersHandler,'https://example.com/');assert.equal(result.apiStatus,200);assert.equal(result.http.http_status,503);cases.push('upstream-api-200-keeps-target-503');
  for(mode of ['antibot','body-antibot']) {result=await collect(headersHandler,'https://example.com/');assert.equal(result.http.interstitial,true);}
  cases.push('header-and-utf16-interstitial-detection');
  mode='direct';assert.equal((await originalFetch('http://other.example.net/')).status,200);assert.equal(forbidden,1);forbidden=0;requests=0;
  mode='redirect-blocked';result=await collect(headersHandler,'https://example.com/');assert.equal(result.error,'HTTP_REDIRECT_BLOCKED');assert.equal(result.http,null);assert.equal(forbidden,0);assert.equal(requests,1);cases.push('cross-host-redirect-stopped-before-request');
  mode='redirect-loop';requests=0;result=await collect(headersHandler,'https://example.com/');assert.equal(result.error,'HTTP_REDIRECT_LIMIT');assert.equal(requests,3);cases.push('redirect-budget-enforced');
  mode='compressed';result=await collect(headersHandler,'https://example.com/');assert.equal(result.error,'HTTP_DECODED_BODY_LIMIT');assert.equal(result.http,null);cases.push('gzip-expansion-budget-enforced');
  mode='total';const total=createBoundedFetch({hostname:'example.com',limits:{...limits,maxTotalBytes:65536},fetcher:originalFetch});
  let scope=total.begin();await total.fetch('https://example.com/');assert.ok(scope.finish());scope=total.begin();await assert.rejects(total.fetch('https://example.com/'),/HTTP_DECODED_BODY_LIMIT/u);assert.equal(scope.finish(),null);cases.push('job-wide-decoded-body-budget');
  mode='timeout';result=await collect(headersHandler,'https://example.com/');assert.equal(result.error,'HTTP_TIMEOUT_OR_CANCELLED');assert.equal(result.http,null);cases.push('body-deadline-aborts-collection');
  console.log(JSON.stringify({schema:'isolated-http-adapter-lab-v1',synthetic:true,network_none:true,upstream_unmodified:true,fixture_ca_only:true,production_approved:false,cases,forbidden_requests:forbidden,observed_at:new Date().toISOString()}));
} finally {
  globalThis.fetch=originalFetch;plain.closeAllConnections();secure.closeAllConnections();
  await Promise.all([new Promise(done=>plain.close(done)),new Promise(done=>secure.close(done))]);
  // Upstream middleware leaves timeout timers. No fixture or process survives.
  process.exitCode=process.exitCode??0;
}
