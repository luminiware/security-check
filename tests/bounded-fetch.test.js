import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedFetch } from '../executor/bounded-fetch.mjs';
const limits={maxRedirects:2,maxResponseBytes:4096,maxTotalBytes:8192,maxRequests:8,timeoutMs:500};
function guard(fetcher,custom={}){return createBoundedFetch({hostname:'example.com',limits:{...limits,...custom},fetcher});}
test('HTTP adapter follows bounded same-host redirects and binds metadata to the completed response',async()=>{
  const calls=[];const bounded=guard(async(url,init)=>{
    calls.push({url,init});return calls.length===1?new Response(null,{status:301,headers:{location:'https://example.com/final'}}):new Response('synthetic',{headers:{'content-encoding':'gzip','content-length':'2'}});
  });const scope=bounded.begin();const result=await bounded.fetch('http://example.com/');
  assert.equal(await result.text(),'synthetic');assert.equal(result.url,'https://example.com/final');assert.equal(result.headers.has('content-encoding'),false);
  assert.ok(calls.every(call=>call.init.redirect==='manual'&&call.init.credentials==='omit'));
  assert.deepEqual(scope.finish(),{http_status:200,interstitial:false,final_https:true,redirect_count:1,http_reaches_https:true});
});
test('HTTP adapter rejects forbidden destinations, credentials, extra ports, downgrade, loops and excess redirects before following',async()=>{
  for(const destination of ['http://169.254.169.254/','https://other.example.com/','https://user:pass@example.com/','https://example.com:8080/','file:///etc/passwd','http://example.com/']) {
    let calls=0;const bounded=guard(async()=>{calls++;return new Response(null,{status:302,headers:{location:destination}});});
    const scope=bounded.begin();await assert.rejects(bounded.fetch('https://example.com/'));assert.equal(calls,1);assert.equal(scope.finish(),null);
  }
  const bounded=guard(async url=>new Response(null,{status:302,headers:{location:url+'next/'}}));const scope=bounded.begin();
  await assert.rejects(bounded.fetch('https://example.com/'),/HTTP_REDIRECT_LIMIT/u);assert.equal(scope.finish(),null);
});
test('HTTP adapter rejects unscoped calls, sensitive headers and oversized decoded streams; errors never produce metadata',async()=>{
  const bounded=guard(async()=>new Response(new Uint8Array(4097)));
  await assert.rejects(bounded.fetch('https://example.com/'),/HTTP_CALL_NOT_SCOPED/u);
  let scope=bounded.begin();await assert.rejects(bounded.fetch('https://example.com/',{headers:{authorization:'synthetic'}}),/HTTP_HEADER_BLOCKED/u);assert.equal(scope.finish(),null);
  scope=bounded.begin();await assert.rejects(bounded.fetch('https://example.com/'),/HTTP_DECODED_BODY_LIMIT/u);assert.equal(scope.finish(),null);
});
test('HTTP metadata preserves error status and interstitial signals including UTF-16 body and closes old scopes',async()=>{
  const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('_sec/verify?provider=interstitial','utf16le')]);
  for(const response of [()=>new Response('synthetic',{status:503}),()=>new Response(utf16),()=>new Response('synthetic',{headers:{'cf-mitigated':'challenge'}})]) {
    const bounded=guard(async()=>response()),scope=bounded.begin();await bounded.fetch('https://example.com/');
    const observed=scope.finish();assert.ok(observed.http_status===503||observed.interstitial===true);assert.equal(observed.http_reaches_https,null);assert.equal(scope.finish(),null);
  }
});
