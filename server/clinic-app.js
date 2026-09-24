import express from "express";
import path from "node:path";
import fs from "node:fs";
import { WebSocketServer } from "ws";
import { buildHumanNotification } from "./ai.js";
import { createAIConfig } from "./ai-config.js";
import { createAIService } from "./ai-service.js";
import { createDatabase, sanitizePhone, seedDatabase } from "./db.js";
import { WhatsAppConnector } from "./whatsapp.js";
import { createClinicStore, registerClinicRoutes } from "./clinic.js";
import { registerDeletionRoutes } from "./deletions.js";
import { collectPatient } from "./patient-intake.js";
import { createSecurity } from './security.js';
import { validateRequests } from './validation.js';
import { createHealthMonitor } from './health-monitor.js';
import { safeLog } from './reliability.js';
import { createUserManager, registerUsers } from './users.js';
import { createConversationMemory } from './conversation-memory.js';

export function createClinicApp({ rootDir, dataDir, authDir }) {
const company={id:'acores',name:'Centro Veterinário dos Açores',primary:true};
const petshopName = company.name;
const assistantName = 'Açores IA';
const humanTeamName = process.env.HUMAN_TEAM_NAME || 'Equipe da recepcao';
const store = createDatabase(rootDir, dataDir);
const conversationMemory = createConversationMemory(process.env);
conversationMemory.init().catch(() => {});
if (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') seedDatabase(store);
const clinic = createClinicStore(store.raw);
const aiConfig = createAIConfig(
  store.raw,
  dataDir,
  process.env,
);
const ai = createAIService(aiConfig, () => ({ ...clinic.snapshot().settings, is24Hours: true }));

const app = express();
const security = createSecurity(store.raw, dataDir, process.env, company);
security.install(app);
app.use((req,res,next)=>{
  if(/^\/(?:admin|central)(?:\/|$)/.test(req.path) || /^\/api\/(?:admin|central|platform|onboarding|catalog|records)(?:\/|$)/.test(req.path) || req.path==='/api/auth/request-access')
    return res.status(404).json({error:'Recurso não encontrado.'});
  if(req.path.startsWith('/api/acores/'))req.url=req.url.replace('/api/acores/','/api/');
  next();
});
app.use(express.json({ limit: '64kb', strict: true }));
security.routes(app);
app.use('/api', validateRequests);
const users = createUserManager(store.raw, {changed:() => broadcast()});
registerUsers(app, users, store.raw);

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const upgrade = (req, socket, head) => {
  const session = security.session(req);
  if (req.url !== '/ws' || !session || session.must_change_password || !security.origins.has(req.headers.origin) ||
      (security.production && req.headers['x-forwarded-proto'] !== 'https')) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  if ([...wss.clients].filter((ws) => ws.userId === session.id).length >= 5) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.authRequest = req; ws.userId = session.id;
    wss.emit('connection', ws);
  });
};
const broadcast = () => {
  for (const client of wss.clients) {
    const session = security.session(client.authRequest);
    if (!session) { client.close(1008, 'Sessão encerrada'); continue; }
    if (client.readyState === client.OPEN)
      client.send(JSON.stringify({ type: 'dashboard', payload: security.view(dashboardPayload(), session) }));
  }
};
const sessionCheck = setInterval(() => {
  for (const client of wss.clients) if (!security.session(client.authRequest)) client.close(1008, 'Sessão encerrada');
}, 30000);
sessionCheck.unref();

