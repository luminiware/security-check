import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectQuick} from '../src/quick-check.js';
import {makeQuickReport} from '../src/report.js';
import {QUICK_VERSIONS} from '../src/contracts.js';

const target='https://example.com/';
const dns=(answers)=>Response.json({Status:0,Answer:answers});
function fetcherFor({a=['93.184.215.14'],aaaa=[],headers={},httpsStatus=200,httpRedirect=true}={}){
  const calls=[];
  async function fetcher(url,init){
    const u=new URL(url);calls.push(u.href);
    if(u.hostname==='cloudflare-dns.com'){
      const type=u.searchParams.get('type');
      return dns((type==='A'?a:aaaa).map(data=>({type:type==='A'?1:28,data})));
    }
    assert.equal(init.redirect,'manual');
    if(u.protocol==='http:'&&httpRedirect)return new Response(null,{status:301,headers:{location:'https://example.com/'}});
    return new Response(null,{status:u.protocol==='https:'?httpsStatus:200,headers});
  }
  return {fetcher,calls};
}
test('quick check reads metadata only, never invents a certificate inspection',async()=>{
  const mock=fetcherFor({headers:{'strict-transport-security':'max-age=123','x-content-type-options':'nosniff'}});
  const checks=await collectQuick(target,{fetcher:mock.fetcher});
  assert.deepEqual(checks.map(c=>c.id),['headers','http-security','ssl','dns']);
  assert.equal(checks[2].collection,'não_executado');
  const report=makeQuickReport(checks,target,new Date().toISOString(),QUICK_VERSIONS);
  assert.ok(report.score!==null);
  assert.equal(report.versions.engine,'worker-quick');
  assert.match(report.disclaimer,/TLS detalhado/u);
  assert.ok(report.limitations.some(l=>l.id==='ESCOPO-TLS'));
  assert.equal(mock.calls.filter(url=>url.startsWith('https://example.com/')).length,2);
});
test('DNS private or mixed answer blocks every HTTP request, including IPv6',async()=>{
  for(const value of ['127.0.0.1','10.0.0.4','192.0.2.1','169.254.169.254','::1','fc00::1','2001:db8::1']){
    const mock=fetcherFor(value.includes(':')?{aaaa:[value]}:{a:['93.184.215.14',value]});
    const checks=await collectQuick(target,{fetcher:mock.fetcher});
    assert.equal(checks.find(c=>c.id==='headers').collection,'erro');
    assert.equal(checks.find(c=>c.id==='dns').collection,'erro');
    assert.ok(mock.calls.every(url=>url.includes('cloudflare-dns.com')),value);
  }
});
test('same-hostname redirects only; cross-host response cannot produce confirmed header score',async()=>{
  const mock=fetcherFor();
  const fetcher=async(url,init)=>{
    if(url.includes('dns-query'))return mock.fetcher(url,init);
    return new Response(null,{status:302,headers:{location:'http://localhost/admin'}});
  };
  const checks=await collectQuick(target,{fetcher});
  assert.equal(checks[0].collection,'erro');
  assert.equal(checks[1].collection,'erro');
  assert.equal(makeQuickReport(checks,target,new Date().toISOString(),QUICK_VERSIONS).score,null);
});
test('HTTP without upgrade is an observation requiring attention, not an HTTPS pass',async()=>{
  const mock=fetcherFor({httpRedirect:false});
  const checks=await collectQuick(target,{fetcher:mock.fetcher});
  assert.equal(checks[1].evidence.http_reaches_https,false);
  const report=makeQuickReport(checks,target,new Date().toISOString(),QUICK_VERSIONS);
  assert.ok(report.priorities.some(x=>x.id==='HTTPS-TRANSPORT'));
});
test('DNS timeout causes no target request and no score',async()=>{
  const mock=fetcherFor();
  const fetcher=async(url,init)=>{if(url.includes('dns-query'))throw Error('unavailable');return mock.fetcher(url,init)};
  const checks=await collectQuick(target,{fetcher});
  assert.equal(makeQuickReport(checks,target,new Date().toISOString(),QUICK_VERSIONS).score,null);
  assert.equal(mock.calls.length,0);
});

test('a valid IPv4-only site with no AAAA Answer remains scannable',async()=>{
  const calls=[];
  const fetcher=async (url,init)=>{
    calls.push(url);
    if(url.includes('dns-query')){
      const type=new URL(url).searchParams.get('type');
      return type==='AAAA' ? Response.json({Status:0}) : dns([{type:1,data:'93.184.215.14'}]);
    }
    if(url.startsWith('http://'))return new Response(null,{status:301,headers:{location:'https://example.com/'}});
    return new Response(null,{status:200,headers:{'x-content-type-options':'nosniff'}});
  };
  const checks=await collectQuick(target,{fetcher});
  assert.equal(checks.find(c=>c.id==='dns').collection,'ok');
  assert.ok(calls.some(u=>u.startsWith('https://example.com/')));
});
