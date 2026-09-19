import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import express from "express";
import { createDatabase, seedDatabase } from "../server/db.js";
import { createClinicStore, registerClinicRoutes } from "../server/clinic.js";

test("clinic workflows persist and preserve existing patients and tickets", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "acores-clinic-test-"),
  );
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  let store = createDatabase(directory);
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  seedDatabase(store);
  let clinic = createClinicStore(store.raw);
  const clients = store.listClients();
  const tickets = store.listTickets();
  const client = clients[0];
  const surgery = tickets.find((ticket) => ticket.category === "cirurgia");
  let changes = 0;
  const app = express();
  app.use(express.json());
  registerClinicRoutes(app, clinic, () => changes++);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(url, method, body) {
    const response = await fetch(origin + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  let appointment;
  try {
    await t.test(
      "appointments validate input and support cancellation",
      async () => {
        const created = await request("/api/appointments", "POST", {
          client_id: client.id,
          service: "cirurgia",
          scheduled_at: "2026-09-15T10:30",
          professional: "Camila Teste",
        });
        assert.equal(created.status, 200);
        appointment = created.data;
        const cancelled = await request(
          `/api/appointments/${appointment.id}`,
          "PATCH",
          { status: "cancelado" },
        );
        assert.equal(cancelled.data.status, "cancelado");
        assert.equal(cancelled.data.client_id, client.id);
        for (const scheduled_at of ["invalid", "2026-02-30T10:30"]) {
          assert.equal(
            (
              await request("/api/appointments", "POST", {
                client_id: client.id,
                service: "consulta",
                scheduled_at,
              })
            ).status,
            400,
          );
        }
        assert.equal(
          (
            await request("/api/appointments", "POST", {
              client_id: 99999,
              service: "consulta",
              scheduled_at: "2026-09-15T10:30",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("/api/appointments/0", "PATCH", {
              status: "confirmado",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("/api/appointments/99999", "PATCH", {
              status: "confirmado",
            })
          ).status,
          404,
        );
      },
    );
    await t.test(
      "checklist edits are isolated by surgery and validate item keys",
      async () => {
        assert.equal(
          (
            await request(`/api/checklist/${surgery.id}`, "PATCH", {
              key: "exames",
              checked: true,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(`/api/checklist/${surgery.id}`, "PATCH", {
              key: "unknown",
              checked: true,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(`/api/checklist/${surgery.id}`, "PATCH", {
              key: "exames",
              checked: false,
            })
          ).status,
          200,
        );
        assert.equal(clinic.snapshot().checklist.length, 1);
        assert.equal(clinic.snapshot().checklist[0].checked, 0);
      },
    );
    await t.test(
      "neonatal care can be updated without duplicate patient records",
      async () => {
        const created = await request("/api/neonatal", "POST", {
          client_id: client.id,
          notes: "Registro da equipe",
          next_check: "2026-09-16T09:00",
        });
        assert.equal(created.status, 200);
        assert.equal(
          (await request("/api/neonatal", "POST", { client_id: client.id }))
            .status,
          400,
        );
        const updated = await request(
          `/api/neonatal/${created.data.id}`,
          "PATCH",
          { status: "alta" },
        );
        assert.equal(updated.data.status, "alta");
        assert.equal(updated.data.notes, "Registro da equipe");
      },
    );
    await t.test(
      "clinic settings and all operational data survive reopening",
      async () => {
        assert.equal(
          (
            await request("/api/settings", "PATCH", {
              unit: "Unidade de teste",
            })
          ).status,
          200,
        );
        assert.equal(store.listClients().length, clients.length);
        assert.equal(store.listTickets().length, tickets.length);
        assert.ok(changes >= 7);
        store.raw.close();
        process.env.DATA_DIR = directory;
        store = createDatabase(directory);
        if (previousDataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = previousDataDir;
        clinic = createClinicStore(store.raw);
        const snapshot = clinic.snapshot();
        assert.equal(snapshot.appointments.length, 1);
        assert.equal(snapshot.checklist.length, 1);
        assert.equal(snapshot.neonatal.length, 1);
        assert.equal(snapshot.staff, undefined);
        assert.equal(snapshot.settings.unit, "Unidade de teste");
        assert.equal(store.listClients().length, clients.length);
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.raw.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("acores-clinic-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
