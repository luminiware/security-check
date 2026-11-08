// Self-contained so the runner can pass this static function with its collector
// to an unchanged upstream image. This is not the independent network boundary.
export function createBoundedFetch({hostname,limits,fetcher=globalThis.fetch}) {
  if(typeof hostname!=='string'||hostname.length>253||!hostname.includes('.')||
      hostname.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))||typeof fetcher!=='function')throw new Error('HTTP_GUARD_CONFIG_INVALID');
  const ranges={maxRedirects:[0,5],maxResponseBytes:[4096,1048576],maxTotalBytes:[4096,2097152],maxRequests:[1,16],timeoutMs:[100,30000]};
  if(!limits||Object.keys(limits).length!==Object.keys(ranges).length||Object.keys(limits).some(key=>!Object.hasOwn(ranges,key)))throw new Error('HTTP_GUARD_LIMITS_REQUIRED');
  for(const [key,[min,max]]of Object.entries(ranges))if(!Number.isSafeInteger(limits[key])||limits[key]<min||limits[key]>max)throw new Error('HTTP_GUARD_LIMITS_REQUIRED');
  limits=Object.freeze({...limits});let totalBytes=0,requests=0,active;
  const checkedUrl=value=>{
    let url;try{url=new URL(value);}catch{throw new Error('HTTP_DESTINATION_BLOCKED');}
    if(url.href.length>2048||!['http:','https:'].includes(url.protocol)||url.hostname!==hostname||url.port||url.username||url.password)throw new Error('HTTP_DESTINATION_BLOCKED');
    url.hash='';return url;
  };
  const guarded=async(input,init={})=>{
    const scope=active;if(!scope||scope.closed||++scope.calls!==1)throw new Error('HTTP_CALL_NOT_SCOPED');
    let url=checkedUrl(input);const initialHttp=url.protocol==='http:',seen=new Set();
    if(!init||typeof init!=='object'||(init.method??'GET')!=='GET'||init.body!=null||
        Object.keys(init).some(key=>!['method','headers','redirect','signal','body'].includes(key)))throw new Error('HTTP_METHOD_OR_OPTIONS_BLOCKED');
    const headers=new Headers(init.headers);
    for(const name of headers.keys())if(!['user-agent','accept','accept-language'].includes(name))throw new Error('HTTP_HEADER_BLOCKED');
    const controller=new AbortController();scope.controller=controller;
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(limits.timeoutMs),...(init.signal?[init.signal]:[])]);
    let redirects=0;
    try {
      for(;;) {
        signal.throwIfAborted();if(++requests>limits.maxRequests)throw new Error('HTTP_REQUEST_LIMIT');
        if(seen.has(url.href))throw new Error('HTTP_REDIRECT_LOOP');seen.add(url.href);
        const response=await fetcher(url.href,{method:'GET',headers,signal,redirect:'manual',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
        if(!response||response.status<200||response.status>599||!response.headers||response.type==='opaqueredirect')throw new Error('HTTP_RESPONSE_INVALID');
        const headerBytes=[...response.headers].reduce((sum,[key,value])=>sum+key.length+value.length,0);
        if(headerBytes>16384)throw new Error('HTTP_HEADERS_LIMIT');
        if([301,302,303,307,308].includes(response.status)) {
          const location=response.headers.get('location');if(!location)throw new Error('HTTP_REDIRECT_INVALID');
          let next;try{next=checkedUrl(new URL(location,url).href);}catch{throw new Error('HTTP_REDIRECT_BLOCKED');}
          if(url.protocol==='https:'&&next.protocol!=='https:')throw new Error('HTTP_DOWNGRADE_BLOCKED');
          if(redirects++>=limits.maxRedirects)throw new Error('HTTP_REDIRECT_LIMIT');
          // Stop redirect bodies before following. Do not materialize them.
          await response.body?.cancel();url=next;continue;
        }
        const encoding=response.headers.get('content-encoding');
        if(encoding&&(!/^(?:gzip|x-gzip|br|deflate|identity)$/iu.test(encoding)))throw new Error('HTTP_ENCODING_UNSUPPORTED');
        const chunks=[];let size=0;
        if(response.body) {
          const reader=response.body.getReader();
          try {
            for(;;) {
              const {value,done}=await reader.read();if(done)break;
              if(!(value instanceof Uint8Array))throw new Error('HTTP_RESPONSE_INVALID');
              size+=value.byteLength;totalBytes+=value.byteLength;
              if(size>limits.maxResponseBytes||totalBytes>limits.maxTotalBytes)throw new Error('HTTP_DECODED_BODY_LIMIT');
              chunks.push(value);
            }
          } finally {reader.releaseLock();}
        }
        signal.throwIfAborted();if(scope.closed)throw new Error('HTTP_SCOPE_CLOSED');
        const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        const bom=size>=2?(bytes[0]<<8)|bytes[1]:0;
        const text=new TextDecoder(bom===0xfffe?'utf-16le':bom===0xfeff?'utf-16be':'utf-8').decode(bytes);
        const interstitial=response.status===202||['cf-mitigated','x-vercel-mitigated','x-amzn-waf-action','x-datadome-cid'].some(name=>response.headers.has(name))||text.includes('_sec/verify?provider=interstitial');
        scope.observation=Object.freeze({http_status:response.status,interstitial,final_https:url.protocol==='https:',redirect_count:redirects,
          http_reaches_https:initialHttp&&response.status<400&&!interstitial?url.protocol==='https:':null});
        // fetch has already decoded the stream. Preserve the bounded bytes for
        // upstream parsing, with representation headers corrected accordingly.
        const copiedHeaders=new Headers(response.headers);copiedHeaders.delete('content-encoding');copiedHeaders.delete('content-length');
        const copied=new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,statusText:response.statusText,headers:copiedHeaders});
        Object.defineProperties(copied,{url:{value:url.href},redirected:{value:redirects>0}});return copied;
      }
    } catch(error) {
      controller.abort();scope.observation=null;
      if(signal.aborted&&(error.name==='TimeoutError'||error.name==='AbortError')) {scope.error='HTTP_TIMEOUT_OR_CANCELLED';throw new Error(scope.error);}
      if(typeof error.message==='string'&&/^HTTP_[A-Z_]{2,48}$/u.test(error.message)) {scope.error=error.message;throw error;}
      scope.error='HTTP_COLLECTION_FAILED';
      throw new Error('HTTP_COLLECTION_FAILED');
    }
  };
  return Object.freeze({fetch:guarded,begin(){
    if(active)throw new Error('HTTP_SCOPE_ALREADY_OPEN');const scope={calls:0,closed:false,observation:null};active=scope;
    return {error(){return scope.error??null;},finish(){if(scope.closed)return null;scope.closed=true;scope.controller?.abort();if(active===scope)active=null;return scope.calls===1?scope.observation:null;}};
  }});
}
