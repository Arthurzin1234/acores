import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { legalDocuments } from '../server/legal.js';
import { DatabaseSync } from 'node:sqlite';
import { AI_UNAVAILABLE_REPLY } from '../server/ai-service.js';

test("topic changes and follow-ups reuse an open conversation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "acores-conversation-"));
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["--no-warnings=ExperimentalWarning", "server/index.js"], {
    env: { ...process.env, NODE_ENV: 'test', APP_ORIGIN: `http://127.0.0.1:${port}`, ENABLE_SIMULATOR: 'true', PORT: String(port), DATA_DIR: directory, OPENAI_API_KEY: "", GEMINI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  const origin = `http://127.0.0.1:${port}`;
  let cookie = '', csrf = '';
  const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, ...options.headers } });
  try {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {}
      if (attempt === 300) throw new Error("Test server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const send = async (text) => {
      const response = await fetch(`${origin}/api/simulate-message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "5511990001122", name: "Teste", text }),
      });
      assert.equal(response.status, 201);
      return response.json();
    };
    const setup = await fetch(`${origin}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.invalid', password: 'Only-for-tests-93847', token: fs.readFileSync(path.join(directory, 'admin-setup.token'), 'utf8'), acceptedTerms: true, privacyAcknowledged: true, legalVersion: legalDocuments.version }) });
    assert.equal(setup.status, 201);
    cookie = setup.headers.get('set-cookie').split(';')[0]; csrf = (await setup.json()).csrf;
    const first = await send("ola");
    const surgery = await send("quero marcar uma cirurgia");
    const followup = await send("meu pet tem 3 anos");
    assert.equal(surgery.ticket.id, first.ticket.id);
    assert.equal(followup.ticket.id, first.ticket.id);
    assert.equal(followup.ticket.category, "cirurgia");
    const { messages } = await (await fetch(`${origin}/api/tickets/${first.ticket.id}/messages`)).json();
    assert.equal(messages.filter((message) => message.direction === "inbound").length, 3);
    await send("Kamily");
    const pet = await send("Hanna");
    assert.equal(pet.client.pet_name, "Hanna");
    assert.equal(pet.reply, "Qual é a espécie do seu pet?");
    const species = await send("Felina");
    assert.equal(species.client.species, "Felina");
    assert.match(species.reply, /idade/);
    const ambiguous = await send("7");
    assert.equal(ambiguous.client.pet_age, null);
    assert.match(ambiguous.reply, /meses ou anos/);
    const age = await send("7 anos");
    assert.equal(age.client.pet_age, "7 anos");
    assert.equal(age.client.name, "Kamily");
    assert.equal(age.ticket.ai_paused, 1);
    const paused = await send("mais uma mensagem");
    assert.equal(paused.reply, null);
    assert.equal(paused.ticket.id, first.ticket.id);
    await fetch(`${origin}/api/tickets/${first.ticket.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_paused: false }),
    });
    assert.ok((await send("ola")).reply);
    const manual = await fetch(`${origin}/api/tickets/${first.ticket.id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "A recepção assumiu.", sendToWhatsApp: false }),
    });
    assert.equal(manual.status, 201);
    const afterHuman = await send("ola");
    assert.equal(afterHuman.reply, null);
    assert.equal(afterHuman.ticket.ai_paused, 1);
    const response = await fetch(`${origin}/api/tickets/${first.ticket.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolvido" }),
    });
    assert.equal(response.status, 200);
    const next = await send("ola novamente");
    assert.notEqual(next.ticket.id, first.ticket.id);
    const clientId = next.ticket.client_id;
    assert.equal((await fetch(`${origin}/api/clients/${clientId}`, { method: "DELETE" })).status, 400);
    const removed = await fetch(`${origin}/api/clients/${clientId}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(`${origin}/api/tickets/${first.ticket.id}/messages`)).status, 404);
    assert.equal((await fetch(`${origin}/api/tickets/${next.ticket.id}/messages`)).status, 404);
    await fetch(`${origin}/api/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: "Rua de Teste, 123" }) });
    const emergency = await send("é uma emergência");
    assert.equal(emergency.ticket.ai_paused, 0);
    assert.match(emergency.reply, /24 horas/);
    assert.match(emergency.reply, /https:\/\/www.google.com\/maps/);
    const tutor = await send("Kamily");
    assert.equal(tutor.reply, "Qual é o nome do seu pet?");
    assert.equal(tutor.ticket.category, "urgencia");
    assert.equal((await send("Hanna")).reply, "Qual é a espécie do seu pet?");
    assert.match((await send("Felina")).reply, /idade/);
    const complete = await send("7 anos");
    assert.equal(complete.ticket.ai_paused, 1);
    assert.equal(complete.client.pet_age, "7 anos");
    assert.equal((await send("obrigada")).reply, null);
    const database = new DatabaseSync(path.join(directory, 'petbot.sqlite'));
    database.exec('PRAGMA busy_timeout=3000');
    try {
      database.prepare("UPDATE ai_settings SET provider='gemini',gemini_secret=NULL WHERE id=1").run();
      await fetch(`${origin}/api/tickets/${complete.ticket.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'resolvido' }) });
      const unavailable = await send('Quero informações sobre castração');
      assert.equal(unavailable.reply, AI_UNAVAILABLE_REPLY);
      assert.equal(unavailable.ticket.ai_paused, 1);
      assert.match(unavailable.ticket.ai_summary, /IA indisponível/);
      assert.equal((await send('Hanna')).reply, null);
      database.prepare("UPDATE ai_settings SET provider='rules' WHERE id=1").run();
      assert.equal((await send('A IA já voltou?')).reply, null);
      const context = await (await fetch(`${origin}/api/tickets/${unavailable.ticket.id}/messages`)).json();
      assert.equal(context.messages.filter((m) => m.body === AI_UNAVAILABLE_REPLY).length, 1);
      assert.equal(context.messages.filter((m) => m.direction === 'inbound').length, 3);
      const dashboard = await (await fetch(`${origin}/api/dashboard`)).json();
      assert.ok(dashboard.notifications.some((n) => n.ticket_id === unavailable.ticket.id && n.title === 'IA indisponível'));
      assert.equal(dashboard.operations.ai.available, false);
      const status = await fetch(`${origin}/api/operations/status`);
      assert.equal(status.status, 200);
      await fetch(`${origin}/api/tickets/${unavailable.ticket.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ai_paused: false }) });
      assert.ok((await send('Olá')).reply);
    } finally { database.close(); }
  } finally {
    child.kill();
    await exited;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
