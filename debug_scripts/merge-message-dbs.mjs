#!/usr/bin/env node

// Merge multiple message catalog SQLite DBs into a single output DB.
// Usage:
//   node debug_scripts/merge-message-dbs.mjs out.db input1.db input2.db [...]
//
// The script:
// - Accepts both two-table (providers+messages) and single-table schemas.
// - Normalizes into a two-table schema in the output.
// - Deduplicates rows by (provider_name, event_id, language, message) and stores the first occurrence.
// - Optionally computes args_count (max placeholder index) for quick selection in clients.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('Usage: node debug_scripts/merge-message-dbs.mjs out.db input1.db [input2.db ...]');
  process.exit(1);
}

const [outPath, ...inputs] = process.argv.slice(2);
if (!outPath || inputs.length === 0) usage();

// Create/clear output DB
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
const out = new Database(outPath);
out.pragma('journal_mode = WAL');

out.exec(`
CREATE TABLE providers(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE,
  guid TEXT
);
CREATE TABLE messages(
  id INTEGER PRIMARY KEY,
  provider_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  language TEXT NULL,
  qualifiers INTEGER NULL,
  version INTEGER NULL,
  opcode INTEGER NULL,
  task INTEGER NULL,
  channel TEXT NULL,
  message_id INTEGER NULL,
  args_count INTEGER NULL,
  build_min INTEGER NULL,
  build_max INTEGER NULL,
  FOREIGN KEY(provider_id) REFERENCES providers(id)
);
CREATE INDEX idx_messages_pid_eid ON messages(provider_id, event_id);
`);

const selProv = out.prepare('SELECT id FROM providers WHERE name = ?');
const insProv = out.prepare('INSERT INTO providers(name, guid) VALUES(?, ?)');
const insMsg = out.prepare(`INSERT INTO messages(
  provider_id, event_id, message, language, qualifiers, version, opcode, task, channel, message_id, args_count, build_min, build_max
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const seen = new Set(); // key: provider|eventId|language|message

function maxPlaceholderCount(msg) {
  if (!msg) return 0;
  let max = 0; const re = /%(\d+)/g; let m;
  while ((m = re.exec(msg)) !== null) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  return max;
}

function normalizeProvider(db, row) {
  // Return { provider: 'name', guid?: string }
  if ('provider_name' in row) return { provider: row.provider_name, guid: null };
  if ('provider' in row) return { provider: row.provider, guid: null };
  if ('name' in row) return { provider: row.name, guid: row.guid || null };
  return { provider: String(row.provider || row.provider_id || 'unknown'), guid: null };
}

function detectSchema(db) {
  const msgCols = new Set(db.prepare(`PRAGMA table_info(messages)`).all().map(r => r.name));
  const provCols = new Set(db.prepare(`PRAGMA table_info(providers)`).all().map(r => r.name));
  const hasLanguage = msgCols.has('language');
  if (provCols.has('id') && provCols.has('name') && msgCols.has('provider_id') && (msgCols.has('message') || msgCols.has('message_string'))) {
    return { kind: 'two-table', hasLanguage, hasMsgString: msgCols.has('message_string'), hasProvGuid: provCols.has('guid') };
  }
  if (msgCols.has('provider_name') && (msgCols.has('message_string') || msgCols.has('message'))) {
    return { kind: 'single-table', hasLanguage, hasMsgString: msgCols.has('message_string') };
  }
  throw new Error('Unrecognized schema in input DB');
}

function* iterateRows(db, schema) {
  if (schema.kind === 'single-table') {
    const msgCol = schema.hasMsgString ? 'message_string' : 'message';
    const iter = db.prepare(`SELECT provider_name, event_id, ${msgCol} as message, ${schema.hasLanguage ? 'language' : 'NULL as language'} FROM messages`).iterate();
    for (const row of iter) yield row;
  } else {
    // Join providers+messages; pass through language if present
    const msgCol = schema.hasMsgString ? 'message_string' : 'message';
    const provGuidCol = schema.hasProvGuid ? 'p.guid' : 'NULL';
    const iter = db.prepare(`
      SELECT p.name as provider_name, ${provGuidCol} as provider_guid, m.event_id as event_id, m.${msgCol} as message,
             ${schema.hasLanguage ? 'm.language' : 'NULL'} as language
      FROM messages m JOIN providers p ON m.provider_id = p.id
    `).iterate();
    for (const row of iter) yield row;
  }
}

for (const inPath of inputs) {
  if (!fs.existsSync(inPath)) { console.error(`Missing input DB: ${inPath}`); continue; }
  const db = new Database(inPath, { readonly: true, fileMustExist: true });
  const schema = detectSchema(db);
  const tx = out.transaction(() => {
    for (const row of iterateRows(db, schema)) {
      const provider = row.provider_name || row.provider || null;
      const eventId = Number(row.event_id);
      const message = row.message || '';
      const language = row.language || null;
      if (!provider || !eventId || !message) continue;
      const key = `${provider}|${eventId}|${language || ''}|${message}`;
      if (seen.has(key)) continue;
      // upsert provider
      let provRow = selProv.get(provider);
      if (!provRow) {
        insProv.run(provider, row.provider_guid || null);
        provRow = selProv.get(provider);
      }
      const pid = provRow.id;
      const argsCount = maxPlaceholderCount(message);
      insMsg.run(pid, eventId, message, language, null, null, null, null, null, null, argsCount, null, null);
      seen.add(key);
    }
  });
  tx();
  db.close();
  console.log(`[merge] merged: ${path.basename(inPath)}`);
}

console.log(`[merge] output written: ${outPath}`);
out.close();
