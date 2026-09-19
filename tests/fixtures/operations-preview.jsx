import React from 'react';
import { createRoot } from 'react-dom/client';
import { OperationsPage } from '../../src/OperationsPage.jsx';
import '../../src/styles.css';

const at = '2026-09-12T14:00:00Z';
const dashboard = { whatsapp: { connected: false, mode: 'intervention', attempts: 6, requiresNewQr: true,
  lastEvent: 'Sessão desconectada. Requer novo QR Code.', lastReconnectAt: at },
  operations: { checkedAt: at, database: true, memoryMB: 163, environment: { valid: true },
    ai: { available: false, provider: 'gemini' }, queue: { pending: 3, incoming: 2, outgoing: 1 },
    lastError: { message: 'Envio sem confirmação. Confira a conversa antes de reenviar.', at },
    alerts: [{ code: 'logged_out', message: 'Sessão desconectada. Requer novo QR Code.', classification: 'intervention', last_at: at }],
    reviews: [{ id: 'fixture', ticket_id: 123, created_at: at }] } };
createRoot(document.getElementById('root')).render(<main className="page-content" style={{ margin: '0 auto', maxWidth: 1250 }}>
  <OperationsPage dashboard={dashboard} busy={false} run={async () => true} />
</main>);
