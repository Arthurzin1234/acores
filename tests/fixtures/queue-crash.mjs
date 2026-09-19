import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WhatsAppQueue } from '../../server/whatsapp-queue.js';

const [directory, phase] = process.argv.slice(2);
const db = new DatabaseSync(path.join(directory, 'queue.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY);');
const queue = new WhatsAppQueue(db);
const account = '5511000000000@s.whatsapp.net', jid = '5511998887766@s.whatsapp.net';
const message = { key: { id: 'crash-input', remoteJid: jid }, message: { conversation: 'Mensagem de teste' }, messageTimestamp: 1 };
queue.receive(account, message);
if (phase !== 'received') {
  const id = queue.batch(account, [message]), job = queue.next(account);
  queue.begin(id);
  if (phase === 'transaction') {
    db.exec('BEGIN IMMEDIATE'); db.prepare('INSERT INTO effects VALUES (?)').run(id);
  } else {
    queue.commit(job, () => { db.prepare('INSERT INTO effects VALUES (?)').run(id); return { reply: 'Resposta de teste' }; });
    if (phase === 'sending') queue.markOutgoing(id, 'sending');
  }
}
process.send('ready');
setInterval(() => {}, 1000);
