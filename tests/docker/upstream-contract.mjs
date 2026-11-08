// Runs only inside a network=none container. Loopback targets are controlled
// fixtures; they MUST NOT be used as an exception in a production network policy.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
assert.notEqual(process.getuid(), 0);
const processStatus = readFileSync('/proc/self/status', 'utf8');
assert.match(processStatus, /^CapEff:\s+0+$/mu); assert.match(processStatus, /^NoNewPrivs:\s+1$/mu);
assert.equal(readFileSync('/proc/net/route', 'utf8').trim().split('\n').length, 1, 'No routed IPv4 egress is permitted');
assert.throws(() => writeFileSync('/app/security-check-write-probe', 'synthetic'), error => ['EROFS','EACCES'].includes(error.code));
process.env.PLATFORM = 'NODE';
process.env.WC_SERVER = 'true';
process.env.PUBLIC_API_TIMEOUT_LIMIT = '1000';
process.env.API_ENABLED_CHECKS = 'headers,http-security,ssl,dns';
process.env.API_DISABLED_CHECKS = 'get-ip';
const { shouldSkip } = await import('/app/api/_common/check-skipper.js');
for (const id of ['get-ip','ports','trace-route','screenshot','tech-stack','tls-labs','shodan']) {
  assert.equal(shouldSkip('/api/' + id, 'https://example.com/').skip, true, id);
}
for (const id of ['headers','http-security','ssl','dns']) assert.equal(shouldSkip('/api/' + id, 'https://example.com/').skip, false, id);
const handlers = {};
for (const id of ['headers','http-security','ssl','dns']) handlers[id] = (await import('/app/api/' + id + '.js')).default;
async function invoke(id, target) {
  let status, body;
  const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  await handlers[id]({ url: '/api/' + id, query: { url: target } }, response);
  return { status, body };
}
const serve = (request, response) => {
  if (request.url === '/redirect') { response.writeHead(302, { location: '/ok' }); return response.end(); }
  if (request.url === '/error') { response.writeHead(503, { 'x-content-type-options': 'nosniff' }); return response.end('synthetic unavailable'); }
  if (request.url === '/bot') { response.writeHead(200, { 'cf-mitigated': 'challenge' }); return response.end('synthetic challenge'); }
  response.writeHead(200, { 'content-security-policy': "default-src 'self'", 'strict-transport-security': 'max-age=3600', 'x-content-type-options': 'nosniff' });
  response.end('synthetic fixture');
};
const server = http.createServer(serve);
await new Promise(resolve => server.listen(18080, '127.0.0.1', resolve));
const tlsServer = https.createServer({ key: readFileSync('/tls/key.pem'), cert: readFileSync('/tls/cert.pem') }, serve);
await new Promise(resolve => tlsServer.listen(18443, '127.0.0.1', resolve));
const evidence = { schema: 'upstream-controlled-contract-v1', synthetic: true, network: 'none',
  isolation: ['non-root','capabilities-empty','no-new-privileges','no-ipv4-route','read-only-app'], cases: [] };
try {
  const headers = await invoke('headers', 'http://127.0.0.1:18080/ok');
  assert.equal(headers.status, 200); assert.equal(headers.body['x-content-type-options'], 'nosniff'); evidence.cases.push('headers-selected-response');
  const redirect = await invoke('headers', 'http://127.0.0.1:18080/redirect');
  assert.equal(redirect.body['strict-transport-security'], 'max-age=3600'); evidence.cases.push('upstream-follows-redirect-without-hop-proof');
  const error = await invoke('headers', 'http://127.0.0.1:18080/error');
  assert.equal(error.status, 200); assert.equal(error.body['x-content-type-options'], 'nosniff'); assert.equal(error.body.http_status, undefined);
  evidence.cases.push('headers-503-is-api-200-without-target-status');
  const bot = await invoke('http-security', 'http://127.0.0.1:18080/bot');
  assert.equal(bot.status, 200); assert.equal(typeof bot.body.error, 'string'); evidence.cases.push('anti-bot-api-200-error-body');
  const ssl = await invoke('ssl', 'https://127.0.0.1:18443/');
  assert.equal(ssl.status, 200); assert.equal(ssl.body.isValid, false); assert.ok(ssl.body.authError); assert.ok(ssl.body.valid_to);
  evidence.cases.push('invalid-tls-retains-observable-authorization-failure');
  const dns = await invoke('dns', 'https://nonexistent.invalid/');
  assert.equal(dns.status, 200); assert.deepEqual(dns.body.A, []); assert.deepEqual(dns.body.AAAA, []);
  evidence.cases.push('dns-failure-collapses-into-empty-arrays');
  const skipped = await invoke('headers', 'http://127.0.0.1:18081/');
  assert.equal(skipped.status, 200); assert.equal(typeof skipped.body.error, 'string'); evidence.cases.push('connection-error-is-api-200-error-body');
  console.log(JSON.stringify(evidence));
} finally {
  server.closeAllConnections(); tlsServer.closeAllConnections(); server.close(); tlsServer.close();
}
