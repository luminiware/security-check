import ipaddr from 'ipaddr.js';
// Conservative candidate: deny every IANA special-purpose block, including
// globally-reachable special services. This is intentionally stricter than a
// generic Internet router. Registry snapshots consulted 2026-11-07.
export const ADDRESS_POLICY_SOURCES = [
  'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xml',
  'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xml',
  'https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16',
];
export const SPECIAL_ADDRESS_RANGES = Object.freeze([
  '0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12',
  '192.0.0.0/24','192.0.2.0/24','192.31.196.0/24','192.52.193.0/24','192.88.99.0/24','192.168.0.0/16',
  '192.175.48.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4',
  '::/128','::1/128','::ffff:0:0/96','64:ff9b::/96','64:ff9b:1::/48','100::/64','100:0:0:1::/64',
  '2001::/23','2001:db8::/32','2002::/16','2620:4f:8000::/48','3fff::/20','5f00::/16','fc00::/7','fe80::/10',
]);
export const PROVIDER_CONTROL_RANGES = Object.freeze(['168.63.129.16/32']);
const deny = [...SPECIAL_ADDRESS_RANGES,...PROVIDER_CONTROL_RANGES].map(cidr => ipaddr.parseCIDR(cidr));
export function publicAddress(value) {
  if (typeof value !== 'string' || value.length > 45 || value.includes('%') || value.includes('[') || value.trim() !== value) throw new Error('DESTINATION_BLOCKED');
  let address;
  try { address = ipaddr.parse(value); } catch { throw new Error('DESTINATION_BLOCKED'); }
  if (address.kind() === 'ipv4') {
    // Reject octal/hex/short encodings even if the parser recognizes them.
    if (address.toString() !== value) throw new Error('DESTINATION_BLOCKED');
  } else if (!address.match(ipaddr.parseCIDR('2000::/3'))) throw new Error('DESTINATION_BLOCKED');
  if (deny.some(([network, bits]) => address.kind() === network.kind() && address.match(network, bits))) throw new Error('DESTINATION_BLOCKED');
  return address.toNormalizedString();
}
export function publicResolution({ hostname, addresses, cnames, resolved_at, ttl_ms }, limits, now = Date.now()) {
  if (!limits || !Number.isInteger(limits.maxAddresses) || limits.maxAddresses < 1 || !Number.isInteger(limits.maxCnames) || limits.maxCnames < 0 || !Number.isInteger(limits.maxTtlMs) || limits.maxTtlMs < 1) throw new Error('NETWORK_LIMITS_REQUIRED');
  if (typeof hostname !== 'string' || !Array.isArray(addresses) || !addresses.length || addresses.length > limits.maxAddresses ||
      !Array.isArray(cnames) || cnames.length > limits.maxCnames || cnames.some(c => typeof c !== 'string' || !/^[a-z0-9.-]{1,253}$/u.test(c)) ||
      new Set([hostname, ...cnames]).size !== cnames.length + 1 || !Number.isInteger(resolved_at) || resolved_at > now ||
      !Number.isInteger(ttl_ms) || ttl_ms < 1 || now >= resolved_at + Math.min(ttl_ms, limits.maxTtlMs)) throw new Error('INVALID_RESOLUTION');
  // Reject the entire answer if even one address is forbidden, not only the
  // address eventually selected. A later DNS answer needs a fresh reservation.
  const permitted = [...new Set(addresses.map(publicAddress))];
  return Object.freeze({ hostname, addresses: Object.freeze(permitted), expires_at: resolved_at + Math.min(ttl_ms, limits.maxTtlMs) });
}
export function verifyPeer(reservation, peerAddress, port, expectedHostname, now = Date.now()) {
  if (!reservation || reservation.expires_at <= now || reservation.hostname !== expectedHostname || ![80,443].includes(port) ||
      !reservation.addresses.includes(publicAddress(peerAddress))) throw new Error('PEER_NOT_RESERVED');
  return true;
}
