import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { WhatsAppQueue } from '../server/whatsapp-queue.js';

test('real Render-mode server drains on termination and restores its durable queue on restart', {timeout:30000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acores-lifecycle-'));
  const reservation=net.createServer().listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const env={...process.env,RENDER:'true',NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://acores-test.onrender.com',
    APP_ORIGIN:'https://acores-test.onrender.com',PORT:String(port),BIND_HOST:'0.0.0.0',TRUST_PROXY:'1',PERSISTENT_ROOT:dir,
    DATA_DIR:path.join(dir,'data'),WHATSAPP_AUTH_DIR:path.join(dir,'auth'),INITIAL_ADMIN_EMAIL:'test@example.invalid',
    INITIAL_ADMIN_PASSWORD:'Temporary-test-only-123',WHATSAPP_AUTOSTART:'false',SEED_DEMO:'false',
    AI_PROVIDER:'rules',OPENAI_API_KEY:'',GEMINI_API_KEY:'',ADMIN_ALERT_WEBHOOK_URL:''};
  let child,exited,db,logs='';
  const health=()=>new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/api/health',headers:{Host:'acores-test.onrender.com'}},
      res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);
  });
  const start=async()=>{
    child=fork(new URL('./fixtures/server-lifecycle.mjs',import.meta.url),[],{env,stdio:['ignore','pipe','pipe','ipc']});
    child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
    exited=once(child,'exit');await once(child,'message');
    for (let attempt=0;attempt<100;attempt++) {
      try { if (await health()===200) return; } catch {}
      if (child.exitCode !== null) throw new Error('Server exited before readiness.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Server did not become ready.');
  };
  const stop=async()=>{
    child.send('terminate');const [code]=await exited;child=null;assert.equal(code,0);
  };
  const message={key:{id:'persist-once',remoteJid:'5511000000000@s.whatsapp.net',fromMe:false},message:{conversation:'Test only'}};
  try {
    await start();
    db=new DatabaseSync(path.join(dir,'data','petbot.sqlite'));
    new WhatsAppQueue(db).receive('test-account',message);
    db.close();db=null;await stop();
    assert.match(logs,/server_stopping/);
    await start();
    db=new DatabaseSync(path.join(dir,'data','petbot.sqlite'));
    const queue=new WhatsAppQueue(db);queue.receive('test-account',message);
    assert.equal(queue.snapshot().incoming,1);assert.equal(queue.snapshot().outgoing,0);
    assert.equal(db.prepare('SELECT count(*) n FROM auth_users').get().n,1);
    db.close();db=null;await stop();
    assert.doesNotMatch(logs,/Temporary-test-only|conversation|password_hash|Test only/);
  } finally {
    db?.close();if(child){child.kill();await exited;}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
