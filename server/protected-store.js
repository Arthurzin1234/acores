import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { failure } from './reliability.js';

export function protectedCodec(directory, hasData = false) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(directory, 'storage.key');
  if (!fs.existsSync(keyPath)) {
    if (hasData) throw failure('credentials_storage');
    const fd = fs.openSync(keyPath, 'wx', 0o600);
    try { fs.writeFileSync(fd, randomBytes(32)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw failure('credentials_storage');
  return {
    check() { return fs.readFileSync(keyPath).equals(key); },
    encrypt(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt(value) {
      const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}

export class EmergencySpool {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.codec = protectedCodec(directory, fs.readdirSync(directory).some((f) => f.endsWith('.pending')));
  }
  files() { return fs.readdirSync(this.directory).filter((f) => /^[a-f0-9]{64}\.pending$/.test(f)); }
  put(account, message) {
    const id = createHash('sha256').update(`${account}:${message.key.id}`).digest('hex');
    const destination = path.join(this.directory, `${id}.pending`);
    if (fs.existsSync(destination)) return;
    const temporary = path.join(this.directory, `${id}.tmp`);
    const fd = fs.openSync(temporary, 'w', 0o600);
    try {
      fs.writeFileSync(fd, this.codec.encrypt(JSON.stringify({ account, message })));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, destination);
  }
  replay(save) {
    for (const file of this.files()) {
      const target = path.join(this.directory, file);
      const item = JSON.parse(this.codec.decrypt(fs.readFileSync(target)));
      save(item.account, item.message);
      fs.unlinkSync(target);
    }
  }
}
