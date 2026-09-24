// Production uses same-origin Vercel rewrites so cookies remain first-party.
const API_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1' && window.location.port === '5173'
    ? 'http://127.0.0.1:3333'
    : '');
let csrf = '';
export const setCSRF = (value) => { csrf = value || ''; };
const fields = {
  clients: ['name','phone','email','pet_name','species','breed','pet_age','pet_weight','notes'],
  appointments: ['client_id','service','scheduled_at','professional','status','notes'],
  neonatal: ['client_id','status','notes','next_check'],
  settings: ['name','unit','phone','address'],
};
const clean = (entity, body) => Object.fromEntries(fields[entity].filter((key) => body[key] !== undefined).map((key) => [key, key === 'client_id' ? Number(body[key]) : body[key]]));

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(20000),
    credentials: API_URL ? 'include' : 'same-origin',
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new Error(data?.error || "Nao foi possivel concluir a acao.");
  }
  return data;
}

export const api = {
  users: () => request('/api/users'),
  saveUser: (data,id) => request(`/api/users${id ? `/${id}` : ''}`,{method:id ? 'PATCH' : 'POST',body:JSON.stringify(data)}),
  audit: () => request('/api/audit'),
  legal: () => request('/api/legal'),
  session: () => request('/api/auth/session'),
  login: (body) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  setup: (body) => request('/api/auth/setup', { method: 'POST', body: JSON.stringify(body) }),
  unlockFlow: (password) => request('/api/flow/unlock', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  changePassword: (body) => request('/api/auth/password', { method: 'POST', body: JSON.stringify(body) }),
  whatsappStatus: () => request('/api/whatsapp/status'),
  checkOperations: () => request('/api/operations/check', { method: 'POST' }),
  relinkWhatsApp: () => request('/api/whatsapp/relink', { method: 'POST', body: JSON.stringify({ confirmed: true }) }),
  reviewDelivery: (id, resolution) => request(`/api/operations/review/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ confirmed: true, resolution }) }),
  deleteRecord: (entity, id) => request(`/api/${entity}/${id}`, {
    method: "DELETE", body: JSON.stringify({ confirmed: true }),
  }),
  dashboard: () => request("/api/dashboard"),
  ticketMessages: (id) => request(`/api/tickets/${id}/messages`),
  updateTicket: (id, body) =>
    request(`/api/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  sendTicketMessage: (id, body) =>
    request(`/api/tickets/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveClient: (body) =>
    request("/api/clients", { method: "POST", body: JSON.stringify(clean('clients', body)) }),
  updateClient: (id, body) =>
    request(`/api/clients/${id}`, {
      method: "PATCH",
      body: JSON.stringify(clean('clients', body)),
    }),
  saveAppointment: (body, id) =>
    request(`/api/appointments${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(clean('appointments', body)),
    }),
  setChecklist: (id, body) =>
    request(`/api/checklist/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  saveNeonatal: (body, id) =>
    request(`/api/neonatal${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(clean('neonatal', body)),
    }),
  saveSettings: (body) =>
    request("/api/settings", { method: "PATCH", body: JSON.stringify(clean('settings', body)) }),
  saveAISettings: (body) =>
    request("/api/ai/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  testAI: (provider) => request(`/api/ai/test/${provider}`, { method: "POST" }),
  syncWhatsApp: () => request("/api/whatsapp/sync", { method: "POST" }),
  simulateMessage: (body) =>
    request("/api/simulate-message", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  startWhatsApp: () => request("/api/whatsapp/start", { method: "POST" }),
  markNotificationsRead: () =>
    request("/api/notifications/read", { method: "POST" }),
};
