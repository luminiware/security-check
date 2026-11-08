import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { firewallRules, isolatedFixtureFirewallRules } from './firewall.mjs';
import { serveDns } from './dns.mjs';
import { deriveIpv6Link,hasIpv6DefaultRoute } from './ipv6.mjs';
try {
  if (statSync('/policy/network.json').size > 4096) throw new Error('GUARDIAN_POLICY_TOO_LARGE');
  const policy = JSON.parse(readFileSync('/policy/network.json', 'utf8'));
  const keys = ['hostname','addresses','expires_at','maxDnsRequests','ingressBytes','egressBytes','maxPacketBytes','shutdown_grace_ms'];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).some(k => !keys.includes(k))) throw new Error('INVALID_GUARDIAN_CONFIGURATION');
  const grace = policy.shutdown_grace_ms ?? 0;
  if (!Number.isInteger(grace) || grace < 0 || grace > 10000) throw new Error('INVALID_SHUTDOWN_GRACE');
  // The engine is created only AFTER the host observes this successful setup.
  const lab = process.env.ISOLATED_TEST_FIXTURES === 'true';
  if (lab && readFileSync('/proc/net/route','utf8').split('\n').some(line => /^\S+\s+00000000\s/u.test(line))) throw new Error('LAB_DEFAULT_ROUTE_FORBIDDEN');
  if(lab) {
    let routes;try{routes=readFileSync('/proc/net/ipv6_route','utf8');}catch(error){if(error.code!=='ENOENT')throw error;routes='';}
    if(hasIpv6DefaultRoute(routes))throw new Error('LAB_DEFAULT_ROUTE_FORBIDDEN');
  }
  const has6=policy.addresses?.some(value=>typeof value==='string'&&value.includes(':'));let link=null;
  if(has6)for(let i=0;;i++) {
    const routeText=readFileSync('/proc/net/ipv6_route','utf8');
    if(lab&&hasIpv6DefaultRoute(routeText))throw new Error('LAB_DEFAULT_ROUTE_FORBIDDEN');
    try{link=deriveIpv6Link(policy.addresses,{interfaces:networkInterfaces(),routeText,addressText:readFileSync('/proc/net/if_inet6','utf8')});break;}
    catch(error){if(error.message!=='IPV6_LINK_NOT_READY'||i>=10)throw error;await delay(100);}
  }
  const applied = spawnSync('nft', ['-f','-'], { input: lab ? isolatedFixtureFirewallRules(policy,Date.now(),link) : firewallRules(policy,Date.now(),link), encoding: 'utf8', timeout: 5000 });
  if (applied.status !== 0) throw new Error('FIREWALL_SETUP_FAILED');
  const close = await serveDns(policy);
  console.log(JSON.stringify({ code: 'GUARDIAN_READY', expires_at: policy.expires_at }));
  const timer = setTimeout(() => { close(); process.exit(0); }, Math.max(1, policy.expires_at - Date.now() + grace));
  // Grace only retains the namespace for inspection; DNS returns SERVFAIL and
  // the kernel peer set expires at the original reservation deadline.
  process.on('SIGTERM', () => { clearTimeout(timer); close(); process.exit(0); });
} catch (error) {
  const reason = typeof error.code === 'string' && /^[A-Z_]{2,40}$/u.test(error.code) ? error.code :
    typeof error.message === 'string' && /^[A-Z_]{2,40}$/u.test(error.message) ? error.message : 'INVALID_GUARDIAN_CONFIGURATION';
  console.error(JSON.stringify({ code: 'GUARDIAN_SETUP_FAILED', reason })); process.exitCode = 1;
}
