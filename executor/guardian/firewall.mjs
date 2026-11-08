import ipaddr from 'ipaddr.js';
import { publicAddress, SPECIAL_ADDRESS_RANGES, PROVIDER_CONTROL_RANGES } from '../address-policy.mjs';
import { ipv6NeighborRules } from './ipv6.mjs';

// This layer enforces exact addresses selected by the trusted supervisor.
// Repeats address validation here and also emits kernel deny sets, so omitting
// the supervisor's earlier publicResolution cannot open a private destination.
export function firewallRules(policy, now = Date.now(), link = null) {
  return build(policy, now, false,link);
}
// Only RFC 5737 / RFC 3849 documentation fixtures are supported by this path.
// Caller MUST additionally prove the Docker network is internal and controlled.
export function isolatedFixtureFirewallRules(policy, now = Date.now(), link = null) {
  return build(policy, now, true,link);
}
function build(policy, now, isolatedFixture,link) {
  if (!policy || !Array.isArray(policy.addresses) || !policy.addresses.length || policy.addresses.length > 32 ||
      !Number.isInteger(policy.expires_at) || policy.expires_at <= now || policy.expires_at - now > 120000) throw new Error('INVALID_NETWORK_RESERVATION');
  const { ingressBytes, egressBytes, maxPacketBytes } = policy;
  if (![ingressBytes,egressBytes,maxPacketBytes].every(Number.isSafeInteger) || maxPacketBytes < 1500 || maxPacketBytes > 16384 ||
      ingressBytes < 2 * maxPacketBytes || egressBytes < 2 * maxPacketBytes || ingressBytes > 16777216 || egressBytes > 16777216) throw new Error('INVALID_NETWORK_BUDGET');
  const families = { ipv4: [], ipv6: [] };
  for (const value of policy.addresses) {
    if (typeof value !== 'string' || value.includes('%') || value.includes('[') || value.trim() !== value) throw new Error('INVALID_FIREWALL_ADDRESS');
    let address; try { address = ipaddr.parse(value); } catch { throw new Error('INVALID_FIREWALL_ADDRESS'); }
    if (address.kind() === 'ipv4' && address.toString() !== value) throw new Error('INVALID_FIREWALL_ADDRESS');
    if (isolatedFixture) {
      if (!address.match(ipaddr.parseCIDR(address.kind()==='ipv4'?'192.0.2.0/24':'2001:db8::/32'))) throw new Error('DOCUMENTATION_FIXTURE_REQUIRED');
    } else publicAddress(value);
    families[address.kind()].push(address.toString());
  }
  const ttl = policy.expires_at - now;
  const ndp=families.ipv6.length?ipv6NeighborRules(link,families.ipv6,ttl):null;
  const declarations = Object.entries(families).filter(([,v]) => v.length).map(([family, values]) =>
    `set ${family}_peers { type ${family === 'ipv4' ? 'ipv4_addr' : 'ipv6_addr'}; flags timeout; elements = { ${[...new Set(values)].map(v => `${v} timeout ${ttl}ms`).join(', ')} }; }`).join('\n');
  const allowed = direction => Object.entries(families).filter(([,v]) => v.length).map(([family]) => {
    const ip = family === 'ipv4' ? 'ip' : 'ip6';
    const remote = direction === 'out' ? 'daddr' : 'saddr'; const port = direction === 'out' ? 'dport' : 'sport';
    const local=family==='ipv6'?`ip6 ${direction==='in'?'daddr':'saddr'} @ipv6_link_local `:'';
    return `${ip} ${remote} @${family}_peers ${local}tcp ${port} { 80, 443 } ${direction === 'in' ? 'ct state established ' : ''}quota name "${direction}_bytes" counter name "${direction}_accepted" accept`;
  }).join('\n');
  const denySets = isolatedFixture ? '' : ['ipv4','ipv6'].map(family => {
    const ranges = [...SPECIAL_ADDRESS_RANGES,...PROVIDER_CONTROL_RANGES].filter(c => c.includes(':') === (family === 'ipv6'));
    return `set ${family}_denied { type ${family === 'ipv4' ? 'ipv4_addr' : 'ipv6_addr'}; flags interval; auto-merge; elements = { ${ranges.join(', ')} }; }`;
  }).join('\n');
  const denyRules = direction => isolatedFixture ? '' : `ip ${direction === 'in' ? 'saddr' : 'daddr'} @ipv4_denied counter name "${direction}_blocked" drop
ip6 ${direction === 'in' ? 'saddr' : 'daddr'} @ipv6_denied counter name "${direction}_blocked" drop
ip6 ${direction === 'in' ? 'saddr' : 'daddr'} != 2000::/3 counter name "${direction}_blocked" drop`;
  return `table inet security_check {
${declarations}
${ndp?.declarations??''}
${denySets}
quota in_bytes { until ${ingressBytes - maxPacketBytes} bytes }
quota out_bytes { until ${egressBytes - maxPacketBytes} bytes }
counter in_accepted { }
counter out_accepted { }
counter in_blocked { }
counter out_blocked { }
${ndp?`counter in_fragments { }
chain ipv6_fragments {
type filter hook prerouting priority -450; policy accept;
exthdr frag exists counter name "in_fragments" counter name "in_blocked" drop
}`:''}
chain pinned_docker_dns {
type nat hook output priority -110; policy accept;
ip daddr 127.0.0.11 udp dport 53 dnat ip to 127.0.0.1:53
ip daddr 127.0.0.11 tcp dport 53 dnat ip to 127.0.0.1:53
}
chain input {
type filter hook input priority 0; policy drop;
iifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 udp dport 53 accept
iifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 udp sport 53 accept
iifname "lo" ip saddr 127.0.0.11 ip daddr 127.0.0.1 udp sport 53 ct state established accept
iifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport 53 accept
iifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp sport 53 ct state established accept
iifname "lo" ip saddr 127.0.0.11 ip daddr 127.0.0.1 tcp sport 53 ct state established accept
meta length > ${maxPacketBytes} counter name "in_blocked" drop
${ndp?.input??''}
${denyRules('in')}
${allowed('in')}
counter name "in_blocked" drop
}
chain output {
type filter hook output priority 0; policy drop;
oifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 udp dport 53 accept
oifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 udp sport 53 accept
oifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport 53 accept
oifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp sport 53 ct state established accept
meta length > ${maxPacketBytes} counter name "out_blocked" drop
${ndp?.output??''}
${denyRules('out')}
${allowed('out')}
counter name "out_blocked" drop
}
chain forward { type filter hook forward priority 0; policy drop; }
}\n`;
}
