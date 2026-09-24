import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { classify, disconnectFault, failure, retryDelay } from './reliability.js';
import { openPostgresAuthStore } from './postgres-whatsapp-auth.js';

const cleanJid = (value) => String(value || '').replace(/:\d+@/, '@');
const privateJid = (value) => /^\d+@s\.whatsapp\.net$/.test(cleanJid(value));
const textOf = (message) => (message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '').trim();

export async function createPostgresWhatsApp({ db, authDir: _authDir, onMessage, onHumanMessage, onDelivery, onAlert, env = process.env }) {
  const account = String(env.WHATSAPP_ACCOUNT || 'acores');
  const maxAttempts = Math.max(1, Number(env.WHATSAPP_MAX_RECONNECTS || 6));
  const authStore = await openPostgresAuthStore(db, account, env);
  const state = { mode: 'offline', connected: false, phone: null, attempts: 0, requiresNewQr: false, qrDataUrl: null, lastError: null, archiveSyncReady: false, offlineSince: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const archived = new Map();
  let socket = null;
  let stopping = false;
  let starting = null;
  let reconnectTimer = null;
  let drainTimer = null;
  let archiveReadyTimer = null;
  let drainPromise = null;
  let generation = 0;

  const setStatus = (value) => Object.assign(state, value, { updatedAt: new Date().toISOString() });
  const report = (fault) => { state.lastError = { code: fault.code, message: fault.message, classification: fault.classification }; onAlert?.(fault); };

  async function policyFor(jid) {
    const normalized = cleanJid(jid);
    if (archived.get(normalized) === true) return true;
    const row = await db.one('select archived from whatsapp_chat_policy where account=$1 and jid=$2', [account, normalized]);
    if (row) archived.set(normalized, row.archived === true);
    return row?.archived === true;
  }

  async function humanPaused(jid) {
    const row = await db.one('select 1 from whatsapp_human_pause where account=$1 and jid=$2', [account, cleanJid(jid)]);
    return !!row;
  }

  async function blocked(jid) {
    return !privateJid(jid) || await policyFor(jid) || await humanPaused(jid);
  }

  async function blockedForDelivery(jid, automatic) {
    return !privateJid(jid) || await policyFor(jid) || (automatic && await humanPaused(jid));
  }

  async function snapshot() {
    const queue = await db.one(`select
      (select count(*)::int from wa_inbox i left join wa_jobs j on j.id=i.job_id where i.account=$1 and (i.job_id is null or j.state in ('pending','processing'))) as incoming,
      (select count(*)::int from wa_outbox where account=$1 and state in ('pending','sending')) as outgoing,
      (select count(*)::int from wa_outbox where account=$1 and state='review') as review,
      (select count(*)::int from wa_jobs where account=$1 and state='blocked') as blocked`, [account]);
    const incoming = Number(queue?.incoming || 0);
    return { ...state, ignoreGroups: true, ignoreArchived: true, pendingMessages: incoming + Number(queue?.outgoing || 0), queue: { incoming, outgoing: Number(queue?.outgoing || 0), review: Number(queue?.review || 0), blocked: Number(queue?.blocked || 0), pending: incoming + Number(queue?.outgoing || 0) } };
  }

  async function markArchive(chats) {
    for (const chat of chats || []) {
      const jid = cleanJid(chat?.id);
      if (!privateJid(jid) || typeof chat.archived !== 'boolean') continue;
      const value = chat.archived === true;
      archived.set(jid, value);
      await db.query(`insert into whatsapp_chat_policy(account,jid,archived) values($1,$2,$3)
        on conflict(account,jid) do update set archived=excluded.archived`, [account, jid, value]);
    }
    if (!state.archiveSyncReady) {
      setStatus({ archiveSyncReady: true });
      if (archiveReadyTimer) { clearTimeout(archiveReadyTimer); archiveReadyTimer = null; }
      scheduleDrain(0);
    }
  }

  async function enqueue(raw) {
    const jid = cleanJid(raw?.key?.remoteJid);
    if (!raw?.key?.id || !privateJid(jid)) return null;
    if (await blocked(jid)) return null;
    const body = textOf(raw);
    if (!body) return null;
    const result = await db.transaction(async (client) => {
      const inbox = await client.query(`insert into wa_inbox(account,jid,message_id,payload,received_at)
        values($1,$2,$3,$4::jsonb,$5) on conflict(account,message_id) do nothing returning seq`, [account, jid, String(raw.key.id), JSON.stringify(raw), Date.now()]);
      if (!inbox.rowCount) return null;
      const pending = await client.query(`select id,payload from wa_jobs where account=$1 and jid=$2 and state='pending' order by created_at desc limit 1 for update`, [account, jid]);
      const jobId = pending.rows[0]?.id || `inbound:${account}:${String(raw.key.id)}`;
      const payload = pending.rows[0] ? [...(Array.isArray(pending.rows[0].payload) ? pending.rows[0].payload : JSON.parse(pending.rows[0].payload)), raw] : [raw];
      if (pending.rows[0]) await client.query('update wa_jobs set payload=$1::jsonb,next_at=$2 where id=$3', [JSON.stringify(payload), Date.now() + 5000, jobId]);
      else await client.query(`insert into wa_jobs(id,account,jid,payload,state,attempts,next_at,created_at)
        values($1,$2,$3,$4::jsonb,'pending',0,$5,$6)`, [jobId, account, jid, JSON.stringify(payload), Date.now() + 5000, Date.now()]);
      await client.query('update wa_inbox set job_id=$1 where account=$2 and message_id=$3', [jobId, account, String(raw.key.id)]);
      return jobId;
    });
    if (result) { if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; } scheduleDrain(5000); }
    return result;
  }

  async function handleHuman(raw) {
    const jid = cleanJid(raw?.key?.remoteJid), id = String(raw?.key?.id || '');
    if (!privateJid(jid) || !id) return;
    await db.query(`insert into wa_human_inbox(account,message_id,payload,done) values($1,$2,$3::jsonb,0) on conflict(account,message_id) do nothing`, [account, id, JSON.stringify(raw)]);
    await db.query('insert into whatsapp_human_pause(account,jid) values($1,$2) on conflict do nothing', [account, jid]);
    const seen = await db.query('insert into whatsapp_human_seen(account,id) values($1,$2) on conflict do nothing', [account, id]);
    if (seen.rowCount) await onHumanMessage?.({ phone: jid.split('@')[0], text: textOf(raw) || '[Mensagem enviada pelo atendente]' });
    await db.query('update wa_human_inbox set done=1 where account=$1 and message_id=$2', [account, id]);
  }

  async function isAutomaticMessage(raw) {
    const jid = cleanJid(raw?.key?.remoteJid), body = textOf(raw);
    if (!jid || !body) return false;
    const exact = await db.one('select 1 from wa_outbox where account=$1 and jid=$2 and automatic=true and state in (\'sent\',\'sending\') and (message_id=$3 or (body=$4 and sent_at>$5)) limit 1', [account, jid, raw.key.id, body, Date.now() - 60000]);
    return !!exact;
  }

  async function rescheduleComposing(jid) {
    await db.query(`update wa_jobs set next_at=$1 where account=$2 and jid=$3 and state='pending'`, [Date.now() + 10000, account, cleanJid(jid)]);
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
    scheduleDrain(10000);
  }

  async function processJob(job) {
    const claimed = await db.one(`update wa_jobs set state='processing',attempts=attempts+1 where id=$1 and state='pending' returning *`, [job.id]);
    if (!claimed) return;
    try {
      const messages = Array.isArray(claimed.payload) ? claimed.payload : JSON.parse(claimed.payload);
      const last = messages.at(-1), jid = cleanJid(claimed.jid);
      if (await blocked(jid)) { await db.query("update wa_jobs set state='ignored',error=null where id=$1", [claimed.id]); return; }
      const result = await onMessage({ phone: jid.split('@')[0], name: last.pushName || null, text: messages.map((m) => textOf(m)).filter(Boolean).join('\n'), source: 'whatsapp' });
      if (result?.reply && !(await blocked(jid))) {
        await db.query(`insert into wa_outbox(id,account,jid,body,automatic,ticket_id,message_id,created_at)
          values($1,$2,$3,$4,true,$5,$6,$7) on conflict(id) do nothing`, [claimed.id, account, jid, result.reply, result.ticket?.id || null, `out:${claimed.id}`, Date.now()]);
      }
      await db.query("update wa_jobs set state='processed',error=null where id=$1", [claimed.id]);
      await flushOutbox();
    } catch (error) {
      const fault = classify(error?.fault ? error : failure('processing_failed'));
      const attempts = Number(claimed.attempts || 1);
      const retry = fault.classification === 'recoverable' && attempts < maxAttempts;
      await db.query('update wa_jobs set state=$1,error=$2,next_at=$3 where id=$4', [retry ? 'pending' : 'blocked', fault.code, Date.now() + (retry ? retryDelay(attempts) : 0), claimed.id]);
      report(fault);
    }
  }

  async function drain() {
    if (drainPromise) return drainPromise;
    drainPromise = (async () => {
      if (!state.archiveSyncReady) return;
      const jobs = await db.many(`select * from wa_jobs where account=$1 and state='pending' and next_at <= $2 order by created_at,id limit 100`, [account, Date.now()]);
      for (const job of jobs) { if (stopping) break; await processJob(job); }
      await flushOutbox();
      const next = await db.one("select min(next_at)::bigint as next_at from wa_jobs where account=$1 and state='pending'", [account]);
      if (next?.next_at) scheduleDrain(Math.max(0, Number(next.next_at) - Date.now()));
    })().finally(() => { drainPromise = null; });
    return drainPromise;
  }

  function scheduleDrain(delay = 0) {
    if (drainTimer) return;
    drainTimer = setTimeout(() => { drainTimer = null; void drain(); }, Math.max(0, delay));
    drainTimer.unref?.();
  }

  async function flushOutbox() {
    if (!socket || !state.connected) return;
    const rows = await db.many(`select * from wa_outbox where account=$1 and state='pending' order by seq limit 100`, [account]);
    for (const row of rows) {
      if (!socket || !state.connected || await blockedForDelivery(row.jid, row.automatic)) continue;
      await db.query("update wa_outbox set state='sending' where id=$1 and state='pending'", [row.id]);
      try {
        await socket.sendMessage(row.jid, { text: row.body }, { messageId: row.message_id });
        await db.query("update wa_outbox set state='sent',error=null,sent_at=$1 where id=$2", [Date.now(), row.id]);
        if (row.automatic) await onDelivery?.({ ticket: { id: row.ticket_id }, reply: row.body });
      } catch {
        await db.query("update wa_outbox set state='review',error='delivery_uncertain' where id=$1 and state='sending'", [row.id]);
        report(failure('delivery_uncertain'));
      }
    }
  }

  function reconnect() {
    if (stopping || reconnectTimer) return;
    if (state.attempts >= maxAttempts) { setStatus({ mode: 'intervention', requiresIntervention: true }); report(failure('retry_limit')); return; }
    const attempt = state.attempts + 1, delay = retryDelay(attempt);
    setStatus({ mode: 'reconnecting', attempts: attempt, nextReconnectAt: new Date(Date.now() + delay).toISOString() });
    reconnectTimer = setTimeout(() => { reconnectTimer = null; void start(); }, delay);
    reconnectTimer.unref?.();
  }

  async function start({ newSession = false } = {}) {
    if (starting) return starting;
    if (socket || stopping) return snapshot();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    starting = (async () => {
      if (newSession) { await authStore.newSession(); setStatus({ requiresNewQr: false, qrDataUrl: null, attempts: 0 }); }
      const currentGeneration = ++generation;
      try {
        const auth = await authStore.load();
        const current = makeWASocket({ auth: auth.state, printQRInTerminal: false, syncFullHistory: true, markOnlineOnConnect: false, connectTimeoutMs: 20000, defaultQueryTimeoutMs: 20000 });
        socket = current;
        current.ev.on('creds.update', auth.saveCreds);
        current.ev.on('messaging-history.set', async ({ chats }) => { await markArchive(chats); });
        current.ev.on('chats.upsert', async (chats) => { await markArchive(chats); });
        current.ev.on('chats.update', async (chats) => { await markArchive(chats); });
        current.ev.on('presence.update', async ({ id, presences }) => { if (Object.values(presences || {}).some((p) => ['composing','recording'].includes(p.lastKnownPresence))) await rescheduleComposing(id); });
        current.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
          if (currentGeneration !== generation) return;
          if (qr) setStatus({ mode: 'qr', connected: false, qrDataUrl: await QRCode.toDataURL(qr, { margin: 1, width: 280 }), requiresNewQr: false, lastEvent: 'Escaneie o QR Code para conectar.' });
          if (connection === 'open') { setStatus({ mode: 'connected', connected: true, phone: current.user?.id || null, qrDataUrl: null, attempts: 0, requiresNewQr: false, requiresIntervention: false, offlineSince: null, lastReconnectAt: new Date().toISOString() }); archiveReadyTimer = setTimeout(() => { if (!state.archiveSyncReady && socket === current) { setStatus({ archiveSyncReady: true }); scheduleDrain(0); } }, 15000); archiveReadyTimer.unref?.(); scheduleDrain(0); }
          if (connection === 'close') { socket = null; generation += 1; clearTimeout(archiveReadyTimer); archiveReadyTimer = null; const code = lastDisconnect?.error?.output?.statusCode, fault = disconnectFault(code); setStatus({ archiveSyncReady: false, connected: false, offlineSince: state.offlineSince || new Date().toISOString(), lastError: { code: fault.code, message: fault.message } }); report(fault); if (code === DisconnectReason.loggedOut || ['invalid_session','forbidden','replaced','mismatch'].includes(fault.code)) setStatus({ mode: 'intervention', requiresNewQr: true, requiresIntervention: true }); else reconnect(); }
        });
        current.ev.on('messages.upsert', async ({ messages, type }) => { if (type !== 'notify' || currentGeneration !== generation) return; for (const message of messages || []) { if (message.key?.fromMe) { if (!(await isAutomaticMessage(message))) await handleHuman(message); } else await enqueue(message); } });
        current.ev.on('messages.update', async (updates) => { for (const { key, update } of updates || []) if (key?.fromMe && Number(update?.status) >= 2) await db.query("update wa_outbox set state='sent',sent_at=$1 where account=$2 and message_id=$3", [Date.now(), account, key.id]); });
      } catch (error) { socket = null; clearTimeout(archiveReadyTimer); archiveReadyTimer = null; const fault = classify(error); setStatus({ mode: 'intervention', connected: false, archiveSyncReady: false }); report(fault); }
      return snapshot();
    })().finally(() => { starting = null; });
    return starting;
  }

  return {
    snapshot,
    start,
    async setHumanPaused(phoneOrJid, paused = true) {
      const jid = cleanJid(String(phoneOrJid).includes('@') ? phoneOrJid : `${String(phoneOrJid).replace(/\D/g, '')}@s.whatsapp.net`);
      if (paused) await db.query('insert into whatsapp_human_pause(account,jid) values($1,$2) on conflict do nothing', [account, jid]);
      else await db.query('delete from whatsapp_human_pause where account=$1 and jid=$2', [account, jid]);
      if (paused) await db.query("update wa_outbox set state='cancelled' where account=$1 and jid=$2 and automatic=true and state='pending'", [account, jid]);
      else scheduleDrain(0);
    },
    async sendText(phoneOrJid, body, { automatic = false, id = `manual:${randomBytes(12).toString('hex')}`, ticketId = null } = {}) {
      const jid = cleanJid(String(phoneOrJid).includes('@') ? phoneOrJid : `${String(phoneOrJid).replace(/\D/g, '')}@s.whatsapp.net`);
      if (await blockedForDelivery(jid, automatic)) return { delivered: false, reason: 'Envio bloqueado pela conexão ou política da conversa.' };
      await db.query(`insert into wa_outbox(id,account,jid,body,automatic,ticket_id,message_id,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do nothing`, [id, account, jid, body, automatic, ticketId, `out:${id}`, Date.now()]);
      await flushOutbox();
      const row = await db.one('select state from wa_outbox where id=$1', [id]);
      return { delivered: row?.state === 'sent', queued: row?.state === 'pending', reason: row?.state === 'review' ? 'Envio sem confirmação. Confira a conversa.' : 'Mensagem salva na fila de envio.' };
    },
    async stop() { stopping = true; clearTimeout(reconnectTimer); clearTimeout(drainTimer); clearTimeout(archiveReadyTimer); socket?.end?.(failure('interrupted')); socket = null; await drainPromise; await authStore.close(); },
  };
}
