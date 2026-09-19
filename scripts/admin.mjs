import fs from 'node:fs';
import path from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { createInterface as questions } from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { createDatabase } from '../server/db.js';
import { createSecurity, roles } from '../server/security.js';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const root = process.cwd(), dir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const store = createDatabase(root, dir);
const command = process.argv[2] || 'create';
const secretInput = () => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY) return reject(new Error('Use um terminal interativo para informar a senha.'));
  let value = '';
  process.stdout.write('Senha (12+ caracteres, entrada oculta): ');
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  const done = () => { process.stdin.off('keypress', handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
  const handler = (s, key = {}) => {
    if (key.ctrl && key.name === 'c') { done(); reject(new Error('Cancelado.')); }
    else if (key.name === 'return') { done(); resolve(value); }
    else if (key.name === 'backspace') value = value.slice(0,-1);
    else if (s && !key.ctrl && !key.meta) value += s;
  };
  process.stdin.on('keypress', handler);
});
try {
  if (command === 'bootstrap') {
    createSecurity(store.raw, dir);
    if (store.raw.prepare('SELECT 1 FROM auth_users LIMIT 1').get()) throw new Error('Já existe conta. Use reset para recuperar acesso.');
    store.raw.prepare('DELETE FROM auth_bootstrap').run();
    fs.rmSync(path.join(dir, 'admin-setup.token'), { force: true });
    createSecurity(store.raw, dir);
    console.log('Novo código em data/admin-setup.token, válido por uma hora. O conteúdo não é registrado no terminal.');
  } else {
    const security = createSecurity(store.raw, dir);
    const prompt = questions({ input: process.stdin, output: process.stdout });
    const email = (await prompt.question('E-mail: ')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('E-mail inválido.');
    let role, clientId;
    if (command === 'create') {
      role = (await prompt.question(`Função (${roles.join(', ')}): `)).trim();
      if (!roles.includes(role)) throw new Error('Função inválida.');
      clientId = role === 'usuario' ? Number(await prompt.question('ID do cadastro do tutor verificado pela recepção: ')) : null;
      if (role === 'usuario' && !store.getClient(clientId)) throw new Error('Cadastro não encontrado.');
    }
    prompt.close();
    const existing = store.raw.prepare('SELECT * FROM auth_users WHERE email=?').get(email);
    if (command === 'disable') {
      if (!existing) throw new Error('Conta não encontrada.');
      if (existing.role === 'administrador' && store.raw.prepare("SELECT COUNT(*) AS n FROM auth_users WHERE role='administrador' AND active=1").get().n <= 1) throw new Error('Não desative o último administrador.');
      store.raw.prepare('UPDATE auth_users SET active=0 WHERE id=?').run(existing.id);
      store.raw.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(existing.id);
      security.audit(null, 'cli_disable', String(existing.id));
    } else if (['create','reset'].includes(command)) {
      if (command === 'create' && existing) throw new Error('Conta já existe.');
      if (command === 'reset' && !existing) throw new Error('Conta não encontrada.');
      const password = await secretInput();
      if (password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('Senha deve ter 12+ caracteres e até 72 bytes.');
      const hash = await bcrypt.hash(password, 12);
      if (existing) {
        store.raw.prepare('UPDATE auth_users SET password_hash=?,active=1 WHERE id=?').run(hash, existing.id);
        store.raw.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(existing.id);
      } else store.raw.prepare('INSERT INTO auth_users(email,password_hash,role,client_id) VALUES (?,?,?,?)').run(email,hash,role,clientId);
      store.raw.prepare('DELETE FROM auth_bootstrap').run(); fs.rmSync(path.join(dir, 'admin-setup.token'), { force: true });
      security.audit(null, `cli_${command}`);
    } else throw new Error('Comando inválido. Use create, reset, disable ou bootstrap.');
    console.log('Operação concluída. Nenhuma senha foi registrada em arquivo ou log.');
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { store.raw.close(); }
