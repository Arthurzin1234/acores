import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { failure } from './reliability.js';

export async function openPostgresAuthStore(db, account = 'acores', env = process.env) {
  await db.query('insert into whatsapp_auth_meta(account,generation) values($1,1) on conflict(account) do nothing', [account]);
  const rawKey = env.WHATSAPP_AUTH_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY || env.SUPABASE_DB_URL;
  const key = createHash('sha256').update(String(rawKey || '')).digest();
  const protect = (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(JSON.stringify(value, BufferJSON.replacer), 'utf8'), cipher.final()]); return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }; };
  const unprotect = (value) => { const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64')); cipher.setAuthTag(Buffer.from(value.tag, 'base64')); return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.body, 'base64')), cipher.final()]).toString('utf8'), BufferJSON.reviver); };
  const generation = async () => (await db.one('select generation from whatsapp_auth_meta where account=$1', [account])).generation;
  const nameOf = (name) => name.replace(/\//g, '__').replace(/:/g, '-');
  const read = async (gen, name) => { const row = await db.one('select value from whatsapp_auth where account=$1 and generation=$2 and name=$3', [account, gen, nameOf(name)]); return row ? unprotect(row.value) : null; };
  const write = async (gen, name, value) => db.query(`insert into whatsapp_auth(account,generation,name,value) values($1,$2,$3,$4::jsonb) on conflict(account,generation,name) do update set value=excluded.value`, [account, gen, nameOf(name), JSON.stringify(protect(value))]);
  return {
    async load() {
      const gen = await generation(); let creds = await read(gen, 'creds.json');
      if (!creds) creds = initAuthCreds();
      if (!creds.noiseKey || !creds.signedIdentityKey) throw failure('credentials_storage');
      await write(gen, 'creds.json', creds);
      return { state: { creds, keys: {
        async get(type, ids) { const values = {}; for (const id of ids) { let value = await read(gen, `${type}-${id}.json`); if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value); values[id] = value; } return values; },
        async set(data) { for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries)) { const name = `${type}-${id}.json`; if (value != null) await write(gen, name, value); else await db.query('delete from whatsapp_auth where account=$1 and generation=$2 and name=$3', [account, gen, nameOf(name)]); } },
      } }, saveCreds: async () => write(gen, 'creds.json', creds) };
    },
    async newSession() { await db.query('update whatsapp_auth_meta set generation=generation+1 where account=$1', [account]); },
    async check() { await db.query('select 1'); return true; },
    async close() {},
  };
}
