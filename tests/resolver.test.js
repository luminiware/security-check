import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dnsQuestion,parseDnsResponse,resolutionCollector,createPublicResolver,tcpDnsExchange } from '../executor/resolver.mjs';
import { decodeQuery,response } from './dns-fixture.mjs';
const limits={maxAddresses:4,maxCnames:3,maxTtlMs:30000,timeoutMs:2000,queryTimeoutMs:500,maxBytes:4096};
const target='https://example.com/';
function answerFor(query,overrides={}) {
  const {type}=decodeQuery(query);
  return response(query,{answers:type===1?[{value:'8.8.8.8'}]:type===28?[{value:'2001:4860:4860::8888'}]:[],...overrides});
}
test('controlled DNS construction requires a public literal resolver, explicit bounds and no tenancy fallback',()=>{
  for(const server of [undefined,'dns.example.com','127.0.0.1','169.254.169.254','168.63.129.16','192.0.2.2'])assert.throws(()=>createPublicResolver({server,limits}));
  assert.throws(()=>createPublicResolver({server:'8.8.8.8',limits:{...limits,maxCnames:9}}),/DNS_LIMITS_REQUIRED/u);
  assert.throws(()=>tcpDnsExchange({server:'dns.example.com'},dnsQuestion('example.com',1).packet),/DNS_TRANSPORT_CONFIG_INVALID/u);
  assert.equal(typeof createPublicResolver({server:'8.8.8.8',limits}),'function');
});
test('DNS parser binds question/ID, expands compressed owners and rejects malformed or truncated packets',()=>{
  const question=dnsQuestion('example.com',1,42),packet=answerFor(question.packet);
  assert.deepEqual(parseDnsResponse(packet,question),[{owner:'example.com',type:1,value:'8.8.8.8',ttl:30,section:0}]);
  for(const mutate of [p=>p.writeUInt16BE(43),p=>p.writeUInt16BE(0x8380,2),p=>p.writeUInt16BE(2,4),p=>p[13]=0xff,
    p=>p.writeUInt16BE(0xffff,question.packet.length),p=>p.writeUInt16BE(65,6),p=>p.writeUInt16BE(15,question.packet.length+10)]) {
    const bad=Buffer.from(packet);mutate(bad);assert.throws(()=>parseDnsResponse(bad,question));
  }
  assert.throws(()=>parseDnsResponse(Buffer.concat([packet,Buffer.from([0])]),question));
  assert.throws(()=>parseDnsResponse(packet.subarray(0,-1),question));
  assert.throws(()=>parseDnsResponse(response(question.packet,{rcode:3}),question),/DNS_NAME_NOT_FOUND/u);
});
test('DNS follows a bounded CNAME chain, collects both families and caps reservation by the smallest TTL',async()=>{
  const queries=[],start=Date.now();
  const resolver=resolutionCollector(async packet=>{
    const q=decodeQuery(packet);queries.push(q);
    if(q.name==='example.com'&&q.type===5)return response(packet,{answers:[{type:5,value:'edge.example.net',ttl:3}]});
    assert.equal(q.name,'edge.example.net');return answerFor(packet);
  },limits);
  const result=await resolver(target);
  assert.deepEqual(queries.map(q=>[q.name,q.type]),[['example.com',5],['edge.example.net',5],['edge.example.net',1],['edge.example.net',28]]);
  assert.equal(result.hostname,'example.com');assert.deepEqual(result.addresses,['8.8.8.8','2001:4860:4860:0:0:0:0:8888']);
  assert.ok(result.expires_at<=Date.now()+3000&&result.expires_at>=start+2900);assert.ok(Object.isFrozen(result.addresses));
});
test('DNS rejects mixed/private answers, poisoned additional records, changed aliases and either-family errors',async()=>{
  for(const options of [
    q=>q.type===1?{answers:[{value:'8.8.8.8'},{value:'10.0.0.1'}]}:{},
    q=>q.type===1?{additional:[{type:1,owner:'ns.example.net',value:'169.254.169.254'}]}:{},
    q=>q.type===28?{answers:[{type:5,value:'changed.example.net'}]}:{},
    q=>q.type===28?{rcode:2}:{},
    q=>q.type===1?{answers:[{owner:'unrelated.example.net',value:'8.8.8.8'}]}:{},
    q=>q.type===28?{answers:[{value:'::ffff:8.8.8.8'}]}:{},
  ])await assert.rejects(resolutionCollector(async packet=>answerFor(packet,options(decodeQuery(packet))),limits)(target));
});
test('DNS does not reserve empty, expired, excessive or looping resolutions',async()=>{
  const exchanges=[
    async packet=>response(packet),
    async packet=>answerFor(packet,{answers:decodeQuery(packet).type===1?[{value:'8.8.8.8',ttl:0}]:[]}),
    async packet=>answerFor(packet,{answers:decodeQuery(packet).type===1?Array.from({length:5},(_,i)=>({value:'8.8.8.'+(i+1)})):[]}),
    async packet=>response(packet,{answers:[{type:5,value:'example.com'}]}),
    async packet=>response(packet,{answers:[{type:5,value:'edge.example.net'},{type:5,value:'other.example.net'}]}),
    async packet=>response(packet,{answers:[{type:5,value:'localhost'}]}),
  ];
  for(const exchange of exchanges)await assert.rejects(resolutionCollector(exchange,limits)(target));
  const controller=new AbortController();controller.abort();let queried=false;
  await assert.rejects(resolutionCollector(async()=>{queried=true;},limits)(target,controller.signal));assert.equal(queried,false);
});
