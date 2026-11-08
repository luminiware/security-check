import { CHECKS, LOCAL, Problem, VERSIONS, canonical, fail, hash, jsonBody, object, secretEqual, string, token } from './contracts.js';
import { normalizeTarget, syntheticTarget } from './target.js';
import { claim, completeQuick, createJob, finish, getJob, publicJob, reconcile, stmt } from './store.js';
import { SCENARIOS, syntheticResult } from './synthetic.js';
import { captureLead } from './leads.js';
import { collectQuick } from './quick-check.js';

const SECURITY = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function response(value, status = 200, extra = {}) { return Response.json(value, { status, headers: { ...SECURITY, ...extra } }); }
function localDemo(request, env) { return env.DEMO === 'true' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname); }
function originCheck(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'ORIGIN_DENIED', 'Origem não autorizada.');
}
function sessionToken(request, demo) {
  const name = demo ? 'sc_local' : '__Host-sc';
  const value = request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.slice(name.length + 1);
  return value && /^[a-f0-9-]{72}$/u.test(value) ? value : null;
}
function cookie(value, demo) { return `${demo ? 'sc_local' : '__Host-sc'}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${demo ? '' : '; Secure'}`; }
function idemKey(request) { return string(request.headers.get('idempotency-key'), 128, 8); }
async function session(request, demo, required = true) {
  const value = sessionToken(request, demo); if (!value && required) fail(403, 'SESSION_REQUIRED', 'Atualize a página para iniciar uma sessão.');
  if (!value) return null;
  return hash(value);
}
async function internalAuth(request, env) {
  const keyId = request.headers.get('x-executor-id');
  let keys; try { keys = JSON.parse(env.EXECUTOR_KEYS || '{}'); } catch { fail(503, 'EXECUTOR_UNCONFIGURED', 'Executor indisponível.'); }
  const key = keyId && Object.hasOwn(keys, keyId) ? keys[keyId] : null;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer /u, '');
  if (typeof key !== 'string' || key.length < 32 || !await secretEqual(key, supplied)) fail(403, 'EXECUTOR_DENIED', 'Executor não autorizado.');
  return keyId;
}

export async function siteverify(request, env, turnstileToken) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_HOSTNAME) fail(503, 'TURNSTILE_UNCONFIGURED', 'Análises temporariamente indisponíveis.', true);
  string(turnstileToken, 2048);
  const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: turnstileToken }),
    signal: AbortSignal.timeout(8000) });
  const data = await jsonBody(verify, 8192);
  if (!verify.ok || data.success !== true || data.hostname !== env.TURNSTILE_HOSTNAME || data.action !== 'security-check') fail(403, 'TURNSTILE_INVALID', 'Refaça a validação para continuar.');
}

async function runSynthetic(env, id, withDelay = true) {
  // Local fixture execution only. No traffic to the submitted domain.
  if (withDelay) await new Promise(resolve => setTimeout(resolve, 1500));
  const attempt = await claim(env, id, 'local-synthetic');
  if (attempt.terminal) return;
  if (withDelay) await new Promise(resolve => setTimeout(resolve, 500));
  const job = await getJob(env, id);
  await finish(env, id, 'local-synthetic', attempt.lease_token, syntheticResult(job));
}

