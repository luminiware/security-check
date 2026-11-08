import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.js';
import { createJob, claim, dispatch, finish, getJob, reconcile, stmt } from '../src/store.js';
import { LOCAL } from '../src/contracts.js';
import { syntheticResult } from '../src/synthetic.js';
import { captureLead, drainLeads } from '../src/leads.js';
let db, env;
before(async () => { db = await database(); env = db.env; });
after(async () => { await db?.dispose(); });
beforeEach(async () => { await env.DB.batch(['leads','attempts','jobs','events','quotas'].map(t => env.DB.prepare('DELETE FROM ' + t))); });
async function admitted(key = crypto.randomUUID(), owner = 'synthetic-session', now = Date.now()) {
  return (await createJob(env, owner, key, 'request', 'https://example.com/', 'complete', now)).job;
}
async function completed() {
  let job = await admitted(); const attempt = await claim(env, job.id, 'executor-a'); job = await getJob(env, job.id);
  const body = syntheticResult(job); await finish(env, job.id, 'executor-a', attempt.lease_token, body);
  return { job, attempt, body };
}
test('idempotent concurrent admission persists only one job and one quota charge', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => createJob(env, 'session', 'same-key', 'hash', 'https://example.com/', 'complete', Date.now())));
  assert.equal(new Set(results.map(r => r.job.id)).size, 1);
  const quotas = await env.DB.prepare('SELECT used FROM quotas').all(); assert.ok(quotas.results.every(q => q.used === 1));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM events').first()).n, 1);
  await assert.rejects(createJob(env, 'session', 'same-key', 'other-hash', 'https://example.com/', 'complete', Date.now()), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('concurrent quota cannot overshoot or leave a runnable rejected job', async () => {
  const results = await Promise.allSettled(Array.from({ length: 15 }, () => admitted()));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, LOCAL.sessionQuota);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n, LOCAL.sessionQuota);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'QUOTA_EXCEEDED'));
});
test('registrable-domain quota cannot be bypassed with subdomains and new sessions', async () => {
  const results = await Promise.allSettled(Array.from({ length: LOCAL.domainQuota + 3 }, (_, i) =>
    createJob(env, 'visitor-' + i, 'domain-key-' + i, 'hash', `https://sub${i}.example.com/`, 'complete', Date.now())));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, LOCAL.domainQuota);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'QUOTA_EXCEEDED'));
});
test('global budget is atomic across visitors and targets; exhaustion returns unavailable', async () => {
  const results = await Promise.allSettled(Array.from({ length: LOCAL.dailyBudget + 3 }, (_, i) => {
    const target = ['example.com','example.org','example.net'][i % 3];
    return createJob(env, 'visitor-' + i, 'budget-key-' + i, 'hash', 'https://' + target + '/', 'complete', Date.now());
  }));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, LOCAL.dailyBudget);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason.code === 'BUDGET_EXHAUSTED' && r.reason.status === 503));
});
test('only one concurrent claim owns the job, with durable attempt', async () => {
  const job = await admitted(); const results = await Promise.allSettled([claim(env, job.id, 'a'), claim(env, job.id, 'b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM attempts').first()).n, 1);
});
test('callbacks require current executor and lease; replay is accepted without mutation', async () => {
  const { job, attempt, body } = await completed();
  assert.equal((await finish(env, job.id, 'executor-a', attempt.lease_token, body)).duplicate, true);
  const altered = structuredClone(body); altered.duration_ms++;
  await assert.rejects(finish(env, job.id, 'executor-a', attempt.lease_token, altered), { code: 'RESULT_CONFLICT' });
  await assert.rejects(finish(env, job.id, 'executor-b', attempt.lease_token, body), { code: 'STALE_ATTEMPT' });
  await assert.rejects(finish(env, job.id, 'executor-a', 'invalid-token', body), { code: 'STALE_ATTEMPT' });
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE event='analysis_concluído'").first()).n, 1);
});
test('identical concurrent callbacks both receive durable acceptance', async () => {
  let job = await admitted(); const attempt = await claim(env, job.id, 'a'); job = await getJob(env, job.id);
  const body = syntheticResult(job);
  const receipts = await Promise.all([finish(env, job.id, 'a', attempt.lease_token, body), finish(env, job.id, 'a', attempt.lease_token, body)]);
  assert.ok(receipts.every(r => r.accepted)); assert.equal(receipts.filter(r => !r.duplicate).length, 1);
});
test('lost leases retry, reject late results, exhaust attempts and preserve terminal state', async () => {
  let job = await admitted(); const start = job.created_at + 100;
  const old = await claim(env, job.id, 'a', start);
  job = await getJob(env, job.id); const oldBody = syntheticResult(job, start + 1);
  await reconcile(env, start + LOCAL.leaseMs + 1);
  const next = await claim(env, job.id, 'b', start + LOCAL.leaseMs + 2);
  await assert.rejects(finish(env, job.id, 'a', old.lease_token, oldBody, start + LOCAL.leaseMs + 3), { code: 'STALE_ATTEMPT' });
  await reconcile(env, next.lease_until + 1);
  assert.equal((await getJob(env, job.id)).state, 'falhou');
  assert.equal((await claim(env, job.id, 'a', next.lease_until + 2)).terminal, true);
});
test('global deadline wins over callbacks at the boundary', async () => {
  let job = await admitted(); const attempt = await claim(env, job.id, 'a'); job = await getJob(env, job.id);
  await assert.rejects(finish(env, job.id, 'a', attempt.lease_token, syntheticResult(job), job.deadline_at), { code: 'LEASE_EXPIRED' });
  await reconcile(env, job.deadline_at); assert.equal((await getJob(env, job.id)).state, 'expirou');
});
test('queue failure keeps durable outbox and dispatch is recoverable', async () => {
  const job = await admitted(); await dispatch({ ...env, JOBS: { send: async () => { throw new Error('synthetic failure'); } } }, job);
  assert.equal((await getJob(env, job.id)).dispatch_pending, 1);
  let deliveries = 0; await dispatch({ ...env, JOBS: { send: async () => { deliveries++; } } }, await getJob(env, job.id));
  assert.equal(deliveries, 1); assert.equal((await getJob(env, job.id)).dispatch_pending, 0);
});
test('lead consent, session, durable receipt and semantic deduplication', async () => {
  const { job } = await completed();
  const body = { analysis_id: job.id, email: 'pessoa@example.com', consent: true, consent_version: LOCAL.consent };
  await assert.rejects(captureLead(env, job.session_hash, 'lead-key', { ...body, consent: false }, Date.now(), true), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(captureLead(env, 'different-session', 'lead-key', body, Date.now(), true), { code: 'NOT_FOUND' });
  const first = await captureLead(env, job.session_hash, 'lead-key', body, Date.now(), true);
  const second = await captureLead(env, job.session_hash, 'new-key', body, Date.now(), true);
  assert.equal(first.id, second.id); assert.equal(first.state, 'pendente');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM leads').first()).n, 1);
  let sends = 0;
  await drainLeads(env, async () => { sends++; throw new Error('ambiguous synthetic response'); });
  await drainLeads(env, async () => { sends++; return { status: 'confirmed', crm_id: 'synthetic' }; });
  assert.equal(sends, 1); assert.equal((await env.DB.prepare('SELECT state FROM leads').first()).state, 'revisão_manual');
});
test('every lead retry key remains bound to its body, including semantic aliases', async () => {
  const { job } = await completed();
  const body = { analysis_id: job.id, email: 'pessoa@example.com', consent: true, consent_version: LOCAL.consent };
  const receipts = await Promise.all(Array.from({ length: 4 }, () => captureLead(env, job.session_hash, 'same-key', body, Date.now(), true)));
  assert.equal(new Set(receipts.map(r => r.id)).size, 1);
  const alias = await captureLead(env, job.session_hash, 'alias-key', body, Date.now(), true); assert.equal(alias.id, receipts[0].id);
  await assert.rejects(captureLead(env, job.session_hash, 'alias-key', { ...body, email: 'outro@example.com' }, Date.now(), true), { code: 'IDEMPOTENCY_CONFLICT' });
  const different = await Promise.allSettled([
    captureLead(env, job.session_hash, 'racing-key', { ...body, email: 'um@example.com' }, Date.now(), true),
    captureLead(env, job.session_hash, 'racing-key', { ...body, email: 'dois@example.com' }, Date.now(), true),
  ]);
  assert.equal(different.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(different.find(r => r.status === 'rejected').reason.code, 'IDEMPOTENCY_CONFLICT');
});
test('reconciliation caps state transitions per tick and does not dispatch expired leftovers', async () => {
  // Construct a larger backlog without bypassing quota safeguards on admission.
  for (let i = 0; i < 25; i++) {
    await env.DB.prepare('DELETE FROM quotas').run();
    await admitted('batch-' + i, 'session-' + i, Date.now() - LOCAL.jobMs - 1000);
  }
  await reconcile(env);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE state='expirou'").first()).n, 20);
  await reconcile(env);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE state='expirou'").first()).n, 25);
});
test('retention removes selected evidence and contact, then tombstone expires', async () => {
  const { job } = await completed();
  await captureLead(env, job.session_hash, 'lead-key', { analysis_id: job.id, email: 'pessoa@example.com', consent: true, consent_version: LOCAL.consent }, Date.now(), true);
  await reconcile(env, job.retain_until + 1);
  const tombstone = await getJob(env, job.id); assert.equal(tombstone.result_json, null); assert.equal(tombstone.target, '');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM leads').first()).n, 0);
  await reconcile(env, job.retain_until + LOCAL.retainMs + 1); assert.equal(await getJob(env, job.id), null);
});
