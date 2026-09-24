import { z } from 'zod';
const text = (max) => z.string().trim().max(max);
const id = z.number().int().positive().safe();
const nullable = (max) => text(max).nullable().optional();
const client = z.object({
  name: text(120).min(1).optional(), phone: z.string().regex(/^[+()\d\s-]{8,25}$/).transform((v) => v.replace(/\D/g, '')).refine((v) => v.length >= 8 && v.length <= 15).optional(),
  email: z.union([z.literal(''), z.string().email().max(254), z.null()]).optional(),
  pet_name: nullable(100), species: nullable(80), breed: nullable(100), pet_age: nullable(80), pet_weight: nullable(80), notes: nullable(4000),
}).strict();
const ticket = z.object({ subject: text(200).min(1).optional(), category: z.enum(['geral','consulta','banho_tosa','cirurgia','urgencia']).optional(),
  status: z.enum(['novo','em_atendimento','aguardando_cliente','resolvido','cancelado']).optional(), priority: z.enum(['alta','normal','baixa']).optional(),
  assigned_to: nullable(100), ai_summary: nullable(4000), human_required: z.boolean().optional(), ai_paused: z.boolean().optional(),
}).strict();
const date = z.string().max(32).refine((v) => !Number.isNaN(Date.parse(v)));
const appointment = z.object({ client_id: id, service: z.enum(['consulta','cirurgia','retorno','vacina','banho_tosa','exame','servico','reuniao','visita','reserva','procedimento','avaliacao']),
  scheduled_at: date, professional: text(120), status: z.enum(['aguardando','confirmado','em_preparo','concluido','cancelado']), notes: text(4000) }).strict();
const neonatal = z.object({ client_id: id, status: z.enum(['estavel','observacao','alta']), notes: text(4000), next_check: z.union([date,z.literal('')]) }).strict();
const settings = z.object({ name: text(150).min(1).optional(), unit: text(120).min(1).optional(), phone: text(25).optional(), address: text(300).optional() }).strict();
const knowledge = z.object({ knowledge: z.array(z.object({ id: text(80).regex(/^[\w-]+$/), question: text(300).min(1), answer: text(2000).min(1) }).strict()).max(60), instructions: text(4000).optional() }).strict();
export function validateRequests(req, res, next) {
  const path = req.path;
  if (path === '/health') return next();
  if (req.query && Object.keys(req.query).some((k) => !['limit','offset'].includes(k))) return res.status(400).json({ error: 'Filtro inválido.' });
  for (const key of ['limit','offset']) if (req.query[key] !== undefined && !/^\d{1,6}$/.test(req.query[key])) return res.status(400).json({ error: 'Paginação inválida.' });
  req.page = { limit: Math.min(Number(req.query.limit) || 100, 200), offset: Math.min(Number(req.query.offset) || 0, 100000) };
  const numeric = path.match(/^\/(?:clients|tickets|appointments|checklist|neonatal|notifications|records|users)\/([^/]+)/);
  if (numeric && numeric[1] !== 'read' && !/^[1-9]\d{0,9}$/.test(numeric[1])) return res.status(400).json({ error: 'Identificador inválido.' });
  if (['GET','HEAD'].includes(req.method)) return next();
  if (req.headers['content-type'] && !req.is('application/json')) return res.status(415).json({ error: 'Use JSON.' });
  if (/^\/users(?:\/|$)/.test(path)) return next();
  let schema = z.object({}).strict();
  if (req.method === 'DELETE') schema = z.object({ confirmed: z.literal(true) }).strict();
  else if (/^\/clients(?:\/\d+)?$/.test(path)) schema = req.user.role === 'usuario' ? client.omit({ phone: true }) : req.method === 'POST' ? client.required({ phone: true, name: true }) : client;
  else if (/^\/tickets\/\d+\/messages$/.test(path)) schema = z.object({ body: text(6000).min(1), sendToWhatsApp: z.boolean().optional(), author: text(120).optional() }).strict();
  else if (/^\/tickets\/\d+$/.test(path)) schema = ticket;
  else if (/^\/appointments/.test(path)) schema = appointment;
  else if (/^\/neonatal/.test(path)) schema = neonatal;
  else if (/^\/checklist/.test(path)) schema = z.object({ key: text(80).regex(/^[\w-]+$/), checked: z.boolean() }).strict();
  else if (path === '/settings') schema = settings;
  else if (path === '/ai/settings') schema = knowledge;
  else if (path === '/whatsapp/relink') schema = z.object({ confirmed: z.literal(true) }).strict();
  else if (/^\/operations\/review\/[\w:-]{1,100}$/.test(path)) schema = z.object({ confirmed: z.literal(true), resolution: z.enum(['sent','cancelled']) }).strict();
  else if (path === '/simulate-message') schema = z.object({ phone: z.string().regex(/^\d{8,15}$/), name: text(120), text: text(6000).min(1) }).strict();
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Campos inválidos ou não permitidos.' });
  req.body = parsed.data;
  next();
}
