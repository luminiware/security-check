import { CHECKS, LOCAL, VERSIONS, QUICK_VERSIONS, canonical, fail, hash, token } from './contracts.js';
import { makeReport, makeQuickReport, validateResult } from './report.js';
import { quotaDomains } from './domains.js';

export const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export const getJob = (env, id) => stmt(env, 'SELECT * FROM jobs WHERE id=?', id).first();
export function jobMessage(job) {
  return { schema_version: '1', job_id: job.id, target: job.target, allowed_checks: CHECKS,
    policy_version: JSON.parse(job.versions_json).policy, deadline_at: new Date(job.deadline_at).toISOString() };
}
export function publicJob(job) {
  return { schema_version: '1', id: job.id, target: job.target, state: job.state,
    created_at: new Date(job.created_at).toISOString(), deadline_at: new Date(job.deadline_at).toISOString(),
    poll_after_ms: LOCAL.pollMs, status_url: '/api/v1/analyses/' + job.id,
    progress: { completed: job.result_json ? CHECKS.length : 0, total: CHECKS.length },
    report: job.result_json ? JSON.parse(job.result_json) : null, failure_code: job.failure_code,
    synthetic: job.scenario !== null && job.scenario !== 'quick' };
}
export async function createJob(env, session, idem, requestHash, target, scenario, now) {
  const id = crypto.randomUUID();
  const day = Math.floor(now / 86400000); const expiry = (day + 2) * 86400000;
  const domains = quotaDomains(target);
  const buckets = [`session:${session}:${day}`, `domain:${await hash(domains.registrable)}:${day}`, `host:${await hash(domains.hostname)}:${day}`, `budget:${day}`];
  const limits = [LOCAL.sessionQuota, LOCAL.domainQuota, LOCAL.domainQuota, LOCAL.dailyBudget];
  try {
    await env.DB.batch([
      ...buckets.map((b, i) => stmt(env, 'INSERT OR IGNORE INTO quotas(bucket,expires_at,limit_value) VALUES(?,?,?)', b, expiry, limits[i])),
      stmt(env, `INSERT OR IGNORE INTO jobs(id,session_hash,idem_key,request_hash,target,scenario,state,created_at,deadline_at,retain_until,versions_json,session_bucket,domain_bucket,host_bucket,budget_bucket)
        VALUES(?,?,?,?,?,?,'pendente',?,?,?,?,?,?,?,?)`, id, session, idem, requestHash, target, scenario,
      now, now + LOCAL.jobMs, now + LOCAL.retainMs, canonical(scenario === 'quick' ? QUICK_VERSIONS : VERSIONS), ...buckets),
    ]);
  } catch (error) {
    if (String(error).includes('BUDGET_EXHAUSTED')) fail(503, 'BUDGET_EXHAUSTED', 'Análises temporariamente indisponíveis.', true);
    if (String(error).includes('QUOTA_EXCEEDED')) fail(429, 'QUOTA_EXCEEDED', 'Limite temporário atingido. Tente no próximo período.', true);
    throw error;
  }
  const job = await stmt(env, 'SELECT * FROM jobs WHERE session_hash=? AND idem_key=?', session, idem).first();
  if (job.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outros dados.');
  return { job, created: job.id === id };
}
export async function dispatch(env, job, now = Date.now()) {
  if (!job.dispatch_pending || job.deadline_at <= now) return;
  try {
    await env.JOBS.send(jobMessage(job));
    await stmt(env, 'UPDATE jobs SET dispatch_pending=0 WHERE id=? AND state=\'pendente\'', job.id).run();
  } catch {
    await stmt(env, 'UPDATE jobs SET dispatch_tries=dispatch_tries+1,dispatch_after=? WHERE id=?', now + Math.min(30000, 1000 * 2 ** Math.min(job.dispatch_tries, 5)), job.id).run();
  }
}
export async function claim(env, id, executorId, now = Date.now()) {
  const attempt = crypto.randomUUID(); const lease = token(); const leaseHash = await hash(lease);
  const row = await stmt(env, `UPDATE jobs SET state='executando',attempts=attempts+1,attempt_id=?,lease_hash=?,lease_until=MIN(deadline_at,?),executor_id=?,attempt_started_at=?,dispatch_pending=0
    WHERE id=? AND state='pendente' AND deadline_at>? AND attempts<? RETURNING *`,
  attempt, leaseHash, now + LOCAL.leaseMs, executorId, now, id, now, LOCAL.maxAttempts).first();
  if (!row) {
    const existing = await getJob(env, id);
    if (!existing) fail(404, 'NOT_FOUND', 'Análise não encontrada.');
    if (['concluído', 'falhou', 'expirou'].includes(existing.state)) return { terminal: true, state: existing.state };
    fail(409, 'CLAIM_CONFLICT', 'Análise indisponível para esta tentativa.', true);
  }
  return { ...jobMessage(row), attempt_id: attempt, lease_token: lease, lease_until: row.lease_until,
    versions: JSON.parse(row.versions_json), scenario: row.scenario };
}
export async function finish(env, id, executorId, leaseToken, body, now = Date.now()) {
  const job = await getJob(env, id); if (!job) fail(404, 'NOT_FOUND', 'Análise não encontrada.');
  const leaseHash = await hash(leaseToken); const resultHash = await hash(canonical(body));
  if (job.executor_id !== executorId || job.lease_hash !== leaseHash || job.attempt_id !== body.attempt_id) fail(409, 'STALE_ATTEMPT', 'Tentativa não é mais válida.');
  if (job.result_hash) {
    if (job.result_hash !== resultHash) fail(409, 'RESULT_CONFLICT', 'Tentativa já finalizada com outro resultado.');
    return { accepted: true, duplicate: true, state: job.state };
  }
  if (job.state !== 'executando' || job.deadline_at <= now || job.lease_until <= now) fail(409, 'LEASE_EXPIRED', 'Prazo da tentativa expirou.');
  validateResult(body, job, now);
  const report = makeReport(body.checks, job.target, new Date(now).toISOString(),JSON.parse(job.versions_json));
  const state = report.useful ? 'concluído' : 'falhou';
  const row = await stmt(env, `UPDATE jobs SET state=?,finished_at=?,result_hash=?,result_json=?,failure_code=?
    WHERE id=? AND state='executando' AND attempt_id=? AND lease_hash=? AND deadline_at>? AND lease_until>? RETURNING id`,
  state, now, resultHash, canonical(report), report.useful ? null : 'NO_USEFUL_EVIDENCE', id, body.attempt_id, leaseHash, now, now).first();
  if (!row) {
    const accepted = await getJob(env, id);
    if (accepted?.attempt_id === body.attempt_id && accepted.executor_id === executorId && accepted.lease_hash === leaseHash && accepted.result_hash === resultHash) {
      return { accepted: true, duplicate: true, state: accepted.state };
    }
    fail(409, 'STALE_ATTEMPT', 'Tentativa não é mais válida.');
  }
  return { accepted: true, duplicate: false, state };
}
export async function reconcile(env, now = Date.now(), recoverSynthetic) {
  await env.DB.batch([
    stmt(env, `UPDATE jobs SET state='expirou',finished_at=?,lease_hash=NULL,failure_code='DEADLINE',dispatch_pending=0
      WHERE id IN (SELECT id FROM jobs WHERE state IN ('pendente','executando') AND deadline_at<=? ORDER BY deadline_at LIMIT 20)`, now, now),
    stmt(env, `UPDATE jobs SET state=CASE WHEN attempts>=? THEN 'falhou' ELSE 'pendente' END,
      failure_code=CASE WHEN attempts>=? THEN 'ATTEMPTS_EXHAUSTED' ELSE NULL END,
      finished_at=CASE WHEN attempts>=? THEN ? ELSE NULL END,
      lease_hash=NULL,attempt_id=NULL,dispatch_pending=CASE WHEN attempts>=? THEN 0 ELSE 1 END,dispatch_after=?
      WHERE id IN (SELECT id FROM jobs WHERE state='executando' AND lease_until<=? AND deadline_at>? ORDER BY lease_until LIMIT 20)`, LOCAL.maxAttempts, LOCAL.maxAttempts, LOCAL.maxAttempts, now, LOCAL.maxAttempts, now, now, now),
    stmt(env, 'DELETE FROM leads WHERE id IN (SELECT id FROM leads WHERE retain_until<=? ORDER BY retain_until LIMIT 20)', now),
    // Retain an access tombstone for one local day, without target, result or contact.
    stmt(env, `UPDATE jobs SET target='',result_json=NULL,lease_hash=NULL,result_hash=NULL,scenario=NULL,dispatch_pending=0
      WHERE id IN (SELECT id FROM jobs WHERE retain_until<=? AND target!='' ORDER BY retain_until LIMIT 20)`, now),
    stmt(env, 'DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE retain_until<=? ORDER BY retain_until LIMIT 20)', now - LOCAL.retainMs),
    stmt(env, 'DELETE FROM quotas WHERE bucket IN (SELECT bucket FROM quotas WHERE expires_at<=? ORDER BY expires_at LIMIT 60)', now),
    stmt(env, 'DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE occurred_at<=? ORDER BY occurred_at LIMIT 100)', now - LOCAL.retainMs),
  ]);
  const { results } = await stmt(env, `SELECT * FROM jobs WHERE dispatch_pending=1 AND dispatch_after<=? AND deadline_at>? AND state='pendente' LIMIT 20`, now, now).all();
  for (const job of results) {
    if (job.scenario === 'quick') continue; // Quick Check never enqueues an advanced engine job.
    if (!job.scenario) await dispatch(env, job, now);
    else if (recoverSynthetic && env.DEMO === 'true') await recoverSynthetic(env, job.id, false);
  }
}

/** Persist a report produced by the trusted Worker collector (not an external callback). */
export async function completeQuick(env, id, checks, now=Date.now()) {
  const job=await getJob(env,id);
  if(!job || job.scenario!=='quick' || !['pendente','executando'].includes(job.state)) fail(409,'QUICK_JOB_INVALID','Análise indisponível.');
  const report=makeQuickReport(checks,job.target,new Date(now).toISOString(),JSON.parse(job.versions_json));
  const state=report.useful?'concluído':'falhou';
  const updated=await stmt(env,`UPDATE jobs SET state=?,finished_at=?,result_json=?,dispatch_pending=0,failure_code=?
    WHERE id=? AND scenario='quick' AND state IN ('pendente','executando') AND deadline_at>?`,
    state,now,canonical(report),report.useful?null:'NO_USEFUL_EVIDENCE',id,now).run();
  if(updated.meta?.changes!==1) fail(409,'QUICK_JOB_EXPIRED','Análise expirada.');
  return report;
}
