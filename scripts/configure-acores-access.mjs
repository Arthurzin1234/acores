import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(process.env.DATA_DIR || path.join(root,'data'),'petbot.sqlite');
const email = z.string().email().max(254).parse(process.argv[2]).toLowerCase();
const username = z.string().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/).parse(process.argv[3]).toLowerCase();
if (!fs.existsSync(file)) throw new Error('Central existente nao encontrada. Nenhuma conta criada.');
const db = new DatabaseSync(file);
try {
  db.exec('PRAGMA busy_timeout=2000; BEGIN IMMEDIATE');
  const owner = db.prepare("SELECT * FROM auth_users WHERE role='administrador' AND active=1 ORDER BY id LIMIT 1").get();
  if (!owner) throw new Error('Administrador da central nao encontrado.');
  if (owner.email !== email || owner.username !== username) {
    db.prepare('UPDATE auth_users SET email=?,username=?,platform_admin=0 WHERE id=?').run(email,username,owner.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(owner.id);
    db.prepare('INSERT INTO security_audit(at,user_id,event,resource) VALUES (?,?,?,?)').run(new Date().toISOString(),owner.id,'login_identifier_updated','/auth/account');
  }
  db.exec('COMMIT');
  console.log('Login da central configurado. Hash da senha e dados preservados.');
} catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error;} finally {db.close();}
