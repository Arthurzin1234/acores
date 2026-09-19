import bcrypt from 'bcryptjs';
import { z } from 'zod';

const secret = z.string().min(12).refine((value) => Buffer.byteLength(value) <= 72);
export function createUserManager(db, { existingLogin = () => null, changed = () => {} } = {}) {
  const list = () => db.prepare('SELECT id,email,username,role,active,must_change_password FROM auth_users ORDER BY id LIMIT 500').all();
  const schema = z.object({email:z.string().email().max(254).transform((v) => v.toLowerCase()),
    username:z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/).transform((v) => v.toLowerCase()),
    role:z.enum(['administrador','atendente','tecnico']),password:secret}).strict();
  async function create(input) {
    const v = schema.parse(input);
    if (existingLogin(v.email) || existingLogin(v.username)) throw Object.assign(new Error('E-mail ou usuário já utilizado.'),{status:409});
    const result = db.prepare('INSERT INTO auth_users(email,username,role,password_hash,platform_admin,must_change_password) VALUES (?,?,?,?,0,1)')
      .run(v.email,v.username,v.role,await bcrypt.hash(v.password,12));
    return {id:Number(result.lastInsertRowid)};
  }
  async function update(id, input, actorId) {
    const v = z.object({active:z.boolean().optional(),role:schema.shape.role.optional(),password:secret.optional(),confirmed:z.literal(true)}).strict().parse(input);
    if (!db.prepare('SELECT 1 FROM auth_users WHERE id=?').get(id)) throw Object.assign(new Error('Usuário não encontrado.'),{status:404});
    const hash = v.password ? await bcrypt.hash(v.password,12) : null;
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT * FROM auth_users WHERE id=?').get(id);
      const losesAdmin = v.active === false || (v.role && v.role !== 'administrador');
      if (losesAdmin && (row.id === actorId || (row.role === 'administrador' && row.active && db.prepare("SELECT count(*) AS n FROM auth_users WHERE active=1 AND role='administrador'").get().n <= 1)))
        throw Object.assign(new Error('Mantenha ao menos um administrador ativo e não remova seu próprio acesso.'),{status:409});
      db.prepare('UPDATE auth_users SET active=?,role=?,password_hash=?,must_change_password=? WHERE id=?')
        .run(v.active === undefined ? row.active : Number(v.active),v.role || row.role,hash || row.password_hash,v.password ? 1 : row.must_change_password,id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(id); db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK'); throw e;}
    changed(); return {ok:true};
  }
  return {list,create,update};
}
export function registerUsers(app, manager, db) {
  const route = (handler) => async (req,res) => {
    try { await handler(req,res); } catch(e) { res.status(e instanceof z.ZodError ? 400 : e.status || (String(e.code).includes('CONSTRAINT') ? 409 : 500)).json({error:e.status ? e.message : 'Confira os dados e se o acesso já está cadastrado.'}); }
  };
  app.get('/api/users',route((_req,res) => res.json(manager.list())));
  app.post('/api/users',route(async(req,res) => res.status(201).json(await manager.create(req.body))));
  app.patch('/api/users/:id',route(async(req,res) => res.json(await manager.update(Number(req.params.id),req.body,req.user.id))));
  app.get('/api/audit',route((_req,res) => res.json(db.prepare('SELECT at,user_id,event,resource FROM security_audit ORDER BY id DESC LIMIT 200').all())));
}
