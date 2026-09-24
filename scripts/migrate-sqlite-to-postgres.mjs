import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const { Pool } = pg;
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const sqlitePath = process.env.SQLITE_PATH || path.join(root, 'data', 'petbot.sqlite');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error('Configure SUPABASE_DB_URL antes da migracao.');
if (!fs.existsSync(sqlitePath)) throw new Error(`Banco SQLite nao encontrado: ${sqlitePath}`);

const tables = [
  'clients', 'tickets', 'messages', 'notifications', 'appointments',
  'checklist_items', 'neonatal_care', 'clinic_settings', 'auth_users',
  'staff',
  'auth_sessions', 'auth_bootstrap', 'security_audit', 'auth_legal_versions', 'auth_legal_acceptance',
  'ai_settings', 'operational_alerts', 'service_health', 'wa_inbox', 'wa_jobs',
  'wa_outbox', 'wa_runtime', 'wa_human_inbox', 'whatsapp_sent_ids', 'whatsapp_human_pause',
  'whatsapp_human_seen', 'whatsapp_chat_policy', 'whatsapp_processed_messages', 'whatsapp_chat_alias',
];
const booleanColumns = new Set(['human_required', 'ai_paused', 'active', 'platform_admin', 'must_change_password', 'checked', 'automatic', 'archived']);
const jsonColumns = new Set(['knowledge', 'payload', 'value']);
const timestampColumns = new Set(['created_at', 'updated_at', 'read_at', 'accepted_at', 'first_at', 'last_at', 'sent_at', 'checked_at', 'next_check']);
const sequenceTables = new Set(['clients', 'tickets', 'messages', 'notifications', 'appointments', 'neonatal_care', 'staff', 'security_audit', 'wa_inbox', 'wa_outbox']);
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new Pool({ connectionString, ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false } });
const schemaPath = path.join(root, 'supabase', 'schema.sql');

function columns(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
}

async function main() {
  const client = await pool.connect();
  try {
    if (!fs.existsSync(schemaPath)) throw new Error(`Schema PostgreSQL nao encontrado: ${schemaPath}`);
    await client.query(fs.readFileSync(schemaPath, 'utf8'));
    process.stdout.write('Schema PostgreSQL verificado.\n');
    await client.query('BEGIN');
    for (const table of tables) {
      const available = columns(table);
      if (!available.length) continue;
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) continue;
      for (const row of rows) {
        const names = available.filter((name) => row[name] !== undefined);
        const values = names.map((name) => {
          if (row[name] === undefined) return null;
          const numericTimestamp = (table === 'wa_jobs' || table === 'wa_outbox') && ['created_at', 'sent_at'].includes(name);
          if (row[name] === '' && timestampColumns.has(name) && !numericTimestamp) return null;
          if (booleanColumns.has(name)) return Boolean(Number(row[name]));
          if (jsonColumns.has(name)) {
            if (row[name] === null || row[name] === '') return name === 'knowledge' ? [] : {};
            return typeof row[name] === 'string' ? JSON.parse(row[name]) : row[name];
          }
          if (timestampColumns.has(name) && !numericTimestamp && row[name] !== null && Number.isFinite(Number(row[name])) && !String(row[name]).includes('-'))
            return new Date(Number(row[name])).toISOString();
          return row[name];
        });
        const placeholders = names.map((_, index) => `$${index + 1}`).join(',');
        await client.query(
          `INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
      }
      process.stdout.write(`Migrada ${table}: ${rows.length} registro(s)\n`);
      if (sequenceTables.has(table)) {
        const idColumn = table === 'wa_inbox' ? 'seq' : table === 'wa_outbox' ? 'seq' : 'id';
        const sequence = `${table}_${idColumn}_seq`;
        await client.query(`select setval($1::regclass, coalesce((select max(${idColumn}) from ${table}), 1), (select count(*) > 0 from ${table}))`, [sequence]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
