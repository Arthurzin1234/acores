import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
test('encrypted backup restores into a new database; incorrect keys cannot restore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acores-backup-'));
  const env = { ...process.env, DATA_DIR: dir, BACKUP_DIR: path.join(dir,'backups'), BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  try {
    const db = new DatabaseSync(path.join(dir,'petbot.sqlite')); db.exec("CREATE TABLE records(body TEXT); INSERT INTO records VALUES ('private-fixture');"); db.close();
    assert.equal(spawnSync(process.execPath, ['scripts/backup.mjs'], { env }).status, 0);
    const source = path.join(env.BACKUP_DIR, fs.readdirSync(env.BACKUP_DIR)[0]);
    assert.equal(fs.readFileSync(source).includes(Buffer.from('private-fixture')), false);
    const output = path.join(dir,'restored.sqlite');
    assert.equal(spawnSync(process.execPath, ['scripts/restore-backup.mjs',source,output], { env }).status, 0);
    const restored = new DatabaseSync(output); assert.equal(restored.prepare('SELECT body FROM records').get().body, 'private-fixture'); restored.close();
    assert.notEqual(spawnSync(process.execPath, ['scripts/restore-backup.mjs',source,path.join(dir,'bad.sqlite')], { env: { ...env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64') } }).status, 0);
    assert.equal(fs.existsSync(path.join(dir,'bad.sqlite')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
