import { CHECKS, VERSIONS } from '../src/contracts.js';

// Adapter for the inspected upstream revision, not approval of a deployment pin.
export const RESEARCH_REVISION = 'fd08be81f700254214ef49d093e71a991567841f';
const SELECTED_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy'];
export function normalizeUpstream(id, raw, provenance, target, observedAt) {
  const empty = (collection, error) => ({ id, collection, observed_at: observedAt, evidence: null, errors: [error], duration_ms: 0 });
  if (!CHECKS.includes(id)) throw new Error('CHECK_NOT_ALLOWLISTED');
  if (!provenance || provenance.target !== target || provenance.peer_verified !== true || provenance.policy_enforced !== true) return empty('bloqueado', 'POLICY_BLOCKED');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'error' in raw || 'errors' in raw) return empty('erro', 'UPSTREAM_MALFORMED');
  const common = { target, peer_verified: true }; let evidence;
  if (id === 'headers') {
    // Upstream returns headers only: status, redirects and bot observations
    // must come from the bounded transport adapter, under the external firewall.
    // This candidate design still requires explicit review; API 200 is no proof.
    if (!Number.isInteger(provenance.http_status) || typeof provenance.interstitial !== 'boolean' || provenance.final_https!==true) return empty('bloqueado', 'POLICY_BLOCKED');
    const headers = {};
    for (const name of SELECTED_HEADERS) {
      const value = raw[name];
      if (value !== undefined && (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value))) return empty('erro', 'UPSTREAM_MALFORMED');
      if (value !== undefined) headers[name] = value;
    }
    evidence = { ...common, http_status: provenance.http_status, interstitial: provenance.interstitial, final_https:true, headers };
  } else if (id === 'ssl') {
    if (typeof raw.isValid !== 'boolean' || !Number.isFinite(Date.parse(raw.valid_from)) || !Number.isFinite(Date.parse(raw.valid_to))) return empty('erro', 'UPSTREAM_MALFORMED');
    evidence = { ...common, identity_valid: raw.isValid && !raw.authError, valid_from: new Date(raw.valid_from).toISOString(), valid_to: new Date(raw.valid_to).toISOString() };
  } else if (id === 'dns') {
    const count = Array.isArray(raw.A) && Array.isArray(raw.AAAA) ? raw.A.length + raw.AAAA.length : 0;
    if (!count || count > 32 || provenance.public_address_count !== count) return empty('erro', 'UPSTREAM_MALFORMED');
    evidence = { ...common, public_address_count: count };
  } else {
    // http-security reports header presence, NOT HTTP→HTTPS transport.
    // Without independently proven transport it remains inconclusive.
    if (typeof provenance.http_reaches_https !== 'boolean') return empty('não_executado', 'NOT_RUN');
    evidence = { ...common, http_reaches_https: provenance.http_reaches_https };
  }
  return { id, collection: 'ok', observed_at: observedAt, evidence, errors: [], duration_ms: 0 };
}
export function resultEnvelope(attempt, checks, durationMs) {
  const v = attempt.versions || VERSIONS;
  return { schema_version: '1', job_id: attempt.job_id, attempt_id: attempt.attempt_id,
    engine: { name: 'web-check', revision: v.engine, image_digest: v.digest }, policy_version: v.policy,
    rules_version: v.rules, result_version: v.result, duration_ms: durationMs, checks };
}
