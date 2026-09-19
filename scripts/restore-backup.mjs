import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Informe arquivo .enc e um novo arquivo .sqlite de destino.');
const output = path.resolve(target);
if (fs.existsSync(output)) throw new Error('O destino já existe. Restaure em um arquivo novo para não perder dados.');
const key = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY || '', 'base64');
if (key.length !== 32) throw new Error('Chave de backup inválida.');
const input = fs.readFileSync(path.resolve(source));
if (input.subarray(0,4).toString() !== 'ACR1') throw new Error('Formato de backup inválido.');
const decipher = createDecipheriv('aes-256-gcm', key, input.subarray(4,16));
decipher.setAuthTag(input.subarray(16,32));
const plain = Buffer.concat([decipher.update(input.subarray(32)), decipher.final()]);
fs.writeFileSync(output, plain, { flag: 'wx', mode: 0o600 });
const db = new DatabaseSync(output, { readOnly: true });
try { if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Integridade inválida.'); }
finally { db.close(); }
console.log('Backup autenticado e integridade verificada. O banco ativo não foi alterado.');
