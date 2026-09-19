import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const now = () => new Date().toISOString();

export function createDatabase(rootDir, directory) {
  const dataDir = directory || (process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(rootDir, "data"));

  fs.mkdirSync(dataDir, { recursive: true });

  const db = new DatabaseSync(path.join(dataDir, "petbot.sqlite"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 2000;

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Cliente sem nome',
      phone TEXT NOT NULL UNIQUE,
      email TEXT,
      pet_name TEXT,
      species TEXT,
      breed TEXT,
      pet_age TEXT,
      pet_weight TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'geral',
      status TEXT NOT NULL DEFAULT 'novo',
      priority TEXT NOT NULL DEFAULT 'normal',
      human_required INTEGER NOT NULL DEFAULT 0,
      assigned_to TEXT,
      ai_summary TEXT,
      source TEXT NOT NULL DEFAULT 'whatsapp',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
    CREATE INDEX IF NOT EXISTS idx_tickets_status_priority ON tickets(status, priority);
    CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(phone);
    CREATE INDEX IF NOT EXISTS idx_messages_ticket_created ON messages(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at, created_at);
  `);
  db.exec("PRAGMA optimize;");
  if (!db.prepare("PRAGMA table_info(tickets)").all().some((c) => c.name === "ai_paused"))
    db.exec("ALTER TABLE tickets ADD COLUMN ai_paused INTEGER NOT NULL DEFAULT 0");

  return {
    raw: db,
    now,
    getStats() {
      const tickets = db
        .prepare(
          `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('novo', 'em_atendimento') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN human_required = 1 AND status != 'resolvido' THEN 1 ELSE 0 END) AS human,
            SUM(CASE WHEN priority = 'alta' AND status != 'resolvido' THEN 1 ELSE 0 END) AS urgent
          FROM tickets`
        )
        .get();
      const clients = db.prepare("SELECT COUNT(*) AS total FROM clients").get();
      const unread = db
        .prepare("SELECT COUNT(*) AS total FROM notifications WHERE read_at IS NULL")
        .get();

      return {
        totalTickets: Number(tickets.total || 0),
        openTickets: Number(tickets.open || 0),
        humanQueue: Number(tickets.human || 0),
        urgentTickets: Number(tickets.urgent || 0),
        totalClients: Number(clients.total || 0),
        unreadNotifications: Number(unread.total || 0)
      };
    },
    listClients() {
      return db
        .prepare(
          `SELECT c.*,
            COUNT(t.id) AS ticket_count,
            MAX(t.updated_at) AS last_ticket_at
           FROM clients c
           LEFT JOIN tickets t ON t.client_id = c.id
           GROUP BY c.id
           ORDER BY COALESCE(last_ticket_at, c.updated_at) DESC, c.id DESC`
        )
        .all();
    },
    getClientByPhone(phone) {
      return db.prepare("SELECT * FROM clients WHERE phone = ?").get(phone);
    },
    getClient(id) {
      return db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
    },
    upsertClient(input) {
      const timestamp = now();
      const phone = sanitizePhone(input.phone);
      if (!phone) {
        throw new Error("Telefone do cliente e obrigatorio.");
      }

      const existing = this.getClientByPhone(phone);
      if (existing) {
        const merged = {
          name: input.name || existing.name,
          email: input.email ?? existing.email,
          pet_name: input.pet_name ?? existing.pet_name,
          species: input.species ?? existing.species,
          breed: input.breed ?? existing.breed,
          pet_age: input.pet_age ?? existing.pet_age,
          pet_weight: input.pet_weight ?? existing.pet_weight,
          notes: input.notes ?? existing.notes,
          updated_at: timestamp,
          id: existing.id
        };
        db.prepare(
          `UPDATE clients
           SET name = ?, email = ?, pet_name = ?, species = ?, breed = ?,
               pet_age = ?, pet_weight = ?, notes = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          merged.name,
          merged.email,
          merged.pet_name,
          merged.species,
          merged.breed,
          merged.pet_age,
          merged.pet_weight,
          merged.notes,
          merged.updated_at,
          merged.id
        );
        return this.getClient(merged.id);
      }

      const inserted = db
        .prepare(
          `INSERT INTO clients
            (name, phone, email, pet_name, species, breed, pet_age, pet_weight, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name || "Cliente sem nome",
          phone,
          input.email || null,
          input.pet_name || null,
          input.species || null,
          input.breed || null,
          input.pet_age || null,
          input.pet_weight || null,
          input.notes || null,
          timestamp,
          timestamp
        );
      return this.getClient(Number(inserted.lastInsertRowid));
    },
    updateClient(id, input) {
      const current = this.getClient(id);
      if (!current) return null;
      db.prepare(
        `UPDATE clients
         SET name = ?, phone = ?, email = ?, pet_name = ?, species = ?, breed = ?,
             pet_age = ?, pet_weight = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        input.name ?? current.name,
        sanitizePhone(input.phone ?? current.phone),
        input.email ?? current.email,
        input.pet_name ?? current.pet_name,
        input.species ?? current.species,
        input.breed ?? current.breed,
        input.pet_age ?? current.pet_age,
        input.pet_weight ?? current.pet_weight,
        input.notes ?? current.notes,
        now(),
        id
      );
      return this.getClient(id);
    },
    listTickets() {
      return db
        .prepare(
          `SELECT t.*, c.name AS client_name, c.pet_name, c.species, c.breed, c.pet_age, c.pet_weight
           FROM tickets t
           LEFT JOIN clients c ON c.id = t.client_id
           ORDER BY
             CASE t.priority WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
             CASE t.status WHEN 'novo' THEN 0 WHEN 'em_atendimento' THEN 1 WHEN 'aguardando_cliente' THEN 2 ELSE 3 END,
             t.updated_at DESC`
        )
        .all()
        .map(normalizeTicket);
    },
    getTicket(id) {
      const ticket = db
        .prepare(
          `SELECT t.*, c.name AS client_name, c.pet_name, c.species, c.breed, c.pet_age, c.pet_weight
           FROM tickets t
           LEFT JOIN clients c ON c.id = t.client_id
           WHERE t.id = ?`
        )
        .get(id);
      return ticket ? normalizeTicket(ticket) : null;
    },
    findActiveTicket(phone) {
      const ticket = db
        .prepare(
          `SELECT * FROM tickets
           WHERE phone = ?
             AND status NOT IN ('resolvido', 'cancelado')
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`
        )
        .get(phone);
      return ticket ? normalizeTicket(ticket) : null;
    },
    createTicket(input) {
      const timestamp = now();
      const inserted = db
        .prepare(
          `INSERT INTO tickets
            (client_id, phone, subject, category, status, priority, human_required,
             assigned_to, ai_summary, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.client_id || null,
          sanitizePhone(input.phone),
          input.subject || "Novo atendimento",
          input.category || "geral",
          input.status || "novo",
          input.priority || "normal",
          input.human_required ? 1 : 0,
          input.assigned_to || null,
          input.ai_summary || null,
          input.source || "whatsapp",
          timestamp,
          timestamp
        );
      return this.getTicket(Number(inserted.lastInsertRowid));
    },
    updateTicket(id, input) {
      const current = this.getTicket(id);
      if (!current) return null;
      db.prepare(
        `UPDATE tickets
         SET subject = ?, category = ?, status = ?, priority = ?, assigned_to = ?, ai_summary = ?, human_required = ?, ai_paused = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        input.subject ?? current.subject,
        input.category ?? current.category,
        input.status ?? current.status,
        input.priority ?? current.priority,
        input.assigned_to ?? current.assigned_to,
        input.ai_summary ?? current.ai_summary,
        typeof input.human_required === "boolean"
          ? input.human_required
            ? 1
            : 0
          : current.human_required
            ? 1
            : 0,
        input.ai_paused === undefined ? current.ai_paused : Number(!!input.ai_paused),
        now(),
        id
      );
      return this.getTicket(id);
    },
    addMessage(ticketId, input) {
      const timestamp = now();
      const inserted = db
        .prepare(
          `INSERT INTO messages (ticket_id, direction, author, body, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          ticketId,
          input.direction,
          input.author || (input.direction === "inbound" ? "Cliente" : "PetCare IA"),
          input.body,
          timestamp
        );
      db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(timestamp, ticketId);
      return db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(inserted.lastInsertRowid));
    },
    listMessages(ticketId) {
      return db
        .prepare("SELECT * FROM messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC")
        .all(ticketId);
    },
    createNotification(input) {
      const inserted = db
        .prepare(
          `INSERT INTO notifications (ticket_id, title, body, level, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(input.ticket_id || null, input.title, input.body, input.level || "info", now());
      return db
        .prepare("SELECT * FROM notifications WHERE id = ?")
        .get(Number(inserted.lastInsertRowid));
    },
    listNotifications() {
      return db
        .prepare(
          `SELECT n.*, t.subject, t.status
           FROM notifications n
           LEFT JOIN tickets t ON t.id = n.ticket_id
           ORDER BY n.read_at IS NULL DESC, n.created_at DESC
           LIMIT 20`
        )
        .all();
    },
    markNotificationsRead() {
      db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL").run(now());
      return this.listNotifications();
    }
  };
}