async function runQuick(env,id) {
  try {
    const job=await getJob(env,id);
    if (!job || job.scenario!=='quick') return;
    await stmt(env,"UPDATE jobs SET state='executando' WHERE id=? AND scenario='quick' AND state='pendente'",id).run();
    const checks=await collectQuick(job.target);
    await completeQuick(env,id,checks);
  } catch {
    // Never send the target, raw response or internal failure into logs.
    await stmt(env,"UPDATE jobs SET state='falhou',finished_at=?,dispatch_pending=0,failure_code='QUICK_COLLECTION_ERROR' WHERE id=? AND scenario='quick' AND state IN ('pendente','executando')",Date.now(),id).run();
  }
}
export async function handle(request, env, ctx) {
  const url = new URL(request.url); const path = url.pathname; const demo = localDemo(request, env); const quick = !demo && env.QUICK_CHECK_ENABLED === 'true'; const now = Date.now();
  if (path === '/api/v1/config' && request.method === 'GET') {
    const current = sessionToken(request, demo); const value = current || token();
    return response({ demo, admission: demo || quick, leads: demo, consent_version: LOCAL.consent,
      turnstile_sitekey: quick ? env.TURNSTILE_SITEKEY || null : null,
      message: demo ? 'Demonstração local com evidências sintéticas. Nenhum site é acessado.' : quick ? 'Quick Check: HTTP, headers e DNS. Sem inspeção detalhada de TLS.' : 'Análises temporariamente indisponíveis.',
      scenarios: demo ? SCENARIOS : [] }, 200, current ? {} : { 'Set-Cookie': cookie(value, demo) });
  }
  if (path.startsWith('/internal/')) {
    if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    const executorId = await internalAuth(request, env);
    const body = await jsonBody(request);
    if (path === '/internal/v1/executors/heartbeat') {
      object(body, ['schema_version', 'healthy', 'free_slots', 'versions']);
      object(body.versions, Object.keys(VERSIONS));
      if (body.schema_version !== '1' || typeof body.healthy !== 'boolean' || !Number.isInteger(body.free_slots) || body.free_slots < 0 || body.free_slots > 16 || canonical(body.versions) !== canonical(VERSIONS)) fail(400, 'INVALID_HEALTH', 'Estado de executor inválido.');
      await stmt(env, `INSERT INTO executor_health(id,updated_at,free_slots,versions_json,healthy) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,free_slots=excluded.free_slots,versions_json=excluded.versions_json,healthy=excluded.healthy`, executorId, now, body.free_slots, canonical(body.versions), Number(body.healthy)).run();
      return response({ accepted: true });
    }
    const match = /^\/internal\/v1\/jobs\/([a-f0-9-]{36})\/(claim|result)$/u.exec(path);
    if (!match) fail(404, 'NOT_FOUND', 'Recurso não encontrado.');
    if (match[2] === 'claim') {
      object(body, ['schema_version']); if (body.schema_version !== '1') fail(400, 'INVALID_VERSION', 'Versão inválida.');
      return response(await claim(env, match[1], executorId, now));
    }
    return response(await finish(env, match[1], executorId, string(request.headers.get('x-lease-token'), 128), body, now));
  }
  if (path === '/api/v1/analyses' && request.method === 'POST') {
    originCheck(request); const owner = await session(request, demo); const idem = idemKey(request);
    const body = await jsonBody(request, 4096);
    object(body, ['target', 'turnstile_token', 'scenario'], ['target', 'turnstile_token']);
    const target = normalizeTarget(body.target);
    if (body.scenario !== undefined && !SCENARIOS.includes(body.scenario)) fail(400, 'INVALID_SCENARIO', 'Cenário inválido.');
    const scenario = demo ? body.scenario || 'complete' : 'quick';
    const requestHash = await hash(canonical({ target, scenario }));
    const existing = await stmt(env, 'SELECT * FROM jobs WHERE session_hash=? AND idem_key=?', owner, idem).first();
    if (existing) {
      if (existing.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outros dados.');
      if (existing.retain_until <= now) fail(410, 'REPORT_REMOVED', 'Relatório removido por retenção.');
      return response(publicJob(existing), 202);
    }
    if (!demo && !quick) fail(503, 'LAUNCH_REVIEW_REQUIRED', 'Análises temporariamente indisponíveis.', true);
    if (demo && !syntheticTarget(target)) fail(400, 'SYNTHETIC_TARGET_ONLY', 'Na demonstração, use example.com, example.org ou example.net.');
    if (!demo && body.scenario !== undefined) fail(400, 'INVALID_SCENARIO', 'Cenários sintéticos não são públicos.');
    if (quick) await siteverify(request,env,body.turnstile_token);
    const { job, created } = await createJob(env, owner, idem, requestHash, target, scenario, now);
    if (created) ctx.waitUntil((demo ? runSynthetic(env,job.id) : runQuick(env,job.id)).catch(() => {}));
    return response(publicJob(job), 202);
  }
  const analysis = /^\/api\/v1\/analyses\/([a-f0-9-]{36})$/u.exec(path);
  if (analysis && ['GET', 'DELETE'].includes(request.method)) {
    if (request.method === 'DELETE') originCheck(request);
    const owner = await session(request, demo, false); const job = await getJob(env, analysis[1]);
    if (!job || job.session_hash !== owner) fail(404, 'NOT_FOUND', 'Análise não encontrada.');
    if (job.retain_until <= now) fail(410, 'REPORT_REMOVED', 'Relatório removido por retenção.');
    if (request.method === 'DELETE') {
      await env.DB.batch([
        stmt(env, 'DELETE FROM leads WHERE job_id=?', job.id),
        stmt(env, 'DELETE FROM jobs WHERE id=?', job.id),
      ]);
      return response({ deleted: true, message: 'Dados ativos removidos. Backups seguem sua própria janela de retenção.' });
    }
    // Lazy expiry is a state transition, never a new scan.
    if (['pendente', 'executando'].includes(job.state) && job.deadline_at <= now) {
      await stmt(env, "UPDATE jobs SET state='expirou',finished_at=?,lease_hash=NULL,dispatch_pending=0,failure_code='DEADLINE' WHERE id=? AND state IN ('pendente','executando')", now, job.id).run();
      return response(publicJob(await getJob(env, job.id)));
    }
    return response(publicJob(job));
  }
  if (path === '/api/v1/leads' && request.method === 'POST') {
    originCheck(request); const owner = await session(request, demo); const idem = idemKey(request);
    if (!demo) fail(503, 'CONSENT_REVIEW_REQUIRED', 'Pedidos de ajuda temporariamente indisponíveis.', true);
    return response(await captureLead(env, owner, idem, await jsonBody(request, 4096), now, demo), 202);
  }
  if (path.startsWith('/api/') || path.startsWith('/internal/')) fail(404, 'NOT_FOUND', 'Recurso não encontrado.');
  if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
  if (path === '/') return Response.redirect(url.origin + '/security', 302);
  if (path === '/security' || path === '/security/') url.pathname = '/index.html';
  const asset = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(asset.headers); for (const [key, value] of Object.entries(SECURITY)) headers.set(key, value);
  return new Response(asset.body, { status: asset.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    try { return await handle(request, env, ctx); }
    catch (error) {
      const known = error instanceof Problem;
      // No request, target, contact, lease or upstream payload enters logs.
      if (!known) console.error(JSON.stringify({ request_id: requestId, code: 'DEPENDENCY_FAILURE' }));
      return response({ code: known ? error.code : 'DEPENDENCY_FAILURE', message: known ? error.message : 'Serviço temporariamente indisponível.',
        retryable: known ? error.retryable : true, request_id: requestId }, known ? error.status : 503,
      known && [429, 503].includes(error.status) ? { 'Retry-After': error.status === 429 ? '86400' : '60' } : {});
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(reconcile(env, Date.now(), runSynthetic)); },
};
