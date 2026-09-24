const appointmentStatuses = ['aguardando','confirmado','em_preparo','concluido','cancelado'];
const services = ['servico','reuniao','visita','reserva','procedimento','avaliacao','consulta','cirurgia','retorno','vacina','banho_tosa','exame'];
const careStatuses = ['estavel','observacao','alta'];

function validDate(value, required = true) {
  if (!value && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '') || Number.isNaN(Date.parse(`${value}Z`)) || new Date(`${value}Z`).toISOString().slice(0, 16) !== value)
    throw new Error('Informe uma data e um horário válidos.');
  return value;
}

export async function createPostgresClinicStore(db, env = process.env) {
  await db.query(`insert into clinic_settings(id,name,unit,address) values (1,$1,$2,$3) on conflict(id) do nothing`,
    [env.PETSHOP_NAME || 'Centro Veterinário dos Açores', 'Clínica Matriz', 'R. Raul Cabral de Menezes, 467 - Centro, Viamão - RS, 94415-610']);

  const requireClient = async (id) => {
    if (!Number.isInteger(Number(id)) || !(await db.one('select id from clients where id=$1', [Number(id)])))
      throw new Error('Selecione um paciente cadastrado.');
  };
  const ensureSurgeryChecklist = async (clientId, client = null) => {
    client ||= await db.one('select id,phone,name,pet_name from clients where id=$1', [Number(clientId)]);
    if (!client) return;
    const ticket = await db.one(`select id from tickets where client_id=$1 and category='cirurgia' and status not in ('resolvido','cancelado') order by id desc limit 1`, [client.id]);
    if (!ticket) await db.query(`insert into tickets(client_id,phone,subject,category,status,priority,human_required,source,created_at,updated_at)
      values($1,$2,$3,'cirurgia','novo','alta',true,'painel',$4,$4)`,
      [client.id, client.phone, `Checklist de cirurgia${client.pet_name ? ` - ${client.pet_name}` : ''}`, new Date().toISOString()]);
  };
  return {
    postgres: true,
    async snapshot() {
      const [appointments, checklist, neonatal, settings] = await Promise.all([
        db.many(`select a.*,c.name as client_name,c.pet_name,c.species from appointments a join clients c on c.id=a.client_id order by a.scheduled_at`),
        db.many('select * from checklist_items'),
        db.many(`select n.*,c.name as client_name,c.pet_name,c.species,c.pet_age from neonatal_care n join clients c on c.id=n.client_id order by n.updated_at desc`),
        db.one('select * from clinic_settings where id=1'),
      ]);
      return { appointments, checklist, neonatal, settings };
    },
    async saveAppointment(input, id) {
      const current = id ? await db.one('select * from appointments where id=$1', [id]) : {};
      if (!current) return null;
      const value = { ...current, ...input };
      await requireClient(value.client_id);
      if (!services.includes(value.service)) throw new Error('Serviço inválido.');
      if (!appointmentStatuses.includes(value.status || 'aguardando')) throw new Error('Status inválido.');
      const fields = [Number(value.client_id), value.service, validDate(value.scheduled_at), String(value.professional || '').trim(), value.status || 'aguardando', String(value.notes || '').trim()];
      if (id) await db.query('update appointments set client_id=$1,service=$2,scheduled_at=$3,professional=$4,status=$5,notes=$6 where id=$7', [...fields, id]);
      else { const row = await db.one(`insert into appointments(client_id,service,scheduled_at,professional,status,notes,created_at) values($1,$2,$3,$4,$5,$6,$7) returning id`, [...fields, new Date().toISOString()]); id = row.id; }
      if (value.service === 'cirurgia') await ensureSurgeryChecklist(value.client_id);
      return db.one('select * from appointments where id=$1', [id]);
    },
    async setChecklist(ticketId, input) {
      const keys = ['tutor','dados','exames','avaliacao','autorizacao','retorno'];
      if (!keys.includes(input.key) || typeof input.checked !== 'boolean') throw new Error('Item inválido.');
      if (!(await db.one("select id from tickets where id=$1 and category='cirurgia'", [ticketId]))) return null;
      return db.one(`insert into checklist_items(ticket_id,item_key,checked,updated_at) values($1,$2,$3,$4)
        on conflict(ticket_id,item_key) do update set checked=excluded.checked,updated_at=excluded.updated_at
        returning ticket_id,item_key,checked`, [ticketId, input.key, input.checked, new Date().toISOString()]);
    },
    async saveNeonatal(input, id) {
      const current = id ? await db.one('select * from neonatal_care where id=$1', [id]) : {};
      if (!current) return null;
      const value = { ...current, ...input }; await requireClient(value.client_id);
      if (!careStatuses.includes(value.status || 'observacao')) throw new Error('Status inválido.');
      const fields = [Number(value.client_id), value.status || 'observacao', String(value.notes || ''), validDate(value.next_check, false), new Date().toISOString()];
      if (id) await db.query('update neonatal_care set client_id=$1,status=$2,notes=$3,next_check=$4,updated_at=$5 where id=$6', [...fields, id]);
      else { if (await db.one('select id from neonatal_care where client_id=$1', [Number(value.client_id)])) throw new Error('Este paciente já possui um acompanhamento.'); id = (await db.one('insert into neonatal_care(client_id,status,notes,next_check,updated_at) values($1,$2,$3,$4,$5) returning id', fields)).id; }
      return db.one('select * from neonatal_care where id=$1', [id]);
    },
    async saveSettings(input) {
      const current = (await this.snapshot()).settings; const value = { ...current, ...input };
      if (!String(value.name).trim() || !String(value.unit).trim()) throw new Error('Informe o nome e a unidade.');
      await db.query('update clinic_settings set name=$1,unit=$2,phone=$3,address=$4 where id=1', [String(value.name).trim(), String(value.unit).trim(), String(value.phone || ''), String(value.address || '')]);
      return db.one('select * from clinic_settings where id=1');
    },
  };
}

export function registerPostgresClinicRoutes(app, clinic, onChange) {
  const handler = (action) => async (req, res) => {
    try {
      if (req.params.id && (!Number.isInteger(Number(req.params.id)) || Number(req.params.id) < 1)) return res.status(400).json({ error: 'Identificador inválido.' });
      const result = await action(req); if (!result) return res.status(404).json({ error: 'Registro não encontrado.' });
      await onChange?.(); res.json(result);
    } catch { res.status(400).json({ error: 'Não foi possível concluir a operação. Confira os dados.' }); }
  };
  app.post('/api/appointments', handler((req) => clinic.saveAppointment(req.body)));
  app.patch('/api/appointments/:id', handler((req) => clinic.saveAppointment(req.body, Number(req.params.id))));
  app.patch('/api/checklist/:id', handler((req) => clinic.setChecklist(Number(req.params.id), req.body)));
  app.post('/api/neonatal', handler((req) => clinic.saveNeonatal(req.body)));
  app.patch('/api/neonatal/:id', handler((req) => clinic.saveNeonatal(req.body, Number(req.params.id))));
  app.patch('/api/settings', handler((req) => clinic.saveSettings(req.body)));
}
