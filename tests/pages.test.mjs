import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";

test("all ten pages render with populated and empty data, without Team", async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const pages = await vite.ssrLoadModule("/src/pages.jsx");
    const date = new Date().toISOString();
    const client = {
      id: 1,
      name: "Tutora de teste",
      phone: "5500000000000",
      pet_name: "Mel",
      species: "Cachorro",
      ticket_count: 1,
    };
    const ticket = {
      id: 1,
      client_id: 1,
      client_name: client.name,
      pet_name: "Mel",
      phone: client.phone,
      category: "cirurgia",
      subject: "Solicitação de cirurgia",
      status: "novo",
      human_required: true,
      created_at: date,
      updated_at: date,
    };
    const empty = {
      tickets: [],
      clients: [],
      notifications: [],
      appointments: [],
      neonatal: [],
      staff: [],
      checklist: [],
      whatsapp: { connected: false },
      settings: { name: "Centro Veterinário dos Açores", unit: "Matriz" },
      stats: { unreadNotifications: 0 },
    };
    const populated = {
      ...empty,
      clients: [client],
      tickets: [ticket],
      appointments: [
        {
          id: 1,
          client_id: 1,
          pet_name: "Mel",
          service: "consulta",
          scheduled_at: date,
          status: "confirmado",
        },
      ],
      notifications: [
        {
          id: 1,
          ticket_id: 1,
          title: "Cirurgia",
          body: "Solicitação recebida",
          created_at: date,
        },
      ],
      neonatal: [
        {
          id: 1,
          client_id: 1,
          pet_name: "Mel",
          status: "estavel",
          updated_at: date,
        },
      ],
      staff: [{ id: 1, name: "Recepção", role: "Recepção", active: 1 }],
    };
    const pageEntries = Object.entries(pages).filter(([name]) => name.endsWith("Page"));
    assert.equal(pageEntries.length, 10);
    const link = renderToString(React.createElement(pages.MessageText, { text: "Maps: https://www.google.com/maps/search/?api=1&query=Rua%20123" }));
    assert.match(link, /href="https:\/\/www.google.com\/maps\/search\//);
    assert.match(link, /Abrir no Google Maps/);
    assert.equal(pages.TeamPage, undefined);
    for (const [name, Page] of pageEntries) {
      for (const dashboard of [empty, populated]) {
        const html = renderToString(
          React.createElement(Page, {
            dashboard,
            busy: false,
            route: { page: name, params: new URLSearchParams() },
            run: async () => {},
            go: () => {},
            notify: () => {},
          }),
        );
        assert.match(html, /<h1[ >]/, `${name} must expose its own page title`);
        assert.doesNotMatch(html, /Chat da IA|Contato de teste|Chave da API|Testar conexão|Obter chave|Assistente ativo/);
        assert.ok(html.length > 100, `${name} must render a working surface`);
      }
    }
  } finally {
    await vite.close();
  }
});
