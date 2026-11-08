import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const child = spawn(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, WRANGLER_LOG_PATH: resolve('.wrangler/logs/wrangler.log'), WRANGLER_SEND_METRICS: 'false' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('Não foi possível iniciar o Wrangler local. Execute npm ci.'); process.exitCode = 1; });
