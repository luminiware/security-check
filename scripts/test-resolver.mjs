import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { DockerCLI } from '../executor/docker.mjs';
const docker=new DockerCLI(),name='security-check-resolver-'+crypto.randomUUID();
const files=['executor/resolver.mjs','src/target.js','src/contracts.js','tests/dns-fixture.mjs','tests/docker/resolver-lab.mjs'];
try {
  const image=await docker.inspect('image','security-check-guardian:lab');
  await docker.run(['create','--name',name,'--network','none','--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--read-only','--memory','128m','--memory-swap','128m','--cpus','1','--pids-limit','32','--log-driver','none',
    ...files.flatMap(file=>['--mount',`type=bind,source=${resolve(file)},target=/guardian/${file},readonly`]),
    '--entrypoint','node',image.Id,'tests/docker/resolver-lab.mjs']);
  const state=await docker.inspect('container',name);assert.equal(state.HostConfig.NetworkMode,'none');
  const output=await docker.run(['start','--attach',name],{timeoutMs:30000,maxBytes:8192});
  assert.equal((await docker.inspect('container',name)).State.ExitCode,0,output.stderr);
  const report=JSON.parse(output.stdout);assert.equal(report.cases.length,9);
  mkdirSync('test-results',{recursive:true});writeFileSync('test-results/resolver-lab.json',JSON.stringify({...report,guardianImage:image.Id},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {try{await docker.run(['rm','--force',name]);}catch{}}
