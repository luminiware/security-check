import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firewallRules, isolatedFixtureFirewallRules } from '../executor/guardian/firewall.mjs';
import { dnsResponder } from '../executor/guardian/dns.mjs';
const policy = () => ({ hostname: 'example.com', addresses: ['8.8.8.8'], expires_at: Date.now() + 60000, maxDnsRequests: 5, ingressBytes: 65536, egressBytes: 65536, maxPacketBytes: 4096 });
function query(host, type = 1) {
  const header = Buffer.alloc(12); header.writeUInt16BE(17); header.writeUInt16BE(0x100,2); header.writeUInt16BE(1,4);
  const name = Buffer.concat([...host.split('.').flatMap(s => [Buffer.from([s.length]),Buffer.from(s)]),Buffer.from([0])]);
  const suffix = Buffer.alloc(4); suffix.writeUInt16BE(type); suffix.writeUInt16BE(1,2); return Buffer.concat([header,name,suffix]);
}
test('firewall is default-deny, exact-peer, expiring and budgeted; input cannot inject nft syntax', () => {
  const rules = firewallRules(policy()); assert.match(rules, /policy drop/u); assert.match(rules, /timeout 60000ms/u);
  assert.match(rules, /until 61440 bytes/u); assert.match(rules, /meta length > 4096/u);
  assert.throws(() => firewallRules({ ...policy(), addresses: ['8.8.8.8; accept'] }));
  assert.throws(() => firewallRules({ ...policy(), expires_at: Date.now() - 1 }));
  assert.throws(() => firewallRules({ ...policy(), ingressBytes: 4096 }));
  assert.throws(() => firewallRules({ ...policy(), addresses:['192.0.2.2'] }));
  assert.match(rules, /@ipv4_denied/u); assert.match(rules, /@ipv6_denied/u);
  assert.match(isolatedFixtureFirewallRules({ ...policy(), addresses:['192.0.2.2'] }), /192\.0\.2\.2/u);
  assert.throws(() => isolatedFixtureFirewallRules({ ...policy(), addresses:['169.254.169.254'] }));
});
test('DNS answers only the pinned hostname, never forwards and enforces expiry/request budget', () => {
  const p = policy(); let now = Date.now(); const reply = dnsResponder(p, () => now);
  const answer = reply(query('example.com')); assert.equal(answer.readUInt16BE(6),1); assert.equal(answer.readUInt16BE(0),17);
  assert.equal(reply(query('other.example.com')).readUInt16BE(2) & 15,3);
  assert.equal(reply(query('example.com',28)).readUInt16BE(6),0);
  assert.equal(reply(Buffer.alloc(512)),null);
  now = p.expires_at; assert.equal(reply(query('example.com')).readUInt16BE(2) & 15,2);
  now--; reply(query('example.com')); assert.equal(reply(query('example.com')).readUInt16BE(2) & 15,2);
});
