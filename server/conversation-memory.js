import { createPostgresPool } from './postgres.js';

export function createConversationMemory(env = process.env) {
  if (env.NODE_ENV === 'test') return { enabled: false, init: async () => {}, list: async () => [], append: async () => {}, close: async () => {} };
  const pool = createPostgresPool(env);
  if (!pool) return { enabled: false, init: async () => {}, list: async () => [], append: async () => {}, close: async () => {} };
  let ready;
  const init = () => ready ||= pool.query(`create table if not exists conversation_memory (
    id bigserial primary key, phone text not null,
    direction text not null check (direction in ('inbound','outbound')),
    author text not null, body text not null, created_at timestamptz not null default now());
    create index if not exists idx_conversation_memory_phone on conversation_memory(phone, created_at);`);
  return {
    enabled: true,
    async init() { await init(); },
    async list(phone) {
      await init();
      const result = await pool.query('select direction, author, body, created_at from conversation_memory where phone=$1 order by created_at asc, id asc limit 100', [phone]);
      return result.rows;
    },
    async append(phone, message) {
      await init();
      await pool.query('insert into conversation_memory(phone,direction,author,body) values($1,$2,$3,$4)', [phone, message.direction, message.author, message.body]);
    },
    async close() { await pool.end(); },
  };
}
