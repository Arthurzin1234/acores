import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { positiveInt, retryDelay, safeLog, failure } from '../server/reliability.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const limit = positiveInt(process.env.PROCESS_MAX_RESTARTS, 6, 1, 20);
let child, attempts = 0, retry, stable, stopping = false, lastAlert = '', lastAlertAt = 0;

async function notify(code) {
  if (lastAlert === code && Date.now() - lastAlertAt < 600000) return;
  lastAlert = code; lastAlertAt = Date.now();
  safeLog('health_alert', failure(code), attempts);
  if (!process.env.ADMIN_ALERT_WEBHOOK_URL) return;
  try {
    const url = new URL(process.env.ADMIN_ALERT_WEBHOOK_URL);
    if (url.protocol !== 'https:') return;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'acores', event: code, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(7000) });
  } catch { safeLog('health_alert', failure('connection_lost')); }
}

function start() {
  if (stopping) return;
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'server/index.js'], {
    cwd: root, env: process.env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
  });
  stable = setTimeout(() => { attempts = 0; }, 300000);
  const closed = () => {
    clearTimeout(stable); child = null;
    if (stopping) return;
    void notify('connection_lost');
    if (attempts >= limit) { void notify('retry_limit'); return; }
    retry = setTimeout(start, retryDelay(++attempts));
  };
  child.once('error', () => { void notify('unknown'); });
  child.once('exit', closed);
}

const monitor = setInterval(() => {
  if (!child) return;
  try {
    const health = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime-health.json'), 'utf8'));
    if (Date.now() - Date.parse(health.checkedAt) > 90000) { void notify('unknown'); return; }
    if (health.alerts?.length) void notify(health.alerts[0].code);
    else { lastAlert = ''; lastAlertAt = 0; }
  } catch { void notify('database_failure'); }
}, 30000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopping = true; clearInterval(monitor); clearTimeout(retry); clearTimeout(stable);
  if (child) child.kill();
});
start();
