import ipaddr from 'ipaddr.js';
import { canonical } from '../src/contracts.js';

// Compare rules before/after a workload, excluding only kernel accounting and
// remaining TTL. This is a local control-plane check, not a remote attestation.
export function guardianState(snapshot, reservation, limits) {
  if (!snapshot || !Array.isArray(snapshot.nftables)) throw new Error('GUARDIAN_ATTESTATION_MISSING');
  const entries = snapshot.nftables;
  const tables = entries.filter(e=>e.table).map(e=>e.table);
  if (tables.length!==1 || tables[0].family!=='inet' || tables[0].name!=='security_check') throw new Error('GUARDIAN_ATTESTATION_INVALID');
  const chains = entries.filter(e=>e.chain).map(e=>e.chain);
  const ipv6=reservation.addresses.some(address=>ipaddr.parse(address).kind()==='ipv6'),chainCount=ipv6?5:4;
  if (chains.length!==chainCount || new Set(chains.map(c=>c.name)).size!==chainCount) throw new Error('GUARDIAN_ATTESTATION_INVALID');
  if(ipv6) {
    const fragments=chains.find(chain=>chain.name==='ipv6_fragments');
    if(!fragments||fragments.type!=='filter'||fragments.hook!=='prerouting'||fragments.prio!==-450||fragments.policy!=='accept')throw new Error('GUARDIAN_ATTESTATION_INVALID');
  }
  for (const name of ['input','output','forward']) {
    const chain=chains.find(c=>c.name===name);
    if (!chain || chain.type!=='filter' || chain.hook!==name || chain.policy!=='drop' || chain.prio!==0) throw new Error('GUARDIAN_ATTESTATION_INVALID');
  }
  const nat=chains.find(c=>c.name==='pinned_docker_dns');
  if (!nat || nat.type!=='nat' || nat.hook!=='output' || nat.prio!==-110) throw new Error('GUARDIAN_ATTESTATION_INVALID');
  const expected=[...new Set(reservation.addresses.map(a=>ipaddr.parse(a).toNormalizedString()))].sort();
  const peers=entries.filter(e=>e.set && ['ipv4_peers','ipv6_peers'].includes(e.set.name)); const actual=[];
  for (const {set} of peers) {
    if (!set.flags?.includes('timeout') || !Array.isArray(set.elem)) throw new Error('GUARDIAN_ATTESTATION_INVALID');
    for (const element of set.elem) {
      if (typeof element.elem?.val!=='string' || !Number.isFinite(element.elem.expires) || element.elem.expires<=0) throw new Error('GUARDIAN_RESERVATION_EXPIRED');
      actual.push(ipaddr.parse(element.elem.val).toNormalizedString());
    }
  }
  if (canonical(actual.sort())!==canonical(expected)) throw new Error('GUARDIAN_PEER_MISMATCH');
  if(ipv6)for(const [name,maximum] of [['ipv6_link_local',8],['ipv6_link_neighbors',33]]) {
    const set=entries.find(entry=>entry.set?.name===name)?.set;
    if(!set||set.type!=='ipv6_addr'||!set.flags?.includes('timeout')||!Array.isArray(set.elem)||!set.elem.length||set.elem.length>maximum)throw new Error('GUARDIAN_ATTESTATION_INVALID');
    for(const element of set.elem) {
      let address;try{address=ipaddr.parse(element.elem?.val);}catch{throw new Error('GUARDIAN_ATTESTATION_INVALID');}
      if(address.kind()!=='ipv6'||['unspecified','loopback','multicast','ipv4Mapped'].includes(address.range()))throw new Error('GUARDIAN_ATTESTATION_INVALID');
      if(!Number.isFinite(element.elem.expires)||element.elem.expires<=0)throw new Error('GUARDIAN_RESERVATION_EXPIRED');
    }
  }
  for (const [direction,budget] of [['in',limits.ingressBytes],['out',limits.egressBytes]]) {
    const quota=entries.find(e=>e.quota?.name===direction+'_bytes')?.quota;
    const counter=entries.find(e=>e.counter?.name===direction+'_accepted')?.counter;
    if (!quota || quota.bytes!==budget-limits.maxPacketBytes || quota.inv!==false || !counter ||
        !Number.isSafeInteger(counter.bytes) || counter.bytes<0 || counter.bytes>budget) throw new Error('GUARDIAN_BUDGET_INVALID');
  }
  const stable=entries.filter(e=>!e.metainfo).map(entry=>{
    const copy=structuredClone(entry);
    if (copy.counter) {delete copy.counter.packets;delete copy.counter.bytes;}
    if (copy.quota) delete copy.quota.used;
    if (copy.set?.elem) for (const element of copy.set.elem) if(element.elem) delete element.elem.expires;
    return copy;
  });
  return canonical(stable);
}
