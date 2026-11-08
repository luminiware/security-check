// Host-side supervisor fixture. Deliberately killed by test-runner.mjs after
// its bounded workload starts. This module never contains control credentials.
import { createIsolatedLabRunner } from '../../executor/runner.mjs';
import { DockerCLI } from '../../executor/docker.mjs';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const docker=new DockerCLI();
const observed={inspect:(...args)=>docker.inspect(...args),run:(args,options)=>{
  if(args[0]==='start'&&args.includes('--attach')) console.log(JSON.stringify({code:'ENGINE_STARTING',name:args.at(-1)}));
  return docker.run(args,options);
}};
const runner=createIsolatedLabRunner({...input.config,docker:observed,
  resolveTarget:async()=>({hostname:'example.com',addresses:[input.address],expires_at:Date.now()+30000})},{fault:'unresponsive'});
try {await runner(input.attempt);} catch {process.exitCode=1;}
