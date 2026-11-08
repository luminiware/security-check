import { spawnSync } from 'node:child_process';
import { resolve, join, sep } from 'node:path';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
const candidate = JSON.parse(readFileSync('executor/upstream.research.json', 'utf8'));
const image = candidate.image + '@' + candidate.amd64_digest;
const inspection = spawnSync('docker', ['image','inspect',image,'--format','{{json .Config.Labels}}'], { encoding: 'utf8' });
if (inspection.status !== 0) { console.error('UPSTREAM_IMAGE_REQUIRED: docker pull ' + image); process.exit(1); }
if (JSON.parse(inspection.stdout)['org.opencontainers.image.revision'] !== candidate.research_revision) { console.error('UPSTREAM_REVISION_MISMATCH'); process.exit(1); }
const daemonArch = spawnSync('docker', ['info','--format','{{.Architecture}}'], { encoding: 'utf8' });
const name = 'security-check-contract-' + process.pid;
const fixtureRoot = resolve('.wrangler/fixtures'); mkdirSync(fixtureRoot, { recursive: true });
const fixtureDir = mkdtempSync(join(fixtureRoot, 'tls-'));
const openssl = process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
const generated = spawnSync(openssl, ['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=example.com',
  '-addext','subjectAltName=DNS:example.com','-keyout',join(fixtureDir,'key.pem'),'-out',join(fixtureDir,'cert.pem')], { encoding: 'utf8' });
if (generated.error || generated.status !== 0) { console.error('OPENSSL_REQUIRED_FOR_EPHEMERAL_TLS_FIXTURE'); process.exit(1); }
const result = spawnSync('docker', ['run','--rm','--name',name,'--network','none','--read-only','--user','65532:65532',
  '--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','512m','--cpus','1',
  '--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--mount',`type=bind,source=${resolve('tests/docker')},target=/tests,readonly`,
  '--mount',`type=bind,source=${fixtureDir},target=/tls,readonly`,
  '--entrypoint','node',image,'/tests/upstream-contract.mjs'], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
if (result.status !== 0 || result.error) {
  spawnSync('docker', ['rm','--force',name], { stdio: 'ignore' });
  console.error(result.stderr || result.error?.message || 'UPSTREAM_CONTRACT_FAILED'); process.exitCode = 1;
} else {
  const payload = JSON.parse(result.stdout.trim().split('\n').at(-1));
  const report = { ...payload, image, revision: candidate.research_revision, observed_at: new Date().toISOString(), production_pin_approved: false,
    runtime_arch: 'amd64', host_arch: daemonArch.stdout.trim(), native_execution: ['x86_64','amd64'].includes(daemonArch.stdout.trim()) };
  mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/upstream-contract.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
// Only the directory created above is eligible for recursive cleanup.
if (resolve(fixtureDir).startsWith(fixtureRoot + sep)) rmSync(fixtureDir, { recursive: true, force: true });
