import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createSecurity } from '../server/security.js';
import { legalDocuments } from '../server/legal.js';
test('production requires HTTPS, canonical redirects and Secure session cookies behind trusted loopback proxy', async () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE clients(id INTEGER PRIMARY KEY)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acores-tls-'));
  assert.throws(() => createSecurity(db,dir,{ NODE_ENV:'production',APP_ORIGIN:'http://example.test' }), /HTTPS/);
  const security = createSecurity(db,dir,{ NODE_ENV:'production',APP_ORIGIN:'https://clinic.example.test',TRUST_PROXY:'loopback' });
  const app = express(); security.install(app); app.use(express.json()); security.routes(app); app.get('/api/health', (_req,res) => res.json({ ok:true }));
  const server = await new Promise((resolve) => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetch = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers }, (res) => {
      let body = ''; res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(Object.fromEntries(Object.entries(res.headers).map(([k,v]) => [k, Array.isArray(v) ? v.join(', ') : v]))), body }));
    });
    req.on('error', reject); req.end(options.body);
  });
  try {
    const redirect = await fetch(base+'/login',{ redirect:'manual',headers:{ Host:'clinic.example.test' } });
    assert.equal(redirect.status,308); assert.equal(redirect.headers.get('location'),'https://clinic.example.test/login');
    const setup = await fetch(base+'/api/auth/setup',{ method:'POST',headers:{Host:'clinic.example.test',Origin:'https://clinic.example.test','X-Forwarded-Proto':'https','Content-Type':'application/json'},
      body:JSON.stringify({email:'tls@example.invalid',password:'Only-tests-8317492',token:fs.readFileSync(path.join(dir,'admin-setup.token'),'utf8'),acceptedTerms:true,privacyAcknowledged:true,legalVersion:legalDocuments.version}) });
    assert.equal(setup.status,201); assert.match(setup.headers.get('set-cookie'),/^__Host-acores_session=/);
    assert.match(setup.headers.get('set-cookie'),/Secure/); assert.match(setup.headers.get('set-cookie'),/HttpOnly/);
    assert.ok(setup.headers.get('strict-transport-security'));
  } finally { await new Promise((r) => server.close(r)); db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