export function seedDatabase(store) {
  const count = store.raw.prepare("SELECT COUNT(*) AS total FROM clients").get();
  if (Number(count.total || 0) > 0) return;

  const ana = store.upsertClient({
    name: "Ana Souza",
    phone: "5511998887766",
    email: "ana@email.com",
    pet_name: "Mel",
    species: "Cachorro",
    breed: "Shih-tzu",
    pet_age: "6 anos",
    pet_weight: "5 kg",
    notes: "Prefere atendimento no periodo da tarde."
  });
  const urgent = store.createTicket({
    client_id: ana.id,
    phone: ana.phone,
    subject: "Duvida sobre cirurgia de retirada de nodulo",
    category: "cirurgia",
    priority: "alta",
    human_required: true,
    ai_summary:
      "Tutora quer entender preparo, risco anestesico e agenda para procedimento cirurgico.",
    source: "whatsapp"
  });
  store.addMessage(urgent.id, {
    direction: "inbound",
    author: "Ana Souza",
    body: "Quero marcar uma cirurgia para retirar um nodulo da Mel. Como funciona?"
  });
  store.addMessage(urgent.id, {
    direction: "outbound",
    author: "PetCare IA",
    body: surgeryQuestionnaire("Ana Souza")
  });
  store.createNotification({
    ticket_id: urgent.id,
    title: "Atendente humano necessario",
    body: "Caso de cirurgia aberto para Ana Souza e Mel.",
    level: "warning"
  });

  const leo = store.upsertClient({
    name: "Leo Martins",
    phone: "5511981234455",
    pet_name: "Nina",
    species: "Gato",
    breed: "SRD",
    pet_age: "2 anos"
  });
  const grooming = store.createTicket({
    client_id: leo.id,
    phone: leo.phone,
    subject: "Pre-agendamento de banho e tosa",
    category: "banho_tosa",
    priority: "normal",
    human_required: false,
    ai_summary: "Cliente pediu horarios para banho e tosa da Nina.",
    source: "whatsapp"
  });
  store.addMessage(grooming.id, {
    direction: "inbound",
    author: "Leo Martins",
    body: "Tem horario para banho e tosa essa semana?"
  });
  store.addMessage(grooming.id, {
    direction: "outbound",
    author: "PetCare IA",
    body: appointmentQuestionnaire("banho e tosa")
  });
}

export function sanitizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeTicket(ticket) {
  return {
    ...ticket,
    human_required: Boolean(ticket.human_required)
  };
}

function surgeryQuestionnaire(name = "tutor") {
  return `Vou acionar um atendente humano para acompanhar esse caso, ${name}. Para adiantar o atendimento, me responda:
1. Nome do tutor
2. Nome, especie, raca, idade e peso do animal
3. Qual cirurgia ou procedimento foi indicado
4. Se ja existe exame, laudo ou encaminhamento veterinario
5. Melhor dia e horario para a equipe retornar`;
}

function appointmentQuestionnaire(serviceName) {
  return `Consigo iniciar o pre-agendamento de ${serviceName}. Me envie o nome do tutor, nome do pet, porte/idade e os melhores dias ou horarios para atendimento.`;
}
