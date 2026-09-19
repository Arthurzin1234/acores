export function registerDeletionRoutes(app, db, onChange) {
  const tables = { clients: "clients", tickets: "tickets", appointments: "appointments", neonatal: "neonatal_care", notifications: "notifications" };
  app.delete("/api/:entity/:id", (req, res) => {
    const table = tables[req.params.entity];
    const id = Number(req.params.id);
    if (!table || !Number.isSafeInteger(id) || id < 1)
      return res.status(400).json({ error: "Registro inválido." });
    if (req.body?.confirmed !== true)
      return res.status(400).json({ error: "Confirme a exclusão." });
    if (!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))
      return res.status(404).json({ error: "Registro não encontrado." });
    db.exec("BEGIN IMMEDIATE");
    try {
      if (['clients','tickets'].includes(table) && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wa_outbox'").get()) {
        const tickets = table === 'tickets' ? [{ id }] : db.prepare('SELECT id FROM tickets WHERE client_id=?').all(id);
        for (const ticket of tickets) {
          db.prepare("UPDATE wa_jobs SET payload='[]',state='ignored' WHERE id IN (SELECT id FROM wa_outbox WHERE ticket_id=?)").run(ticket.id);
          db.prepare("UPDATE wa_inbox SET payload='{}' WHERE job_id IN (SELECT id FROM wa_outbox WHERE ticket_id=?)").run(ticket.id);
          db.prepare("UPDATE wa_outbox SET body='',state='cancelled',ticket_id=NULL WHERE ticket_id=?").run(ticket.id);
        }
      }
      if (table === "clients") {
        db.prepare("DELETE FROM appointments WHERE client_id=?").run(id);
        db.prepare("DELETE FROM neonatal_care WHERE client_id=?").run(id);
        db.prepare("DELETE FROM tickets WHERE client_id=?").run(id);
      }
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      return res.status(409).json({ error: "Não foi possível excluir o registro vinculado." });
    }
    onChange();
    res.json({ deleted: true });
  });
}
