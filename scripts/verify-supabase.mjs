import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL não configurada.');
const schemaPath = path.join(root, 'supabase', 'schema.sql');
if (!fs.existsSync(schemaPath)) throw new Error(`Schema não encontrado: ${schemaPath}`);
const pool = new pg.Pool({ connectionString, ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 1 });
const required = ['clients','tickets','messages','notifications','appointments','checklist_items','auth_users','auth_sessions','ai_settings','wa_inbox','wa_jobs','wa_outbox','whatsapp_auth_meta','whatsapp_auth','conversation_memory'];
try {
  await pool.query(fs.readFileSync(schemaPath, 'utf8'));
  const result = await pool.query(`select table_name from information_schema.tables where table_schema='public' and table_name = any($1::text[])`, [required]);
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = required.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Tabelas ausentes: ${missing.join(', ')}`);
  await pool.query('select 1');
  console.log(JSON.stringify({ ok: true, tables: required.length, message: 'Schema Supabase verificado.' }));
} finally {
  await pool.end();
}