const whatsapp = new WhatsAppConnector({
  authDir,
  spoolDir: path.join(dataDir, 'whatsapp-spool'),
  onAlert: (fault) => monitor?.alert(fault.code, fault.message, fault.classification),
  onMessage: handleIncomingMessage,
  onStatus: (status) => broadcast("whatsapp_status", status),
  db: store.raw,
  onHumanMessage: ({ phone, text }) => {
    const client = store.getClientByPhone(phone) || store.upsertClient({ phone });
    const ticket = store.findActiveTicket(phone) || store.createTicket({ client_id: client.id, phone, subject: "Atendimento humano", source: "whatsapp" });
    store.updateTicket(ticket.id, { ai_paused: true, status: "em_atendimento", human_required: true });
    store.addMessage(ticket.id, { direction: "outbound", author: humanTeamName, body: text });
    broadcast("dashboard", dashboardPayload());
  },
  onDelivery: ({ ticket, reply }) => {
    if (!store.getTicket(ticket.id)) return;
    store.addMessage(ticket.id, {
      direction: "outbound",
      author: assistantName,
      body: reply,
    });
    broadcast("dashboard", dashboardPayload());
  },
});
const monitor = createHealthMonitor({ db: store.raw, whatsapp, ai, aiConfig, dataDir, broadcast });

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({ type: "dashboard", payload: security.view(dashboardPayload(), security.session(socket.authRequest)) }),
  );
});

registerDeletionRoutes(app, store.raw, () => broadcast("dashboard", dashboardPayload()));

store.raw.exec('CREATE TABLE IF NOT EXISTS service_health(id INTEGER PRIMARY KEY CHECK(id=1),checked_at TEXT); INSERT OR IGNORE INTO service_health VALUES (1,NULL)');
app.get("/api/health", (_req, res) => {
  try {
    store.raw.prepare('UPDATE service_health SET checked_at=? WHERE id=1').run(new Date().toISOString());
    res.json({ ok: true, service: 'acores' });
  } catch {res.status(503).json({ok:false,service:'acores'});}
});
app.get('/api/operations/status', (req, res) => {
  const snapshot = monitor.snapshot();
  if (req.user.role !== 'administrador') snapshot.reviews = [];
  res.json(snapshot);
});
app.post('/api/operations/check', async (_req, res) => {
  await monitor.check(); res.json(monitor.snapshot());
});
app.post('/api/whatsapp/relink', async (req, res) => {
  if (req.body?.confirmed !== true || !whatsapp.status.requiresNewQr)
    return res.status(400).json({ error: 'Confirme a substituição da sessão inválida.' });
  res.json(await whatsapp.start({ manual: true, newSession: true }));
});
app.post('/api/operations/review/:id', (req, res) => {
  if (req.body?.confirmed !== true || !['sent', 'cancelled'].includes(req.body?.resolution))
    return res.status(400).json({ error: 'Confirme a conferência do envio.' });
  const row = store.raw.prepare("SELECT * FROM wa_outbox WHERE id=? AND state='review'").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Envio não encontrado.' });
  whatsapp.queue.transaction(() => {
    whatsapp.queue.markOutgoing(row.id, req.body.resolution);
    if (req.body.resolution === 'sent') whatsapp.delivered(row);
  });
  broadcast(); res.json({ ok: true });
});

app.get("/api/dashboard", (req, res) => {
  res.json(security.view(dashboardPayload(), req.user));
});

app.get("/api/clients", (req, res) => {
  const rows = req.user.role === 'usuario' ? [store.getClient(req.user.client_id)].filter(Boolean) : store.listClients();
  res.json(rows.slice(req.page.offset, req.page.offset + req.page.limit));
});

app.post("/api/clients", (req, res) => {
  try {
    const client = store.upsertClient(req.body);
    broadcast("client_saved", client);
    broadcast("dashboard", dashboardPayload());
    res.status(201).json(client);
  } catch (error) {
    res.status(400).json({ error: "Não foi possível concluir a operação. Confira os dados." });
  }
});

app.patch("/api/clients/:id", (req, res) => {
  try {
    const client = store.updateClient(Number(req.params.id), req.body);
    if (!client)
      return res.status(404).json({ error: "Cliente nao encontrado." });
    broadcast("client_saved", client);
    broadcast("dashboard", dashboardPayload());
    res.json(client);
  } catch (error) {
    res.status(400).json({ error: "Não foi possível concluir a operação. Confira os dados." });
  }
});

app.get("/api/tickets", (req, res) => {
  const rows = store.listTickets().filter((t) => req.user.role !== 'usuario' || t.client_id === req.user.client_id);
  res.json(rows.slice(req.page.offset, req.page.offset + req.page.limit));
});

