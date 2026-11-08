import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveIpv6Link,hasIpv6DefaultRoute,ipv6NeighborRules } from '../executor/guardian/ipv6.mjs';
import { firewallRules,isolatedFixtureFirewallRules } from '../executor/guardian/firewall.mjs';
const own='2001:db8:5c::3',peer='2001:db8:5c::2';
const ownHex='20010db8005c00000000000000000003';
const defaults='00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200 lo\n';
function route(destination,prefix,gateway='00000000000000000000000000000000',metric='00000100',flags='00000001'){return `${destination} ${prefix} 00000000000000000000000000000000 00 ${gateway} ${metric} 00000001 00000000 ${flags} eth0\n`;}
function topology(){return {interfaces:{eth0:[{address:own,family:'IPv6',internal:false,cidr:own+'/64'}]},routeText:defaults+route('20010db8005c00000000000000000000','40'),addressText:ownHex+' 02 40 00 82 eth0\n'};}
const expected={interface:'eth0',local_addresses:[own],on_link_peers:[peer],next_hop:null};
test('IPv6 topology reserves only ready addresses, direct peers or a single active kernel gateway',()=>{
  assert.deepEqual(deriveIpv6Link([peer],topology()),expected);assert.equal(hasIpv6DefaultRoute(defaults),false);
  const active='00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000100 00000001 00000000 00000003 eth0\n';
  assert.equal(hasIpv6DefaultRoute(active),true);
  const t=topology();t.routeText+=active;t.interfaces.eth0.push({address:'fe80::2',family:'IPv6',internal:false,cidr:'fe80::2/64'});t.addressText+='fe800000000000000000000000000002 02 40 20 80 eth0\n';
  const link=deriveIpv6Link(['2001:db8:ffff::2'],t);assert.equal(link.next_hop,'fe80::1');assert.deepEqual(link.on_link_peers,[]);
  const missing=topology();assert.throws(()=>deriveIpv6Link(['2001:db8:ffff::2'],missing),/IPV6_ROUTE_NOT_RESERVED/u);
  missing.addressText=missing.addressText.replace('82 eth0','c0 eth0');assert.throws(()=>deriveIpv6Link([peer],missing),/IPV6_LINK_NOT_READY/u);
  const ambiguous=topology();ambiguous.interfaces.eth1=ambiguous.interfaces.eth0;assert.throws(()=>deriveIpv6Link([peer],ambiguous),/IPV6_LINK_NOT_RESERVED/u);
});
test('IPv6 routes prefer the longest prefix then metric and refuse ambiguous, rejected or source-specific routes',()=>{
  const t=topology(),gateway='20010db8005c000000000000000000fe',other='20010db8005c000000000000000000fd';
  t.routeText+=route('20010db8ffff00000000000000000000','40',gateway);
  assert.deepEqual(deriveIpv6Link(['2001:db8:ffff::2'],t),{...expected,on_link_peers:[],next_hop:'2001:db8:5c::fe'});
  t.routeText+=route('20010db8ffff00000000000000000000','40',other,'00000200');
  assert.equal(deriveIpv6Link(['2001:db8:ffff::2'],t).next_hop,'2001:db8:5c::fe');
  t.routeText+=route('20010db8005c00000000000000000002','80',gateway);
  assert.deepEqual(deriveIpv6Link([peer],t).on_link_peers,[]);
  const ambiguous=structuredClone(t);ambiguous.routeText+=route('20010db8ffff00000000000000000000','40',other);assert.throws(()=>deriveIpv6Link(['2001:db8:ffff::2'],ambiguous),/IPV6_ROUTE_NOT_RESERVED/u);
  const rejected=topology();rejected.routeText+=route('20010db8005c00000000000000000002','80',gateway,'00000100','00000201');assert.throws(()=>deriveIpv6Link([peer],rejected),/IPV6_ROUTE_NOT_RESERVED/u);
  const source=topology();source.routeText+=route('20010db8005c00000000000000000002','80',gateway).replace('00000000000000000000000000000000 00','20010db8005c00000000000000000000 40');assert.throws(()=>deriveIpv6Link([peer],source),/IPV6_ROUTE_NOT_RESERVED/u);
  const malformed=topology();malformed.routeText+='invalid';assert.throws(()=>deriveIpv6Link([peer],malformed),/INVALID_IPV6_TOPOLOGY/u);
  const missing=topology();missing.routeText=defaults;assert.throws(()=>deriveIpv6Link([peer],missing),/IPV6_ROUTE_NOT_RESERVED/u);
  const wrongInterface=structuredClone(t);wrongInterface.routeText=wrongInterface.routeText.replace(gateway+' 00000100 00000001 00000000 00000001 eth0',gateway+' 00000100 00000001 00000000 00000001 eth1');assert.throws(()=>deriveIpv6Link(['2001:db8:ffff::2'],wrongInterface),/IPV6_ROUTE_NOT_RESERVED/u);
  const multiple=topology();multiple.routeText+=route('20010db8ffff00000000000000000000','40',gateway)+route('20010db8eeee00000000000000000000','40',other);assert.throws(()=>deriveIpv6Link(['2001:db8:ffff::2','2001:db8:eeee::2'],multiple),/IPV6_LINK_NOT_RESERVED/u);
});
test('NDP controls are exact, expiring, budgeted and never grant a TCP/UDP service exception to the gateway',()=>{
  const ndp=ipv6NeighborRules({...expected,on_link_peers:[],next_hop:'fe80::1'},[peer],10000);
  assert.match(ndp.declarations,/fe80::1 timeout 10000ms/u);assert.match(ndp.input,/hoplimit 255/u);assert.match(ndp.input,/@th,64,128/u);
  assert.match(ndp.output,/ff02::1:ff00:1/u);assert.match(ndp.output,/quota name "out_bytes"/u);assert.doesNotMatch(ndp.input+ndp.output,/tcp|udp|icmpv6 type \{/u);
  for(const bad of [{...expected,interface:'eth0; accept'},{...expected,interface:undefined},{...expected,on_link_peers:['2001:db8::999']},
    {...expected,next_hop:'::1'},{...expected,local_addresses:['::ffff:192.0.2.1']}])assert.throws(()=>ipv6NeighborRules(bad,[peer],10000));
});
test('IPv6 documentation addresses remain excluded from public policy and require explicit laboratory link context',()=>{
  const policy={addresses:[peer],expires_at:Date.now()+60000,ingressBytes:65536,egressBytes:65536,maxPacketBytes:4096};
  assert.throws(()=>firewallRules(policy,Date.now(),expected),/DESTINATION_BLOCKED/u);
  assert.throws(()=>isolatedFixtureFirewallRules(policy),/INVALID_IPV6_LINK/u);
  assert.match(isolatedFixtureFirewallRules(policy,Date.now(),expected),/ipv6_peers/u);
  assert.throws(()=>isolatedFixtureFirewallRules({...policy,addresses:['fd00::2']},Date.now(),expected),/DOCUMENTATION_FIXTURE_REQUIRED/u);
});
