import QRCode from 'qrcode';
import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { classify, disconnectFault, failure, retryDelay } from './reliability.js';
import { openPostgresAuthStore } from './postgres-whatsapp-auth.js';

const cleanJid = (value) => String(value || '').replace(/:\d+@/, '@');
const privateJid = (value) => /^\d+@s\.whatsapp\.net$/.test(cleanJid(value));
const textOf = (message) => (message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || '').trim();

export async function createPostgresWhatsApp({ db, authDir, onMessage, onHumanMessage, onDelivery, onAlert, env = process.env }) {
  const accountName = String(env.WHATSAPP_ACCOUNT || 'acores');
  const maxReconnects = Math.max(1, Number(env.WHATSAPP_MAX_RECONNECTS || 6));
  const state = { mode: 'offline', connected: false, phone: null, attempts: 0, requiresNewQr: false, qrDataUrl: null, lastError: null, offlineSince: new Date().toISOString() };
  let socket = null, stopping = false, reconnectTimer = null, generation = 0;
  const archived = new Map(), paused = new Set(), pending = new Map();
  const authStore = await openPostgresAuthStore(db, accountName, env);
  const snapshot = () => ({ ...state, ignoreGroups: true, ignoreArchived: true, archiveSyncReady: state.connected, pendingMessages: pending.size, queue: { pending: pending.size, incoming: pending.size, outgoing: 0, review: 0, blocked: 0 } });
  const publish = () => onAlert?.({ ...state, code: state.lastError?.code || 'whatsapp_status', classification: 'intervention' });
  const setStatus = (value) => Object.assign(state, value, { updatedAt: new Date().toISOString() });
  const isBlocked = (jid) => archived.get(cleanJid(jid)) === true || paused.has(cleanJid(jid));
  const nextReconnect = () => { if (stopping || state.attempts >= maxReconnects) { setStatus({ mode: 'intervention', requiresIntervention: true }); onAlert?.(failure('retry_limit')); return; } const attempt = ++state.attempts; reconnectTimer = setTimeout(() => void start(), retryDelay(attempt)); reconnectTimer.unref?.(); setStatus({ mode: 'reconnecting', nextReconnectAt: new Date(Date.now() + retryDelay(attempt)).toISOString() }); };
  const markInbound = async (jid, message) => {
    const result = await db.one(`insert into wa_inbox(account,jid,message_id,payload,received_at) values($1,$2,$3,$4::jsonb,$5) on conflict(account,message_id) do nothing returning seq`, [accountName, jid, message.key.id, JSON.stringify(message), Date.now()]);
    return !!result;
  };
  const start = async ({ newSession = false } = {}) => {
    if (stopping || socket) return snapshot();
    if (newSession) { await authStore.newSession(); state.requiresNewQr = false; }
    const currentGeneration = ++generation;
    try {
      const authState = await authStore.load();
      const sock = makeWASocket({ auth: authState.state, printQRInTerminal: false, syncFullHistory: true, markOnlineOnConnect: false, connectTimeoutMs: 20000, defaultQueryTimeoutMs: 20000 }); socket = sock;
      sock.ev.on('creds.update', authState.saveCreds);
      sock.ev.on('chats.upsert', (chats) => { for (const chat of chats || []) if (chat?.id) archived.set(cleanJid(chat.id), chat.archived === true); });
      sock.ev.on('chats.update', (chats) => { for (const chat of chats || []) if (chat?.id && typeof chat.archived === 'boolean') archived.set(cleanJid(chat.id), chat.archived); });
      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (currentGeneration !== generation) return;
        if (qr) { state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 280 }); setStatus({ mode: 'qr', connected: false, requiresNewQr: false, lastEvent: 'Escaneie o QR Code para conectar.' }); }
        if (connection === 'open') { setStatus({ mode: 'connected', connected: true, phone: sock.user?.id || null, qrDataUrl: null, attempts: 0, requiresNewQr: false, offlineSince: null, lastReconnectAt: new Date().toISOString() }); publish(); }
        if (connection === 'close') {
          socket = null; const code = lastDisconnect?.error?.output?.statusCode; const fault = disconnectFault(code); setStatus({ connected: false, offlineSince: state.offlineSince || new Date().toISOString(), lastError: { code: fault.code, message: fault.message } }); onAlert?.(fault);
          if (code === DisconnectReason.loggedOut || ['invalid_session','forbidden','replaced','mismatch'].includes(fault.code)) { setStatus({ mode: 'intervention', requiresNewQr: true, requiresIntervention: true }); return; }
          nextReconnect();
        }
      });
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' || currentGeneration !== generation) return;
        for (const message of messages || []) {
          const jid = cleanJid(message.key?.remoteJid); if (!privateJid(jid) || !message.key?.id) continue;
          if (message.key?.fromMe) { paused.add(jid); onHumanMessage?.({ phone: jid.split('@')[0], text: textOf(message) || '[Mensagem enviada pelo atendente]' }); continue; }
          if (isBlocked(jid)) continue;
          if (!await markInbound(jid, message)) continue;
          const body = textOf(message); if (!body) continue;
          const timer = pending.get(jid); if (timer) clearTimeout(timer);
          pending.set(jid, setTimeout(async () => { pending.delete(jid); try { const result = await onMessage({ phone: jid.split('@')[0], name: message.pushName || null, text: body, source: 'whatsapp' }); if (result?.reply && !isBlocked(jid)) { await db.query(`insert into wa_outbox(id,account,jid,body,automatic,ticket_id,message_id,created_at) values($1,$2,$3,$4,true,$5,$6,$7) on conflict(id) do nothing`, [`inbound:${message.key.id}`, accountName, jid, result.reply, result.ticket?.id || null, `out:${message.key.id}`, Date.now()]); await sock.sendMessage(jid, { text: result.reply }); await db.query(`update wa_outbox set state='sent',sent_at=$1 where id=$2`, [Date.now(), `inbound:${message.key.id}`]); onDelivery?.({ ticket: result.ticket, reply: result.reply }); } } catch (error) { await db.query(`insert into wa_jobs(id,account,jid,payload,state,error,created_at) values($1,$2,$3,$4::jsonb,'blocked',$5,$6) on conflict(id) do update set state='blocked',error=excluded.error`, [`inbound:${message.key.id}`, accountName, jid, JSON.stringify([message]), error?.message || 'processing_failed', Date.now()]); } }, 5000));
        }
      });
      sock.ev.on('messages.update', async (updates) => { for (const { key, update } of updates || []) if (key?.fromMe && update?.status >= 2) await db.query(`update wa_outbox set state='sent',sent_at=$1 where account=$2 and message_id=$3`, [Date.now(), accountName, key.id]); });
    } catch (error) { socket = null; setStatus({ mode: 'intervention', connected: false, lastError: { code: 'credentials_storage', message: 'Não foi possível abrir a sessão do WhatsApp.' } }); onAlert?.(classify(error)); }
    return snapshot();
  };
  return { snapshot, start, async stop() { stopping = true; clearTimeout(reconnectTimer); for (const timer of pending.values()) clearTimeout(timer); pending.clear(); try { socket?.end?.(failure('interrupted')); } catch {} socket = null; await authStore.close(); }, setHumanPaused(phoneOrJid, value = true) { const jid = cleanJid(String(phoneOrJid).includes('@') ? phoneOrJid : `${String(phoneOrJid).replace(/\D/g, '')}@s.whatsapp.net`); if (value) paused.add(jid); else paused.delete(jid); }, async sendText(phoneOrJid, body) { const jid = cleanJid(String(phoneOrJid).includes('@') ? phoneOrJid : `${String(phoneOrJid).replace(/\D/g, '')}@s.whatsapp.net`); if (!socket || !state.connected || !privateJid(jid) || isBlocked(jid)) return { delivered: false, reason: 'Envio bloqueado pela conexão ou política da conversa.' }; await socket.sendMessage(jid, { text: body }); return { delivered: true }; } };
}
