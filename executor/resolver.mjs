import net from 'node:net';
import { randomBytes } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { normalizeTarget } from '../src/target.js';
import { publicAddress, publicResolution } from './address-policy.mjs';

const TYPES=Object.freeze({A:1,CNAME:5,AAAA:28});
function dnsName(value) {
  if(typeof value!=='string'||value!==value.toLowerCase()||value.endsWith('.'))throw new Error('DNS_NAME_INVALID');
  try {if(new URL(normalizeTarget(value)).hostname!==value)throw new Error();}
  catch {throw new Error('DNS_NAME_INVALID');}
  return value;
}
function nameBytes(name) {return Buffer.concat([...dnsName(name).split('.').map(label=>Buffer.concat([Buffer.from([label.length]),Buffer.from(label,'ascii')])),Buffer.from([0])]);}
export function dnsQuestion(name,type,id=randomBytes(2).readUInt16BE()) {
  if(!Object.values(TYPES).includes(type)||!Number.isInteger(id)||id<0||id>65535)throw new Error('DNS_QUESTION_INVALID');
  const header=Buffer.alloc(12);header.writeUInt16BE(id);header.writeUInt16BE(0x0100,2);header.writeUInt16BE(1,4);
  const tail=Buffer.alloc(4);tail.writeUInt16BE(type);tail.writeUInt16BE(1,2);
  return Object.freeze({name:dnsName(name),type,id,packet:Buffer.concat([header,nameBytes(name),tail])});
}
function readName(packet,start) {
  const labels=[];let offset=start,end,steps=0;const seen=new Set();
  for(;;) {
    if(offset>=packet.length||seen.has(offset)||++steps>128)throw new Error('DNS_PACKET_INVALID');
    seen.add(offset);const size=packet[offset++];
    if((size&0xc0)===0xc0) {
      if(offset>=packet.length)throw new Error('DNS_PACKET_INVALID');
      const pointer=((size&0x3f)<<8)|packet[offset++];
      if(pointer<12||pointer>=offset-2)throw new Error('DNS_PACKET_INVALID');
      end??=offset;offset=pointer;continue;
    }
    if(size>63||offset+size>packet.length)throw new Error('DNS_PACKET_INVALID');
    if(!size){end??=offset;break;}
    const bytes=packet.subarray(offset,offset+size);
    if(bytes.some(byte=>byte>127)||!/^[a-z0-9-]+$/iu.test(bytes.toString('ascii')))throw new Error('DNS_PACKET_INVALID');
    labels.push(bytes.toString('ascii').toLowerCase());offset+=size;
    if(labels.join('.').length>253)throw new Error('DNS_PACKET_INVALID');
  }
  return {name:labels.join('.'),end};
}
export function parseDnsResponse(packet,question,maxBytes=4096) {
  if(!Buffer.isBuffer(packet)||packet.length<12||packet.length>maxBytes||packet.readUInt16BE()!==question.id)throw new Error('DNS_PACKET_INVALID');
  const flags=packet.readUInt16BE(2),rcode=flags&15;
  if(!(flags&0x8000)||(flags&0x7800)||(flags&0x0040)||packet.readUInt16BE(4)!==1)throw new Error('DNS_PACKET_INVALID');
  const asked=readName(packet,12);let offset=asked.end;
  if(offset+4>packet.length||asked.name!==question.name||packet.readUInt16BE(offset)!==question.type||packet.readUInt16BE(offset+2)!==1)throw new Error('DNS_PACKET_INVALID');
  offset+=4;
  // TCP is the only original-resolution transport. Truncation is not accepted
  // as a partial address set, nor retried against an implicit resolver.
  if(flags&0x0200)throw new Error('DNS_TRUNCATED');
  if(rcode!==0)throw new Error(rcode===3?'DNS_NAME_NOT_FOUND':'DNS_RESOLUTION_FAILED');
  const counts=[packet.readUInt16BE(6),packet.readUInt16BE(8),packet.readUInt16BE(10)];
  if(counts.reduce((a,b)=>a+b,0)>64)throw new Error('DNS_RECORD_LIMIT');
  const records=[];
  for(let section=0;section<3;section++)for(let index=0;index<counts[section];index++) {
    const owner=readName(packet,offset);offset=owner.end;
    if(offset+10>packet.length)throw new Error('DNS_PACKET_INVALID');
    const type=packet.readUInt16BE(offset),rrclass=packet.readUInt16BE(offset+2),rawTtl=packet.readUInt32BE(offset+4),length=packet.readUInt16BE(offset+8);
    offset+=10;const end=offset+length;if(end>packet.length)throw new Error('DNS_PACKET_INVALID');
    let value;
    if(rrclass===1&&[1,28].includes(type)) {
      if(length!==(type===1?4:16))throw new Error('DNS_PACKET_INVALID');
      value=ipaddr.fromByteArray([...packet.subarray(offset,end)]).toString();
    } else if(rrclass===1&&type===5) {
      const alias=readName(packet,offset);if(alias.end!==end)throw new Error('DNS_PACKET_INVALID');value=dnsName(alias.name);
    }
    if(value!==undefined)records.push({owner:owner.name,type,value,ttl:rawTtl>0x7fffffff?0:rawTtl,section});
    offset=end;
  }
  if(offset!==packet.length)throw new Error('DNS_PACKET_INVALID');
  return records;
}
export function tcpDnsExchange({server,port=53,maxBytes=4096,timeoutMs=2000},packet,signal) {
  if(!net.isIP(server)||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(maxBytes)||maxBytes<512||maxBytes>16384||
      !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000||!Buffer.isBuffer(packet)||packet.length<12||packet.length>512)throw new Error('DNS_TRANSPORT_CONFIG_INVALID');
  signal?.throwIfAborted();
  return new Promise((resolveResponse,reject)=>{
    const socket=net.createConnection({host:server,port,family:net.isIP(server)});let pending=Buffer.alloc(0),settled=false;
    const timer=setTimeout(()=>finish(new Error('DNS_TIMEOUT')),timeoutMs);
    const abort=()=>finish(new Error('DNS_CANCELLED'));
    const finish=(error,response)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.destroy();
      if(error)reject(error);else resolveResponse(response);
    };
    signal?.addEventListener('abort',abort,{once:true});
    socket.on('error',()=>finish(new Error('DNS_TRANSPORT_FAILED')));
    socket.on('end',()=>finish(new Error('DNS_PACKET_INVALID')));
    socket.on('connect',()=>{
      if(ipaddr.parse(socket.remoteAddress).toNormalizedString()!==ipaddr.parse(server).toNormalizedString())return finish(new Error('DNS_PEER_MISMATCH'));
      const prefix=Buffer.alloc(2);prefix.writeUInt16BE(packet.length);socket.write(Buffer.concat([prefix,packet]));
    });
    socket.on('data',chunk=>{
      if(pending.length+chunk.length>maxBytes+2)return finish(new Error('DNS_PACKET_LIMIT'));
      pending=Buffer.concat([pending,chunk]);if(pending.length<2)return;
      const length=pending.readUInt16BE();if(length<12||length>maxBytes)return finish(new Error('DNS_PACKET_LIMIT'));
      if(pending.length>length+2)return finish(new Error('DNS_PACKET_INVALID'));
      if(pending.length===length+2)finish(null,pending.subarray(2));
    });
    if(signal?.aborted)abort();
  });
}
function checkedLimits(limits) {
  const ranges={maxAddresses:[1,32],maxCnames:[0,8],maxTtlMs:[1000,120000],timeoutMs:[100,10000],queryTimeoutMs:[100,3000],maxBytes:[512,16384]};
  if(!limits||Object.keys(limits).length!==Object.keys(ranges).length||Object.keys(limits).some(key=>!Object.hasOwn(ranges,key)))throw new Error('DNS_LIMITS_REQUIRED');
  for(const [key,[min,max]]of Object.entries(ranges))if(!Number.isSafeInteger(limits[key])||limits[key]<min||limits[key]>max)throw new Error('DNS_LIMITS_REQUIRED');
  return Object.freeze({...limits});
}
// The injected exchange is for deterministic contract tests. Public construction
// below always uses the fixed TCP transport and the public address classifier.
export function resolutionCollector(exchange,limits) {
  limits=checkedLimits(limits);
  return async(target,signal)=>{
    if(normalizeTarget(target)!==target)throw new Error('DNS_NAME_INVALID');
    const hostname=new URL(target).hostname,started=Date.now(),cnames=[];
    const bounded=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(limits.timeoutMs)]);
    let expires=started+limits.maxTtlMs;
    const query=async(name,type)=>{
      bounded.throwIfAborted();const observed=Date.now(),question=dnsQuestion(name,type);
      const records=parseDnsResponse(await exchange(question.packet,bounded),question,limits.maxBytes);
      bounded.throwIfAborted();
      // Even unsolicited/glue addresses must not smuggle a special destination.
      for(const record of records)if([1,28].includes(record.type))publicAddress(record.value);
      return {records,observed};
    };
    let current=hostname;
    for(;;) {
      const {records,observed}=await query(current,TYPES.CNAME);
      const answers=records.filter(record=>record.section===0);
      if(answers.some(record=>record.owner!==current||record.type!==TYPES.CNAME))throw new Error('DNS_INCONSISTENT');
      if(!answers.length)break;
      const aliases=[...new Set(answers.map(record=>record.value))];
      if(aliases.length!==1||cnames.length>=limits.maxCnames||[hostname,...cnames].includes(aliases[0]))throw new Error('DNS_CNAME_LIMIT_OR_LOOP');
      expires=Math.min(expires,...answers.map(record=>observed+record.ttl*1000));
      cnames.push(aliases[0]);current=aliases[0];
    }
    const addresses=[];
    // Both families are required. A failure in one is not hidden by the other.
    for(const type of [TYPES.A,TYPES.AAAA]) {
      const {records,observed}=await query(current,type);
      const answers=records.filter(record=>record.section===0);
      if(answers.some(record=>record.owner!==current||record.type!==type))throw new Error('DNS_CHANGED_DURING_RESOLUTION');
      addresses.push(...answers.map(record=>record.value));
      expires=Math.min(expires,...answers.map(record=>observed+record.ttl*1000));
    }
    return publicResolution({hostname,addresses,cnames,resolved_at:started,ttl_ms:expires-started},limits);
  };
}
export function createPublicResolver({server,limits}) {
  const pinned=publicAddress(server),policy=checkedLimits(limits);
  return resolutionCollector((packet,signal)=>tcpDnsExchange({server:pinned,timeoutMs:policy.queryTimeoutMs,maxBytes:policy.maxBytes},packet,signal),policy);
}
