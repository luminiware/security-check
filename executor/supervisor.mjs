import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CHECKS, VERSIONS, canonical } from '../src/contracts.js';
import { QueueClient, ControlClient, decodeMessage } from './transport.mjs';

export async function consumeOne({ message, control, queue, runner, signal, now = Date.now }) {
  signal?.throwIfAborted();
  const reference = decodeMessage(message);
  // D1 claim is authoritative. A forged queue target is never sent to a runner.
  const attempt = await control.claim(reference.job_id);
  if (attempt.terminal) { await queue.ack(message.lease_id); return 'terminal'; }
  if (attempt.job_id !== reference.job_id || canonical(attempt.allowed_checks) !== canonical(CHECKS) || Date.parse(attempt.deadline_at) <= now() || attempt.lease_until <= now()) throw new Error('INVALID_CLAIM');
  if (!runner) throw new Error('NETWORK_GUARDIAN_PENDING');
  const deadline = Math.min(attempt.lease_until, Date.parse(attempt.deadline_at));
  const result = await runner(attempt, AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(Math.max(1, deadline - now() - 1000))]));
  signal?.throwIfAborted();
  // Retry identical callback in-memory; never rerun a scan on ambiguous receipt.
  let accepted;
  for (let i = 0; i < 2; i++) {
    try { accepted = await control.result(attempt.job_id, result, attempt.lease_token); break; }
    catch (error) { if (error.status && error.status < 500) throw error; if (i === 1 || now() + 1000 >= deadline) throw error; }
  }
  if (accepted?.accepted !== true) throw new Error('RESULT_NOT_DURABLE');
  await queue.ack(message.lease_id);
  return 'accepted';
}

export async function main() {
  // Deliberately no direct HTTP fallback and no upstream process without P2.
  // Candidate guardian/runner exist, but their remaining G2 checks, resolver,
  // reviewed configuration and remote integration are not implicitly approved.
  console.error(JSON.stringify({ code: 'EXECUTOR_REVIEW_REQUIRED', healthy: false }));
  process.exitCode = 1;
}

// Integration entrypoint for controlled tests / an eventual reviewed runner.
export async function supervise(config, runner, signal) {
  if (typeof runner !== 'function') throw new Error('NETWORK_GUARDIAN_PENDING');
  const control = new ControlClient(config); const queue = new QueueClient(config);
  while (!signal.aborted) {
    try {
      if (runner.maintenance) await runner.maintenance();
      const healthy = typeof runner.health === 'function' && await runner.health();
      await control.heartbeat({ schema_version: '1', healthy, free_slots: healthy?1:0, versions: config.versions || VERSIONS });
      if (healthy) {
        const messages = await queue.pull(60000);
        for (const message of messages) {
          await control.heartbeat({ schema_version: '1', healthy: true, free_slots: 0, versions: config.versions || VERSIONS });
          try { await consumeOne({ message, control, queue, runner, signal }); }
          catch { await queue.retry(message.lease_id); }
        }
      }
    } catch {
      try { await control.heartbeat({schema_version:'1',healthy:false,free_slots:0,versions:config.versions||VERSIONS}); } catch { /* Existing heartbeat still expires. */ }
      console.error(JSON.stringify({ code: 'EXECUTOR_CYCLE_FAILED' }));
    }
    try { await delay(5000, undefined, { signal }); } catch { break; }
  }
  await control.heartbeat({ schema_version: '1', healthy: false, free_slots: 0, versions: config.versions || VERSIONS });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
