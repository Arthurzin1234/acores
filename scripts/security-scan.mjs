import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(), findings = [];
const secret = /(?:sk-(?:proj-)?[a-zA-Z0-9_-]{24,}|gsk_[a-zA-Z0-9_-]{20,}|AIza[\w-]{30,}|AQ\.[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g;
function scan(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','server/auth','.sites-runtime'].includes(item.name) || (dir.endsWith('server') && item.name === 'auth')) continue;
    const file = path.join(dir, item.name), relative = path.relative(root, file);
    if (item.isDirectory()) { if (relative === 'data') { for (const log of fs.readdirSync(file).filter((n) => n.endsWith('.log'))) inspect(path.join(file, log)); } else scan(file); }
    else if (/\.(?:js|jsx|mjs|json|html|css|md|log)$/.test(item.name) || item.name.startsWith('.env')) inspect(file);
  }
}
function inspect(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.match(secret)) findings.push({ file: path.relative(root, file), issue: 'Possível segredo. Valor omitido.' });
  if (path.basename(file).startsWith('.env') && !file.endsWith('.example')) {
    for (const line of content.split(/\r?\n/)) if (/^VITE_.*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=.+/.test(line)) findings.push({ file: path.relative(root, file), issue: 'Segredo em variável pública VITE_.' });
  }
}
scan(root);
const unsafeEnv = Object.keys(process.env).filter((name) => /^VITE_.*(?:KEY|TOKEN|SECRET|PASSWORD)/.test(name));
for (const name of unsafeEnv) findings.push({ variable: name, issue: 'Variável pública sensível.' });
const git = spawnSync('git', ['rev-parse','--is-inside-work-tree'], { encoding: 'utf8' });
if (git.status === 0) {
  const history = spawnSync('git', ['log','--all','-p','--format='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (history.status !== 0 || secret.test(history.stdout || '')) findings.push({ issue: 'Histórico Git exige revisão restrita; valores omitidos.' });
}
console.log(JSON.stringify({ date: new Date().toISOString(), gitHistoryAvailable: git.status === 0, findings, note: 'Heurística, não substitui rotação nem scanner dedicado. Banco criptografado e conversa do assistente não são examinados.' }, null, 2));
if (findings.length) process.exitCode = 1;
