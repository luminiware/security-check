// Executed as static source in the unchanged engine image. Job input is stdin,
// never JavaScript interpolation or a command argument. No control credential
// enters this process, and only the four literal module paths may be imported.
import { readFileSync } from 'node:fs';
if (process.getuid() === 0 || !/^CapEff:\s+0+$/mu.test(readFileSync('/proc/self/status','utf8')) ||
    ['EXECUTOR_KEY','QUEUE_TOKEN','HUBSPOT_ACCESS_TOKEN'].some(key => process.env[key] !== undefined)) process.exit(2);
const chunks = []; let size = 0;
for await (const chunk of process.stdin) { size += chunk.length; if (size > 4096) process.exit(2); chunks.push(chunk); }
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const url = new URL(input.target);
if (!['https:','http:'].includes(url.protocol) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !Number.isInteger(input.check_ms) || input.check_ms < 100 || input.check_ms > 30000) process.exit(2);
process.env.PLATFORM = 'NODE'; process.env.WC_SERVER = 'true';
process.env.PUBLIC_API_TIMEOUT_LIMIT = String(input.check_ms);
process.env.API_ENABLED_CHECKS = 'headers,http-security,ssl,dns'; process.env.API_DISABLED_CHECKS = 'get-ip';
const httpGuard=createBoundedFetch({hostname:url.hostname,limits:input.http_limits});
globalThis.fetch=httpGuard.fetch;
const paths = { headers:'/app/api/headers.js', 'http-security':'/app/api/http-security.js', ssl:'/app/api/ssl.js', dns:'/app/api/dns.js' };
const headerNames = ['strict-transport-security','content-security-policy','x-content-type-options','referrer-policy'];
const checks = []; const started = Date.now();
function select(id, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'error' in raw || 'errors' in raw || 'skipped' in raw) return null;
  if (id === 'headers') {
    const headers = {};
    for (const name of headerNames) {
      if (raw[name] === undefined) continue;
      if (typeof raw[name] !== 'string' || raw[name].length > 4096 || /[\u0000-\u001f\u007f]/u.test(raw[name])) return null;
      headers[name] = raw[name];
    }
    return headers;
  }
  if (id === 'ssl') {
    if (typeof raw.isValid !== 'boolean' || !Number.isFinite(Date.parse(raw.valid_from)) || !Number.isFinite(Date.parse(raw.valid_to))) return null;
    return { isValid:raw.isValid, authError:Boolean(raw.authError), valid_from:new Date(raw.valid_from).toISOString(), valid_to:new Date(raw.valid_to).toISOString() };
  }
  if (id === 'dns') {
    if (!Array.isArray(raw.A) || !Array.isArray(raw.AAAA) || raw.A.length + raw.AAAA.length > 32 || [...raw.A,...raw.AAAA].some(a => typeof a !== 'string' || a.length > 45)) return null;
    return { A:raw.A, AAAA:raw.AAAA };
  }
  // HTTP→HTTPS is observed by the external adapter, not inferred from these
  // upstream header-presence booleans.
  return {};
}
for (const [id,path] of Object.entries(paths)) {
  const began = Date.now(); let data = null; let collection = 'erro';
  const scope=httpGuard.begin();
  try {
    const handler = (await import(path)).default; let result, status;
    const requestTarget=id==='headers'?`https://${url.hostname}/`:id==='http-security'?`http://${url.hostname}/`:input.target;
    await handler({ url:'/api/'+id, query:{ url:requestTarget } }, { status(code){status=code;return this;}, json(value){result=value;} });
    if (result?.skipped) collection = 'não_executado';
    else if (status === 408) collection = 'timeout';
    else { data = select(id,result); if (data !== null) collection = 'ok'; }
  } catch { /* Never serialize the upstream's error message, URL or body. */ }
  const http=scope.finish(),failure=scope.error();
  if(failure) {data=null;collection=failure==='HTTP_TIMEOUT_OR_CANCELLED'?'timeout':failure==='HTTP_COLLECTION_FAILED'?'erro':'bloqueado';}
  checks.push({ id,collection,data,http,observed_at:new Date().toISOString(),duration_ms:Date.now()-began });
}
const output = JSON.stringify({ schema_version:'workload-v1-proposal',checks,duration_ms:Date.now()-started });
// Middleware races leave operations/timers alive. Exiting the container's PID 1
// after flushing the bounded result also terminates those descendant processes.
process.stdout.write(output+'\n', () => process.exit(0));
