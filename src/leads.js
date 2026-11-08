import { LOCAL, canonical, fail, hash, object, string } from './contracts.js';
import { getJob, stmt } from './store.js';

export async function captureLead(env, session, idem, body, now, demo) {
  object(body, ['analysis_id', 'email', 'name', 'intention', 'consent', 'consent_version'], ['analysis_id', 'email', 'consent', 'consent_version']);
  string(body.analysis_id, 80); string(body.email, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(body.email) || body.consent !== true || body.consent_version !== LOCAL.consent) fail(400, 'CONSENT_REQUIRED', 'Informe um e-mail válido e autorize o pedido de ajuda.');
  if (body.name !== undefined) string(body.name, 100, 0);
  if (body.intention !== undefined) string(body.intention, 1000, 0);
  if (demo && !/^[a-z0-9._+-]+@example\.(com|net|org)$/iu.test(body.email)) fail(400, 'SYNTHETIC_CONTACT_ONLY', 'Na demonstração, use um contato sintético como pessoa@example.com.');
  if (demo && ((body.name && body.name !== 'Pessoa de exemplo') || (body.intention && body.intention !== 'Solicitação sintética de ajuda'))) fail(400, 'SYNTHETIC_CONTACT_ONLY', 'A demonstração aceita somente os textos sintéticos do formulário.');
  const requestHash = await hash(canonical(body));
  const previous = await stmt(env, `SELECT l.id,r.request_hash,l.state FROM lead_requests r JOIN leads l ON l.id=r.lead_id
    WHERE r.session_hash=? AND r.idem_key=?`, session, idem).first();
  if (previous) {
    if (previous.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outros dados.');
    return leadReceipt(previous, demo);
  }
  const job = await getJob(env, body.analysis_id);
  if (!job || job.session_hash !== session) fail(404, 'NOT_FOUND', 'Análise não encontrada.');
  if (job.retain_until <= now) fail(410, 'REPORT_REMOVED', 'Diagnóstico expirado. Faça uma nova análise.');
  if (job.state !== 'concluído' || !job.result_json) fail(409, 'REPORT_REQUIRED', 'Aguarde um diagnóstico disponível antes de pedir ajuda.');
  const report = JSON.parse(job.result_json);
  const id = crypto.randomUUID();
  await env.DB.batch([
    stmt(env, `INSERT OR IGNORE INTO leads(id,job_id,session_hash,idem_key,request_hash,email,name,intention,consent_version,consent_at,summary_json,state,next_attempt_at,retain_until)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,'pendente',?,? FROM jobs
      WHERE id=? AND session_hash=? AND retain_until>? AND state='concluído'`, id, job.id, session, idem, requestHash, body.email.toLowerCase(), body.name || null,
    body.intention || null, LOCAL.consent, now, canonical({ target: job.target, analysis_id: job.id, observed_at: report.observed_at,
      priorities: report.priorities.map(p => ({ id: p.id, observation: p.observation })), synthetic: demo }), now, Math.min(job.retain_until, now + LOCAL.retainMs), job.id, session, now),
    stmt(env, `INSERT OR IGNORE INTO lead_requests(session_hash,idem_key,request_hash,lead_id)
      SELECT ?,?,?,id FROM leads WHERE job_id=? AND email=?`, session, idem, requestHash, job.id, body.email.toLowerCase()),
    stmt(env, `INSERT OR IGNORE INTO events(entity_id,event,occurred_at) SELECT id,'lead_received',consent_at FROM leads WHERE job_id=? AND email=?`, job.id, body.email.toLowerCase()),
  ]);
  const lead = await stmt(env, `SELECT l.id,r.request_hash,l.state FROM lead_requests r JOIN leads l ON l.id=r.lead_id
    WHERE r.session_hash=? AND r.idem_key=?`, session, idem).first();
  if (!lead) fail(409, 'REPORT_UNAVAILABLE', 'Diagnóstico indisponível para este pedido.');
  if (lead.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi usada com outros dados.');
  // Semantic deduplication also protects retries with a fresh client key.
  return leadReceipt(lead, demo);
}
function leadReceipt(lead, demo) {
  return { id: lead.id, state: lead.state, synthetic: demo,
    message: demo ? 'Pedido sintético registrado localmente. Nenhum contato foi enviado ao CRM.' : 'Recebemos seu pedido; o encaminhamento está pendente.' };
}

// No unreviewed HubSpot mapping is shipped. A future approved transport must return
// { status: 'confirmed', crm_id } or { status: 'definitive_failure'|'ambiguous' }.
export async function drainLeads(env, transport, now = Date.now()) {
  const { results } = await stmt(env, "SELECT id FROM leads WHERE state='pendente' AND next_attempt_at<=? AND retain_until>? LIMIT 10", now, now).all();
  for (const item of results) {
    // Claim BEFORE network I/O. A crash after this point requires manual reconciliation.
    const lead = await stmt(env, `UPDATE leads SET state='revisão_manual',attempts=attempts+1,last_code='IN_FLIGHT'
      WHERE id=? AND state='pendente' AND retain_until>? RETURNING *`, item.id, now).first();
    if (!lead) continue;
    let outcome;
    try { outcome = await transport(lead); } catch { outcome = { status: 'ambiguous' }; }
    if (outcome.status === 'confirmed' && typeof outcome.crm_id === 'string' && outcome.crm_id.length <= 100) {
      await stmt(env, "UPDATE leads SET state='enviado',crm_id=?,last_code=NULL WHERE id=? AND state='revisão_manual'", outcome.crm_id, lead.id).run();
    } else if (outcome.status === 'definitive_failure' && lead.attempts < 3) {
      await stmt(env, "UPDATE leads SET state='pendente',next_attempt_at=?,last_code='CRM_RETRY' WHERE id=? AND state='revisão_manual'", now + 60000 * 2 ** lead.attempts, lead.id).run();
    } else {
      await stmt(env, "UPDATE leads SET last_code='CRM_RECONCILIATION_REQUIRED' WHERE id=? AND state='revisão_manual'", lead.id).run();
    }
  }
}
