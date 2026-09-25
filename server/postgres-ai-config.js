import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { MODEL_DEFAULTS } from './ai-config.js';

export async function createPostgresAIConfig(db, dataDir, env = process.env) {
  await db.query('insert into ai_settings(id) values(1) on conflict(id) do nothing');
  const keyPath = path.join(dataDir, 'ai-encryption.key');
  let encryptionKey;
  const getEncryptionKey = () => {
    if (encryptionKey) return encryptionKey;
    if (env.AI_ENCRYPTION_KEY) encryptionKey = Buffer.from(env.AI_ENCRYPTION_KEY, 'base64');
    else if (fs.existsSync(keyPath)) encryptionKey = fs.readFileSync(keyPath);
    else if (env.SUPABASE_DB_URL) encryptionKey = createHash('sha256').update(env.SUPABASE_DB_URL).digest();
    else { fs.mkdirSync(dataDir, { recursive: true }); encryptionKey = randomBytes(32); fs.writeFileSync(keyPath, encryptionKey, { mode: 0o600 }); }
    if (encryptionKey.length !== 32) throw new Error('AI_ENCRYPTION_KEY deve ser base64 de 32 bytes.');
    return encryptionKey;
  };
  const encrypt = (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64')).join('.'); };
  const decrypt = (value) => { if (!value) return ''; const [iv, tag, encrypted] = value.split('.').map((v) => Buffer.from(v, 'base64')); const cipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), iv); cipher.setAuthTag(tag); return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8'); };
  const read = () => db.one('select * from ai_settings where id=1');
  return {
    async snapshot() { const row = await read(); return { provider: env.AI_PROVIDER || row.provider, openaiModel: env.OPENAI_MODEL || row.openai_model, geminiModel: env.GEMINI_MODEL || row.gemini_model, grokModel: env.GROK_MODEL || row.grok_model, openaiConfigured: !!(row.openai_secret || env.OPENAI_API_KEY), geminiConfigured: !!(row.gemini_secret || env.GEMINI_API_KEY), grokConfigured: !!(row.grok_secret || env.GROK_API_KEY || env.GROQ_API_KEY), knowledge: Array.isArray(row.knowledge) ? row.knowledge : JSON.parse(row.knowledge || '[]'), instructions: row.instructions || '', ignoreGroups: true, ignoreArchived: true, approvedRepliesOnly: true }; },
    async credentials(provider) { if (!Object.hasOwn(MODEL_DEFAULTS, provider)) throw new Error('Provedor inválido.'); const row = await read(); const key = provider === 'openai' ? env.OPENAI_API_KEY : provider === 'gemini' ? env.GEMINI_API_KEY : env.GROK_API_KEY || env.GROQ_API_KEY; return { model: env[`${provider.toUpperCase()}_MODEL`] || row[`${provider}_model`], key: key || decrypt(row[`${provider}_secret`]) || '' }; },
    async save(input) {
      const row = await read(); const provider = input.provider ?? row.provider; if (!['rules','openai','gemini','grok'].includes(provider)) throw new Error('Selecione um provedor válido.');
      const models = {}, secrets = {}; for (const name of Object.keys(MODEL_DEFAULTS)) { models[name] = String(input[`${name}Model`] ?? row[`${name}_model`]).trim(); if (!/^[a-zA-Z0-9._-]{1,100}$/.test(models[name])) throw new Error('Identificador de modelo inválido.'); secrets[name] = row[`${name}_secret`]; const supplied = input[`${name}Key`]; if (supplied?.trim()) { if (supplied.trim().length < 16 || supplied.length > 1024 || /\s/.test(supplied.trim())) throw new Error('Confira a chave informada.'); secrets[name] = encrypt(supplied.trim()); } }
      const knowledge = input.knowledge ?? (Array.isArray(row.knowledge) ? row.knowledge : JSON.parse(row.knowledge || '[]')); const instructions = String(input.instructions ?? row.instructions ?? '').trim(); if (instructions.length > 4000 || !Array.isArray(knowledge) || knowledge.length > 60) throw new Error('Confira as instruções e as respostas aprovadas.');
      const ids = new Set(); const cleaned = knowledge.map((item) => { if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error('Resposta cadastrada inválida.'); ids.add(item.id); const question = String(item.question || '').trim(), answer = String(item.answer || '').trim(); if (!question || !answer || question.length > 300 || answer.length > 2000) throw new Error('Preencha a pergunta e a resposta.'); return { id: item.id, question, answer }; });
      await db.query(`update ai_settings set provider=$1,openai_model=$2,gemini_model=$3,grok_model=$4,grok_secret=$5,openai_secret=$6,gemini_secret=$7,knowledge=$8::jsonb,instructions=$9 where id=1`, [provider, models.openai, models.gemini, models.grok, secrets.grok, secrets.openai, secrets.gemini, JSON.stringify(cleaned), instructions]);
      return this.snapshot();
    },
  };
}
