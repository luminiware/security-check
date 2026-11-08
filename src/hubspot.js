import { jsonBody } from './contracts.js';

// No account-specific field names or object choice are inferred here. This
// adapter stays disconnected from scheduled until P4/G6 explicitly approves
// object, unique property, mapping, scopes, retention and consent wording.
export function hubspotTransport({ accessToken, mapping, fetcher = fetch }) {
  if (!accessToken || !mapping || mapping.reviewed !== true ||
      !/^[a-z0-9_-]+$/u.test(mapping.objectType || '') ||
      !/^[a-z][a-z0-9_]*$/u.test(mapping.uniqueProperty || '')) throw new Error('CRM_MAPPING_REVIEW_REQUIRED');
  const fields = ['email', 'name', 'intention', 'domain', 'analysis_id', 'observed_at', 'priorities', 'consent_version'];
  if (!mapping.properties || Object.keys(mapping.properties).some(k => !fields.includes(k)) ||
      Object.values(mapping.properties).some(v => !/^[a-z][a-z0-9_]*$/u.test(v)) ||
      new Set(Object.values(mapping.properties)).size !== Object.values(mapping.properties).length ||
      Object.values(mapping.properties).includes(mapping.uniqueProperty) || !mapping.properties.email) throw new Error('INVALID_CRM_MAPPING');
  return async lead => {
    if (!lead.consent_at || !lead.consent_version || lead.state !== 'revisão_manual') throw new Error('CONSENT_REQUIRED');
    const summary = JSON.parse(lead.summary_json);
    if (summary.synthetic) throw new Error('SYNTHETIC_CRM_DELIVERY_FORBIDDEN');
    const values = { email: lead.email, name: lead.name, intention: lead.intention, domain: summary.target,
      analysis_id: summary.analysis_id, observed_at: summary.observed_at,
      priorities: JSON.stringify(summary.priorities), consent_version: lead.consent_version };
    const properties = { [mapping.uniqueProperty]: lead.id };
    for (const [field, property] of Object.entries(mapping.properties)) if (values[field] !== null && values[field] !== undefined) properties[property] = values[field];
    // Same external ID on retries; no repeated creation of notes or emails.
    const response = await fetcher(`https://api.hubapi.com/crm/v3/objects/${mapping.objectType}/batch/upsert`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: [{ id: lead.id, idProperty: mapping.uniqueProperty, properties }] }),
    });
    if (response.status === 429) { await response.body?.cancel(); return { status: 'definitive_failure' }; }
    if (!response.ok) { await response.body?.cancel(); return { status: 'ambiguous' }; }
    const payload = await jsonBody(response, 16384);
    if (payload.status !== 'COMPLETE' || !Array.isArray(payload.results) || payload.results.length !== 1 ||
        payload.numErrors || payload.errors?.length || typeof payload.results[0].id !== 'string') return { status: 'ambiguous' };
    return { status: 'confirmed', crm_id: payload.results[0].id };
  };
}
