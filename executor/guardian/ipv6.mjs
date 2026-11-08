import ipaddr from 'ipaddr.js';

function unicast(value) {
  if(typeof value!=='string'||value.length>45||value.trim()!==value||value.includes('%')||value.includes('['))throw new Error('INVALID_IPV6_LINK');
  let address;try{address=ipaddr.parse(value);}catch{throw new Error('INVALID_IPV6_LINK');}
  if(address.kind()!=='ipv6'||['unspecified','loopback','multicast','ipv4Mapped'].includes(address.range()))throw new Error('INVALID_IPV6_LINK');
  return address;
}
function hexAddress(value) {
  if(!/^[a-f0-9]{32}$/iu.test(value))throw new Error('INVALID_IPV6_TOPOLOGY');
  return ipaddr.fromByteArray(value.match(/../gu).map(byte=>parseInt(byte,16)));
}
export function hasIpv6DefaultRoute(text) {
  return parseRoutes(text).some(route=>route.prefix===0&&route.destination==='::'&&(route.flags&1)&&!(route.flags&0x200));
}
function parseRoutes(text) {
  if(typeof text!=='string'||text.length>65536)throw new Error('INVALID_IPV6_TOPOLOGY');
  return text.split('\n').filter(line=>line.trim()).map(line=>{
    const fields=line.trim().split(/\s+/u);
    if(fields.length!==10||![1,3,5,6,7,8].every(index=>/^[a-f0-9]{2,8}$/iu.test(fields[index]))||!/^[a-zA-Z0-9_.-]{1,15}$/u.test(fields[9]))throw new Error('INVALID_IPV6_TOPOLOGY');
    const prefix=parseInt(fields[1],16),sourcePrefix=parseInt(fields[3],16);if(prefix>128||sourcePrefix>128)throw new Error('INVALID_IPV6_TOPOLOGY');
    return {destination:hexAddress(fields[0]).toString(),prefix,source:hexAddress(fields[2]).toString(),sourcePrefix,gateway:hexAddress(fields[4]).toString(),metric:parseInt(fields[5],16),flags:parseInt(fields[8],16),interface:fields[9]};
  });
}
// These inputs come from the guardian's own kernel, before any workload starts.
// No link/gateway supplied by the visitor or stdin network policy is accepted.
export function deriveIpv6Link(peers,{interfaces,routeText,addressText}) {
  const addresses=peers.map(value=>ipaddr.parse(value)).filter(address=>address.kind()==='ipv6');
  if(!addresses.length)return null;
  if(typeof addressText!=='string'||addressText.length>65536||!interfaces||typeof interfaces!=='object')throw new Error('INVALID_IPV6_TOPOLOGY');
  const readiness=new Map();
  for(const line of addressText.split('\n').filter(line=>line.trim())) {
    const fields=line.trim().split(/\s+/u);
    if(fields.length!==6||!/^[a-f0-9]{2,8}$/iu.test(fields[4]))throw new Error('INVALID_IPV6_TOPOLOGY');
    readiness.set(fields[5]+'|'+hexAddress(fields[0]).toString(),parseInt(fields[4],16));
  }
  const links=Object.entries(interfaces).filter(([,items])=>items.some(item=>!item.internal&&item.family==='IPv6'));
  if(links.length!==1)throw new Error('IPV6_LINK_NOT_RESERVED');
  const [name,items]=links[0];
  if(!/^[a-zA-Z0-9_.-]{1,15}$/u.test(name))throw new Error('INVALID_IPV6_LINK');
  const local=items.filter(item=>!item.internal&&item.family==='IPv6').map(item=>{
    const address=unicast(item.address),flags=readiness.get(name+'|'+address.toString());
    if(flags===undefined||!item.cidr)throw new Error('INVALID_IPV6_TOPOLOGY');
    let subnet;try{subnet=ipaddr.parseCIDR(item.cidr);}catch{throw new Error('INVALID_IPV6_TOPOLOGY');}
    if(subnet[0].kind()!=='ipv6')throw new Error('INVALID_IPV6_TOPOLOGY');
    return {address,subnet,ready:!(flags&0x48)}; // IFA_F_TENTATIVE | IFA_F_DADFAILED
  });
  const ready=local.filter(item=>item.ready);
  if(!ready.some(item=>item.address.range()!=='linkLocal'))throw new Error('IPV6_LINK_NOT_READY');
  const routes=parseRoutes(routeText);
  const selected=addresses.map(address=>{
    const matching=routes.filter(route=>(route.flags&1)&&address.match(ipaddr.parse(route.destination),route.prefix));
    // Source-specific and equal-cost alternatives require a richer topology
    // contract; conservatively refuse them instead of guessing a next hop.
    if(matching.some(route=>route.sourcePrefix!==0||route.source!=='::'))throw new Error('IPV6_ROUTE_NOT_RESERVED');
    matching.sort((a,b)=>b.prefix-a.prefix||a.metric-b.metric);
    const best=matching[0];
    if(!best||best.interface!==name||(best.flags&0x200))throw new Error('IPV6_ROUTE_NOT_RESERVED');
    if(matching.some((route,index)=>index>0&&route.prefix===best.prefix&&route.metric===best.metric&&(route.gateway!==best.gateway||route.interface!==best.interface||(route.flags&0x200))))throw new Error('IPV6_ROUTE_NOT_RESERVED');
    return {address,route:best};
  });
  const gateways=[...new Set(selected.filter(item=>item.route.gateway!=='::').map(item=>item.route.gateway))];
  if(gateways.length>1)throw new Error('IPV6_LINK_NOT_RESERVED');
  const gateway=gateways[0]??null;
  if(gateway) {
    const address=unicast(gateway);
    if(address.range()==='linkLocal'&&!ready.some(item=>item.address.range()==='linkLocal'))throw new Error('IPV6_LINK_NOT_READY');
    if(!ready.some(item=>address.match(item.subnet)))throw new Error('IPV6_ROUTE_NOT_RESERVED');
  }
  const onLink=selected.filter(item=>item.route.gateway==='::').map(item=>item.address.toString());
  return {interface:name,local_addresses:ready.map(item=>item.address.toString()),on_link_peers:[...new Set(onLink)],next_hop:gateway};
}
export function ipv6NeighborRules(link,peers,ttl) {
  if(!Number.isInteger(ttl)||ttl<1||ttl>120000||!link||Object.keys(link).length!==4||Object.keys(link).some(key=>!['interface','local_addresses','on_link_peers','next_hop'].includes(key))||
      typeof link.interface!=='string'||!/^[a-zA-Z0-9_.-]{1,15}$/u.test(link.interface)||!Array.isArray(link.local_addresses)||!link.local_addresses.length||link.local_addresses.length>8||
      (link.next_hop!==null&&typeof link.next_hop!=='string')||
      !Array.isArray(link.on_link_peers)||link.on_link_peers.length>32)throw new Error('INVALID_IPV6_LINK');
  const local=[...new Set(link.local_addresses.map(value=>unicast(value).toString()))];
  const allowed=new Set(peers.map(value=>unicast(value).toString()));
  const onLink=[...new Set(link.on_link_peers.map(value=>unicast(value).toString()))];
  if(onLink.some(value=>!allowed.has(value))||(!link.next_hop&&onLink.length!==allowed.size))throw new Error('IPV6_ROUTE_NOT_RESERVED');
  const neighbors=[...new Set([...onLink,...(link.next_hop?[unicast(link.next_hop).toString()]:[])])];
  if(!neighbors.length||neighbors.some(value=>local.includes(value)))throw new Error('INVALID_IPV6_LINK');
  const set=(name,values)=>`set ${name} { type ipv6_addr; flags timeout; elements = { ${values.map(value=>`${value} timeout ${ttl}ms`).join(', ')} }; }`;
  const multicast=value=>{
    const bytes=ipaddr.parse(value).toByteArray();return ipaddr.fromByteArray([0xff,2,0,0,0,0,0,0,0,0,0,1,0xff,...bytes.slice(-3)]).toString();
  };
  const target=value=>'0x'+ipaddr.parse(value).toByteArray().map(byte=>byte.toString(16).padStart(2,'0')).join('');
  // Numeric ICMPv6 protocol avoids depending on /etc/protocols in the image.
  const base=direction=>`${direction==='in'?'iifname':'oifname'} "${link.interface}" meta length >= 64 meta length <= 96 ip6 nexthdr 58 ip6 hoplimit 255 icmpv6 code 0`;
  const accept=direction=>`limit rate 10/second burst 5 packets quota name "${direction}_bytes" counter name "${direction}_ndp" counter name "${direction}_accepted" accept`;
  const input=[
    ...neighbors.map(value=>`${base('in')} ip6 saddr ${value} ip6 saddr @ipv6_link_neighbors ip6 daddr @ipv6_link_local icmpv6 type nd-neighbor-advert @th,64,128 ${target(value)} ${accept('in')}`),
    ...local.map(value=>`${base('in')} ip6 saddr @ipv6_link_neighbors ip6 daddr { ${value}, ${multicast(value)} } icmpv6 type nd-neighbor-solicit @th,64,128 ${target(value)} ${accept('in')}`),
  ].join('\n');
  const output=[
    ...neighbors.map(value=>`${base('out')} ip6 saddr @ipv6_link_local ip6 daddr { ${value}, ${multicast(value)} } icmpv6 type nd-neighbor-solicit @th,64,128 ${target(value)} ${accept('out')}`),
    ...local.map(value=>`${base('out')} ip6 saddr ${value} ip6 saddr @ipv6_link_local ip6 daddr @ipv6_link_neighbors icmpv6 type nd-neighbor-advert @th,64,128 ${target(value)} ${accept('out')}`),
  ].join('\n');
  return {declarations:set('ipv6_link_local',local)+'\n'+set('ipv6_link_neighbors',neighbors)+'\ncounter in_ndp { }\ncounter out_ndp { }',input,output};
}
