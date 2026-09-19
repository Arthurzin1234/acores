import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';
import { legalDocuments } from '../server/legal.js';

test('security: real API authentication, ownership, roles, CSRF, validation, limits and WebSocket', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acores-security-'));
  const reservation = net.createServer().listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning','server/index.js'], {
    env: { ...process.env, NODE_ENV: 'test', APP_ORIGIN: origin, DATA_DIR: dir, PORT: String(port), OPENAI_API_KEY: '', GEMINI_API_KEY: '', ENABLE_SIMULATOR: 'false' }, stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  let db;
  const request = (url, options = {}, auth) => fetch(origin + url, {
    ...options, headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...options.headers },
  });
  const credentials = { email: 'admin@example.invalid', password: 'Security-test-only-8942', acceptedTerms: true, privacyAcknowledged: true, legalVersion: legalDocuments.version };
  const authenticate = async (email) => {
    const res = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ ...credentials, email }) });
    assert.equal(res.status, 200); return { cookie: res.headers.get('set-cookie').split(';')[0], csrf: (await res.json()).csrf };
  };
  try {
    for (let i = 0; ; i++) {
      try { if ((await request('/api/health')).ok) break; } catch {}
      if (i >= 300) throw new Error('Security test server did not start');
      await new Promise((r) => setTimeout(r, 100));
    }
    await t.test('anonymous and cross-origin requests cannot read or delete', async () => {
      for (const route of ['/api/dashboard','/api/clients','/api/tickets','/api/whatsapp/status']) assert.equal((await request(route)).status, 401);
      assert.equal((await request('/api/clients/1', { method: 'DELETE', body: '{"confirmed":true}' })).status, 401);
      assert.equal((await request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://evil.invalid' }, body: JSON.stringify(credentials) })).status, 403);
    });
    const setup = await request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ ...credentials, token: fs.readFileSync(path.join(dir, 'admin-setup.token'), 'utf8') }) });
    assert.equal(setup.status, 201); assert.match(setup.headers.get('set-cookie'), /HttpOnly/); assert.match(setup.headers.get('set-cookie'), /SameSite=Strict/);
    const admin = { cookie: setup.headers.get('set-cookie').split(';')[0], csrf: (await setup.json()).csrf };
    db = new DatabaseSync(path.join(dir, 'petbot.sqlite'));
    await t.test('legal documents are public, acceptance is explicit and versioned', async () => {
      const docs = await (await request('/api/legal')).json();
      assert.equal(docs.version, legalDocuments.version);
      assert.match(docs.terms.content, /Termos de Uso/);
      for (const input of [
        { ...credentials, acceptedTerms: false },
        { ...credentials, acceptedTerms: 'true' },
        { email: credentials.email, password: credentials.password },
      ]) {
        const denied = await request('/api/auth/login', { method: 'POST', body: JSON.stringify(input) });
        assert.equal(denied.status, 400); assert.equal(denied.headers.get('set-cookie'), null);
      }
      const obsolete = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ ...credentials, legalVersion: 'old' }) });
      assert.equal(obsolete.status, 409);
      const record = db.prepare('SELECT * FROM auth_legal_acceptance').get();
      assert.equal(record.version, docs.version); assert.ok(record.accepted_at);
      assert.equal(db.prepare('SELECT terms_content FROM auth_legal_versions WHERE version=?').get(docs.version).terms_content, docs.terms.content);
    });
    const hash = await bcrypt.hash(credentials.password, 12);
    for (const n of [1,2]) {
      db.prepare("INSERT INTO clients(id,name,phone,created_at,updated_at) VALUES (?,?,?,datetime('now'),datetime('now'))").run(n, `Tutor ${n}`, `551100000000${n}`);
      db.prepare("INSERT INTO tickets(id,client_id,phone,subject,created_at,updated_at) VALUES (?,?,?,'Consulta',datetime('now'),datetime('now'))").run(n, n, `551100000000${n}`);
      db.prepare("INSERT INTO auth_users(email,password_hash,role,client_id) VALUES (?,?,'usuario',?)").run(`user${n}@example.invalid`, hash, n);
    }
    db.prepare("INSERT INTO auth_users(email,password_hash,role) VALUES (?,?,'tecnico')").run('tech@example.invalid', hash);
    db.prepare("INSERT INTO auth_users(email,password_hash,role) VALUES (?,?,'atendente')").run('staff@example.invalid', hash);
    const user = await authenticate('user1@example.invalid'), other = await authenticate('user2@example.invalid');
    const tech = await authenticate('tech@example.invalid'), staff = await authenticate('staff@example.invalid');
    await t.test('row ownership applies to reads and writes; technician has no clinical access', async () => {
      const d = await (await request('/api/dashboard', {}, user)).json();
      assert.deepEqual(d.clients.map((v) => v.id), [1]); assert.deepEqual(d.tickets.map((v) => v.id), [1]);
      assert.equal((await request('/api/tickets/2/messages', {}, user)).status, 404);
      assert.equal((await request('/api/tickets/1/messages', {}, other)).status, 404);
      assert.equal((await request('/api/clients/2', { method: 'PATCH', body: '{"name":"Changed"}' }, user)).status, 404);
      assert.equal((await request('/api/clients/1', { method: 'PATCH', body: '{"name":"Own name"}' }, user)).status, 200);
      for (const entity of ['tickets','appointments','neonatal','notifications']) assert.equal((await request(`/api/${entity}/2`, { method: 'DELETE', body: '{"confirmed":true}' }, user)).status, 403);
      assert.equal((await request('/api/clients', {}, tech)).status, 403);
      assert.deepEqual((await (await request('/api/dashboard', {}, tech)).json()).clients, []);
      assert.equal((await request('/api/clients', {}, staff)).status, 200);
      assert.equal((await request('/api/clients/1', { method: 'DELETE', body: '{"confirmed":true}' }, staff)).status, 403);
      assert.equal((await request('/api/ai/settings', { method: 'PATCH', body: '{"knowledge":[]}' }, staff)).status, 403);
    });
    await t.test('mass assignment, CSRF, injection, uploads and test routes are blocked', async () => {
      assert.equal((await request('/api/clients/1', { method: 'PATCH', body: '{"name":"x","role":"administrador"}' }, admin)).status, 400);
      assert.equal((await request('/api/clients/1', { method: 'PATCH', body: '{"phone":"5511999999999"}' }, user)).status, 400);
      assert.equal((await request('/api/clients/1', { method: 'PATCH', headers: { 'X-CSRF-Token': 'invalid' }, body: '{"name":"x"}' }, admin)).status, 403);
      assert.equal((await request('/api/tickets/1%20OR%201=1/messages', {}, user)).status, 403);
      assert.equal((await request('/api/clients?order=DROP%20TABLE', {}, admin)).status, 400);
      assert.equal((await request('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: 'MZ executable' }, admin)).status, 415);
      assert.equal((await request('/api/simulate-message', { method: 'POST', body: '{}' }, admin)).status, 403);
      assert.equal((await request('/api/ai/settings', { method: 'PATCH', body: '{"openaiKey":"not-accepted"}' }, admin)).status, 400);
      const giant = await request('/api/clients', { method: 'POST', body: JSON.stringify({ notes: 'x'.repeat(70000) }) }, admin); assert.equal(giant.status, 413);
      const headers = (await request('/api/dashboard', {}, admin)).headers;
      assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.equal(headers.get('x-content-type-options'), 'nosniff'); assert.equal(headers.get('cache-control'), 'no-store');
      assert.equal((await request('/.env', {}, admin)).status, 404);
      assert.doesNotMatch(await (await request('/.env', {}, admin)).text(), /OPENAI_API_KEY|GEMINI_API_KEY/);
    });
    await t.test('WebSocket requires session and returns only authorized records', async () => {
      const rejected = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { origin });
      const code = await new Promise((resolve) => { rejected.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); rejected.terminate(); }); rejected.on('error', () => {}); });
      assert.equal(code, 401);
      const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { origin, headers: { Cookie: user.cookie } });
      const payload = JSON.parse((await once(ws, 'message'))[0].toString());
      assert.deepEqual(payload.payload.clients.map((c) => c.id), [1]); ws.close(); await once(ws, 'close');
    });
    await t.test('login throttling, expiration, deactivation and logout revoke access', async () => {
      let status;
      for (let i = 0; i < 9; i++) status = (await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ ...credentials, email: 'unknown@example.invalid' }) })).status;
      assert.equal(status, 429);
      db.prepare("UPDATE auth_users SET active=0 WHERE email='user2@example.invalid'").run();
      assert.equal((await request('/api/dashboard', {}, other)).status, 401);
      db.prepare("UPDATE auth_sessions SET seen_at=0 WHERE user_id=(SELECT id FROM auth_users WHERE email='user1@example.invalid')").run();
      assert.equal((await request('/api/dashboard', {}, user)).status, 401);
      assert.equal((await request('/api/auth/logout', { method: 'POST' }, admin)).status, 200);
      assert.equal((await request('/api/dashboard', {}, admin)).status, 401);
    });
  } finally { db?.close(); child.kill(); await exited; fs.rmSync(dir, { recursive: true, force: true }); }
});