app.get("/api/tickets/:id/messages", (req, res) => {
  const ticket = store.getTicket(Number(req.params.id));
  if (!ticket)
    return res.status(404).json({ error: "Chamado nao encontrado." });
  res.json({ ticket, messages: store.listMessages(ticket.id).slice(req.page.offset, req.page.offset + req.page.limit) });
});

app.patch("/api/tickets/:id", (req, res) => {
  const ticket = store.updateTicket(Number(req.params.id), req.body);
  if (!ticket)
    return res.status(404).json({ error: "Chamado nao encontrado." });
  if (req.body.ai_paused !== undefined || req.body.status === "em_atendimento")
    whatsapp.setHumanPaused(ticket.phone, !!ticket.ai_paused || ticket.status === "em_atendimento");
  broadcast("ticket_updated", ticket);
  broadcast("dashboard", dashboardPayload());
  res.json(ticket);
});

app.post("/api/tickets/:id/messages", async (req, res) => {
  const ticket = store.getTicket(Number(req.params.id));
  if (!ticket)
    return res.status(404).json({ error: "Chamado nao encontrado." });

  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ error: "Mensagem vazia." });

  const message = whatsapp.queue.transaction(() => {
    whatsapp.setHumanPaused(ticket.phone);
    store.updateTicket(ticket.id, { ai_paused: true, status: "em_atendimento", human_required: true });
    const saved = store.addMessage(ticket.id, { direction: 'outbound', author: req.user.email, body });
    if (req.body.sendToWhatsApp && whatsapp.policy.account)
      whatsapp.queue.addOutgoing({ id: `manual:${saved.id}`, account: whatsapp.policy.account,
        jid: `${ticket.phone}@s.whatsapp.net`, body, ticketId: ticket.id });
    return saved;
  });

  let delivery = { delivered: false, reason: "Mensagem registrada no painel." };
  if (req.body.sendToWhatsApp) {
    try {
      delivery = await whatsapp.sendText(ticket.phone, body, { id: `manual:${message.id}`, ticketId: ticket.id });
    } catch {
      delivery = {
        delivered: false,
        reason:
          "O WhatsApp não confirmou o envio. A mensagem ficou registrada no painel.",
      };
    }
  }

  broadcast("message_added", { ticketId: ticket.id, message, delivery });
  broadcast("dashboard", dashboardPayload());
  res.status(201).json({ message, delivery });
});

app.post("/api/simulate-message", async (req, res) => {
  try {
    const result = await handleIncomingMessage({
      phone: req.body.phone,
      name: req.body.name,
      text: req.body.text,
      source: "simulador",
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: "Não foi possível concluir a operação. Confira os dados." });
  }
});

app.get("/api/whatsapp/status", (_req, res) => {
  res.json(whatsapp.snapshot());
});

app.post("/api/whatsapp/start", async (_req, res) => {
  const status = await whatsapp.start({ manual: true });
  if (status.mode === 'intervention' && status.lastError) return res.status(status.requiresNewQr ? 409 : 503).json({ error: status.lastError.message, code: status.lastError.code });
  res.json(status);
});
app.post("/api/whatsapp/sync", async (_req, res) => {
  await whatsapp.syncArchiveState();
  res.json(whatsapp.snapshot());
});
app.patch("/api/ai/settings", (req, res) => {
  try {
    const value = aiConfig.save(req.body);
    ai.resetChecks();
    broadcast("dashboard", dashboardPayload());
    res.json(value);
  } catch (error) {
    res.status(400).json({ error: "Não foi possível concluir a operação. Confira os dados." });
  }
});
app.post("/api/ai/test/:provider", async (req, res) => {
  try {
    res.json(await ai.test(req.params.provider));
  } catch (error) {
    res.status(400).json({ error: "Não foi possível concluir a operação. Confira os dados." });
  } finally {
    broadcast("dashboard", dashboardPayload());
  }
});

app.post("/api/notifications/read", (_req, res) => {
  const notifications = store.markNotificationsRead();
  broadcast("dashboard", dashboardPayload());
  res.json(notifications);
});

