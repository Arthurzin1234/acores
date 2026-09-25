import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';
import pg from 'pg';
import { sanitizePhone } from './phone.js';

const { Pool } = pg;
dns.setDefaultResultOrder('ipv4first');
pg.types.setTypeParser(20, (value) => Number(value));
const now = () => new Date().toISOString();

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function normalizeTicket(row) {
  return row ? { ...row, human_required: bool(row.human_required), ai_paused: bool(row.ai_paused) } : null;
}

/**
 * PostgreSQL implementation of the application's durable data boundary.
 * It intentionally exposes domain methods instead of leaking SQL into routes.
 */
export async function createPostgresDatabase(rootDir, env = process.env) {
  if (!env.SUPABASE_DB_URL) return null;
  const pool = new Pool({
    connectionString: env.SUPABASE_DB_URL,
    max: Number(env.PG_POOL_MAX || 10),
    connectionTimeoutMillis: 10000,
    family: 4,
    idleTimeoutMillis: 30000,
    ssl: env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  const schema = await fs.readFile(path.join(rootDir, 'supabase', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query('select 1');

  const query = (text, values = [], client = pool) => client.query(text, values);
  const one = async (text, values = [], client = pool) => (await query(text, values, client)).rows[0] || null;
  const many = async (text, values = [], client = pool) => (await query(text, values, client)).rows;
  const transaction = async (work) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const store = {
    postgres: true,
    query,
    one,
    many,
    transaction,
    async close() { await pool.end(); },
    async getStats() {
      const [tickets, clients, unread] = await Promise.all([
        one(`select count(*)::int as total,
          count(*) filter (where status in ('novo','em_atendimento'))::int as open,
          count(*) filter (where human_required and status <> 'resolvido')::int as human,
          count(*) filter (where priority = 'alta' and status <> 'resolvido')::int as urgent from tickets`),
        one('select count(*)::int as total from clients'),
        one('select count(*)::int as total from notifications where read_at is null'),
      ]);
      return { totalTickets: tickets.total, openTickets: tickets.open, humanQueue: tickets.human,
        urgentTickets: tickets.urgent, totalClients: clients.total, unreadNotifications: unread.total };
    },
    async listClients() {
      return many(`select c.*, count(t.id)::int as ticket_count, max(t.updated_at) as last_ticket_at
        from clients c left join tickets t on t.client_id = c.id
        group by c.id order by coalesce(max(t.updated_at), c.updated_at) desc, c.id desc`);
    },
    async getClientByPhone(phone) { return one('select * from clients where phone = $1', [phone]); },
    async getClient(id) { return one('select * from clients where id = $1', [id]); },
    async upsertClient(input) {
      const phone = sanitizePhone(input.phone);
      if (!phone) throw new Error('Telefone do cliente e obrigatorio.');
      const current = await this.getClientByPhone(phone);
      const row = await one(`insert into clients(name, phone, email, pet_name, species, breed, pet_age, pet_weight, notes, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
        on conflict(phone) do update set name=excluded.name, email=excluded.email, pet_name=excluded.pet_name,
          species=excluded.species, breed=excluded.breed, pet_age=excluded.pet_age, pet_weight=excluded.pet_weight,
          notes=excluded.notes, updated_at=excluded.updated_at returning *`,
        [input.name || current?.name || 'Cliente sem nome', phone, input.email ?? current?.email ?? null,
          input.pet_name ?? current?.pet_name ?? null, input.species ?? current?.species ?? null,
          input.breed ?? current?.breed ?? null, input.pet_age ?? current?.pet_age ?? null,
          input.pet_weight ?? current?.pet_weight ?? null, input.notes ?? current?.notes ?? null, now()]);
      return row;
    },
    async updateClient(id, input) {
      const current = await this.getClient(id); if (!current) return null;
      return one(`update clients set name=$1, phone=$2, email=$3, pet_name=$4, species=$5, breed=$6,
        pet_age=$7, pet_weight=$8, notes=$9, updated_at=$10 where id=$11 returning *`,
        [input.name ?? current.name, sanitizePhone(input.phone ?? current.phone), input.email ?? current.email,
          input.pet_name ?? current.pet_name, input.species ?? current.species, input.breed ?? current.breed,
          input.pet_age ?? current.pet_age, input.pet_weight ?? current.pet_weight, input.notes ?? current.notes, now(), id]);
    },
    async listTickets() {
      const rows = await many(`select t.*, c.name as client_name, c.pet_name, c.species, c.breed, c.pet_age, c.pet_weight
        from tickets t left join clients c on c.id=t.client_id
        order by case t.priority when 'alta' then 0 when 'normal' then 1 else 2 end,
          case t.status when 'novo' then 0 when 'em_atendimento' then 1 when 'aguardando_cliente' then 2 else 3 end,
          t.updated_at desc`);
      return rows.map(normalizeTicket);
    },
    async getTicket(id) {
      return normalizeTicket(await one(`select t.*, c.name as client_name, c.pet_name, c.species, c.breed, c.pet_age, c.pet_weight
        from tickets t left join clients c on c.id=t.client_id where t.id=$1`, [id]));
    },
    async findActiveTicket(phone) {
      return normalizeTicket(await one(`select * from tickets where phone=$1 and status not in ('resolvido','cancelado')
        order by updated_at desc, id desc limit 1`, [phone]));
    },
    async createTicket(input) {
      const row = await one(`insert into tickets(client_id, phone, subject, category, status, priority, human_required,
        assigned_to, ai_summary, source, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) returning id`,
        [input.client_id || null, sanitizePhone(input.phone), input.subject || 'Novo atendimento', input.category || 'geral',
          input.status || 'novo', input.priority || 'normal', !!input.human_required, input.assigned_to || null,
          input.ai_summary || null, input.source || 'whatsapp', now()]);
      return this.getTicket(row.id);
    },
    async updateTicket(id, input) {
      const current = await this.getTicket(id); if (!current) return null;
      return normalizeTicket(await one(`update tickets set subject=$1, category=$2, status=$3, priority=$4, assigned_to=$5,
        ai_summary=$6, human_required=$7, ai_paused=$8, updated_at=$9 where id=$10 returning *`,
        [input.subject ?? current.subject, input.category ?? current.category, input.status ?? current.status,
          input.priority ?? current.priority, input.assigned_to ?? current.assigned_to, input.ai_summary ?? current.ai_summary,
          input.human_required ?? current.human_required, input.ai_paused ?? current.ai_paused, now(), id]));
    },
    async addMessage(ticketId, input) {
      const timestamp = now();
      const inserted = await one(`insert into messages(ticket_id,direction,author,body,created_at,external_id)
        values ($1,$2,$3,$4,$5,$6)
        on conflict (external_id) where external_id is not null do nothing returning *`,
        [ticketId, input.direction, input.author || (input.direction === 'inbound' ? 'Cliente' : 'PetCare IA'), input.body, timestamp, input.externalId || null]);
      const row = inserted || (input.externalId ? await one('select * from messages where external_id=$1', [input.externalId]) : null);
      if (!row) throw new Error('Não foi possível registrar a mensagem.');
      await query('update tickets set updated_at=$1 where id=$2', [timestamp, ticketId]);
      return { ...row, inserted: !!inserted };
    },
    async listMessages(ticketId) { return many('select * from messages where ticket_id=$1 order by created_at asc,id asc', [ticketId]); },
    async createNotification(input) {
      return one(`insert into notifications(ticket_id,title,body,level,created_at) values ($1,$2,$3,$4,$5) returning *`,
        [input.ticket_id || null, input.title, input.body, input.level || 'info', now()]);
    },
    async listNotifications() { return many(`select n.*,t.subject,t.status from notifications n left join tickets t on t.id=n.ticket_id
      order by (n.read_at is null) desc,n.created_at desc limit 20`); },
    async markNotificationsRead() {
      await query('update notifications set read_at=$1 where read_at is null', [now()]);
      return this.listNotifications();
    },
  };
  return store;
}
