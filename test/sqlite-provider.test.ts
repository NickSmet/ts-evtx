/// <reference path="../packages/ts-evtx-messages/src/shims.d.ts" />
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SqliteMessageProvider } from '../packages/ts-evtx-messages/src/providers/SqliteProvider';

// The provider borrows its logger from @ts-evtx/core, which is an ESM build jest cannot load.
jest.mock('@ts-evtx/core', () => ({
  getLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));

type Row = { provider: string; eventId: number; message: string; language?: string | null };

const tmpFiles: string[] = [];
function tmpDb(): string {
  const file = path.join(os.tmpdir(), `evtx-msgs-${process.pid}-${tmpFiles.length}-${Date.now()}.db`);
  tmpFiles.push(file);
  return file;
}

/** providers(id, name) + messages(provider_id, event_id, message, language), like the shipped catalog. */
function twoTableDb(rows: Row[]): string {
  const file = tmpDb();
  const db = new Database(file);
  db.exec(`CREATE TABLE providers (id INTEGER PRIMARY KEY, name TEXT);
           CREATE TABLE messages (provider_id INTEGER, event_id INTEGER, message TEXT, language TEXT);`);
  const ids = new Map<string, number>();
  for (const r of rows) {
    if (!ids.has(r.provider)) {
      ids.set(r.provider, ids.size + 1);
      db.prepare('INSERT INTO providers (id, name) VALUES (?, ?)').run(ids.get(r.provider), r.provider);
    }
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(ids.get(r.provider), r.eventId, r.message, r.language ?? null);
  }
  db.close();
  return file;
}

/** messages(provider_name, event_id, message_string, language) */
function singleTableDb(rows: Row[]): string {
  const file = tmpDb();
  const db = new Database(file);
  db.exec(`CREATE TABLE messages (provider_name TEXT, event_id INTEGER, message_string TEXT, language TEXT);`);
  for (const r of rows) db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?)').run(r.provider, r.eventId, r.message, r.language ?? null);
  db.close();
  return file;
}

afterAll(() => { for (const f of tmpFiles) fs.rmSync(f, { force: true }); });

const schemas: Array<[string, (rows: Row[]) => string]> = [
  ['two-table', twoTableDb],
  ['single-table', singleTableDb],
];

describe.each(schemas)('SqliteMessageProvider (%s schema)', (_name, makeDb) => {
  describe('lookup', () => {
    it('finds the message', async () => {
      const p = new SqliteMessageProvider(makeDb([{ provider: 'Prov', eventId: 7, message: 'seven', language: 'en-US' }]));
      expect(await p.getMessage('Prov', 7)).toBe('seven');
      expect(await p.getMessage('Prov', 8)).toBeNull();
      expect(await p.getMessage('Other', 7)).toBeNull();
    });

    it('returns the same answer from the memo, including for misses', async () => {
      const p = new SqliteMessageProvider(makeDb([{ provider: 'Prov', eventId: 7, message: 'seven', language: 'en-US' }]));
      for (let i = 0; i < 3; i++) {
        expect(await p.getMessage('Prov', 7)).toBe('seven');
        expect(await p.getMessage('Prov', 99)).toBeNull();
        expect(await p.getMessage('Nope', 7)).toBeNull();
      }
    });

    it('stays correct when the memo is smaller than the working set', async () => {
      const rows = Array.from({ length: 20 }, (_, i): Row => ({ provider: 'Prov', eventId: i, message: `m${i}`, language: 'en-US' }));
      const p = new SqliteMessageProvider(makeDb(rows), { maxCacheEntries: 3 });
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 20; i++) expect(await p.getMessage('Prov', i)).toBe(`m${i}`);
      }
    });
  });

  describe('candidates', () => {
    const rows: Row[] = [
      { provider: 'Prov', eventId: 1, message: 'first', language: 'en-US' },
      { provider: 'Prov', eventId: 1, message: 'second', language: 'en-US' },
    ];

    it('returns every message for the event', async () => {
      const p = new SqliteMessageProvider(makeDb(rows));
      expect([...(await p.getMessageCandidates('Prov', 1))].sort()).toEqual(['first', 'second']);
      expect(await p.getMessageCandidates('Prov', 2)).toEqual([]);
      expect(await p.getMessageCandidates('Nope', 1)).toEqual([]);
    });

    it('hands out a shared, read-only array so one caller cannot corrupt another', async () => {
      const p = new SqliteMessageProvider(makeDb(rows));
      const a = await p.getMessageCandidates('Prov', 1);
      const b = await p.getMessageCandidates('Prov', 1);
      expect(b).toBe(a);
      expect(Object.isFrozen(a)).toBe(true);
    });
  });
});
