-- Schema inicial para preparar a migracao do SQLite local para Supabase Postgres.
-- Rode em um projeto Supabase novo. Nao cole dados reais no SQL Editor.
-- A API/worker deve usar SUPABASE_SERVICE_ROLE_KEY apenas no servidor.

create extension if not exists pgcrypto;

create table if not exists clients (
  id bigserial primary key,
  name text not null default 'Cliente sem nome',
  phone text not null unique,
  email text,
  pet_name text,
  species text,
  breed text,
  pet_age text,
  pet_weight text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tickets (
  id bigserial primary key,
  client_id bigint references clients(id) on delete set null,
  phone text not null,
  subject text not null,
  category text not null default 'geral',
  status text not null default 'novo',
  priority text not null default 'normal',
  human_required boolean not null default false,
  ai_paused boolean not null default false,
  assigned_to text,
  ai_summary text,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id bigserial primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  direction text not null,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id bigserial primary key,
  ticket_id bigint references tickets(id) on delete cascade,
  title text not null,
  body text not null,
  level text not null default 'info',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id bigserial primary key,
  client_id bigint not null references clients(id) on delete cascade,
  service text not null,
  scheduled_at timestamptz not null,
  professional text not null default '',
  status text not null default 'aguardando',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  ticket_id bigint not null references tickets(id) on delete cascade,
  item_key text not null,
  checked boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (ticket_id, item_key)
);

create table if not exists neonatal_care (
  id bigserial primary key,
  client_id bigint not null unique references clients(id) on delete cascade,
  status text not null default 'observacao',
  notes text not null default '',
  next_check timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists clinic_settings (
  id integer primary key default 1 check (id = 1),
  name text not null default 'Centro Veterinario dos Acores',
  unit text not null default 'Clinica Matriz',
  phone text not null default '',
  address text not null default 'R. Raul Cabral de Menezes, 467 - Centro, Viamao - RS, 94415-610'
);

create table if not exists auth_users (
  id bigserial primary key,
  email text not null unique,
  username text unique,
  password_hash text not null,
  role text not null check (role in ('usuario','atendente','tecnico','administrador')),
  client_id bigint references clients(id) on delete set null,
  active boolean not null default true,
  must_change_password boolean not null default false
);

create table if not exists auth_sessions (
  hash text primary key,
  user_id bigint not null references auth_users(id) on delete cascade,
  csrf text not null,
  created_at bigint not null,
  expires_at bigint not null,
  seen_at bigint not null
);

create table if not exists security_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id bigint,
  event text not null,
  resource text not null default ''
);

create table if not exists ai_settings (
  id integer primary key default 1 check (id = 1),
  provider text not null default 'rules',
  openai_model text not null default 'gpt-4.1-mini',
  gemini_model text not null default 'gemini-3.1-flash-lite',
  grok_model text not null default 'grok-3-mini',
  openai_secret text,
  gemini_secret text,
  grok_secret text,
  knowledge jsonb not null default '[]'::jsonb
);

create table if not exists wa_inbox (
  seq bigserial primary key,
  account text not null,
  jid text not null,
  message_id text not null,
  payload jsonb not null,
  job_id text,
  received_at bigint not null,
  unique(account, message_id)
);

create table if not exists wa_jobs (
  id text primary key,
  account text not null,
  jid text not null,
  payload jsonb not null,
  state text not null default 'pending',
  attempts integer not null default 0,
  next_at bigint not null default 0,
  error text,
  created_at bigint not null
);

create table if not exists wa_outbox (
  seq bigserial primary key,
  id text unique not null,
  account text not null,
  jid text not null,
  body text not null,
  automatic boolean not null default false,
  ticket_id bigint references tickets(id) on delete set null,
  message_id text unique not null,
  state text not null default 'pending',
  error text,
  created_at bigint not null,
  sent_at bigint
);

create table if not exists wa_runtime (
  id integer primary key default 1 check (id = 1),
  value jsonb not null default '{}'::jsonb
);

create table if not exists wa_human_inbox (
  account text not null,
  message_id text not null,
  payload jsonb not null,
  done integer not null default 0,
  primary key(account, message_id)
);

create table if not exists conversation_memory (
  id bigserial primary key,
  phone text not null,
  direction text not null check (direction in ('inbound','outbound')),
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tickets_status_priority on tickets(status, priority);
create index if not exists idx_tickets_phone on tickets(phone);
create index if not exists idx_messages_ticket_created on messages(ticket_id, created_at);
create index if not exists idx_notifications_read on notifications(read_at, created_at);
create index if not exists idx_appointments_schedule on appointments(scheduled_at);
create index if not exists idx_wa_jobs_pending on wa_jobs(account, state, next_at);
create index if not exists idx_wa_outbox_pending on wa_outbox(account, state, seq);
create index if not exists idx_conversation_memory_phone on conversation_memory(phone, created_at);

insert into clinic_settings(id) values (1) on conflict (id) do nothing;
insert into ai_settings(id) values (1) on conflict (id) do nothing;

alter table clients enable row level security;
alter table tickets enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table appointments enable row level security;
alter table neonatal_care enable row level security;

-- O painel atual usa a API do servidor. Nao exponha tabelas diretamente ao navegador.
-- A chave anon fica sem politicas permissivas por padrao; o service role do worker
-- ignora RLS e deve aplicar as permissoes ja existentes no backend.
