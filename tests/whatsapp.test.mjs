import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ReplyPolicy } from "../server/reply-policy.js";
import { WhatsAppConnector } from "../server/whatsapp.js";
import { extractText } from "../server/postgres-whatsapp.js";

const jid = "5511998887766@s.whatsapp.net";
const account = "5511000000000@s.whatsapp.net";
const message = (id) => ({
  key: { remoteJid: jid, id, fromMe: false },
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: "Olá" },
});

test("Postgres WhatsApp adapter extracts the real Baileys message payload", () => {
  assert.equal(extractText({ message: { conversation: "Olá" } }), "Olá");
  assert.equal(extractText({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: "Mensagem encapsulada" } } } } }), "Mensagem encapsulada");
});

test("human intervention blocks an in-flight reply; bot echoes do not pause", async () => {
  const db = new DatabaseSync(":memory:");
  let sent = 0, human = 0, release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const bot = new WhatsAppConnector({ db, authDir: ".", onStatus() {},
    onHumanMessage: () => { human++; },
    onMessage: async () => { entered(); await pending; return { reply: "Resposta pendente" }; },
  });
  bot.policy.begin(account); bot.policy.ready = true; bot.status.connected = true;
  bot.socket = { sendMessage: async (_jid, _body, options) => {
    sent++;
    await bot.handleHumanMessage({ ...message(options.messageId), key: { remoteJid: jid, id: options.messageId, fromMe: true } });
  } };
  try {
    await bot.sendText(jid, "Resposta da IA", { automatic: true });
    assert.equal(human, 0); assert.equal(bot.isHumanPaused(jid), false);
    const processing = bot.handleBaileysMessage(message("incoming"));
    await started;
    const manual = { ...message("human"), key: { remoteJid: jid, id: "human", fromMe: true } };
    await bot.handleHumanMessage(manual);
    await bot.handleHumanMessage(manual);
    assert.equal(human, 1); assert.ok(bot.isHumanPaused(jid));
    release(); await processing; assert.equal(sent, 1);
    assert.equal((await bot.sendText(jid, "Bloqueado", { automatic: true })).delivered, false);
    bot.setHumanPaused(jid, false);
    assert.equal((await bot.sendText(jid, "Liberado", { automatic: true })).delivered, true);
  } finally { db.close(); }
});

test("live greetings wait for archive sync; archived chats remain blocked", async () => {
  const db = new DatabaseSync(":memory:");
  const received = [];
  const bot = new WhatsAppConnector({
    db, authDir: ".", onStatus() {},
    onMessage: async (incoming) => { received.push(incoming.text); return {}; },
  });
  try {
    bot.policy.begin(account);
    bot.enqueueMessage(message("greeting"));
    bot.enqueueMessage(message("greeting"));
    const archived = "5511888888888@s.whatsapp.net";
    bot.enqueueMessage({ ...message("archived"), key: { remoteJid: archived, id: "archived" } });
    bot.enqueueMessage({ ...message("group"), key: { remoteJid: "123@g.us", id: "group" } });
    assert.equal(bot.snapshot().pendingMessages, 2);
    assert.equal(received.length, 0);
    bot.policy.update([{ id: archived, archived: true }]);
    bot.status.connected = true;
    bot.policy.ready = true;
    bot.flushWaitingMessages();
    await Promise.all(bot.queues.values());
    assert.deepEqual(received, ["Olá"]);
    assert.equal(bot.snapshot().pendingMessages, 0);
  } finally { db.close(); }
});

test("group, broadcast and archived chats stay blocked; state survives reload", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const policy = new ReplyPolicy(db);
    policy.begin(account);
    assert.equal(policy.allowed(jid), false);
    policy.ready = true;
    for (const id of [
      "123@g.us",
      "status@broadcast",
      "123@newsletter",
      "123@invalid",
    ])
      assert.equal(policy.allowed(id), false);
    assert.equal(policy.allowed(jid), true);
    policy.update([{ id: jid, archived: true }]);
    assert.equal(policy.allowed(jid), false);
    policy.update([{ id: jid, unreadCount: 1 }]);
    policy.update([{ id: jid, archived: false, unreadCount: 1 }]);
    assert.equal(policy.allowed(jid), false);
    const reloaded = new ReplyPolicy(db);
    reloaded.begin(account);
    reloaded.ready = true;
    assert.equal(reloaded.allowed(jid), false);
    reloaded.update([{ id: jid, archived: false }]);
    assert.equal(reloaded.allowed(jid), true);
  } finally {
    db.close();
  }
});

test("phone and LID aliases share archive changes and unarchive together", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const policy = new ReplyPolicy(db);
    policy.begin(account);
    policy.ready = true;
    policy.alias(jid, "987654321@lid");
    policy.update([{ id: "987654321@lid", archived: true }]);
    assert.equal(policy.allowed(jid), false);
    policy.update([{ id: "987654321@lid", archived: false }]);
    assert.equal(policy.allowed(jid), true);
    assert.equal(policy.allowed("987654321@lid"), true);
  } finally {
    db.close();
  }
});

test("incoming messages are processed once; groups and archives never reach AI", async () => {
  const db = new DatabaseSync(":memory:");
  let processed = 0;
  let sent = 0;
  try {
    const bot = new WhatsAppConnector({
      db,
      authDir: ".",
      onStatus() {},
      onMessage: async () => {
        processed++;
        return { reply: "Olá!" };
      },
    });
    bot.socket = {
      sendMessage: async () => {
        sent++;
      },
    };
    bot.status.connected = true;
    bot.policy.begin(account);
    bot.policy.ready = true;
    await bot.handleBaileysMessage({
      ...message("group"),
      key: { id: "group", remoteJid: "123@g.us" },
    });
    bot.policy.update([{ id: jid, archived: true }]);
    await bot.handleBaileysMessage(message("archived"));
    assert.equal(processed, 0);
    assert.equal(
      (await bot.sendText("123@g.us", "Nunca enviar")).delivered,
      false,
    );
    assert.equal((await bot.sendText(jid, "Nunca enviar")).delivered, false);
    bot.policy.update([{ id: jid, archived: false }]);
    await bot.handleBaileysMessage(message("valid"));
    await bot.handleBaileysMessage(message("valid"));
    assert.equal(processed, 1);
    assert.equal(sent, 1);
  } finally {
    db.close();
  }
});

test("archiving during AI processing aborts delivery, even if unarchived again", async () => {
  const db = new DatabaseSync(":memory:");
  let sent = 0;
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const bot = new WhatsAppConnector({
      db,
      authDir: ".",
      onStatus() {},
      onMessage: async () => {
        entered();
        await pending;
        return { reply: "Não enviar" };
      },
    });
    bot.socket = {
      sendMessage: async () => {
        sent++;
      },
    };
    bot.status.connected = true;
    bot.policy.begin(account);
    bot.policy.ready = true;
    const processing = bot.handleBaileysMessage(message("pending"));
    await started;
    bot.policy.update([{ id: jid, archived: true }]);
    bot.policy.update([{ id: jid, archived: false }]);
    release();
    await processing;
    assert.equal(sent, 0);
  } finally {
    db.close();
  }
});
