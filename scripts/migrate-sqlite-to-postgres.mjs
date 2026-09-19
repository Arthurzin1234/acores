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
  'auth_sessions', 'security_audit', 'ai_settings', 'wa_inbox', 'wa_jobs',
  'wa_outbox', 'wa_runtime', 'wa_human_inbox',
];
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new Pool({ connectionString, ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false } });

function columns(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      const available = columns(table);
      if (!available.length) continue;
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) continue;
      for (const row of rows) {
        const names = available.filter((name) => row[name] !== undefined);
        const values = names.map((name) => row[name] === undefined ? null : row[name]);
        const placeholders = names.map((_, index) => `$${index + 1}`).join(',');
        await client.query(
          `INSERT INTO ${table} (${names.join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
      }
      process.stdout.write(`Migrada ${table}: ${rows.length} registro(s)\n`);
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
