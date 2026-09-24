import express from 'express';
import path from 'node:path';
import { createPostgresDatabase } from './postgres-database.js';
import { createPostgresClinicStore, registerPostgresClinicRoutes } from './postgres-clinic.js';
import { createPostgresAIConfig } from './postgres-ai-config.js';
import { createAIService } from './ai-service.js';
import { createPostgresSecurity } from './postgres-security.js';
import { collectPatient } from './patient-intake.js';
import { buildHumanNotification } from './ai.js';
import { legalDocuments } from './legal.js';
import { createPostgresWhatsApp } from './postgres-whatsapp.js';
import bcrypt from 'bcryptjs';
import { WebSocketServer } from 'ws';
import { createConversationMemory } from './conversation-memory.js';

export async function createPostgresClinicApp({ rootDir, dataDir, authDir }) {
  const company = { id: 'acores', name: 'Centro Veterinário dos Açores', primary: true };
  const db = await createPostgresDatabase(rootDir); if (!db) throw new Error('SUPABASE_DB_URL não configurada.');
  const clinic = await createPostgresClinicStore(db);
  const aiConfig = await createPostgresAIConfig(db, dataDir);
  const ai = createAIService(aiConfig, async () => ({ ...(await clinic.snapshot()).settings, is24Hours: true }));
  const conversationMemory = createConversationMemory(process.env);
  await conversationMemory.init();
  const app = express();
  const security = await createPostgresSecurity(db, dataDir, process.env, company);
  security.install(app);
  app.use(express.json({ limit: '64kb', strict: true }));
  security.routes(app);
  app.use('/api', (req, res, next) => { if (['/health', '/legal'].includes(req.path) || req.path.startsWith('/auth/')) return next(); if (!req.user) return res.status(401).json({ error: 'Entre para continuar.' }); next(); });
  const processIncoming = async ({ phone, name, text, source }) => {
    const existing = await db.getClientByPhone(phone);
    const active = await db.findActiveTicket(phone);
    const history = active ? await db.listMessages(active.id) : [];
    const cloudHistory = conversationMemory.enabled ? await conversationMemory.list(phone).catch(() => []) : [];
    const intake = collectPatient(text, history, existing || {});
    const analysis = await ai.analyze(text, cloudHistory.length ? cloudHistory : history);
    const client = await db.upsertClient({ phone, name: existing?.name || name, ...intake.patch });
    const ticket = active ? await db.updateTicket(active.id, { subject: analysis.subject, category: analysis.category, priority: analysis.priority, human_required: active.human_required || analysis.humanRequired, ai_summary: analysis.summary }) : await db.createTicket({ client_id: client.id, phone, subject: analysis.subject, category: analysis.category, priority: analysis.priority, human_required: analysis.humanRequired, ai_summary: analysis.summary, source });
    await db.addMessage(ticket.id, { direction: 'inbound', author: client.name, body: text });
    await conversationMemory.append(phone, { direction: 'inbound', author: client.name, body: text }).catch(() => {});
    const message = source === 'whatsapp' ? null : await db.addMessage(ticket.id, { direction: 'outbound', author: 'Açores IA', body: analysis.reply });
    if (analysis.humanRequired) await db.createNotification({ ticket_id: ticket.id, ...buildHumanNotification(client, ticket), ...(analysis.aiUnavailable ? { title: 'IA indisponível', level: 'warning' } : {}) });
    if (analysis.reply) await conversationMemory.append(phone, { direction: 'outbound', author: 'Açores IA', body: analysis.reply }).catch(() => {});
    return { ticket: await db.getTicket(ticket.id), client, reply: analysis.reply, message, aiProvider: analysis.aiProvider };
  };
  const whatsapp = await createPostgresWhatsApp({ db, authDir, onMessage: processIncoming, onAlert: () => {}, onDelivery: async ({ ticket, reply }) => { if (ticket?.id && reply) await db.addMessage(ticket.id, { direction: 'outbound', author: 'Açores IA', body: reply }); }, onHumanMessage: async ({ phone, text }) => { const client = await db.getClientByPhone(phone) || await db.upsertClient({ phone }); const ticket = await db.findActiveTicket(phone) || await db.createTicket({ client_id: client.id, phone, subject: 'Atendimento humano', source: 'whatsapp' }); await db.updateTicket(ticket.id, { ai_paused: true, human_required: true, status: 'em_atendimento' }); await db.addMessage(ticket.id, { direction: 'outbound', author: 'Recepção', body: text }); } });
  const snapshot = async () => { const clinicData = await clinic.snapshot(); return { stats: await db.getStats(), clients: await db.listClients(), tickets: await db.listTickets(), notifications: await db.listNotifications(), whatsapp: await whatsapp.snapshot(), petshopName: clinicData.settings.name, company, ...clinicData, ai: { ...(await aiConfig.snapshot()), runtime: ai.snapshot() } }; };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const broadcast = () => { void snapshot().then((data) => { for (const client of wss.clients) { if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: 'dashboard', payload: data })); } }).catch(() => {}); };
  wss.on('connection', async (socket, req) => { const session = await security.session(req); if (session) socket.send(JSON.stringify({ type: 'dashboard', payload: security.view(await snapshot(), session) })); });

  app.get('/api/health', async (_req, res) => { try { await db.query('select 1'); res.json({ ok: true, service: 'acores', database: 'supabase' }); } catch { res.status(503).json({ ok: false, service: 'acores' }); } });
  app.get('/api/dashboard', async (req, res) => res.json(security.view(await snapshot(), req.user)));
  app.get('/api/clients', async (req, res) => { const rows = req.user.role === 'usuario' ? [await db.getClient(req.user.client_id)].filter(Boolean) : await db.listClients(); res.json(rows.slice(req.page?.offset || 0, (req.page?.offset || 0) + (req.page?.limit || 200))); });
  app.post('/api/clients', async (req, res) => { try { const client = await db.upsertClient(req.body); res.status(201).json(client); } catch { res.status(400).json({ error: 'Não foi possível concluir a operação. Confira os dados.' }); } });
  app.patch('/api/clients/:id', async (req, res) => { try { if (req.user.role === 'usuario' && Number(req.params.id) !== Number(req.user.client_id)) return res.status(404).json({ error: 'Cliente nao encontrado.' }); const client = await db.updateClient(Number(req.params.id), req.body); if (!client) return res.status(404).json({ error: 'Cliente nao encontrado.' }); res.json(client); } catch { res.status(400).json({ error: 'Não foi possível concluir a operação. Confira os dados.' }); } });
  app.get('/api/tickets', async (req, res) => { const rows = await db.listTickets(); res.json(req.user.role === 'usuario' ? rows.filter((t) => Number(t.client_id) === Number(req.user.client_id)) : rows); });
  app.get('/api/tickets/:id/messages', async (req, res) => { const ticket = await db.getTicket(Number(req.params.id)); if (!ticket || (req.user.role === 'usuario' && Number(ticket.client_id) !== Number(req.user.client_id))) return res.status(404).json({ error: 'Chamado nao encontrado.' }); res.json({ ticket, messages: await db.listMessages(ticket.id) }); });
  app.patch('/api/tickets/:id', async (req, res) => { const current = await db.getTicket(Number(req.params.id)); if (!current || (req.user.role === 'usuario' && Number(current.client_id) !== Number(req.user.client_id))) return res.status(404).json({ error: 'Chamado nao encontrado.' }); const ticket = await db.updateTicket(Number(req.params.id), req.body); if (!ticket) return res.status(404).json({ error: 'Chamado nao encontrado.' }); if (req.body.ai_paused !== undefined || req.body.status === 'em_atendimento') await whatsapp.setHumanPaused(ticket.phone, !!ticket.ai_paused || ticket.status === 'em_atendimento'); res.json(ticket); });
  app.post('/api/tickets/:id/messages', async (req, res) => { const ticket = await db.getTicket(Number(req.params.id)); const body = String(req.body.body || '').trim(); if (!ticket) return res.status(404).json({ error: 'Chamado nao encontrado.' }); if (!body) return res.status(400).json({ error: 'Mensagem vazia.' }); await db.updateTicket(ticket.id, { ai_paused: true, status: 'em_atendimento', human_required: true }); await whatsapp.setHumanPaused(ticket.phone); const message = await db.addMessage(ticket.id, { direction: 'outbound', author: req.user.email, body }); const delivery = req.body.sendToWhatsApp ? await whatsapp.sendText(ticket.phone, body, { id: `manual:${message.id}`, ticketId: ticket.id }) : { delivered: false, reason: 'Mensagem registrada no painel.' }; res.status(201).json({ message, delivery }); });
  app.post('/api/simulate-message', async (req, res) => { try { const result = await processIncoming({ phone: String(req.body.phone || '').replace(/\D/g, ''), name: req.body.name, text: req.body.text, source: 'simulador' }); res.status(201).json(result); } catch { res.status(400).json({ error: 'Não foi possível concluir a operação. Confira os dados.' }); } });
  app.patch('/api/ai/settings', async (req, res) => { try { res.json(await aiConfig.save(req.body)); } catch { res.status(400).json({ error: 'Não foi possível concluir a operação. Confira os dados.' }); } });
  app.post('/api/ai/test/:provider', async (req, res) => { try { res.json(await ai.test(req.params.provider)); } catch (error) { res.status(400).json({ error: error.message || 'Não foi possível testar a IA.' }); } });
  app.post('/api/notifications/read', async (_req, res) => res.json(await db.markNotificationsRead()));
  app.get('/api/whatsapp/status', async (_req, res) => res.json(await whatsapp.snapshot()));
  app.post('/api/whatsapp/start', async (_req, res) => {
    const status = await whatsapp.start();
    if (status.mode === 'intervention' && status.lastError) return res.status(status.requiresNewQr ? 409 : 503).json({ error: status.lastError.message, code: status.lastError.code });
    res.json(status);
  });
  app.post('/api/whatsapp/sync', async (_req, res) => res.json(await whatsapp.snapshot()));
  app.post('/api/whatsapp/relink', async (req, res) => { const status = await whatsapp.snapshot(); if (req.body?.confirmed !== true || !status.requiresNewQr) return res.status(400).json({ error: 'Confirme a substituição da sessão inválida.' }); res.json(await whatsapp.start({ newSession: true })); });
  app.get('/api/operations/status', async (_req, res) => { const wa = await whatsapp.snapshot(); res.json({ checkedAt: new Date().toISOString(), process: true, database: true, ai: ai.snapshot(), whatsapp: wa, queue: wa.queue, alerts: [] }); });
  app.post('/api/operations/check', async (_req, res) => { await ai.health(); const wa = await whatsapp.snapshot(); res.json({ checkedAt: new Date().toISOString(), process: true, database: true, ai: ai.snapshot(), whatsapp: wa, queue: wa.queue, alerts: [] }); });
  app.get('/api/operations/reviews', async (_req, res) => res.json(await db.many("select id,ticket_id,created_at,error from wa_outbox where state='review' order by seq limit 50")));
  app.post('/api/operations/review/:id', async (req, res) => { if (req.body?.confirmed !== true || !['sent','cancelled'].includes(req.body?.resolution)) return res.status(400).json({ error: 'Confirme a conferência do envio.' }); const row = await db.one("select id from wa_outbox where id=$1 and state='review'", [req.params.id]); if (!row) return res.status(404).json({ error: 'Envio não encontrado.' }); await db.query('update wa_outbox set state=$1,error=null where id=$2', [req.body.resolution, req.params.id]); res.json({ ok: true }); });
  app.get('/api/users', async (_req, res) => res.json(await db.many('select id,email,username,role,active,must_change_password from auth_users order by id limit 500')));
  app.post('/api/users', async (req, res) => { const { email, username, role, password } = req.body || {}; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '')) || !/^[a-zA-Z0-9._-]{3,80}$/.test(String(username || '')) || !['administrador','atendente','tecnico'].includes(role) || String(password || '').length < 10) return res.status(400).json({ error: 'Confira os dados e se o acesso já está cadastrado.' }); try { const row = await db.one('insert into auth_users(email,username,role,password_hash,must_change_password) values($1,$2,$3,$4,true) returning id', [String(email).toLowerCase(), String(username).toLowerCase(), role, await bcrypt.hash(password, 12)]); res.status(201).json({ id: row.id }); } catch { res.status(409).json({ error: 'E-mail ou usuário já utilizado.' }); } });
  app.patch('/api/users/:id', async (req, res) => { const id = Number(req.params.id), input = req.body || {}; const current = await db.one('select * from auth_users where id=$1', [id]); if (!current) return res.status(404).json({ error: 'Usuário não encontrado.' }); await db.transaction(async (client) => { await client.query('update auth_users set active=$1,role=$2,password_hash=$3,must_change_password=$4 where id=$5', [input.active ?? current.active, input.role || current.role, input.password ? await bcrypt.hash(input.password, 12) : current.password_hash, input.password ? true : current.must_change_password, id]); await client.query('delete from auth_sessions where user_id=$1', [id]); }); res.json({ ok: true }); });
  app.get('/api/audit', async (_req, res) => res.json(await db.many('select at,user_id,event,resource from security_audit order by id desc limit 200')));
  app.delete('/api/:entity/:id', async (req, res) => {
    const table = { clients: 'clients', tickets: 'tickets', appointments: 'appointments', neonatal: 'neonatal_care', notifications: 'notifications' }[req.params.entity];
    const id = Number(req.params.id);
    if (!table || !Number.isSafeInteger(id) || id < 1 || req.body?.confirmed !== true) return res.status(400).json({ error: 'Confirme a exclusão.' });
    try {
      const exists = await db.one(`select id from ${table} where id=$1`, [id]); if (!exists) return res.status(404).json({ error: 'Registro não encontrado.' });
      await db.transaction(async (client) => {
        if (table === 'clients') {
          await client.query('delete from appointments where client_id=$1', [id]);
          await client.query('delete from neonatal_care where client_id=$1', [id]);
          await client.query('delete from tickets where client_id=$1', [id]);
        }
        await client.query(`delete from ${table} where id=$1`, [id]);
      });
      res.json({ deleted: true });
    } catch { res.status(409).json({ error: 'Não foi possível excluir o registro vinculado.' }); }
  });
  registerPostgresClinicRoutes(app, clinic);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Recurso não encontrado.' }));
  const distDir = path.join(rootDir, 'dist'); app.use(express.static(distDir)); app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  const upgrade = (req, socket, head) => { void (async () => { const session = await security.session(req); if (req.url !== '/ws' || !session || !security.origins.has(req.headers.origin) || (security.production && req.headers['x-forwarded-proto'] !== 'https')) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; } wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)); })().catch(() => socket.destroy()); };
  return { app, security, store: db, clinic, aiConfig, ai, whatsapp, broadcast, company, upgrade,
    start() { if (process.env.NODE_ENV !== 'test' && process.env.WHATSAPP_AUTOSTART !== 'false') void whatsapp.start(); },
    async stop() { await whatsapp.stop(); await conversationMemory.close(); await db.close(); } };
}
