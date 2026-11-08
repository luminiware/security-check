import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { VERSIONS, canonical } from '../src/contracts.js';
export async function database() {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'test', modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-11-07', d1Databases: ['DB'] }], host: '127.0.0.1' }));
  const DB = await mf.getD1Database('DB', 'test');
  const migrationDir = new URL('../migrations/', import.meta.url);
  const sql = readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(new URL(f, migrationDir), 'utf8')).join('\n');
  let current = ''; let trigger = false;
  for (const line of sql.split('\n')) {
    if (/^CREATE TRIGGER/u.test(line)) trigger = true;
    current += line + '\n';
    if ((!trigger && line.trim().endsWith(';')) || (trigger && /^END;/u.test(line))) {
      await DB.prepare(current).run(); current = ''; trigger = false;
    }
  }
  return { env: { DB, JOBS: { send: async () => {} }, DEMO: 'true' }, dispose: () => mf.dispose(), mf };
}
export function syntheticJob(now = Date.now(), scenario = 'complete') {
  return { id: crypto.randomUUID(), attempt_id: crypto.randomUUID(), target: 'https://example.com/', scenario,
    created_at: now - 1000, versions_json: canonical(VERSIONS) };
}
