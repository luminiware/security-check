import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, publicResolution, verifyPeer } from '../executor/address-policy.mjs';
import { quotaDomains } from '../src/domains.js';
// No sockets/DNS calls are made by this suite, including private-address cases.
test('address classifier rejects special, local, tunnel, mapped and ambiguous addresses', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','100.100.100.200','169.254.169.254','168.63.129.16','0.0.0.0','224.0.0.1','240.0.0.1',
    '192.0.2.1','198.51.100.1','203.0.113.1','198.18.0.1','127.1','2130706433','0x7f000001','0177.0.0.1',
    '::','::1','::ffff:8.8.8.8','fc00::1','fe80::1','fe80::1%eth0','2001:db8::1','2002:0808:0808::1','64:ff9b::808:808','3fff::1','4000::1']) {
    assert.throws(() => publicAddress(address), /DESTINATION_BLOCKED/u, address);
  }
  assert.equal(publicAddress('8.8.8.8'), '8.8.8.8');
  assert.equal(publicAddress('2606:4700:4700::1111'), '2606:4700:4700:0:0:0:0:1111');
});
test('mixed DNS, CNAME loop, TTL expiry and changed connected peer reject the whole step', () => {
  const now = Date.now(); const limits = { maxAddresses: 4, maxCnames: 2, maxTtlMs: 1000 };
  const answer = { hostname: 'example.com', addresses: ['8.8.8.8'], cnames: [], resolved_at: now, ttl_ms: 1000 };
  const reservation = publicResolution(answer, limits, now);
  assert.equal(verifyPeer(reservation, '8.8.8.8', 443, 'example.com', now), true);
  assert.throws(() => publicResolution({ ...answer, addresses: ['8.8.8.8','127.0.0.1'] }, limits, now));
  assert.throws(() => publicResolution({ ...answer, cnames: ['example.com'] }, limits, now));
  assert.throws(() => publicResolution(answer, limits, now + 1000));
  assert.throws(() => verifyPeer(reservation, '1.1.1.1', 443, 'example.com', now));
  assert.throws(() => verifyPeer(reservation, '8.8.8.8', 8080, 'example.com', now));
  assert.throws(() => verifyPeer(reservation, '8.8.8.8', 443, 'example.org', now));
  assert.throws(() => verifyPeer(reservation, '8.8.8.8', 443, 'example.com', now + 1000));
});
test('quota groups subdomains by PSL while respecting private suffix tenancy', () => {
  assert.deepEqual(quotaDomains('https://www.example.com/'), { hostname: 'www.example.com', registrable: 'example.com' });
  assert.equal(quotaDomains('https://a.example.co.uk/').registrable, 'example.co.uk');
  assert.equal(quotaDomains('https://a.example.github.io/').registrable, 'example.github.io');
  assert.throws(() => quotaDomains('https://example.invalid/'), { code: 'INVALID_TARGET' });
});
