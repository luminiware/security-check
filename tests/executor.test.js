import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS,VERSIONS } from '../src/contracts.js';
import { normalizeUpstream } from '../executor/upstream.mjs';
import { consumeOne,supervise } from '../executor/supervisor.mjs';
import { decodeMessage } from '../executor/transport.mjs';
const target = 'https://example.com/'; const now = new Date().toISOString();
const provenance = { target, peer_verified: true, policy_enforced: true, final_https: true, http_status: 200, interstitial: false };
test('upstream errors under HTTP 200, empty DNS and unsupported transport stay inconclusive', () => {
  assert.equal(normalizeUpstream('headers', { error: 'synthetic' }, provenance, target, now).collection, 'erro');
  assert.equal(normalizeUpstream('dns', { A: [], AAAA: [] }, { ...provenance, public_address_count: 0 }, target, now).collection, 'erro');
  assert.equal(normalizeUpstream('http-security', { contentSecurityPolicy: false }, provenance, target, now).collection, 'não_executado');
  assert.equal(normalizeUpstream('headers', {}, null, target, now).collection, 'bloqueado');
  assert.equal(normalizeUpstream('headers', {}, {...provenance,final_https:'true'}, target, now).collection,'bloqueado');
  assert.throws(() => normalizeUpstream('tech-stack', {}, provenance, target, now), /CHECK_NOT_ALLOWLISTED/u);
});
test('upstream adapter minimizes evidence and preserves TLS authorization failure', () => {
  const headers = normalizeUpstream('headers', { 'x-content-type-options': 'nosniff', 'set-cookie': 'synthetic', server: 'synthetic' }, provenance, target, now);
  assert.deepEqual(headers.evidence.headers, { 'x-content-type-options': 'nosniff' });
  const ssl = normalizeUpstream('ssl', { isValid: false, authError: 'synthetic', valid_from: '2026-01-01', valid_to: '2027-01-01', raw: 'discard' }, provenance, target, now);
  assert.equal(ssl.evidence.identity_valid, false); assert.equal('raw' in ssl.evidence, false);
});
function message(jobId) {
  return { body: Buffer.from(JSON.stringify({ schema_version: '1', job_id: jobId, target: 'https://example.org/', allowed_checks: CHECKS, policy_version: VERSIONS.policy, deadline_at: new Date(Date.now() + 60000).toISOString() })).toString('base64'), lease_id: 'synthetic-queue-lease', metadata: { 'CF-Content-Type': 'json' } };
}
test('Queue JSON base64 is decoded; unsupported serialization is rejected', () => {
  const id = crypto.randomUUID(); assert.equal(decodeMessage(message(id)).job_id, id);
  assert.throws(() => decodeMessage({ ...message(id), metadata: { 'CF-Content-Type': 'v8' } }), /UNSUPPORTED_QUEUE_ENCODING/u);
});
test('supervisor uses canonical claim target, retries identical callback, then acks', async () => {
  const id = crypto.randomUUID(); const order = []; let calls = 0;
  const attempt = { job_id: id, target, allowed_checks: CHECKS, lease_until: Date.now() + 30000, deadline_at: new Date(Date.now() + 60000).toISOString(), lease_token: 'synthetic' };
  const result = { synthetic: true };
  await consumeOne({ message: message(id), control: { claim: async () => attempt, result: async (_id, body) => {
    assert.equal(body, result); order.push('callback'); if (++calls === 1) throw new Error('synthetic network error'); return { accepted: true };
  } }, queue: { ack: async () => order.push('ack') }, runner: async claim => { order.push('run'); assert.equal(claim.target, target); return result; } });
  assert.deepEqual(order, ['run', 'callback', 'callback', 'ack']);
});
test('no ack before durable result; no runner executes for terminal jobs', async () => {
  const id = crypto.randomUUID(); let ack = 0;
  assert.equal(await consumeOne({ message: message(id), control: { claim: async () => ({ terminal: true }) }, queue: { ack: async () => ack++ }, runner: () => { throw new Error('must not run'); } }), 'terminal');
  assert.equal(ack, 1);
  const attempt = { job_id: id, target, allowed_checks: CHECKS, lease_until: Date.now() + 30000, deadline_at: new Date(Date.now() + 60000).toISOString() };
  await assert.rejects(consumeOne({ message: message(id), control: { claim: async () => attempt, result: async () => ({ accepted: false }) }, queue: { ack: async () => ack++ }, runner: async () => ({}) }), /RESULT_NOT_DURABLE/u);
  assert.equal(ack, 1);
});
test('unhealthy supervisor never pulls a job and reports no capacity',async()=>{
  const controller=new AbortController();const requests=[];
  const runner=async()=>{throw new Error('must-not-run');};runner.health=async()=>false;
  const config={origin:'https://control.example.com',executorId:'synthetic',executorKey:crypto.randomUUID(),accountId:'a'.repeat(32),queueId:'b'.repeat(32),queueToken:crypto.randomUUID(),
    fetcher:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});controller.abort();return Response.json({accepted:true});}};
  await supervise(config,runner,controller.signal);
  assert.ok(requests.every(r=>r.url.endsWith('/executors/heartbeat')&&r.body.healthy===false&&r.body.free_slots===0));
});
test('parent cancellation reaches the runner and does not acknowledge an uncommitted result',async()=>{
  const controller=new AbortController();const id=crypto.randomUUID();let ack=0;
  const attempt={job_id:id,target,allowed_checks:CHECKS,lease_until:Date.now()+30000,deadline_at:new Date(Date.now()+60000).toISOString()};
  await assert.rejects(consumeOne({message:message(id),signal:controller.signal,control:{claim:async()=>attempt},queue:{ack:async()=>ack++},
    runner:async(_attempt,signal)=>{controller.abort();signal.throwIfAborted();}}));
  assert.equal(ack,0);
});
