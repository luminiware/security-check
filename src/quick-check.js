// Intentionally small, passive collector for the Cloudflare-only entry tier.
// DNS preflight is a conservative admission filter, not an IP pin. Cloudflare's
// public-only network policy must be verified in the deployed environment.
import { publicAddress } from '../executor/address-policy.mjs';

const HEADERS = ['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy'];
const REDIRECTS = new Set([301,302,303,307,308]);
const MAX_HOPS = 2;
const MAX_DNS_BYTES = 12288;

function check(id, collection, evidence = null, code = null, at = new Date().toISOString()) {
  return { id, collection, observed_at: at, evidence, errors: code ? [code] : [], duration_ms: 0 };
}
function readLimited(response, limit) {
  return (async () => {
    if (!response.body) return '';
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try {
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('DNS_TOO_LARGE');
        chunks.push(value);
      }
    } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const value of chunks) { bytes.set(value,offset); offset+=value.byteLength; }
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  })();
}
async function dnsRecords(host, type, fetcher) {
  const url = 'https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type;
  const res = await fetcher(url,{method:'GET',redirect:'manual',headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(3000)});
  if (res.status!==200 || Number(res.headers.get('content-length')||'0')>MAX_DNS_BYTES) throw new Error('DNS_UNAVAILABLE');
  const packet = JSON.parse(await readLimited(res,MAX_DNS_BYTES));
  if (!packet || packet.Status!==0 || !Array.isArray(packet.Answer) || packet.Answer.length>40) throw new Error('DNS_UNAVAILABLE');
  const addresses=[];
  for (const answer of packet.Answer) {
    if (answer.type!==1 && answer.type!==28) continue;
    if (typeof answer.data!=='string') throw new Error('DNS_UNAVAILABLE');
    // Fail the entire set closed if any address is special/private.
    addresses.push(publicAddress(answer.data));
  }
  return addresses;
}
async function admissibleDns(target, fetcher) {
  const host = new URL(target).hostname;
  // Do not silently treat an unavailable address family as absent.
  const [v4,v6] = await Promise.all([dnsRecords(host,'A',fetcher),dnsRecords(host,'AAAA',fetcher)]);
  const addresses = [...new Set([...v4,...v6])];
  if (!addresses.length || addresses.length>32) throw new Error('DNS_UNAVAILABLE');
  return addresses.length;
}
async function probe(start, host, fetcher) {
  let url=new URL(start);
  for(let hop=0;hop<=MAX_HOPS;hop++){
    if (url.hostname!==host || !['http:','https:'].includes(url.protocol) || url.port ||
        url.username || url.password || url.search || url.hash || url.pathname.length>512)
      throw new Error('REDIRECT_BLOCKED');
    const res=await fetcher(url.href,{method:'GET',redirect:'manual',cache:'no-store',
      headers:{accept:'text/html', 'user-agent':'Luminiware-Security-Check/0.1'},
      signal:AbortSignal.timeout(3500)});
    const selected={}; for(const name of HEADERS){const value=res.headers.get(name);if(value!==null&&value.length<=4096)selected[name]=value;}
    // We examine response metadata only; bodies and Set-Cookie are never stored.
    if(res.body){try{await res.body.cancel();}catch{}}
    if (!REDIRECTS.has(res.status)) return {status:res.status, protocol:url.protocol, headers:selected};
    const location=res.headers.get('location'); if(!location || hop===MAX_HOPS)throw new Error('REDIRECT_LIMIT');
    url=new URL(location,url);
  }
  throw new Error('REDIRECT_LIMIT');
}
export async function collectQuick(target,{fetcher=globalThis.fetch, now=()=>Date.now()}={}) {
  const host=new URL(target).hostname; const time=()=>new Date(now()).toISOString();
  const failure=(id,code='CHECK_ERROR')=>check(id,'erro',null,code,time());
  const all={ssl:check('ssl','não_executado',null,'NOT_RUN',time())};
  try {
    const count=await admissibleDns(target,fetcher);
    all.dns=check('dns','ok',{target,public_address_count:count},null,time());
  } catch {
    // DNS is a prerequisite; never issue a target HTTP fetch after preflight fails.
    return ['headers','http-security','ssl','dns'].map(id=>id==='ssl'?all.ssl:failure(id,id==='dns'?'POLICY_BLOCKED':'NOT_RUN'));
  }
  const [https,http]=await Promise.allSettled([
    probe('https://'+host+'/',host,fetcher),probe('http://'+host+'/',host,fetcher)
  ]);
  if(https.status==='fulfilled'){
    const value=https.value;
    all.headers=check('headers','ok',{target,http_status:value.status,interstitial:false,final_https:value.protocol==='https:',headers:value.headers},null,time());
  }else all.headers=failure('headers');
  if(http.status==='fulfilled'){
    const value=http.value;
    if(value.status>=200&&value.status<400)
      all['http-security']=check('http-security','ok',{target,http_reaches_https:value.protocol==='https:'},null,time());
    else all['http-security']=failure('http-security');
  }else all['http-security']=failure('http-security');
  return ['headers','http-security','ssl','dns'].map(id=>all[id]);
}
