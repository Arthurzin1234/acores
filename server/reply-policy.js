export const privateJid = (jid) =>
  /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid || "");
export const cleanJid = (jid) => String(jid || "").replace(/:\d+@/, "@");

export class ReplyPolicy {
  constructor(db) {
    this.db = db;
    this.account = "";
    this.ready = false;
    this.states = new Map();
    this.revisions = new Map();
    this.pending = new Map();
    this.aliases = new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_chat_policy (
      account TEXT NOT NULL, jid TEXT NOT NULL, archived INTEGER NOT NULL,
      PRIMARY KEY(account, jid)
    ); CREATE TABLE IF NOT EXISTS whatsapp_processed_messages (
      account TEXT NOT NULL, jid TEXT NOT NULL, message_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(account, jid, message_id)
    ); CREATE TABLE IF NOT EXISTS whatsapp_chat_alias (
      account TEXT NOT NULL, first_jid TEXT NOT NULL, second_jid TEXT NOT NULL,
      PRIMARY KEY(account, first_jid, second_jid)
    );`);
  }
  begin(account) {
    this.stop();
    this.account = cleanJid(account);
    this.states = new Map(
      this.db
        .prepare(
          "SELECT jid, archived FROM whatsapp_chat_policy WHERE account=?",
        )
        .all(this.account)
        .map((row) => [row.jid, !!row.archived]),
    );
    this.revisions.clear();
    this.aliases.clear();
    for (const row of this.db
      .prepare(
        "SELECT first_jid, second_jid FROM whatsapp_chat_alias WHERE account=?",
      )
      .all(this.account))
      this.link(row.first_jid, row.second_jid);
  }
  stop() {
    this.ready = false;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
  }
  update(chats, snapshot = false) {
    if (!this.account) return;
    for (const chat of chats || []) {
      const jid = cleanJid(chat.id);
      if (!privateJid(jid)) continue;
      // Partial message updates never establish that an unknown chat is unarchived.
      if (typeof chat.archived !== "boolean" && !snapshot) continue;
      if (snapshot && this.revisions.has(jid)) continue;
      if (
        chat.archived === false &&
        this.states.get(jid) === true &&
        ("unreadCount" in chat || "conversationTimestamp" in chat)
      )
        continue;
      const archived = chat.archived === true;
      for (const target of new Set([jid, ...(this.aliases.get(jid) || [])])) {
        const changed = this.states.get(target) !== archived;
        this.states.set(target, archived);
        if (!snapshot) this.revisions.set(target, this.revision(target) + Number(changed));
        this.db
          .prepare(
            `INSERT INTO whatsapp_chat_policy(account,jid,archived) VALUES(?,?,?)
        ON CONFLICT(account,jid) DO UPDATE SET archived=excluded.archived`,
          )
          .run(this.account, target, archived ? 1 : 0);
        if (archived) this.pending.get(target)?.abort();
      }
    }
  }
  alias(first, second) {
    first = cleanJid(first);
    second = cleanJid(second);
    if (!privateJid(first) || !privateJid(second)) return;
    if (first === second) return;
    this.link(first, second);
    const pair = [first, second].sort();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO whatsapp_chat_alias(account,first_jid,second_jid) VALUES(?,?,?)",
      )
      .run(this.account, ...pair);
    if (this.states.get(first) === true || this.states.get(second) === true)
      this.update([
        { id: first, archived: true },
        { id: second, archived: true },
      ]);
  }
  link(first, second) {
    for (const [a, b] of [
      [first, second],
      [second, first],
    ]) {
      if (!this.aliases.has(a)) this.aliases.set(a, new Set());
      this.aliases.get(a).add(b);
    }
  }
  revision(jid) {
    return this.revisions.get(cleanJid(jid)) || 0;
  }
  allowed(jid) {
    return (
      !!this.account &&
      this.ready &&
      privateJid(jid) &&
      this.states.get(cleanJid(jid)) !== true
    );
  }
  claim(jid, messageId) {
    if (!messageId || !this.allowed(jid)) return false;
    return !!this.db
      .prepare(
        "INSERT OR IGNORE INTO whatsapp_processed_messages(account,jid,message_id,created_at) VALUES(?,?,?,?)",
      )
      .run(this.account, cleanJid(jid), messageId, new Date().toISOString())
      .changes;
  }
}
