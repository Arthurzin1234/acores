import fs from 'node:fs';
import path from 'node:path';
import { classify, failure, positiveInt, safeLog } from './reliability.js';
import { createOperationalNotifier } from './operational-notifier.js';

export function createHealthMonitor({ db, whatsapp, ai, aiConfig, dataDir, broadcast = () => {}, now = Date.now }) {
  const notify = createOperationalNotifier({ url: process.env.RENDER === 'true' ? process.env.ADMIN_ALERT_WEBHOOK_URL : '' });
  db.exec(`CREATE TABLE IF NOT EXISTS operational_alerts (code TEXT PRIMARY KEY, message TEXT NOT NULL,
    classification TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1);`);
  let timer, checking, state = { checkedAt: null, process: true, database: null, ai: { available: null }, queue: {}, alerts: [] };
  const interval = positiveInt(process.env.HEALTH_INTERVAL_MS, 30000, 1000, 300000);
  const offlineLimit = positiveInt(process.env.WHATSAPP_OFFLINE_ALERT_MS, 120000, 1000);
  const queueLimit = positiveInt(process.env.QUEUE_ALERT_LIMIT, 20, 1, 100000);
  const memoryLimit = positiveInt(process.env.MEMORY_ALERT_MB, 512, 64, 8192);
  const failures = [];
  function alert(code, message, classification = 'intervention') {
    const allowed = ['offline_prolonged', 'many_reconnects', 'queue_backlog', 'memory_high', 'environment_invalid', 'repeated_errors'];
    if (!allowed.includes(code)) ({ code, message, classification } = classify(failure(code)));
    const timestamp = new Date(now()).toISOString();
    failures.push(now());
    while (failures.length && failures[0] < now() - 300000) failures.shift();
    safeLog('health_alert', failure(code), failures.length);
    void notify(code);
    try {
      db.prepare(`INSERT INTO operational_alerts(code,message,classification,first_at,last_at) VALUES (?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET message=excluded.message,last_at=excluded.last_at,count=count+1,active=1`)
        .run(code, message, classification, timestamp, timestamp);
    } catch { state.database = false; }
    state.lastError = { code, message, classification, at: timestamp };
  }
  function condition(code, active, message, classification = 'intervention') {
    const current = db.prepare('SELECT active FROM operational_alerts WHERE code=?').get(code);
    if (active && !current?.active) alert(code, message, classification);
    if (!active && current?.active) db.prepare('UPDATE operational_alerts SET active=0 WHERE code=?').run(code);
  }
  function snapshot() {
    const wa = whatsapp.snapshot();
    let alerts = state.alerts, reviews = [];
    try {
      alerts = db.prepare('SELECT * FROM operational_alerts WHERE active=1 ORDER BY last_at DESC LIMIT 50').all();
      reviews = whatsapp.queue.reviews();
    } catch { /* The last safe health snapshot remains available. */ }
    return { ...state, whatsapp: { connected: wa.connected, mode: wa.mode, attempts: wa.attempts,
      archiveSyncReady: wa.archiveSyncReady, requiresNewQr: wa.requiresNewQr,
      lastReconnectAt: wa.lastReconnectAt || null }, ai: ai.snapshot(), queue: wa.queue,
      lastError: state.lastError || wa.lastError || null, alerts, reviews };
  }
  async function performCheck({ probeAI = true } = {}) {
    state.checkedAt = new Date(now()).toISOString();
    state.process = true; state.memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    try {
      db.prepare('SELECT 1').get();
      // A write checks permissions and a read-only/full disk that SELECT alone would miss.
      db.prepare("UPDATE operational_alerts SET count=count WHERE code='health_probe'").run();
      state.database = true;
      whatsapp.spool?.replay((account, message) => whatsapp.queue.receive(account, message));
      if (whatsapp.status.lastError?.code === 'database_busy' && whatsapp.status.requiresIntervention !== true && !whatsapp.socket)
        whatsapp.scheduleReconnect();
      const settings = aiConfig.snapshot();
      let aiCredentials = settings.provider === 'rules';
      try { if (!aiCredentials) { const c = aiConfig.credentials(settings.provider); aiCredentials = !!c.key && /^[\w.-]{1,100}$/.test(c.model); } }
      catch { aiCredentials = false; }
      let session = null;
      try { session = whatsapp.authStore ? whatsapp.authStore.check() : null; } catch { session = false; }
      state.credentials = { aiConfigured: aiCredentials, sessionStorage: session,
        sessionValid: whatsapp.status.requiresNewQr ? false : whatsapp.status.connected ? true : null };
      state.environment = { valid: aiCredentials && session !== false &&
        (process.env.NODE_ENV !== 'production' || /^https:\/\//.test(process.env.APP_ORIGIN || '')) };
      condition('environment_invalid', !state.environment.valid, 'Configuração ou credenciais precisam de revisão.');
      condition('credentials_storage', session === false, 'Falha no armazenamento da sessão.', 'critical');
      if (probeAI) await ai.health();
      const aiState = ai.snapshot();
      condition('ai_unavailable', aiState.available === false, 'IA indisponível. Novos atendimentos serão transferidos.');
      const wa = whatsapp.snapshot();
      condition('offline_prolonged', !wa.connected && now() - Date.parse(wa.offlineSince || state.checkedAt) >= offlineLimit,
        'WhatsApp desconectado por tempo prolongado. Verifique a conexão.');
      condition('many_reconnects', wa.attempts >= 3, 'Várias tentativas de reconexão do WhatsApp.');
      if (wa.connected) for (const code of ['connection_lost','restart_required','retry_limit','invalid_session','forbidden','replaced','mismatch'])
        db.prepare('UPDATE operational_alerts SET active=0 WHERE code=?').run(code);
      if (aiState.available) for (const code of ['ai_timeout','ai_auth','ai_config','ai_response','ai_rate_limit'])
        db.prepare('UPDATE operational_alerts SET active=0 WHERE code=?').run(code);
      condition('logged_out', !!wa.requiresNewQr || wa.mode === 'qr', 'Requer novo QR Code.');
      condition('archive_sync', wa.connected && !wa.archiveSyncReady && now() - Date.parse(wa.connectedAt || state.checkedAt) > 60000,
        'Verificação de conversas arquivadas pendente.');
      condition('queue_backlog', wa.queue.pending >= queueLimit || wa.queue.blocked > 0,
        'Fila acumulada ou mensagens que precisam de intervenção.');
      condition('delivery_uncertain', wa.queue.review > 0, 'Envios sem confirmação precisam de conferência.');
      condition('memory_high', state.memoryMB >= memoryLimit, 'Uso elevado de memória.', 'critical');
      condition('repeated_errors', failures.filter((time) => time > now() - 300000).length >= 10,
        'Falhas repetidas nos últimos cinco minutos.');
      state.alerts = snapshot().alerts;
    } catch (error) { state.database = false; alert('database_failure', '', 'critical'); }
    try {
      const target = path.join(dataDir, 'runtime-health.json');
      const temporary = `${target}.tmp`;
      const { reviews: _reviews, ...safe } = snapshot();
      fs.writeFileSync(temporary, JSON.stringify(safe), { mode: 0o600 });
      fs.renameSync(temporary, target);
    } catch { safeLog('health_alert', failure('database_failure')); }
    try { broadcast(); } catch { /* Database failures must not crash the monitor. */ }
    return snapshot();
  }
  function check(options) {
    if (checking) return checking;
    checking = performCheck(options).finally(() => { checking = null; });
    return checking;
  }
  return { snapshot, alert, check,
    start() {
      if (timer) return;
      const options = { probeAI: process.env.NODE_ENV !== 'test' };
      void check(options);
      timer = setInterval(() => { void check(options); }, interval); timer.unref();
    },
    async stop() { clearInterval(timer); timer = null; await checking; },
  };
}
