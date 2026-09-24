import pg from 'pg';
import dns from 'node:dns';

const { Pool } = pg;
dns.setDefaultResultOrder('ipv4first');

export function postgresConfigured(env = process.env) {
  return Boolean(env.SUPABASE_DB_URL);
}

export function createPostgresPool(env = process.env) {
  const connectionString = env.SUPABASE_DB_URL;
  if (!connectionString) return null;
  const pool = new Pool({
    connectionString,
    max: Number(env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    family: 4,
    ssl: env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  pool.on('error', () => {});
  return pool;
}

export async function verifyPostgres(pool) {
  if (!pool) return false;
  const result = await pool.query('select 1 as ok');
  return result.rows[0]?.ok === 1;
}
