import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClinicApp } from './clinic-app.js';
import { resolveRuntime } from './runtime.js';
import { safeLog } from './reliability.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(rootDir, '.env'))) process.loadEnvFile(path.join(rootDir, '.env'));
const runtime = resolveRuntime(rootDir,process.env);
if (runtime.render && !fs.existsSync(runtime.persistentRoot)) {
  fs.mkdirSync(runtime.persistentRoot, { recursive: true });
  safeLog('ephemeral_storage_enabled', {
    warning: 'Render sem disco persistente; dados locais podem ser perdidos ao reiniciar.'
  });
}
process.env.APP_ORIGIN = runtime.origin;
process.env.TRUST_PROXY = runtime.trustProxy;
const clinic = createClinicApp({rootDir,dataDir:runtime.dataDir,authDir:runtime.authDir});
const server = http.createServer(clinic.app);
server.on('upgrade',(req,socket,head) => {
  if(req.url==='/ws/acores')req.url='/ws';
  try {clinic.upgrade(req,socket,head);} catch {socket.destroy();}
});
server.listen(runtime.port,runtime.host,() => safeLog('server_started'));
clinic.start();
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{
  if(stopping)return;stopping=true;safeLog('server_stopping');
  const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();
  const drained = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections();
  try {await clinic.stop(() => drained);process.exit(0);} catch {process.exit(1);}
});
