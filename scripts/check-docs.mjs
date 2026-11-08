import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const files = execFileSync('git', ['ls-files','--cached','--others','--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/u).filter(Boolean);
let links = 0; let errors = 0;
for (const file of files.filter(f => /\.(?:md|[cm]?js|sql|jsonc?|css|html)$/u.test(f))) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) if (/[\t ]+$/u.test(lines[i])) {
    console.error(`${file}:${i + 1}: trailing whitespace`); errors++;
  }
  if (!file.endsWith('.md')) continue;
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1].replace(/^<|>$/gu, '').split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) { console.error(`${file}: missing link ${target}`); errors++; }
    links++;
  }
}
console.log(`${files.filter(f => f.endsWith('.md')).length} Markdown files, ${links} local links checked; whitespace checked for source files.`);
if (errors) process.exitCode = 1;
