import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';
import { once } from 'node:events';
import { createClinicApp } from '../server/clinic-app.js';
import { createSecurity } from '../server/security.js';
import { createAIConfig } from '../server/ai-config.js';
import { resolveRuntime } from '../server/runtime.js';
import { legalDocuments } from '../server/legal.js';
import { createOperationalNotifier } from '../server/operational-notifier.js';

const production = { RENDER:'true', NODE_ENV:'production', RENDER_EXTERNAL_URL:'https://acores-test.onrender.com' };
test('Render resolves HTTPS, dynamic PORT and disk-only database and WhatsApp paths', () => {
  const runtime = resolveRuntime(process.cwd(), { ...production, PORT:'12345' });
  assert.equal(runtime.origin, production.RENDER_EXTERNAL_URL);
  assert.equal(runtime.host,'0.0.0.0'); assert.equal(runtime.port,12345); assert.equal(runtime.trustProxy,'1');
  assert.equal(runtime.dataDir,path.join(runtime.persistentRoot,'data'));
  assert.equal(runtime.authDir,path.join(runtime.persistentRoot,'whatsapp'));
  for (const overrides of [{NODE_ENV:'development'}, {APP_ORIGIN:'http://unsafe.test'}, {APP_ORIGIN:'https://site.test/login'},
    {DATA_DIR:path.resolve('outside')}, {WHATSAPP_AUTH_DIR:path.resolve('outside')}, {PORT:'invalid'}])
    assert.throws(() => resolveRuntime(process.cwd(),{...production,...overrides}));
  assert.equal(resolveRuntime(process.cwd(), {...production,APP_ORIGIN:'https://clinic.example.test'}).origin,'https://clinic.example.test');
  assert.equal(resolveRuntime(process.cwd(), {}).authDir,path.join(process.cwd(),'server','auth'));
});

test('initial administrator requires strong server-only credentials and never resets an existing password', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acores-bootstrap-'));
  const db=new DatabaseSync(':memory:'); db.exec('CREATE TABLE clients(id INTEGER PRIMARY KEY)');
  const env={NODE_ENV:'production',APP_ORIGIN:'https://clinic.example.test',INITIAL_ADMIN_EMAIL:'acores@gmail.com',INITIAL_ADMIN_PASSWORD:'Bootstrap-only-test-123'};
  try {
    assert.throws(()=>createSecurity(db,dir,{...env,INITIAL_ADMIN_PASSWORD:'admin123'}),/INITIAL_ADMIN/);
    createSecurity(db,dir,env);
    const owner=db.prepare('SELECT * FROM auth_users').get();
    assert.equal(owner.username,'acores'); assert.equal(owner.must_change_password,1);
    assert.ok(bcrypt.compareSync(env.INITIAL_ADMIN_PASSWORD,owner.password_hash));
    assert.equal(db.prepare('SELECT count(*) n FROM auth_legal_acceptance').get().n,0);
    assert.equal(fs.existsSync(path.join(dir,'admin-setup.token')),false);
    createSecurity(db,dir,{...env,INITIAL_ADMIN_PASSWORD:'Changed-env-test-999'});
    assert.equal(db.prepare('SELECT password_hash FROM auth_users').get().password_hash,owner.password_hash);
    assert.equal(db.prepare('SELECT count(*) n FROM auth_users').get().n,1);
  } finally { db.close();fs.rmSync(dir,{recursive:true,force:true}); }
});

