// Trusted, lab-only preparation. Never imported into the production guardian.
import { spawnSync } from 'node:child_process';
if(process.env.ISOLATED_TEST_FIXTURES!=='true')throw new Error('ISOLATED_LAB_REQUIRED');
const applied=spawnSync('ip',['-6','route','replace','2001:db8:5d:2::/64','via','2001:db8:5d:1::fe','dev','eth0'],{encoding:'utf8',timeout:2000});
if(applied.status!==0)throw new Error('LAB_ROUTE_SETUP_FAILED');
await import('./executor/guardian/main.mjs');
