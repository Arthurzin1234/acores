import fs from 'node:fs';
import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const document = (file, title) => {
  const content = fs.readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8');
  return { title, content, version: hash(content), draft: false };
};
const terms = document('TERMS.md', 'Termos de Uso');
const privacy = document('PRIVACY.md', 'Política de Privacidade');
export const legalDocuments = {
  version: hash(`${terms.version}:${privacy.version}`), terms, privacy,
};

export function registerLegal(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_legal_versions (
    version TEXT PRIMARY KEY, terms_content TEXT NOT NULL, privacy_content TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_legal_acceptance (
    user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    version TEXT NOT NULL, terms_version TEXT NOT NULL, privacy_version TEXT NOT NULL,
    accepted_at TEXT NOT NULL, PRIMARY KEY(user_id, version)
  )`);
  db.prepare('INSERT OR IGNORE INTO auth_legal_versions VALUES (?,?,?)')
    .run(legalDocuments.version, terms.content, privacy.content);
  return (userId) => db.prepare(`INSERT OR IGNORE INTO auth_legal_acceptance
    (user_id,version,terms_version,privacy_version,accepted_at) VALUES (?,?,?,?,?)`)
    .run(userId, legalDocuments.version, legalDocuments.terms.version, legalDocuments.privacy.version, new Date().toISOString());
}
