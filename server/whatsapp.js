import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import QRCode from 'qrcode';
import { MessageBuffer } from './message-buffer.js';
import { ReplyPolicy, cleanJid, privateJid } from './reply-policy.js';
import { WhatsAppQueue } from './whatsapp-queue.js';
import { openAuthStore } from './whatsapp-auth.js';
import { EmergencySpool } from './protected-store.js';
import { classify, disconnectFault, failure, positiveInt, retryDelay, safeLog } from './reliability.js';

const logger = pino({ level: 'silent' });
const iso = () => new Date().toISOString();

export class WhatsAppConnector {
  constructor({ authDir, spoolDir, onMessage, onStatus, onDelivery, onHumanMessage, onAlert,
    db, maxReconnects = positiveInt(process.env.WHATSAPP_MAX_RECONNECTS, 6, 1, 20), random = Math.random,
    setTimer = setTimeout, clearTimer = clearTimeout, loadBaileys = () => import('@whiskeysockets/baileys') }) {
    Object.assign(this, { authDir, onMessage, onStatus, onDelivery, onHumanMessage, onAlert, db,
      maxReconnects, random, setTimer, clearTimer, loadBaileys });
    db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_sent_ids (account TEXT, id TEXT, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS whatsapp_human_pause (account TEXT, jid TEXT, PRIMARY KEY(account,jid));
      CREATE TABLE IF NOT EXISTS whatsapp_human_seen (account TEXT, id TEXT, PRIMARY KEY(account,id));`);
    this.queue = new WhatsAppQueue(db);
    this.spool = spoolDir ? new EmergencySpool(spoolDir) : null;
    this.policy = new ReplyPolicy(db);
    this.socket = null; this.qrDataUrl = null; this.startedAt = 0;
    this.queues = new Map(); this.buffered = new Set(); this.generation = 0; this.archiveAttempts = 0;
    this.messageBuffer = new MessageBuffer((messages) => {
      for (const message of messages) this.buffered.delete(message.key.id);
      this.enqueueMessage({ ...messages.at(-1), batchMessages: messages });
    });
    this.status = { mode: 'offline', connected: false, phone: null, attempts: 0,
      lastEvent: 'WhatsApp ainda não iniciado.', updatedAt: iso(), offlineSince: iso(),
      ...this.queue.loadRuntime(), connectedAt: null };
    this.status.connected = false;
    if (this.status.account) this.policy.begin(this.status.account);
    if (!this.status.requiresIntervention) this.status.mode = 'offline';
  }

  snapshot() {
    let queue;
    try { queue = this.queue.snapshot(); } catch { queue = { pending: null, unavailable: true }; }
    return { ...this.status, qrDataUrl: this.qrDataUrl, ignoreGroups: true, ignoreArchived: true,
      archiveSyncReady: this.policy.ready, pendingMessages: queue.pending, queue };
  }

  persistStatus() {
    const { mode, attempts, requiresIntervention, requiresNewQr, lastError, lastReconnectAt, offlineSince, lastEvent } = this.status;
    this.queue.saveRuntime({ account: this.policy.account || this.status.account || '', mode, attempts, requiresIntervention, requiresNewQr, lastError, lastReconnectAt, offlineSince, lastEvent });
  }

  setStatus(partial) {
    this.status = { ...this.status, ...partial, updatedAt: iso() };
    try { this.persistStatus(); } catch { safeLog('whatsapp_fault', failure('database_failure')); }
    try { this.onStatus?.(this.snapshot()); } catch { safeLog('whatsapp_fault', failure('database_failure')); }
  }

  report(error) {
    const fault = classify(error);
    safeLog('whatsapp_fault', error, this.status.attempts);
    this.setStatus({ lastError: { ...fault, at: iso() }, lastEvent: fault.message });
    try { this.onAlert?.(fault); } catch { safeLog('health_alert', failure('database_failure')); }
    return fault;
  }

  async start({ manual = false, newSession = false } = {}) {
    if (this.stopping || this.status.mode === 'starting' || this.socket) return this.snapshot();
    if (this.status.requiresIntervention && !manual) return this.snapshot();
    if (this.status.requiresNewQr && !newSession) return this.snapshot();
    if (newSession && !this.status.requiresNewQr) return this.snapshot();
    if (manual) {
      this.clearTimer(this.reconnectTimer);
      this.setStatus({ attempts: 0, requiresIntervention: false });
    }
    this.setStatus({ mode: 'starting', lastEvent: 'Restaurando a conexão protegida do WhatsApp.' });
    const generation = ++this.generation;
    try {
      const baileys = await this.loadBaileys();
      if (this.stopping || generation !== this.generation) return this.snapshot();
      this.authStore ||= openAuthStore(path.resolve(this.authDir), baileys);
      if (newSession) this.authStore.newSession();
      const { state, saveCreds } = this.authStore.load();
      this.authState = state;
      const socket = baileys.default({ auth: state, logger, browser: ['Acores Atendimento', 'Chrome', '1.0.0'],
        syncFullHistory: true, markOnlineOnConnect: false, connectTimeoutMs: 20000, defaultQueryTimeoutMs: 20000 });
      this.socket = socket;
      this.policy.begin(state.creds.me?.id || '');
      const on = (event, callback) => socket.ev.on(event, (...args) => {
        if (socket !== this.socket || this.stopping) return;
        try { Promise.resolve(callback(...args)).catch((error) => this.halt(error)); }
        catch (error) { this.halt(error); }
      });
      on('messaging-history.set', ({ chats, lidPnMappings }) => {
        this.policy.update(chats, true);
        for (const mapping of lidPnMappings || []) this.policy.alias(mapping.lid, mapping.pn);
      });
      on('chats.upsert', (chats) => this.policy.update(chats, true));
      on('chats.update', (chats) => this.policy.update(chats));
      on('chats.delete', (ids) => this.policy.update(ids.map((id) => ({ id, archived: true }))));
      on('lid-mapping.update', (mapping) => this.policy.alias(mapping.lid, mapping.pn));
      on('creds.update', async (update) => {
        try { await saveCreds(); } catch { throw failure('credentials_storage'); }
        if (update.myAppStateKeyId && this.status.connected && !this.policy.ready) await this.syncArchiveState();
      });
      on('connection.update', async (update) => {
        if (update.qr) {
          const qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 280 });
          if (socket !== this.socket) return;
          this.qrDataUrl = qrDataUrl;
          this.setStatus({ mode: 'qr', connected: false, requiresNewQr: false,
            lastEvent: 'Escaneie o QR Code no WhatsApp para conectar.' });
          this.onAlert?.(classify(failure('logged_out')));
        }
        if (update.connection === 'open') {
          this.qrDataUrl = null; this.startedAt = Math.floor(Date.now() / 1000); this.archiveAttempts = 0;
          const account = cleanJid(socket.user?.id);
          if (this.policy.account !== account) this.policy.begin(account);
          this.setStatus({ mode: 'connected', connected: true, phone: socket.user?.id || null,
            connectedAt: iso(), lastReconnectAt: iso(), offlineSince: null, requiresIntervention: false,
            requiresNewQr: false, lastEvent: 'Conectado. Conferindo conversas arquivadas.' });
          this.clearTimer(this.stableTimer);
          this.stableTimer = this.setTimer(() => {
            if (socket === this.socket && this.status.connected) this.setStatus({ attempts: 0 });
          }, 60000);
          this.stableTimer?.unref?.();
          await this.syncArchiveState();
        }
        if (update.connection === 'close') this.disconnected(update.lastDisconnect?.error?.output?.statusCode);
      });
      on('messages.upsert', async ({ messages, type }) => {
        for (const message of messages || []) {
          if (message.key?.fromMe) {
            const saved = minimalMessage(message, true);
            if (!saved) continue;
            try { await this.handleHumanMessage(saved); }
            catch (error) {
              this.spool?.put(this.policy.account, saved);
              throw error;
            }
          } else if (type === 'notify') this.receive(message);
        }
      });
      on('messages.update', (updates) => {
        for (const { key, update } of updates || []) if (key.fromMe && Number(update.status) >= 2)
          this.queue.acknowledge(key.id, this.policy.account, (row) => this.delivered(row));
      });
      on('presence.update', ({ id, presences }) => this.messageBuffer.presence(cleanJid(id),
        Object.values(presences || {}).some((p) => ['composing', 'recording'].includes(p.lastKnownPresence))));
      this.startWorker();
    } catch (error) { this.halt(error?.fault ? error : failure('credentials_storage')); }
    return this.snapshot();
  }

  detach() {
    const socket = this.socket;
    this.socket = null; this.generation++; this.policy.stop();
    this.messageBuffer.clear(); this.buffered.clear(); this.qrDataUrl = null;
    this.syncPromise = null;
    this.clearTimer(this.stableTimer); this.clearTimer(this.archiveTimer);
    try { socket?.end?.(failure('interrupted')); } catch { /* Already closed. */ }
  }

  disconnected(code) {
    this.detach();
    const error = disconnectFault(code), fault = this.report(error);
    this.setStatus({ connected: false, offlineSince: this.status.offlineSince || iso() });
    if (fault.classification !== 'recoverable') {
      this.setStatus({ mode: 'intervention', requiresIntervention: true,
        requiresNewQr: ['logged_out', 'invalid_session'].includes(fault.code) });
      return;
    }
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    this.clearTimer(this.reconnectTimer);
    if (this.stopping) return;
    if (this.status.attempts >= this.maxReconnects) {
      this.report(failure('retry_limit'));
      this.setStatus({ mode: 'intervention', requiresIntervention: true });
      return;
    }
    const attempts = this.status.attempts + 1, delay = retryDelay(attempts, this.random);
    this.setStatus({ mode: 'reconnecting', attempts, nextReconnectAt: new Date(Date.now() + delay).toISOString() });
    this.reconnectTimer = this.setTimer(() => this.start(), delay);
    this.reconnectTimer?.unref?.();
  }

  halt(error) {
    this.detach();
    const fault = this.report(error);
    this.setStatus({ connected: false, offlineSince: this.status.offlineSince || iso(),
      mode: 'intervention', requiresIntervention: true });
    if (fault.classification === 'recoverable') {
      this.setStatus({ requiresIntervention: false }); this.scheduleReconnect();
    }
  }

  async syncArchiveState() {
    if (this.syncPromise) return this.syncPromise;
    const socket = this.socket, auth = this.authState;
    if (!socket || !this.status.connected || !auth?.creds.myAppStateKeyId) return;
    this.policy.ready = false;
    this.syncPromise = (async () => {
      try {
        // A complete snapshot is needed to catch archives changed during downtime.
        await auth.keys.set({ 'app-state-sync-version': { regular_low: null } });
        await socket.resyncAppState(['regular_low'], true);
        const state = await auth.keys.get('app-state-sync-version', ['regular_low']);
        if (socket !== this.socket) return;
        if (!(Number(state.regular_low?.version) > 0)) throw failure('archive_sync');
        this.policy.ready = true; this.archiveAttempts = 0;
        this.setStatus({ lastEvent: 'WhatsApp conectado. Grupos e conversas arquivadas bloqueados.' });
        this.flushWaitingMessages();
      } catch {
        if (socket !== this.socket) return;
        this.report(failure('archive_sync'));
        if (++this.archiveAttempts < 3) {
          this.archiveTimer = this.setTimer(() => this.syncArchiveState(), retryDelay(this.archiveAttempts));
          this.archiveTimer?.unref?.();
        }
      } finally { if (socket === this.socket) this.syncPromise = null; }
    })();
    return this.syncPromise;
  }

  receive(raw) {
    const message = minimalMessage(raw);
    if (!message || !this.policy.account) return;
    try {
      const row = this.queue.receive(this.policy.account, message);
      if (!row.job_id) this.buffer(message);
    } catch (error) {
      // A separate encrypted, fsync'ed spool retains input while SQLite is unavailable.
      try { if (!this.spool) throw error; this.spool.put(this.policy.account, message); }
      catch { this.halt(failure('database_failure')); return; }
      this.halt(error?.code ? error : failure('database_failure'));
    }
  }

  buffer(message) {
    if (this.buffered.has(message.key.id)) return;
    this.buffered.add(message.key.id);
    this.messageBuffer.add(message.key.remoteJid, message);
    this.socket?.presenceSubscribe?.(message.key.remoteJid)?.catch(() => undefined);
  }

  enqueueMessage(message) {
    const messages = (message.batchMessages || [message]).map((item) => minimalMessage(item)).filter(Boolean);
    if (!messages.length || !this.policy.account) return;
    try {
      this.queue.batch(this.policy.account, messages);
      const next = this.processQueue();
      this.queues.set('worker', next);
      next.finally(() => { if (this.queues.get('worker') === next) this.queues.delete('worker'); });
      return next;
    } catch (error) { this.halt(error); }
  }

  flushWaitingMessages() {
    if (!this.policy.ready) return;
    this.spool?.replay((account, message) => this.queue.receive(account, message));
    for (const row of this.queue.unbatched(this.policy.account)) this.buffer(JSON.parse(row.payload));
    const next = this.processQueue(); this.queues.set('worker', next);
    next.finally(() => { if (this.queues.get('worker') === next) this.queues.delete('worker'); });
  }

  startWorker() {
    if (this.workerTimer) return;
    this.workerTimer = setInterval(() => {
      try { if (this.status.connected && this.policy.ready) this.flushWaitingMessages(); }
      catch (error) { this.halt(error); }
    }, 1000);
    this.workerTimer.unref();
  }

  processQueue() {
    if (!this.policy.ready || !this.status.connected) return Promise.resolve();
    if (this.processing) return this.processing;
    this.processing = this.drain().catch((error) => this.halt(error)).finally(() => { this.processing = null; });
    return this.processing;
  }

  async drain() {
    if (!this.policy.ready || !this.status.connected) return;
    for (const row of this.db.prepare('SELECT payload FROM wa_human_inbox WHERE account=? AND done=0 LIMIT 100').all(this.policy.account))
      await this.handleHumanMessage(JSON.parse(row.payload));
    await this.flushOutgoing();
    let job;
    while (this.status.connected && this.policy.ready && (job = this.queue.next(this.policy.account))) {
      if (!this.policy.allowed(job.jid)) { this.queue.ignore(job.id); continue; }
      this.queue.begin(job.id);
      try { await this.processJob(job); }
      catch (error) {
        const fault = this.queue.fail(job, error);
        this.report(error);
        if (fault.classification === 'critical') { this.halt(error); break; }
      }
    }
  }

  async handleBaileysMessage(message) { return this.enqueueMessage(message); }

  async processJob(job) {
    const messages = JSON.parse(job.payload), last = messages.at(-1), remoteJid = job.jid;
    let phoneJid = remoteJid;
    if (remoteJid.endsWith('@lid')) phoneJid = last.key.remoteJidAlt ||
      await this.socket?.signalRepository?.lidMapping?.getPNForLID(remoteJid);
    if (!/^\d+@s\.whatsapp\.net$/.test(phoneJid || '')) throw failure('invalid_data');
    this.policy.alias(remoteJid, phoneJid);
    if (!this.policy.allowed(phoneJid)) { this.queue.ignore(job.id); return; }
    this.db.prepare('UPDATE wa_jobs SET jid=? WHERE id=?').run(phoneJid, job.id);
    if (this.db.prepare("SELECT 1 FROM wa_outbox WHERE account=? AND jid=? AND state IN ('pending','sending','review')").get(job.account, phoneJid)) {
      this.db.prepare("UPDATE wa_jobs SET state='pending',next_at=? WHERE id=?").run(Date.now() + 1000, job.id);
      return;
    }
    const controller = new AbortController(), revision = this.policy.revision(remoteJid), phoneRevision = this.policy.revision(phoneJid);
    this.policy.pending.set(remoteJid, controller); this.policy.pending.set(phoneJid, controller);
    let committed = false;
    const suppressed = () => this.isHumanPaused(phoneJid) || this.isHumanPaused(remoteJid) ||
      this.policy.revision(remoteJid) !== revision || this.policy.revision(phoneJid) !== phoneRevision ||
      (this.policy.ready && !this.policy.allowed(phoneJid));
    const commit = (fn) => {
      const result = this.queue.commit(job, fn, { jid: phoneJid, suppressed: suppressed() });
      committed = true;
      return result;
    };
    try {
      const result = await this.onMessage({ phone: phoneJid.split('@')[0], name: last.pushName || null,
        text: messages.map((m) => extractText(m.message)).join('\n'), source: 'whatsapp', signal: controller.signal,
        commit, jobId: job.id });
      if (!committed) commit(() => result);
      if (result?.reply) await this.messageBuffer.waitForSilence(remoteJid);
      if (suppressed()) this.db.prepare("UPDATE wa_outbox SET state='cancelled' WHERE id=? AND state='pending'").run(job.id);
      await this.flushOutgoing();
    } finally {
      for (const jid of [remoteJid, phoneJid]) if (this.policy.pending.get(jid) === controller) this.policy.pending.delete(jid);
    }
  }

  isHumanPaused(jid) {
    return [cleanJid(jid), ...(this.policy.aliases.get(cleanJid(jid)) || [])].some((id) =>
      this.db.prepare('SELECT 1 FROM whatsapp_human_pause WHERE account=? AND jid=?').get(this.policy.account, id));
  }

  setHumanPaused(phoneOrJid, paused = true) {
    const jid = cleanJid(String(phoneOrJid).includes('@') ? phoneOrJid : `${phoneOrJid}@s.whatsapp.net`);
    for (const id of [jid, ...(this.policy.aliases.get(jid) || [])]) {
      this.policy.revisions.set(id, this.policy.revision(id) + 1);
      if (paused) {
        this.policy.pending.get(id)?.abort();
        this.db.prepare('INSERT OR IGNORE INTO whatsapp_human_pause VALUES (?,?)').run(this.policy.account, id);
        this.db.prepare("UPDATE wa_outbox SET state='cancelled' WHERE account=? AND jid=? AND automatic=1 AND state='pending'").run(this.policy.account, id);
      } else this.db.prepare('DELETE FROM whatsapp_human_pause WHERE account=? AND jid=?').run(this.policy.account, id);
    }
  }

  async handleHumanMessage(message) {
    const jid = cleanJid(message.key?.remoteJid), id = message.key?.id;
    if (!message.key?.fromMe || !privateJid(jid) || !id || !message.message ||
      message.message.protocolMessage || message.message.senderKeyDistributionMessage) return;
    this.queue.receive(this.policy.account, minimalMessage(message, true));
    if (this.db.prepare('SELECT 1 FROM whatsapp_sent_ids WHERE account=? AND id=?').get(this.policy.account, id)) {
      this.queue.acknowledge(id, this.policy.account, (row) => this.delivered(row));
      this.db.prepare('UPDATE wa_human_inbox SET done=1 WHERE account=? AND message_id=?').run(this.policy.account, id);
      return;
    }
    if (this.db.prepare('SELECT 1 FROM whatsapp_human_seen WHERE account=? AND id=?').get(this.policy.account, id)) {
      this.db.prepare('UPDATE wa_human_inbox SET done=1 WHERE account=? AND message_id=?').run(this.policy.account, id);
      return;
    }
    this.setHumanPaused(jid);
    let phoneJid = jid;
    if (jid.endsWith('@lid')) phoneJid = message.key.remoteJidAlt || await this.socket?.signalRepository?.lidMapping?.getPNForLID(jid);
    if (!/^\d+@s\.whatsapp\.net$/.test(phoneJid || '')) {
      this.db.prepare('UPDATE wa_human_inbox SET done=2 WHERE account=? AND message_id=?').run(this.policy.account, id);
      this.report(failure('invalid_data')); return;
    }
    this.policy.alias(jid, phoneJid); this.setHumanPaused(phoneJid);
    this.queue.transaction(() => {
      this.db.prepare('UPDATE wa_human_inbox SET done=1 WHERE account=? AND message_id=?').run(this.policy.account, id);
      if (!this.db.prepare('INSERT OR IGNORE INTO whatsapp_human_seen VALUES (?,?)').run(this.policy.account, id).changes) return;
      this.onHumanMessage?.({ phone: phoneJid.split('@')[0], text: extractText(message.message) || '[Mensagem de mídia enviada pelo atendente]' });
    });
  }

  async sendText(phoneOrJid, body, { automatic = false, id = randomBytes(16).toString('hex'), ticketId } = {}) {
    const jid = cleanJid(String(phoneOrJid).includes('@') ? phoneOrJid : `${String(phoneOrJid).replace(/\D/g, '')}@s.whatsapp.net`);
    if (!privateJid(jid) || !this.policy.account) return { delivered: false, reason: 'Envio bloqueado: conta ou destinatário inválido.' };
    if ((automatic && this.isHumanPaused(jid)) || (this.policy.ready && !this.policy.allowed(jid)))
      return { delivered: false, reason: 'Envio bloqueado por atendimento humano ou conversa arquivada.' };
    this.queue.addOutgoing({ id, account: this.policy.account, jid, body, automatic, ticketId });
    await this.flushOutgoing();
    const row = this.db.prepare('SELECT state FROM wa_outbox WHERE id=?').get(id);
    return { delivered: row.state === 'sent', queued: row.state === 'pending',
      reason: row.state === 'review' ? 'Envio sem confirmação. Confira a conversa.' : 'Mensagem salva na fila de envio.' };
  }

  delivered(row) {
    if (row.automatic && row.ticket_id) this.onDelivery?.({ ticket: { id: row.ticket_id }, reply: row.body });
  }

  flushOutgoing() {
    if (this.sending) return this.sending;
    this.sending = this.sendPending().finally(() => { this.sending = null; });
    return this.sending;
  }

  async sendPending() {
    if (!this.socket || !this.status.connected || !this.policy.ready) return;
    for (const row of this.queue.outgoing(this.policy.account)) {
      if (row.automatic) for (const jid of [row.jid, ...(this.policy.aliases.get(row.jid) || [])])
        await this.messageBuffer.waitForSilence(jid);
      if (!this.status.connected || !this.policy.ready) break;
      if (this.db.prepare('SELECT state FROM wa_outbox WHERE id=?').get(row.id)?.state !== 'pending') continue;
      if (!this.policy.allowed(row.jid) || (row.automatic && this.isHumanPaused(row.jid))) {
        this.queue.markOutgoing(row.id, 'cancelled'); continue;
      }
      const socket = this.socket;
      this.queue.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO whatsapp_sent_ids VALUES (?,?)').run(row.account, row.message_id);
        this.queue.markOutgoing(row.id, 'sending');
      });
      let timer;
      try {
        await Promise.race([socket.sendMessage(row.jid, { text: row.body }, { messageId: row.message_id }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(failure('delivery_uncertain')), 25000); })]);
        this.queue.acknowledge(row.message_id, row.account, (sent) => this.delivered(sent));
      } catch {
        // After handing data to the transport we cannot prove that it was not delivered.
        this.db.prepare("UPDATE wa_outbox SET state='review',error='delivery_uncertain' WHERE id=? AND state='sending'").run(row.id);
        this.report(failure('delivery_uncertain'));
      } finally { clearTimeout(timer); }
    }
  }

  async stop() {
    this.stopping = true; this.clearTimer(this.reconnectTimer); clearInterval(this.workerTimer);
    this.detach();
    await this.processing; await this.sending;
    this.authStore?.close(); this.authStore = null;
  }
}

function extractText(message) {
  return (message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '').trim();
}

export function minimalMessage(raw, allowHuman = false) {
  const jid = cleanJid(raw?.key?.remoteJid);
  if (!privateJid(jid) || (raw.key.fromMe && !allowHuman) || !raw.key.id || !raw.message || raw.message.protocolMessage || raw.message.senderKeyDistributionMessage) return null;
  const text = extractText(raw.message) || '[Mensagem de mídia recebida: atendimento humano necessário]';
  return { key: { remoteJid: jid, remoteJidAlt: raw.key.remoteJidAlt ? cleanJid(raw.key.remoteJidAlt) : undefined,
    id: String(raw.key.id), fromMe: !!raw.key.fromMe }, pushName: String(raw.pushName || '').slice(0, 120),
    messageTimestamp: Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000), message: { conversation: text.slice(0, 6000) } };
}