registerClinicRoutes(app, clinic, () =>
  broadcast("dashboard", dashboardPayload()),
);

const distDir = path.join(rootDir, "dist");
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Recurso não encontrado." }),
);
app.use((req, res, next) => {
  if (/(^|\/)\./.test(req.path) || /^\/(data|server|scripts|node_modules|deploy|docs)(\/|$)/.test(req.path))
    return res.status(404).json({ error: 'Recurso não encontrado.' });
  next();
});
app.use(express.static(distDir, { dotfiles: 'deny' }));
app.use((_req, res, next) => {
  const indexPath = path.join(distDir, "index.html");
  res.sendFile(indexPath, (error) => {
    if (error) next();
  });
});

app.use((error, req, res, _next) => {
  try { security.audit(req.user?.id, 'request_error'); } catch { safeLog('request_error'); }
  if (res.headersSent) return res.end();
  res.status(error.status === 413 ? 413 : error.status === 400 ? 400 : 500)
    .json({ error: 'Não foi possível processar a solicitação.' });
});

return { app, security, store, clinic, aiConfig, whatsapp, monitor, upgrade, broadcast, company, users,
  start() {
    monitor.start();
    if (process.env.NODE_ENV !== 'test' && process.env.WHATSAPP_AUTOSTART !== 'false' &&
      ['creds.json', 'session.sqlite'].some((file) => fs.existsSync(path.join(authDir, file))))
      whatsapp.start().catch(() => security.audit(null, 'whatsapp_start_failed'));
  },
  async stop(drain = async () => {}) {
    clearInterval(sessionCheck);
    for (const client of wss.clients) client.terminate();
    await Promise.all([monitor.stop(), whatsapp.stop()]);
    await drain();
    store.raw.close();
    await conversationMemory.close();
  },
};

