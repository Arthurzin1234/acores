import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { protectedCodec } from './protected-store.js';
import { failure } from './reliability.js';

export function openAuthStore(directory, { BufferJSON, initAuthCreds, proto }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'session.sqlite');
  const codec = protectedCodec(directory, fs.existsSync(file));
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS auth_values (generation INTEGER, name TEXT, value BLOB, PRIMARY KEY(generation,name));
    CREATE TABLE IF NOT EXISTS auth_meta (id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL);
    INSERT OR IGNORE INTO auth_meta VALUES (1,1);`);
  const generation = () => db.prepare('SELECT generation FROM auth_meta WHERE id=1').get().generation;
  const fixName = (name) => name.replace(/\//g, '__').replace(/:/g, '-');
  const write = (gen, name, value) => db.prepare('INSERT OR REPLACE INTO auth_values VALUES (?,?,?)')
    .run(gen, fixName(name), codec.encrypt(JSON.stringify(value, BufferJSON.replacer)));
  const read = (gen, name) => {
    const row = db.prepare('SELECT value FROM auth_values WHERE generation=? AND name=?').get(gen, fixName(name));
    return row ? JSON.parse(codec.decrypt(row.value), BufferJSON.reviver) : null;
  };
  if (!read(generation(), 'creds.json') && generation() === 1 && fs.existsSync(path.join(directory, 'creds.json'))) {
    // Import the complete legacy session atomically; never silently replace unreadable credentials.
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const name of fs.readdirSync(directory).filter((n) => n.endsWith('.json')))
        write(1, name, JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'), BufferJSON.reviver));
      db.exec('COMMIT');
    } catch { db.exec('ROLLBACK'); db.close(); throw failure('credentials_storage'); }
  }
  return {
    load() {
      const gen = generation();
      const saved = read(gen, 'creds.json');
      if (!saved && db.prepare('SELECT 1 FROM auth_values WHERE generation=? LIMIT 1').get(gen)) throw failure('credentials_storage');
      const creds = saved || initAuthCreds();
      if (!creds.noiseKey || !creds.signedIdentityKey) throw failure('credentials_storage');
      write(gen, 'creds.json', creds);
      return {
        state: { creds, keys: {
          async get(type, ids) {
            const values = {};
            for (const id of ids) {
              let value = read(gen, `${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              values[id] = value;
            }
            return values;
          },
          async set(data) {
            db.exec('BEGIN IMMEDIATE');
            try {
              for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries)) {
                const name = `${type}-${id}.json`;
                if (value != null) write(gen, name, value);
                else db.prepare('DELETE FROM auth_values WHERE generation=? AND name=?').run(gen, fixName(name));
              }
              db.exec('COMMIT');
            } catch (error) { db.exec('ROLLBACK'); throw error; }
          },
        } },
        saveCreds: async () => write(gen, 'creds.json', creds),
      };
    },
    newSession() {
      // Explicit administrative relinking starts another generation; old credentials are retained.
      db.prepare('UPDATE auth_meta SET generation=generation+1 WHERE id=1').run();
    },
    check() { db.prepare('SELECT 1').get(); return codec.check(); },
    close() { db.close(); },
  };
}
