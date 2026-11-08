import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : /\.[cm]?js$/u.test(e.name) ? [join(dir, e.name)] : []); }
for (const file of ['src', 'public', 'executor', 'scripts', 'tests'].flatMap(walk)) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}
console.log('JavaScript syntax checked.');
