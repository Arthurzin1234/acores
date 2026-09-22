import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { legalDocuments, registerLegal } from './legal.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const roles = ['usuario', 'atendente', 'tecnico', 'administrador'];
const password = z.string().min(10).refine((v) => Buffer.byteLength(v) <= 72);
const loginPassword = z.string().min(1).refine((v) => Buffer.byteLength(v) <= 72);
const loginSchema = z.object({ email: z.string().trim().min(3).max(254).regex(/^[a-zA-Z0-9._@+-]+$/).transform((v) => v.toLowerCase()), password: loginPassword,
  acceptedTerms: z.literal(true), privacyAcknowledged: z.literal(true), legalVersion: z.literal(legalDocuments.version),
}).strict();

export function createSecurity(db, dataDir, env = process.env, company = { id: 'acores', name: 'Centro Veterinário dos Açores', primary: true }) {
  const publicUser = (u) => ({ id: u.id, email: u.email, username: u.username, role: u.role, client_id: u.client_id,
    must_change_password: !!u.must_change_password,
    company: { id: company.id, name: company.name } });
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || 'http://127.0.0.1:5173';
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password ||
      (production && parsed.protocol !== 'https:')) throw new Error('APP_ORIGIN inválido: produção exige HTTPS.');
  const configuredOrigins = String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const origins = new Set(production ? [origin, ...configuredOrigins] : [origin, ...configuredOrigins, 'http://127.0.0.1:3333', 'http://localhost:5173']);
  const hosts = new Set([...origins].map((value) => new URL(value).host));
  const cookieName = production ? '__Host-acores_session' : 'acores_session';
  const ttl = 8 * 60 * 60 * 1000;
  const idle = 30 * 60 * 1000;
  db.exec(`CREATE TABLE IF NOT EXISTS auth_users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('usuario','atendente','tecnico','administrador')),
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS auth_sessions (
      hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, seen_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_bootstrap (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, event TEXT NOT NULL, resource TEXT NOT NULL);`);
  const columns = new Set(db.prepare('PRAGMA table_info(auth_users)').all().map((column) => column.name));
  for (const [name, definition] of [['username','TEXT'], ['platform_admin','INTEGER NOT NULL DEFAULT 0'], ['must_change_password','INTEGER NOT NULL DEFAULT 0']])
    if (!columns.has(name)) db.exec(`ALTER TABLE auth_users ADD COLUMN ${name} ${definition}`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS auth_username_unique ON auth_users(username) WHERE username IS NOT NULL');
  const recordAcceptance = registerLegal(db);
  fs.mkdirSync(dataDir, { recursive: true });
  const bootstrapPath = path.join(dataDir, 'admin-setup.token');
  if (!db.prepare('SELECT 1 FROM auth_users LIMIT 1').get() && (env.INITIAL_ADMIN_EMAIL || env.INITIAL_ADMIN_PASSWORD)) {
    const initial = z.object({ email: z.string().email().max(254).transform((v) => v.toLowerCase()), password })
      .safeParse({ email: env.INITIAL_ADMIN_EMAIL, password: env.INITIAL_ADMIN_PASSWORD });
    if (!initial.success) throw new Error('Configure INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD com ao menos 10 caracteres e no maximo 72 bytes.');
    const username = String(env.INITIAL_ADMIN_USERNAME || 'acores').trim();
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) throw new Error('INITIAL_ADMIN_USERNAME invalido.');
    db.prepare("INSERT INTO auth_users(email,username,password_hash,role,must_change_password) VALUES (?,?,?,'administrador',1)")
      .run(initial.data.email, username, bcrypt.hashSync(initial.data.password, 12));
    db.prepare('DELETE FROM auth_bootstrap').run();
    fs.rmSync(bootstrapPath, { force: true });
  }
  if (!db.prepare('SELECT 1 FROM auth_users LIMIT 1').get() && !db.prepare('SELECT 1 FROM auth_bootstrap LIMIT 1').get()) {
    const secret = token();
    db.prepare('INSERT INTO auth_bootstrap VALUES (1,?,?)').run(digest(secret), Date.now() + 3600000);
    fs.writeFileSync(bootstrapPath, secret, { mode: 0o600, flag: 'wx' });
  }
  const audit = (userId, event, resource = '') => {
    db.prepare('INSERT INTO security_audit(at,user_id,event,resource) VALUES (?,?,?,?)').run(new Date().toISOString(), userId || null, event, resource.slice(0, 120));
    db.prepare("DELETE FROM security_audit WHERE at < datetime('now','-90 days')").run();
  };
  function session(req, touch = false) {
    const value = String(req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!value || !/^[\w-]{43}$/.test(value)) return null;
    const row = db.prepare(`SELECT s.*, u.id, u.email, u.role, u.client_id FROM auth_sessions s
      JOIN auth_users u ON u.id=s.user_id WHERE s.hash=? AND u.active=1 AND s.expires_at>? AND s.seen_at>?`).get(digest(value), Date.now(), Date.now() - idle);
    if (row) Object.assign(row, db.prepare('SELECT username,platform_admin,must_change_password FROM auth_users WHERE id=?').get(row.id));
    if (row && touch) db.prepare('UPDATE auth_sessions SET seen_at=? WHERE hash=?').run(Date.now(), row.hash);
    return row || null;
  }
  const secureCookie = (res, value, maxAge = ttl) => res.cookie(cookieName, value, { httpOnly: true, secure: production, sameSite: 'strict', path: '/', maxAge });
  function issue(req, res, user) {
    const previous = session(req);
    if (previous) db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(previous.hash);
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<? OR seen_at<?').run(Date.now(), Date.now() - idle);
    const sid = token(), csrf = token(), now = Date.now();
    db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)').run(digest(sid), user.id, csrf, now, now + ttl, now);
    secureCookie(res, sid);
    return { user: publicUser(user), csrf };
  }
  function limiter(limit, windowMs, keyGenerator) {
    return rateLimit({ windowMs, limit, keyGenerator, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Muitas tentativas. Aguarde e tente novamente.' } });
  }
  const apiIp = limiter(300, 60000);
  const authIp = limiter(15, 15 * 60000);
  const authAccount = limiter(8, 15 * 60000, (req) => digest(String(req.body?.email || '').toLowerCase().slice(0, 254)));
  const apiUser = limiter(240, 60000, (req) => String(req.user.id));
  const sensitive = limiter(10, 60000, (req) => String(req.user.id));
  const dummyHash = bcrypt.hashSync(token(), 12);

  function install(app) {
    app.disable('x-powered-by');
    if (production && ['loopback', '1'].includes(env.TRUST_PROXY)) app.set('trust proxy', env.TRUST_PROXY === '1' ? 1 : 'loopback');
    app.use(helmet({
      strictTransportSecurity: production ? { maxAge: 31536000, includeSubDomains: true } : false,
      contentSecurityPolicy: { directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"],
        formAction: ["'self'"], upgradeInsecureRequests: production ? [] : null,
      } }, referrerPolicy: { policy: 'no-referrer' },
    }));
    app.use((req, res, next) => {
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
      if (!hosts.has(req.headers.host)) return res.status(403).json({ error: 'Origem não permitida.' });
      if (production && !req.secure && req.path !== '/api/health') return res.redirect(308, `${origin}${req.originalUrl.startsWith('/') ? req.originalUrl : '/'}`);
      if (req.headers.origin && !origins.has(req.headers.origin)) return res.status(403).json({ error: 'Origem não permitida.' });
      if (req.path.startsWith('/api')) {
        res.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin && !origins.has(req.headers.origin))
          return res.status(403).json({ error: 'Origem obrigatória.' });
        if (req.headers['content-type']?.startsWith('multipart/')) return res.status(415).json({ error: 'Uploads não são permitidos.' });
      }
      next();
    });
    app.use('/api', apiIp);
  }
  function routes(app) {
    app.get('/api/legal', (_req, res) => res.json(legalDocuments));
    const requireAcceptance = (req, res, next) => {
      if (req.body?.acceptedTerms !== true || req.body?.privacyAcknowledged !== true)
        return res.status(400).json({ error: 'Confirme os Termos de Uso e a ciência da Política de Privacidade.' });
      if (req.body.legalVersion !== legalDocuments.version)
        return res.status(409).json({ error: 'Os documentos foram atualizados. Recarregue a página e confira a versão atual.' });
      next();
    };
    app.get('/api/auth/session', (req, res) => {
      const s = session(req);
      res.json(s ? { user: publicUser(s), csrf: s.csrf } : { user: null, setupRequired: !db.prepare('SELECT 1 FROM auth_users LIMIT 1').get() });
    });
    app.post('/api/auth/login', authIp, authAccount, requireAcceptance, async (req, res) => {
      const result = loginSchema.safeParse(req.body);
      if (!result.success) return res.status(401).json({ error: 'Credenciais inválidas.' });
      const user = db.prepare('SELECT * FROM auth_users WHERE lower(email)=? OR lower(username)=?').get(result.data.email, result.data.email);
      const valid = await bcrypt.compare(result.data.password, user?.password_hash || dummyHash);
      if (!valid || !user?.active) { audit(null, 'login_failed'); return res.status(401).json({ error: 'Credenciais inválidas.' }); }
      recordAcceptance(user.id);
      audit(user.id, 'login'); res.json(issue(req, res, user));
    });
    app.post('/api/auth/setup', authIp, authAccount, requireAcceptance, async (req, res) => {
      const input = loginSchema.extend({ email: z.string().email().max(254).transform((v) => v.toLowerCase()), password, token: z.string().length(43) }).safeParse(req.body);
      const bootstrap = db.prepare('SELECT * FROM auth_bootstrap WHERE id=1').get();
      if (!input.success || !bootstrap || bootstrap.expires_at <= Date.now() || !equal(digest(input.data.token), bootstrap.hash))
        return res.status(403).json({ error: 'Configuração não autorizada ou expirada.' });
      const hash = await bcrypt.hash(input.data.password, 12);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM auth_users LIMIT 1').get() || !db.prepare('SELECT 1 FROM auth_bootstrap WHERE id=1').get()) throw new Error();
        const row = db.prepare("INSERT INTO auth_users(email,password_hash,role) VALUES (?,?,'administrador') RETURNING *").get(input.data.email, hash);
        recordAcceptance(row.id);
        db.prepare('DELETE FROM auth_bootstrap').run(); db.exec('COMMIT');
        fs.rmSync(bootstrapPath, { force: true }); audit(row.id, 'setup'); res.status(201).json(issue(req, res, row));
      } catch { db.exec('ROLLBACK'); res.status(409).json({ error: 'Configuração já realizada.' }); }
    });
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' && req.method === 'GET') return next();
      const s = session(req, true);
      if (!s) return res.status(401).json({ error: 'Entre para continuar.' });
      req.user = publicUser(s); req.session = s;
      if (!['GET', 'HEAD'].includes(req.method) && !equal(req.headers['x-csrf-token'], s.csrf))
        return res.status(403).json({ error: 'Validação de sessão inválida.' });
      apiUser(req, res, next);
    });
    app.post('/api/auth/logout', (req, res) => {
      db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(req.session.hash);
      secureCookie(res, '', 0); audit(req.user.id, 'logout'); res.json({ ok: true });
    });
    app.post('/api/auth/password', sensitive, async (req, res) => {
      const result = z.object({ currentPassword: loginPassword, password }).strict().safeParse(req.body);
      const user = db.prepare('SELECT * FROM auth_users WHERE id=?').get(req.user.id);
      if (!result.success || !await bcrypt.compare(result.data.currentPassword, user.password_hash))
        return res.status(400).json({ error: 'Não foi possível alterar a senha.' });
      db.prepare('UPDATE auth_users SET password_hash=?,must_change_password=0 WHERE id=?').run(await bcrypt.hash(result.data.password, 12), user.id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
      audit(user.id, 'password_changed'); res.json(issue(req, res, { ...user, must_change_password: 0 }));
    });
    app.use('/api', (req, res, next) => {
      if (req.path === '/health') return next();
      const role = req.user.role;
      const route = req.path;
      const read = req.method === 'GET';
      const ownRead = read && (/^\/(dashboard|clients|tickets)$/.test(route) || /^\/tickets\/[1-9]\d*\/messages$/.test(route));
      const ownUpdate = req.method === 'PATCH' && /^\/clients\/[1-9]\d*$/.test(route);
      const technical = /^\/whatsapp\/(status|start|sync|relink)$/.test(route) || /^\/ai\/test\/(openai|gemini|grok)$/.test(route) || /^\/operations\/(status|check)$/.test(route);
      const clinical = /^\/(dashboard|clients|tickets|appointments|checklist|neonatal|notifications)(\/|$)/.test(route);
      let allowed = role === 'administrador' || (role === 'atendente' && clinical && req.method !== 'DELETE') ||
        (role === 'tecnico' && (technical || (read && route === '/dashboard'))) || (role === 'usuario' && (ownRead || ownUpdate));
      if (route === '/simulate-message' && (production || env.ENABLE_SIMULATOR !== 'true')) allowed = false;
      if (!allowed) return res.status(403).json({ error: 'Acesso não permitido.' });
      if (role === 'usuario' && /^\/(clients|tickets)\//.test(route)) {
        const id = Number(route.split('/')[2]);
        const owned = route.startsWith('/clients/') ? id === req.user.client_id :
          !!db.prepare('SELECT 1 FROM tickets WHERE id=? AND client_id=?').get(id, req.user.client_id);
        if (!owned) return res.status(404).json({ error: 'Registro não encontrado.' });
      }
      if (!read) res.on('finish', () => audit(req.user.id, `${req.method}:${res.statusCode}`, route));
      if (technical || req.method === 'DELETE' || route.startsWith('/ai/') || (route.startsWith('/users') && !read)) return sensitive(req, res, next);
      next();
    });
  }
  function view(data, user) {
    const d = structuredClone(data);
    const isUser = user.role === 'usuario', tech = user.role === 'tecnico';
    if (isUser || tech) {
      d.clients = tech ? [] : d.clients.filter((c) => c.id === user.client_id);
      d.tickets = tech ? [] : d.tickets.filter((t) => t.client_id === user.client_id);
      d.appointments = tech ? [] : d.appointments.filter((a) => a.client_id === user.client_id);
      d.neonatal = tech ? [] : d.neonatal.filter((n) => n.client_id === user.client_id);
      const ids = new Set(d.tickets.map((t) => t.id));
      d.notifications = []; d.checklist = {};
      d.stats = { totalTickets: ids.size, openTickets: d.tickets.filter((t) => !['resolvido','cancelado'].includes(t.status)).length,
        humanQueue: 0, urgentTickets: 0, totalClients: d.clients.length, unreadNotifications: 0 };
      for (const t of d.tickets) { delete t.ai_summary; delete t.assigned_to; }
    }
    if (user.role !== 'administrador') d.ai = { knowledge: [] };
    if (!['administrador','tecnico'].includes(user.role)) d.whatsapp = { connected: !!d.whatsapp.connected };
    if (!['administrador','tecnico'].includes(user.role)) delete d.operations;
    else if (tech && d.operations) d.operations.reviews = [];
    const limited = ['clients','tickets','appointments','neonatal','notifications'];
    d.truncated = limited.some((key) => d[key]?.length > 200);
    for (const key of limited) if (Array.isArray(d[key])) d[key] = d[key].slice(0,200);
    return d;
  }
  return { install, routes, session, view, audit, origin, production, origins, cookieName, db };
}
