import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { WhatsAppConnector } from '../server/whatsapp.js';
import { WhatsAppQueue } from '../server/whatsapp-queue.js';
import { openAuthStore } from '../server/whatsapp-auth.js';
import { createAIService, AI_UNAVAILABLE_REPLY } from '../server/ai-service.js';
import { createHealthMonitor } from '../server/health-monitor.js';
import { classify, failure, retryDelay } from '../server/reliability.js';

const account = '5511000000000@s.whatsapp.net', jid = '5511998887766@s.whatsapp.net';
const incoming = (id, text = 'Olá') => ({ key: { id, remoteJid: jid, fromMe: false }, messageTimestamp: 1, message: { conversation: text } });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acores-reliability-'));
function connected(db, options = {}) {
  const bot = new WhatsAppConnector({ db, authDir: '.', onStatus() {}, onMessage: async () => ({ reply: 'Resposta aprovada' }), ...options });
  bot.policy.begin(account); bot.policy.ready = true; bot.status.connected = true;
  bot.socket = { sendMessage: async () => {} };
  return bot;
}

test('encrypted authentication restores buffers, imports atomically and never erases an old session', async () => {
  const directory = temp(), baileys = await import('@whiskeysockets/baileys');
  const creds = baileys.initAuthCreds(); creds.me = { id: account }; creds.registered = true;
  fs.writeFileSync(path.join(directory, 'creds.json'), JSON.stringify(creds, baileys.BufferJSON.replacer));
  let auth;
  try {
    auth = openAuthStore(directory, baileys);
    const { state, saveCreds } = auth.load();
    assert.deepEqual(state.creds.noiseKey.private, creds.noiseKey.private);
    state.creds.accountSyncCounter = 19; await saveCreds();
    await state.keys.set({ session: { test: Buffer.from('private-session-material') } });
    auth.close(); auth = openAuthStore(directory, baileys);
    assert.equal(auth.load().state.creds.accountSyncCounter, 19);
    assert.deepEqual((await auth.load().state.keys.get('session', ['test'])).test, Buffer.from('private-session-material'));
    assert.ok(auth.check()); auth.newSession();
    assert.notDeepEqual(auth.load().state.creds.noiseKey.private, creds.noiseKey.private);
    assert.ok(fs.existsSync(path.join(directory, 'creds.json')));
    auth.close(); auth = null;
    const db = new DatabaseSync(path.join(directory, 'session.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(DISTINCT generation) count FROM auth_values').get().count, 2);
    assert.ok(!Buffer.from(db.prepare("SELECT value FROM auth_values WHERE name='session-test.json'").get().value).includes(Buffer.from('private-session-material')));
    db.close();
    fs.renameSync(path.join(directory, 'storage.key'), path.join(directory, 'saved.key'));
    assert.throws(() => openAuthStore(directory, baileys), { fault: 'credentials_storage' });
    assert.ok(fs.existsSync(path.join(directory, 'session.sqlite')));
  } finally { auth?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unstable internet uses jitter and a durable retry limit; terminal disconnects never loop', async () => {
  const db = new DatabaseSync(':memory:'); const timers = [];
  const bot = connected(db, { maxReconnects: 3, random: () => 0.5,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer() {} });
  try {
    for (let i = 0; i < 4; i++) bot.disconnected(408);
    assert.deepEqual(timers.map((t) => t.ms), [2000, 5000, 10000]);
    assert.equal(bot.status.requiresIntervention, true);
    assert.equal(bot.status.lastError.code, 'retry_limit');
    const restored = new WhatsAppConnector({ db, authDir: '.', onStatus() {} });
    assert.equal(restored.status.attempts, 3); assert.equal(restored.status.requiresIntervention, true);
    assert.equal((await restored.start()).mode, 'intervention');
    for (const [code, name, qr] of [[401, 'logged_out', true], [500, 'invalid_session', true], [403, 'forbidden', false], [440, 'replaced', false], [411, 'mismatch', false]]) {
      bot.disconnected(code);
      assert.equal(bot.status.lastError.code, name); assert.equal(bot.status.requiresNewQr, qr);
      assert.equal(timers.length, 3);
    }
    assert.ok(retryDelay(4, () => 0) < retryDelay(4, () => 1));
    assert.equal(classify(failure('unknown')).classification, 'intervention');
  } finally { await bot.stop(); db.close(); }
});

test('connection events restore the session and reconnect queued messages with no duplicate delivery', async () => {
  const db = new DatabaseSync(':memory:'), timers = []; let sockets = 0, sent = 0;
  const bot = new WhatsAppConnector({ db, authDir: '.', onStatus() {}, onMessage: async () => ({ reply: 'Resposta' }),
    random: () => 0.5, setTimer: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimer() {},
    loadBaileys: async () => ({ default: () => {
      sockets++; return { ev: new EventEmitter(), user: { id: account }, resyncAppState: async () => {},
        sendMessage: async () => { sent++; }, end() {} };
    } }) });
  bot.authStore = { load: () => ({ state: { creds: { me: { id: account }, myAppStateKeyId: 'fixture' },
    keys: { set: async () => {}, get: async () => ({ regular_low: { version: 1 } }) } }, saveCreds: async () => {} }), close() {} };
  try {
    await bot.start(); bot.socket.ev.emit('connection.update', { connection: 'open' }); await bot.syncArchiveState();
    assert.equal(bot.status.connected, true); assert.equal(bot.policy.ready, true);
    bot.receive(incoming('reconnect'));
    bot.socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
    assert.equal(bot.status.connected, false); assert.equal(bot.queue.snapshot().incoming, 1);
    await timers.find((timer) => timer.ms === 2000).fn();
    bot.socket.ev.emit('connection.update', { connection: 'open' }); await bot.syncArchiveState();
    bot.messageBuffer.clear(); bot.buffered.clear();
    await bot.enqueueMessage(incoming('reconnect')); await bot.enqueueMessage(incoming('reconnect'));
    assert.equal(sockets, 2); assert.equal(sent, 1); assert.equal(bot.queue.snapshot().pending, 0);
  } finally { await bot.stop(); db.close(); }
});

for (const phase of ['received', 'transaction', 'committed', 'sending']) {
  test(`real process crash at ${phase}: restart retains input and never duplicates a committed reply`, async () => {
    const directory = temp(); let child, db, bot;
    try {
      child = fork(new URL('./fixtures/queue-crash.mjs', import.meta.url), [directory, phase], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      await once(child, 'message'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; child = null;
      db = new DatabaseSync(path.join(directory, 'queue.sqlite'));
      let processed = 0, sent = 0;
      bot = connected(db, { onMessage: async ({ commit }) => commit(() => {
        processed++; db.prepare('INSERT INTO effects VALUES (?)').run('handler'); return { reply: 'Resposta de teste' };
      }) });
      bot.socket.sendMessage = async () => { sent++; };
      for (const row of bot.queue.unbatched(account)) bot.queue.batch(account, [JSON.parse(row.payload)]);
      await bot.processQueue();
      await bot.processQueue();
      assert.equal(processed, ['received', 'transaction'].includes(phase) ? 1 : 0);
      assert.equal(sent, phase === 'sending' ? 0 : 1);
      assert.equal(db.prepare('SELECT COUNT(*) count FROM effects').get().count, 1);
      assert.equal(bot.queue.snapshot().review, phase === 'sending' ? 1 : 0);
      assert.equal(db.prepare('SELECT COUNT(*) count FROM wa_inbox').get().count, 1);
    } finally { child?.kill('SIGKILL'); await bot?.stop(); db?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
}

test('database outage retains encrypted input in a separate spool and recovers once', async () => {
  const directory = temp(), real = new DatabaseSync(':memory:'); let down = false, received = 0;
  const db = { exec(sql) { if (down) throw failure('database_failure'); return real.exec(sql); },
    prepare(sql) { if (down) throw failure('database_failure'); return real.prepare(sql); } };
  const bot = connected(db, { spoolDir: directory, onMessage: async () => { received++; return {}; } });
  try {
    down = true; bot.receive(incoming('database-outage', 'contexto privado'));
    assert.equal(received, 0); assert.equal(bot.status.connected, false);
    assert.equal(bot.spool.files().length, 1);
    assert.ok(!fs.readFileSync(path.join(directory, bot.spool.files()[0])).includes(Buffer.from('contexto privado')));
    down = false; bot.spool.replay((a, m) => bot.queue.receive(a, m));
    bot.status.connected = true; bot.policy.ready = true; bot.socket = { sendMessage: async () => {} };
    await bot.enqueueMessage(incoming('database-outage', 'contexto privado'));
    await bot.enqueueMessage(incoming('database-outage', 'contexto privado'));
    assert.equal(received, 1); assert.equal(bot.spool.files().length, 0);
  } finally { down = false; await bot.stop(); real.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('offline outbox keeps order; uncertain delivery requires review instead of unsafe retry', async () => {
  const db = new DatabaseSync(':memory:'); const sent = [];
  const bot = connected(db);
  try {
    bot.status.connected = false;
    await bot.sendText(jid, 'Primeira', { id: 'one' }); await bot.sendText(jid, 'Segunda', { id: 'two' });
    assert.equal(bot.queue.snapshot().outgoing, 2);
    bot.status.connected = true;
    bot.socket.sendMessage = async (_jid, { text }) => { sent.push(text); };
    await bot.flushOutgoing(); await bot.flushOutgoing();
    assert.deepEqual(sent, ['Primeira', 'Segunda']);
    bot.socket.sendMessage = async () => { throw Object.assign(new Error('private transport data'), { code: 'ECONNRESET' }); };
    await bot.sendText(jid, 'Terceira', { id: 'three' });
    assert.equal(bot.queue.snapshot().review, 1);
    assert.ok(!JSON.stringify(bot.snapshot()).includes('private transport data'));
    await bot.sendText(jid, 'Quarta', { id: 'four' });
    assert.equal(bot.queue.snapshot().outgoing, 1);
    const row = db.prepare("SELECT * FROM wa_outbox WHERE id='three'").get();
    bot.queue.acknowledge(row.message_id, account);
    assert.equal(bot.queue.snapshot().review, 0);
  } finally { await bot.stop(); db.close(); }
});

test('AI timeout gives exactly the approved handoff; circuit breaker bounds retries and recovers', async () => {
  let time = 100000, attempts = 0, available = false;
  const config = { snapshot: () => ({ provider: 'gemini', knowledge: [] }), credentials: () => ({ key: 'test-only', model: 'test' }) };
  const ai = createAIService(config, () => ({}), async () => {
    attempts++; if (!available) return new Promise(() => {});
    return { intent: 'greeting', answerId: '', question: 'need', needsHuman: false };
  }, { timeoutMs: 20, now: () => time });
  const first = await ai.analyze('Quero saber o preço');
  assert.equal(first.reply, AI_UNAVAILABLE_REPLY); assert.equal(first.handoffComplete, true);
  assert.equal(first.summary, 'IA indisponível');
  assert.equal((await ai.analyze('outra mensagem')).reply, AI_UNAVAILABLE_REPLY);
  assert.equal(attempts, 1); assert.equal(ai.snapshot().available, false);
  time += 60000; available = true;
  assert.notEqual((await ai.analyze('Olá')).reply, AI_UNAVAILABLE_REPLY);
  assert.equal(attempts, 2); assert.equal(ai.snapshot().available, true);
});

test('AI authentication errors are not retried automatically', async () => {
  let attempts = 0;
  const config = { snapshot: () => ({ provider: 'gemini', knowledge: [] }), credentials: () => ({ key: 'test-only', model: 'test' }) };
  const ai = createAIService(config, () => ({}), async () => { attempts++; throw failure('ai_auth'); });
  await ai.analyze('Olá'); await ai.analyze('Olá'); await ai.health();
  assert.equal(attempts, 1); assert.equal(ai.snapshot().classification, 'intervention');
});

test('health checks detect downtime, missing credentials, queue and AI failures without exposing context', async () => {
  const directory = temp(), db = new DatabaseSync(':memory:'); const bot = connected(db);
  const ai = { snapshot: () => ({ provider: 'gemini', available: false }), health: async () => {} };
  const aiConfig = { snapshot: () => ({ provider: 'gemini' }), credentials: () => ({ key: '', model: 'model' }) };
  const monitor = createHealthMonitor({ db, whatsapp: bot, ai, aiConfig, dataDir: directory });
  try {
    bot.status.connected = false; bot.status.offlineSince = new Date(Date.now() - 300000).toISOString();
    bot.status.attempts = 3;
    await monitor.check(); await monitor.check();
    const codes = monitor.snapshot().alerts.map((a) => a.code);
    assert.ok(codes.includes('offline_prolonged')); assert.ok(codes.includes('ai_unavailable'));
    assert.ok(codes.includes('many_reconnects')); assert.ok(codes.includes('environment_invalid'));
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(monitor.snapshot().database, true);
    assert.ok(!fs.readFileSync(path.join(directory, 'runtime-health.json'), 'utf8').includes(jid));
  } finally { monitor.stop(); await bot.stop(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
