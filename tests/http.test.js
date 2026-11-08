import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { database } from './helpers.js';
import { LOCAL, hash, token } from '../src/contracts.js';
import { createJob, getJob, stmt } from '../src/store.js';
let db, env, cookie, background;
before(async () => { db = await database(); env = db.env; });
after(async () => { await db?.dispose(); });
beforeEach(async () => {
  await env.DB.batch(['leads','attempts','jobs','events','quotas','executor_health'].map(t => env.DB.prepare('DELETE FROM ' + t)));
  background = []; cookie = ''; const config = await request('/api/v1/config'); cookie = config.headers.get('set-cookie').split(';')[0];
});
function request(path, { method = 'GET', body, key, sessionCookie = cookie, origin = 'http://localhost', host = 'http://localhost', headers = {}, bindings = env } = {}) {
  return worker.fetch(new Request(host + path, { method, headers: { ...(sessionCookie ? { cookie: sessionCookie } : {}),
    ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) }), bindings, { waitUntil: p => background.push(p) });
}
test('HTTP flow: canonical admission, read-only polling, replay and synthetic completion', async () => {
  const body = { target: 'EXAMPLE.com', turnstile_token: 'synthetic', scenario: 'complete' };
  const accepted = await request('/api/v1/analyses', { method: 'POST', body, key: 'http-same-key' });
  assert.equal(accepted.status, 202); const job = await accepted.json(); assert.equal(job.target, 'https://example.com/');
  assert.equal(job.state, 'pendente');
  const repeat = await request('/api/v1/analyses', { method: 'POST', body: { ...body, turnstile_token: 'changed-single-use-token' }, key: 'http-same-key' });
  assert.equal((await repeat.json()).id, job.id);
  await Promise.all(background);
  const read = await request(job.status_url); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal(read.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await read.json()).state,'concluído');
  const final = await request(job.status_url); const finalBody = await final.json(); assert.equal(finalBody.state, 'concluído'); assert.equal(finalBody.report.score, 75);
});

test('polling a persisted pending job never claims it or schedules collection',async()=>{
  const {job}=await createJob(env,await hash(cookie.split('=')[1]),'poll-read-only','synthetic-hash','https://example.com/','complete',Date.now());
  for(let i=0;i<3;i++)assert.equal((await (await request('/api/v1/analyses/'+job.id)).json()).state,'pendente');
  assert.equal((await getJob(env,job.id)).attempts,0);assert.equal(background.length,0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM attempts').first()).n,0);
});
test('same job id is insufficient authorization; no session and foreign session are 404', async () => {
  const owner = await hash(cookie.split('=')[1]);
  const { job } = await createJob(env, owner, 'test-owner-key', 'hash', 'https://example.com/', 'complete', Date.now());
  const path = '/api/v1/analyses/' + job.id;
  assert.equal((await request(path, { sessionCookie: '' })).status, 404);
  assert.equal((await request(path, { sessionCookie: 'sc_local=' + token() })).status, 404);
  await stmt(env, 'UPDATE jobs SET retain_until=? WHERE id=?', Date.now() - 100, job.id).run();
  assert.equal((await request(path)).status, 410);
  assert.equal((await request(path, { sessionCookie: 'sc_local=' + token() })).status, 404);
});
test('public deployment stays closed even if DEMO or PUBLIC_ADMISSION flags are present', async () => {
  const remoteConfig = await request('/api/v1/config', { host: 'https://security.example.com' });
  const config = await remoteConfig.json(); assert.equal(config.demo, false); assert.equal(config.admission, false);
  assert.match(remoteConfig.headers.get('set-cookie'), /Secure/u);
  const remoteCookie = remoteConfig.headers.get('set-cookie').split(';')[0];
  const res = await request('/api/v1/analyses', { host: 'https://security.example.com', origin: 'https://security.example.com', method: 'POST',
    sessionCookie: remoteCookie, body: { target: 'example.com', turnstile_token: 'synthetic' }, key: 'remote-test-key', bindings: { ...env, PUBLIC_ADMISSION: 'true' } });
  assert.equal(res.status, 503); assert.equal((await res.json()).code, 'LAUNCH_REVIEW_REQUIRED');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n, 0);
});
test('invalid target, cross-origin, unknown fields and oversize body create no job', async () => {
  const base = { method: 'POST', key: 'http-key-invalid', body: { target: '127.0.0.1', turnstile_token: 'synthetic' } };
  assert.equal((await request('/api/v1/analyses', base)).status, 400);
  assert.equal((await request('/api/v1/analyses', { ...base, origin: 'https://example.org' })).status, 403);
  assert.equal((await request('/api/v1/analyses', { ...base, body: { target: 'example.com', turnstile_token: 'synthetic', score: 100 } })).status, 400);
  assert.equal((await request('/api/v1/analyses', { ...base, body: { target: 'a'.repeat(5000), turnstile_token: 'synthetic' } })).status, 413);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n, 0);
});
test('authenticated deletion invalidates capability and cancels pending work', async () => {
  const { job } = await createJob(env, await hash(cookie.split('=')[1]), 'delete-key', 'hash', 'https://example.com/', 'complete', Date.now());
  const path = '/api/v1/analyses/' + job.id;
  assert.equal((await request(path, { method: 'DELETE' })).status, 200);
  assert.equal((await request(path)).status, 404); assert.equal(await getJob(env, job.id), null);
});
test('internal schema and dedicated key protect heartbeat and claim', async () => {
  const secret = token(); const bindings = { ...env, EXECUTOR_KEYS: JSON.stringify({ 'synthetic-executor': secret }) };
  const body = { schema_version: '1' };
  const path = '/internal/v1/jobs/' + crypto.randomUUID() + '/claim';
  assert.equal((await request(path, { method: 'POST', body, bindings })).status, 403);
  const headers = { authorization: 'Bearer ' + secret, 'x-executor-id': 'synthetic-executor' };
  assert.equal((await request(path, { method: 'POST', body, bindings, headers })).status, 404);
  assert.equal((await request(path, { method: 'POST', body: { ...body, target: 'https://example.com/' }, bindings, headers })).status, 400);
});
