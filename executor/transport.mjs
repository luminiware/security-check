import { jsonBody, object, string } from '../src/contracts.js';

export class ControlClient {
  constructor({ origin, executorId, executorKey, fetcher = fetch }) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('CONTROL_REQUIRES_HTTPS_ORIGIN');
    Object.assign(this, { origin: url.origin, executorId, executorKey, fetcher });
  }
  async post(path, body, lease) {
    const res = await this.fetcher(this.origin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.executorKey, 'x-executor-id': this.executorId,
        ...(lease ? { 'x-lease-token': lease } : {}) }, body: JSON.stringify(body) });
    const payload = await jsonBody(res, 65536);
    if (!res.ok) { const error = new Error('CONTROL_REJECTED'); error.status = res.status; error.code = payload.code; throw error; }
    return payload;
  }
  claim(id) { return this.post('/internal/v1/jobs/' + validId(id) + '/claim', { schema_version: '1' }); }
  result(id, body, lease) { return this.post('/internal/v1/jobs/' + validId(id) + '/result', body, lease); }
  heartbeat(body) { return this.post('/internal/v1/executors/heartbeat', body); }
}
function validId(id) { if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error('INVALID_JOB_ID'); return id; }
export function decodeMessage(message) {
  if (!message || typeof message.body !== 'string' || message.body.length > 8192) throw new Error('INVALID_QUEUE_MESSAGE');
  const encoding = message.metadata?.['CF-Content-Type'];
  let body;
  if (encoding === 'json') body = JSON.parse(Buffer.from(message.body, 'base64').toString('utf8'));
  else if (encoding === 'text') body = JSON.parse(message.body);
  else throw new Error('UNSUPPORTED_QUEUE_ENCODING');
  object(body, ['schema_version', 'job_id', 'target', 'allowed_checks', 'policy_version', 'deadline_at']);
  validId(body.job_id); string(message.lease_id, 4096);
  return body;
}
export class QueueClient {
  constructor({ accountId, queueId, queueToken, fetcher = fetch }) {
    if (![accountId, queueId].every(v => /^[a-f0-9]{32}$/u.test(v))) throw new Error('INVALID_QUEUE_CONFIG');
    Object.assign(this, { endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages`, queueToken, fetcher });
  }
  async post(action, body) {
    const response = await this.fetcher(this.endpoint + '/' + action, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.queueToken }, body: JSON.stringify(body) });
    const data = await jsonBody(response, 65536);
    if (!response.ok || data.success !== true) throw new Error('QUEUE_UNAVAILABLE');
    return data;
  }
  async pull(visibilityMs) {
    const data = await this.post('pull', { batch_size: 1, visibility_timeout_ms: visibilityMs });
    if (!Array.isArray(data.result?.messages) || data.result.messages.length > 1) throw new Error('INVALID_QUEUE_RESPONSE');
    return data.result.messages;
  }
  ack(lease) { return this.post('ack', { acks: [{ lease_id: string(lease, 4096) }], retries: [] }); }
  retry(lease) { return this.post('ack', { acks: [], retries: [{ lease_id: string(lease, 4096), delay_seconds: 30 }] }); }
}
