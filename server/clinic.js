const appointmentStatuses = [
  "aguardando",
  "confirmado",
  "em_preparo",
  "concluido",
  "cancelado",
];
const services = [
  'servico', 'reuniao', 'visita', 'reserva', 'procedimento', 'avaliacao',
  "consulta",
  "cirurgia",
  "retorno",
  "vacina",
  "banho_tosa",
  "exame",
];
const careStatuses = ["estavel", "observacao", "alta"];

export function createClinicStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      service TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      professional TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'aguardando',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_schedule ON appointments(scheduled_at);
    CREATE TABLE IF NOT EXISTS checklist_items (
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (ticket_id, item_key)
    );
    CREATE TABLE IF NOT EXISTS neonatal_care (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id),
      status TEXT NOT NULL DEFAULT 'observacao',
      notes TEXT NOT NULL DEFAULT '',
      next_check TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(
    "INSERT OR IGNORE INTO clinic_settings (id, name, unit, address) VALUES (1, ?, ?, ?)",
  ).run(
    process.env.PETSHOP_NAME || "Centro Veterinário dos Açores",
    "Clínica Matriz",
    "R. Raul Cabral de Menezes, 467 - Centro, Viamão - RS, 94415-610",
  );

  function requireClient(id) {
    if (
      !Number.isInteger(Number(id)) ||
      !db.prepare("SELECT id FROM clients WHERE id = ?").get(Number(id))
    ) {
      throw new Error("Selecione um paciente cadastrado.");
    }
  }

  function validDate(value, required = true) {
    if (!value && !required) return "";
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || "") ||
      Number.isNaN(Date.parse(`${value}Z`)) ||
      new Date(`${value}Z`).toISOString().slice(0, 16) !== value
    ) {
      throw new Error("Informe uma data e um horário válidos.");
    }
    return value;
  }

  return {
    snapshot() {
      return {
        appointments: db
          .prepare(
            `SELECT a.*, c.name AS client_name, c.pet_name, c.species
          FROM appointments a JOIN clients c ON c.id = a.client_id ORDER BY a.scheduled_at`,
          )
          .all(),
        checklist: db.prepare("SELECT * FROM checklist_items").all(),
        neonatal: db
          .prepare(
            `SELECT n.*, c.name AS client_name, c.pet_name, c.species, c.pet_age
          FROM neonatal_care n JOIN clients c ON c.id = n.client_id ORDER BY n.updated_at DESC`,
          )
          .all(),
        settings: db
          .prepare("SELECT * FROM clinic_settings WHERE id = 1")
          .get(),
      };
    },
    saveAppointment(input, id) {
      const current = id
        ? db.prepare("SELECT * FROM appointments WHERE id = ?").get(id)
        : {};
      if (!current) return null;
      const value = { ...current, ...input };
      requireClient(value.client_id);
      if (!services.includes(value.service))
        throw new Error("Serviço inválido.");
      if (!appointmentStatuses.includes(value.status || "aguardando"))
        throw new Error("Status inválido.");
      const scheduledAt = validDate(value.scheduled_at);
      const fields = [
        Number(value.client_id),
        value.service,
        scheduledAt,
        String(value.professional || "").trim(),
        value.status || "aguardando",
        String(value.notes || "").trim(),
      ];
      if (id) {
        db.prepare(
          "UPDATE appointments SET client_id=?, service=?, scheduled_at=?, professional=?, status=?, notes=? WHERE id=?",
        ).run(...fields, id);
      } else {
        id = Number(
          db
            .prepare(
              `INSERT INTO appointments
          (client_id, service, scheduled_at, professional, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(...fields, new Date().toISOString()).lastInsertRowid,
        );
      }
      return db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
    },
    setChecklist(ticketId, input) {
      const keys = [
        "tutor",
        "dados",
        "exames",
        "avaliacao",
        "autorizacao",
        "retorno",
      ];
      const ticket = db
        .prepare("SELECT id FROM tickets WHERE id = ? AND category = ?")
        .get(ticketId, "cirurgia");
      if (!ticket) return null;
      if (!keys.includes(input.key) || typeof input.checked !== "boolean")
        throw new Error("Item inválido.");
      db.prepare(
        `INSERT INTO checklist_items (ticket_id, item_key, checked, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(ticket_id, item_key) DO UPDATE SET checked=excluded.checked, updated_at=excluded.updated_at`,
      ).run(
        ticketId,
        input.key,
        input.checked ? 1 : 0,
        new Date().toISOString(),
      );
      return {
        ticket_id: ticketId,
        item_key: input.key,
        checked: input.checked,
      };
    },
    saveNeonatal(input, id) {
      const current = id
        ? db.prepare("SELECT * FROM neonatal_care WHERE id = ?").get(id)
        : {};
      if (!current) return null;
      const value = { ...current, ...input };
      requireClient(value.client_id);
      if (!careStatuses.includes(value.status || "observacao"))
        throw new Error("Status inválido.");
      const fields = [
        Number(value.client_id),
        value.status || "observacao",
        String(value.notes || ""),
        validDate(value.next_check, false),
        new Date().toISOString(),
      ];
      if (id) {
        db.prepare(
          "UPDATE neonatal_care SET client_id=?, status=?, notes=?, next_check=?, updated_at=? WHERE id=?",
        ).run(...fields, id);
      } else {
        if (
          db
            .prepare("SELECT id FROM neonatal_care WHERE client_id=?")
            .get(Number(value.client_id))
        ) {
          throw new Error("Este paciente já possui um acompanhamento.");
        }
        id = Number(
          db
            .prepare(
              "INSERT INTO neonatal_care (client_id, status, notes, next_check, updated_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run(...fields).lastInsertRowid,
        );
      }
      return db.prepare("SELECT * FROM neonatal_care WHERE id=?").get(id);
    },
    saveSettings(input) {
      const current = this.snapshot().settings;
      const value = { ...current, ...input };
      if (!String(value.name).trim() || !String(value.unit).trim())
        throw new Error("Informe o nome e a unidade.");
      db.prepare(
        "UPDATE clinic_settings SET name=?, unit=?, phone=?, address=? WHERE id=1",
      ).run(
        String(value.name).trim(),
        String(value.unit).trim(),
        String(value.phone),
        String(value.address),
      );
      return this.snapshot().settings;
    },
  };
}

export function registerClinicRoutes(app, clinic, onChange) {
  function handler(action) {
    return (req, res) => {
      try {
        if (
          req.params.id &&
          (!Number.isInteger(Number(req.params.id)) ||
            Number(req.params.id) < 1)
        ) {
          return res.status(400).json({ error: "Identificador inválido." });
        }
        const result = action(req);
        if (!result)
          return res.status(404).json({ error: "Registro não encontrado." });
        onChange();
        res.json(result);
      } catch (error) {
    res.status(400).json({ error: "Não foi possível concluir a operação. Confira os dados." });
      }
    };
  }
  app.post(
    "/api/appointments",
    handler((req) => clinic.saveAppointment(req.body)),
  );
  app.patch(
    "/api/appointments/:id",
    handler((req) => clinic.saveAppointment(req.body, Number(req.params.id))),
  );
  app.patch(
    "/api/checklist/:id",
    handler((req) => clinic.setChecklist(Number(req.params.id), req.body)),
  );
  app.post(
    "/api/neonatal",
    handler((req) => clinic.saveNeonatal(req.body)),
  );
  app.patch(
    "/api/neonatal/:id",
    handler((req) => clinic.saveNeonatal(req.body, Number(req.params.id))),
  );
  app.patch(
    "/api/settings",
    handler((req) => clinic.saveSettings(req.body)),
  );
}
