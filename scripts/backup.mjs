import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || '', 'base64');
if (key.length !== 32) throw new Error('Configure BACKUP_ENCRYPTION_KEY com 32 bytes em base64, guardada fora do servidor.');
const directory = path.resolve(process.env.DATA_DIR || 'data');
const destination = path.resolve(process.env.BACKUP_DIR || path.join(directory, 'backups'));
fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
const name = `acores-${Date.now()}-${randomBytes(4).toString('hex')}`;
const temporary = path.join(destination, `${name}.sqlite`);
const db = new DatabaseSync(path.join(directory, 'petbot.sqlite'));
try {
  db.prepare('VACUUM INTO ?').run(temporary);
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(fs.readFileSync(temporary)), cipher.final()]);
  fs.writeFileSync(path.join(destination, `${name}.enc`), Buffer.concat([Buffer.from('ACR1'), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: 'wx' });
  console.log('Backup SQLite consistente e criptografado criado. Sessão do WhatsApp e chave legada da IA exigem cópia protegida separada.');
} finally { db.close(); fs.rmSync(temporary, { force: true }); }
