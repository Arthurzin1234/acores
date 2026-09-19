import fs from "node:fs";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

export const MODEL_DEFAULTS = {
  openai: "gpt-4.1-mini",
  gemini: "gemini-3.1-flash-lite",
  grok: "grok-3-mini",
};

export function createAIConfig(db, dataDir, env = process.env) {
  if (env.AI_PROVIDER && !['rules', 'openai', 'gemini', 'grok'].includes(env.AI_PROVIDER))
    throw new Error('AI_PROVIDER invalido.');
  for (const key of ['OPENAI_MODEL', 'GEMINI_MODEL'])
    if (env[key] && !/^[a-zA-Z0-9._-]{1,100}$/.test(env[key])) throw new Error('Modelo de IA invalido.');
  db.exec(`CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), provider TEXT NOT NULL DEFAULT 'rules',
    openai_model TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
    gemini_model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite',
    grok_model TEXT NOT NULL DEFAULT 'grok-3-mini',
    openai_secret TEXT, gemini_secret TEXT, grok_secret TEXT,
    knowledge TEXT NOT NULL DEFAULT '[]'
  )`);
  db.prepare("INSERT OR IGNORE INTO ai_settings (id) VALUES (1)").run();
  const columns = new Set(db.prepare('PRAGMA table_info(ai_settings)').all().map((column) => column.name));
  if (!columns.has('grok_secret')) db.exec('ALTER TABLE ai_settings ADD COLUMN grok_secret TEXT');
  if (!columns.has('grok_model')) db.exec("ALTER TABLE ai_settings ADD COLUMN grok_model TEXT NOT NULL DEFAULT 'grok-3-mini'");
  const keyPath = path.join(dataDir, "ai-encryption.key");
  let encryptionKey;
  function getEncryptionKey() {
    if (encryptionKey) return encryptionKey;
    if (fs.existsSync(keyPath)) encryptionKey = fs.readFileSync(keyPath);
    else {
      const current = db
        .prepare(
          "SELECT openai_secret, gemini_secret FROM ai_settings WHERE id=1",
        )
        .get();
      if (current.openai_secret || current.gemini_secret)
        throw new Error(
          "A chave local de proteção não foi encontrada. Restaure o backup das configurações.",
        );
      fs.mkdirSync(dataDir, { recursive: true });
      encryptionKey = randomBytes(32);
      fs.writeFileSync(keyPath, encryptionKey, { mode: 0o600, flag: "wx" });
    }
    if (encryptionKey.length !== 32)
      throw new Error("A chave local de proteção está inválida.");
    return encryptionKey;
  }
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((buffer) => buffer.toString("base64"))
      .join(".");
  }
  function decrypt(value) {
    if (!value) return "";
    const [iv, tag, encrypted] = value
      .split(".")
      .map((part) => Buffer.from(part, "base64"));
    const cipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
      "utf8",
    );
  }
  const read = () => db.prepare("SELECT * FROM ai_settings WHERE id=1").get();
  return {
    snapshot() {
      const row = read();
      return {
        provider: env.AI_PROVIDER || row.provider,
        openaiModel: env.OPENAI_MODEL || row.openai_model,
        geminiModel: env.GEMINI_MODEL || row.gemini_model,
        grokModel: env.GROK_MODEL || row.grok_model,
        openaiConfigured: !!(row.openai_secret || env.OPENAI_API_KEY),
        geminiConfigured: !!(row.gemini_secret || env.GEMINI_API_KEY),
        grokConfigured: !!(row.grok_secret || env.GROK_API_KEY),
        knowledge: JSON.parse(row.knowledge),
        ignoreGroups: true,
        ignoreArchived: true,
        approvedRepliesOnly: true,
      };
    },
    credentials(provider) {
      if (!Object.hasOwn(MODEL_DEFAULTS, provider))
        throw new Error("Provedor inválido.");
      const row = read();
      return {
        model: env[`${provider.toUpperCase()}_MODEL`] || row[`${provider}_model`],
        key:
          env[
          provider === "openai" ? "OPENAI_API_KEY" : provider === "gemini" ? "GEMINI_API_KEY" : "GROK_API_KEY"
          ] || decrypt(row[`${provider}_secret`]) ||
          "",
      };
    },
    save(input) {
      const row = read();
      const provider = input.provider ?? row.provider;
      if (!["rules", "openai", "gemini", "grok"].includes(provider))
        throw new Error("Selecione um provedor válido.");
      const models = {};
      const secrets = {};
      for (const name of Object.keys(MODEL_DEFAULTS)) {
        models[name] = String(
          input[`${name}Model`] ?? row[`${name}_model`],
        ).trim();
        if (!/^[a-zA-Z0-9._-]{1,100}$/.test(models[name]))
          throw new Error("Identificador de modelo inválido.");
        secrets[name] = row[`${name}_secret`];
        const supplied = input[`${name}Key`];
        if (supplied !== undefined && typeof supplied !== "string")
          throw new Error("Chave inválida.");
        if (supplied?.trim()) {
          if (
            supplied.trim().length < 16 ||
            supplied.length > 1024 ||
            /\s/.test(supplied.trim())
          )
            throw new Error("Confira a chave informada.");
          secrets[name] = encrypt(supplied.trim());
        }
      }
      const knowledge = input.knowledge ?? JSON.parse(row.knowledge);
      if (!Array.isArray(knowledge) || knowledge.length > 60)
        throw new Error("Cadastre até 60 respostas aprovadas.");
      const ids = new Set();
      const cleaned = knowledge.map((item) => {
        if (
          !item ||
          typeof item.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
          ids.has(item.id)
        )
          throw new Error("Resposta cadastrada inválida.");
        if (["clinic_address", "clinic_phone"].includes(item.id))
          throw new Error(
            "Este identificador é reservado aos dados da clínica.",
          );
        ids.add(item.id);
        const question = String(item.question || "").trim();
        const answer = String(item.answer || "").trim();
        if (
          !question ||
          !answer ||
          question.length > 300 ||
          answer.length > 2000
        )
          throw new Error(
            "Preencha a pergunta (até 300 caracteres) e a resposta (até 2.000).",
          );
        return { id: item.id, question, answer };
      });
      db.prepare(
        `UPDATE ai_settings SET provider=?, openai_model=?, gemini_model=?, grok_model=?,
        grok_secret=?, openai_secret=?, gemini_secret=?, knowledge=? WHERE id=1`,
      ).run(
        provider,
        models.openai,
        models.gemini,
        models.grok,
        secrets.grok,
        secrets.openai,
        secrets.gemini,
        JSON.stringify(cleaned),
      );
      return this.snapshot();
    },
  };
}