test('AI environment configuration selects the provider without exposing its secret', () => {
  const db=new DatabaseSync(':memory:');
  try {
    const settings=createAIConfig(db,os.tmpdir(),{AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-only-private-key',GEMINI_MODEL:'test-model'});
    assert.equal(settings.snapshot().provider,'gemini');
    assert.equal(settings.credentials('gemini').model,'test-model');
    assert.doesNotMatch(JSON.stringify(settings.snapshot()),/test-only-private-key/);
    assert.throws(()=>createAIConfig(db,os.tmpdir(),{AI_PROVIDER:'invalid'}));
  } finally { db.close(); }
});

test('operational webhook sends metadata only, bounds failed attempts and disallows redirects', async () => {
  let now=1, calls=0;
  const notify=createOperationalNotifier({url:'https://alerts.example.invalid/private',now:()=>now,fetchImpl:async(_url,options)=>{
    calls++; assert.equal(options.redirect,'error'); assert.ok(options.signal);
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(),['at','event','service']);
    return {ok:false};
  }});
  await notify('ai_unavailable'); await notify('ai_unavailable'); assert.equal(calls,1);
  now+=600001; await notify('ai_unavailable'); assert.equal(calls,2);
  await notify('customer message'); assert.equal(calls,2);
});

test('single Acores production service: login, proxy, permissions, retired routes and durable restart', async (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acores-single-'));
  const previous={...process.env};
  Object.assign(process.env,{...production,APP_ORIGIN:production.RENDER_EXTERNAL_URL,TRUST_PROXY:'1',SEED_DEMO:'false',
    INITIAL_ADMIN_EMAIL:'acores@gmail.com',INITIAL_ADMIN_PASSWORD:'Provisional-test-12345',AI_PROVIDER:'rules',
    OPENAI_API_KEY:'',GEMINI_API_KEY:'',WHATSAPP_AUTOSTART:'false',ADMIN_ALERT_WEBHOOK_URL:''});
  let clinic,server;
  const open=async()=>{
    clinic=createClinicApp({rootDir:process.cwd(),dataDir:path.join(dir,'data'),authDir:path.join(dir,'auth')});
    server=http.createServer(clinic.app);
    server.on('upgrade',clinic.upgrade);
    await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
  };
  const close=async()=>{
    const current=server;server=null;
    if(current){const drained=new Promise((resolve)=>current.close(resolve));current.closeIdleConnections();await clinic.stop(()=>drained);}
  };
  const request=(url,method='GET',body,auth,extra={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,
      headers:{Host:new URL(production.RENDER_EXTERNAL_URL).host,Origin:production.RENDER_EXTERNAL_URL,
        'X-Forwarded-Proto':'https','Content-Type':'application/json',
        ...(auth?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{}),...extra}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  const legal={acceptedTerms:true,privacyAcknowledged:true,legalVersion:legalDocuments.version};
  const fromResponse=(r)=>({...r.json(),cookie:r.headers['set-cookie'][0].split(';')[0]});
  let admin;
  try {
    await open();
    await t.test('only the Acores login and legal identity remain',async()=>{
      for(const route of ['/admin','/central/example','/api/admin/auth/session','/api/platform/companies','/api/onboarding','/api/catalog','/api/records','/api/auth/request-access'])
        assert.equal((await request(route)).status,404,route);
      const page=await request('/');assert.equal(page.status,200);assert.match(page.text,/Açores/);assert.doesNotMatch(page.text,/Kaizen|kaizen/);
      assert.equal((await request('/assets/acores-logo-oficial.jpg')).status,200);
      assert.doesNotMatch(JSON.stringify(legalDocuments),/Kaizen|kaizen/);
      const denied=await request('/api/dashboard','GET',null,{cookie:'kaizen_admin_session=legacy',csrf:''});
      assert.equal(denied.status,401);
    });
    await t.test('first login requires legal acceptance and password change behind Render TLS',async()=>{
      assert.equal((await request('/api/auth/login','POST',{email:'acores',password:process.env.INITIAL_ADMIN_PASSWORD})).status,400);
      const response=await request('/api/auth/login','POST',{...legal,email:'acores',password:process.env.INITIAL_ADMIN_PASSWORD});
      assert.equal(response.status,200);assert.match(response.headers['set-cookie'][0],/^__Host-acores_session=.*Secure/);
      admin=fromResponse(response);assert.equal(admin.user.must_change_password,true);assert.equal(admin.user.platform_admin,undefined);
      assert.equal((await request('/api/dashboard','GET',null,admin)).status,403);
      const changed=await request('/api/auth/password','POST',{currentPassword:process.env.INITIAL_ADMIN_PASSWORD,password:'Permanent-test-98765'},admin);
      assert.equal(changed.status,200);admin=fromResponse(changed);
      const dashboard=(await request('/api/dashboard','GET',null,admin)).json();
      assert.equal(dashboard.company.id,'acores');assert.match(dashboard.settings.address,/467/);
    });
    await t.test('local staff creation, revocation and last administrator protection',async()=>{
      assert.equal((await request('/api/users','POST',{email:'operator@example.invalid',username:'operator',role:'atendente',password:'Operator-test-12345'},admin)).status,201);
      assert.equal((await request('/api/users/'+admin.user.id,'PATCH',{active:false,confirmed:true},admin)).status,409);
      assert.equal((await request('/api/users','POST',{email:'intruder@example.invalid',username:'intruder',role:'administrador',password:'Operator-test-12345',platform_admin:true},admin)).status,400);
      const rows=(await request('/api/users','GET',null,admin)).json();
      assert.doesNotMatch(JSON.stringify(rows),/password_hash|csrf/);
      const id=rows.find(r=>r.username==='operator').id;
      assert.equal((await request('/api/users/'+id,'PATCH',{active:false,confirmed:true},admin)).status,200);
    });
    await t.test('authenticated WebSocket works on the same production origin',async()=>{
      const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/ws',{origin:production.RENDER_EXTERNAL_URL,headers:{Cookie:admin.cookie,'X-Forwarded-Proto':'https'}});
      const result=JSON.parse((await once(ws,'message'))[0].toString());
      assert.equal(result.payload.company.id,'acores');ws.close();await once(ws,'close');
    });
    await t.test('health probes actually test database writes, including without forwarded TLS',async()=>{
      assert.equal((await request('/api/health','GET',null,null,{'X-Forwarded-Proto':'http'})).status,200);
      clinic.store.raw.exec('PRAGMA query_only=ON');
      const failed=await request('/api/health','GET',null,null,{'X-Forwarded-Proto':'http'});
      assert.equal(failed.status,503);assert.deepEqual(failed.json(),{ok:false,service:'acores'});
      clinic.store.raw.exec('PRAGMA query_only=OFF');
      assert.equal((await request('/api/health')).status,200);
    });
    await t.test('patients, credentials and pending messages survive reopening once',async()=>{
      clinic.store.upsertClient({name:'Tutor de teste',phone:'5511000000000',pet_name:'Hanna',species:'Felina'});
      const message={key:{id:'restart-only',remoteJid:'5511000000000@s.whatsapp.net',fromMe:false},message:{conversation:'Mensagem de teste'}};
      clinic.whatsapp.queue.receive('test-account',message);
      const hash=clinic.store.raw.prepare("SELECT password_hash FROM auth_users WHERE username='acores'").get().password_hash;
      await close();await open();
      assert.equal(clinic.store.getClientByPhone('5511000000000').pet_name,'Hanna');
      clinic.whatsapp.queue.receive('test-account',message);
      assert.equal(clinic.whatsapp.queue.snapshot().incoming,1);
      assert.equal(clinic.store.raw.prepare("SELECT password_hash FROM auth_users WHERE username='acores'").get().password_hash,hash);
      const login=await request('/api/auth/login','POST',{...legal,email:'acores@gmail.com',password:'Permanent-test-98765'});
      assert.equal(login.status,200);assert.equal(login.json().user.must_change_password,false);
    });
  } finally {
    await close();
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];
    Object.assign(process.env,previous);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
