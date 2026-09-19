import { createHash, randomBytes } from 'node:crypto';
import { classify, retryDelay } from './reliability.js';

export class WhatsAppQueue {
  constructor(db, { now = Date.now, maxAttempts = 5 } = {}) {
    this.db = db; this.now = now; this.maxAttempts = maxAttempts;
    db.exec(`CREATE TABLE IF NOT EXISTS wa_inbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, jid TEXT NOT NULL,
      message_id TEXT NOT NULL, payload TEXT NOT NULL, job_id TEXT, received_at INTEGER NOT NULL,
      UNIQUE(account,message_id));
      CREATE TABLE IF NOT EXISTS wa_jobs (
      id TEXT PRIMARY KEY, account TEXT NOT NULL, jid TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wa_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, account TEXT NOT NULL, jid TEXT NOT NULL,
      body TEXT NOT NULL, automatic INTEGER NOT NULL, ticket_id INTEGER,
      message_id TEXT UNIQUE NOT NULL, state TEXT NOT NULL DEFAULT 'pending', error TEXT,
      created_at INTEGER NOT NULL, sent_at INTEGER);
      CREATE TABLE IF NOT EXISTS wa_runtime (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wa_human_inbox (account TEXT, message_id TEXT, payload TEXT,
        done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,message_id));
      CREATE INDEX IF NOT EXISTS wa_jobs_pending ON wa_jobs(account,state,next_at);
      CREATE INDEX IF NOT EXISTS wa_outbox_pending ON wa_outbox(account,state,seq);`);
    // A processing job has made no committed changes. A sending job may already be at WhatsApp.
    db.exec("UPDATE wa_jobs SET state='pending' WHERE state='processing'; UPDATE wa_outbox SET state='review',error='delivery_uncertain' WHERE state='sending';");
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  receive(account, message) {
    if (message.key.fromMe) {
      this.db.prepare('INSERT OR IGNORE INTO wa_human_inbox(account,message_id,payload) VALUES (?,?,?)')
        .run(account, message.key.id, JSON.stringify(message));
      return null;
    }
    this.db.prepare('INSERT OR IGNORE INTO wa_inbox(account,jid,message_id,payload,received_at) VALUES (?,?,?,?,?)')
      .run(account, message.key.remoteJid, message.key.id, JSON.stringify(message), this.now());
    return this.db.prepare('SELECT * FROM wa_inbox WHERE account=? AND message_id=?').get(account, message.key.id);
  }
  unbatched(account) {
    return this.db.prepare('SELECT * FROM wa_inbox WHERE account=? AND job_id IS NULL ORDER BY seq LIMIT 200').all(account);
  }
  batch(account, messages) {
    return this.transaction(() => {
      const rows = messages.map((m) => this.receive(account, m)).filter((r) => !r.job_id);
      const unique = [...new Map(rows.map((r) => [r.seq, r])).values()].sort((a, b) => a.seq - b.seq);
      if (!unique.length) return null;
      const id = createHash('sha256').update(`${account}:${unique.map((r) => r.seq).join(',')}`).digest('hex');
      const items = unique.map((r) => JSON.parse(r.payload));
      this.db.prepare('INSERT INTO wa_jobs(id,account,jid,payload,created_at) VALUES (?,?,?,?,?)')
        .run(id, account, unique[0].jid, JSON.stringify(items), unique[0].received_at);
      for (const row of unique) this.db.prepare('UPDATE wa_inbox SET job_id=? WHERE seq=?').run(id, row.seq);
      return id;
    });
  }
  next(account) {
    return this.db.prepare(`SELECT j.* FROM wa_jobs j WHERE j.account=? AND j.state='pending' AND j.next_at<=?
      AND NOT EXISTS (SELECT 1 FROM wa_jobs older WHERE older.account=j.account AND older.jid=j.jid
        AND older.rowid<j.rowid AND older.state IN ('pending','processing','blocked'))
      AND NOT EXISTS (SELECT 1 FROM wa_outbox o WHERE o.account=j.account AND o.jid=j.jid
        AND o.state IN ('pending','sending','review')) ORDER BY j.rowid LIMIT 1`).get(account, this.now());
  }
  begin(id) { this.db.prepare("UPDATE wa_jobs SET state='processing',attempts=attempts+1 WHERE id=?").run(id); }
  commit(job, fn, { jid, suppressed = false } = {}) {
    return this.transaction(() => {
      const current = this.db.prepare('SELECT state FROM wa_jobs WHERE id=?').get(job.id);
      if (current?.state === 'processed') return null;
      const result = fn();
      if (result?.reply && !suppressed) this.addOutgoing({ id: job.id, account: job.account,
        jid: jid || job.jid, body: result.reply, automatic: true, ticketId: result.ticket?.id });
      this.db.prepare("UPDATE wa_jobs SET state='processed',error=NULL WHERE id=?").run(job.id);
      return result;
    });
  }
  ignore(id) { this.db.prepare("UPDATE wa_jobs SET state='ignored' WHERE id=?").run(id); }
  fail(job, error) {
    const fault = classify(error);
    const attempts = this.db.prepare('SELECT attempts FROM wa_jobs WHERE id=?').get(job.id)?.attempts || 1;
    const retry = fault.classification === 'recoverable' && attempts < this.maxAttempts;
    this.db.prepare('UPDATE wa_jobs SET state=?,error=?,next_at=? WHERE id=?')
      .run(retry ? 'pending' : 'blocked', fault.code, this.now() + retryDelay(attempts), job.id);
    return { ...fault, retry };
  }
  addOutgoing({ id, account, jid, body, automatic = false, ticketId }) {
    this.db.prepare(`INSERT OR IGNORE INTO wa_outbox(id,account,jid,body,automatic,ticket_id,message_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, account, jid, body, automatic ? 1 : 0, ticketId || null,
      randomBytes(16).toString('hex').toUpperCase(), this.now());
    return this.db.prepare('SELECT * FROM wa_outbox WHERE id=?').get(id);
  }
  outgoing(account) {
    return this.db.prepare(`SELECT o.* FROM wa_outbox o WHERE account=? AND state='pending'
      AND NOT EXISTS (SELECT 1 FROM wa_outbox older WHERE older.account=o.account AND older.jid=o.jid
        AND older.seq<o.seq AND older.state IN ('pending','sending','review')) ORDER BY seq LIMIT 100`).all(account);
  }
  markOutgoing(id, state, error = null) {
    this.db.prepare('UPDATE wa_outbox SET state=?,error=?,sent_at=CASE WHEN ?=\'sent\' THEN ? ELSE sent_at END WHERE id=?')
      .run(state, error, state, this.now(), id);
  }
  acknowledge(messageId, account, delivered) {
    const row = this.db.prepare("SELECT * FROM wa_outbox WHERE message_id=? AND account=? AND state IN ('sending','review')").get(messageId, account);
    if (!row) return;
    this.transaction(() => { this.markOutgoing(row.id, 'sent'); delivered?.(row); });
  }
  snapshot() {
    const inbox = this.db.prepare(`SELECT COUNT(*) count FROM wa_inbox i LEFT JOIN wa_jobs j ON j.id=i.job_id
      WHERE i.job_id IS NULL OR j.state IN ('pending','processing')`).get().count;
    const outbox = this.db.prepare("SELECT COUNT(*) count FROM wa_outbox WHERE state IN ('pending','sending')").get().count;
    const review = this.db.prepare("SELECT COUNT(*) count FROM wa_outbox WHERE state='review'").get().count;
    const blocked = this.db.prepare("SELECT COUNT(*) count FROM wa_jobs WHERE state='blocked'").get().count +
      this.db.prepare('SELECT COUNT(*) count FROM wa_human_inbox WHERE done=2').get().count;
    const human = this.db.prepare('SELECT COUNT(*) count FROM wa_human_inbox WHERE done=0').get().count;
    return { incoming: inbox + human, outgoing: outbox, pending: inbox + human + outbox, review, blocked };
  }
  reviews() {
    return this.db.prepare("SELECT id,ticket_id,created_at,error FROM wa_outbox WHERE state='review' ORDER BY seq LIMIT 50").all();
  }
  loadRuntime() {
    const row = this.db.prepare('SELECT value FROM wa_runtime WHERE id=1').get();
    return row ? JSON.parse(row.value) : {};
  }
  saveRuntime(value) { this.db.prepare('INSERT OR REPLACE INTO wa_runtime VALUES (1,?)').run(JSON.stringify(value)); }
}