async function handleIncomingMessage({ phone, name, text, source, signal, commit = (fn) => fn() }) {
  const normalizedPhone = sanitizePhone(phone);
  if (!normalizedPhone) throw new Error("Telefone invalido.");
  if (!String(text || "").trim()) throw new Error("Mensagem vazia.");

  let activeTicket = store.findActiveTicket(normalizedPhone);
  const cloudHistory = conversationMemory.enabled ? await conversationMemory.list(normalizedPhone).catch(() => []) : [];
  if (activeTicket?.status === "em_atendimento" || activeTicket?.ai_paused) {
    const result = commit(() => {
    const message = store.addMessage(activeTicket.id, {
      direction: "inbound",
      author: name || "Cliente",
      body: text,
    });
    return {
      ticket: store.getTicket(activeTicket.id),
      message,
      reply: null,
      humanActive: true,
    };
    });
    await conversationMemory.append(normalizedPhone, result.message).catch(() => {});
    broadcast(); return result;
  }
  const history = cloudHistory.length ? cloudHistory : (activeTicket ? store.listMessages(activeTicket.id) : []);
  const existingClient = store.getClientByPhone(normalizedPhone);
  const intake = collectPatient(text, history, existingClient || {});
  const analysis = await ai.analyze(
    text,
    history,
    signal,
  );
  signal?.throwIfAborted();
  const result = commit(() => {
  activeTicket = store.findActiveTicket(normalizedPhone);
  if (activeTicket && (activeTicket.status === 'em_atendimento' || activeTicket.ai_paused)) {
    const message = store.addMessage(activeTicket.id, { direction: 'inbound', author: name || 'Cliente', body: text });
    return { ticket: store.getTicket(activeTicket.id), message, reply: null, humanActive: true };
  }
  const client = store.upsertClient({
    phone: normalizedPhone,
    name: existingClient?.name || name || undefined,
    ...intake.patch,
  });
  if (!analysis.aiUnavailable && intake.nextQuestion && analysis.category !== "urgencia" &&
      !/\b(atendente|humano|emerg[eê]ncia|urgente)\b/i.test(text)) {
    analysis.reply = intake.nextQuestion;
    analysis.handoffComplete = false;
  }
  if (!analysis.aiUnavailable && activeTicket?.category === "urgencia" &&
      !/emerg[eê]ncia|urg[eê]ncia|atropel|convuls|envenen|n[aã]o respira|sem respirar|dor intensa/i.test(text) &&
      !/\b(atendente|humano|recep[cç][aã]o)\b/i.test(text) &&
      (intake.nextQuestion || Object.keys(intake.patch).length)) {
    analysis.category = "urgencia";
    analysis.subject = activeTicket.subject;
    analysis.humanRequired = true;
    analysis.priority = "alta";
    analysis.reply = intake.nextQuestion || "Cadastro registrado. A recepção continuará seu atendimento prioritário.";
    analysis.handoffComplete = !intake.nextQuestion;
  }
  const shouldReuse = !!activeTicket;
  const updateTopic = !activeTicket?.human_required ||
    (analysis.humanRequired && activeTicket.category === "geral") ||
    (analysis.category === "urgencia" && activeTicket.category !== "urgencia");

  const ticket = shouldReuse
    ? store.updateTicket(activeTicket.id, {
        subject: updateTopic ? analysis.subject : activeTicket.subject,
        category: updateTopic ? analysis.category : activeTicket.category,
        priority:
          priorityRank(analysis.priority) < priorityRank(activeTicket.priority)
            ? analysis.priority
            : activeTicket.priority,
        human_required: activeTicket.human_required || analysis.humanRequired,
        ai_summary: mergeSummary(activeTicket.ai_summary, analysis.summary),
      })
    : store.createTicket({
        client_id: client.id,
        phone: normalizedPhone,
        subject: analysis.subject,
        category: analysis.category,
        priority: analysis.priority,
        human_required: analysis.humanRequired,
        ai_summary: analysis.summary,
        source,
      });

  store.addMessage(ticket.id, {
    direction: "inbound",
    author: client.name,
    body: text,
  });
  if (analysis.handoffComplete) store.updateTicket(ticket.id, { ai_paused: true });
  const replyMessage =
    source === "whatsapp"
      ? null
      : store.addMessage(ticket.id, {
          direction: "outbound",
          author: analysis.humanRequired ? `${assistantName} + equipe` : assistantName,
          body: analysis.reply,
        });

  if (analysis.aiUnavailable || !shouldReuse || (analysis.humanRequired && !activeTicket.human_required)) {
    const notification = buildHumanNotification(client, ticket);
    store.createNotification({
      ticket_id: ticket.id,
      ...notification,
      ...(analysis.aiUnavailable ? { title: 'IA indisponível', body: `Chamado #${ticket.id} transferido à recepção. Confira o contato e as últimas mensagens na conversa.`, level: 'warning' } : {}),
    });
  }

  const payload = {
    ticket: store.getTicket(ticket.id),
    client: store.getClient(client.id),
    reply: analysis.reply,
    message: replyMessage,
    aiProvider: analysis.aiProvider,
  };

  return payload;
  });
  await conversationMemory.append(normalizedPhone, { direction: 'inbound', author: result.client?.name || name || 'Cliente', body: text }).catch(() => {});
  if (result.message) await conversationMemory.append(normalizedPhone, result.message).catch(() => {});
  broadcast();
  return result;
}

function dashboardPayload() {
  return {
    stats: store.getStats(),
    clients: store.listClients(),
    tickets: store.listTickets(),
    notifications: store.listNotifications(),
    whatsapp: whatsapp.snapshot(),
    operations: monitor?.snapshot(),
    petshopName: clinic.snapshot().settings.name,
    company: { id: company.id, name: company.name, primary: company.primary },
    ...clinic.snapshot(),
    ai: { ...aiConfig.snapshot(), runtime: ai.snapshot() },
  };
}

function priorityRank(priority) {
  return priority === "alta" ? 0 : priority === "normal" ? 1 : 2;
}

function mergeSummary(current, next) {
  if (!current) return next;
  if (!next || current.includes(next)) return current;
  return `${current} ${next}`;
}
}
