import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryDelay, safeLog, failure } from '../server/reliability.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let child, retry, stable, attempts = 0, stopped = false;
function start() {
  child = spawn(process.execPath, ['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5173','--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore','inherit','inherit'] });
  stable = setTimeout(() => { attempts = 0; }, 300000);
  child.once('error', () => safeLog('health_alert', failure('unknown')));
  child.once('exit', () => {
    clearTimeout(stable); child = null;
    if (stopped) return;
    if (attempts >= 6) { safeLog('health_alert', failure('retry_limit')); return; }
    retry = setTimeout(start, retryDelay(++attempts));
  });
}
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { stopped = true; clearTimeout(stable); clearTimeout(retry); child?.kill(); });
start();
