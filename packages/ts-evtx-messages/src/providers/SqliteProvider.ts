import Database from 'better-sqlite3';
import type { MessageProvider } from '../types';
// Piggyback on @ts-evtx/core logger so apps configure logging once
import { getLogger } from '@ts-evtx/core';

type SchemaMode =
  | { kind: 'single-table'; hasLanguage: boolean } // messages(provider_name, event_id, message_string[, language])
  | { kind: 'two-table'; hasLanguage: boolean };    // providers(id,name), messages(provider_id, event_id, message[, language])

export class SqliteMessageProvider implements MessageProvider {
  private db: any;
  private schema!: SchemaMode;
  private getStmtVelocidex?: any;
  private getProviderIdStmt?: any;
  private getMsgByIdStmt?: any;
  private getMsgByIdWithLangStmt?: any;
  private getAllByProviderNameStmt?: any;
  private getAllByProviderIdStmt?: any;
  // Bounded memo of lookups (including misses). Insertion-ordered Map => O(1) LRU.
  private memo?: Map<string, string | null>;
  private memoMax = 0;
  private candidateMemo = new Map<string, readonly string[]>();
  private providerIdMemo = new Map<string, number | null>();
  private preloadMap?: Map<string, string>; // key: provider|eventId|locale
  private info?: { entryCount: number; locales: Set<string> };
  private log = getLogger('messages:SqliteProvider');

  constructor(dbPath: string, options?: { readonly?: boolean; maxCacheEntries?: number; preload?: boolean }) {
    const fileMustExist = dbPath !== ':memory:'; // allow in-memory for tests
    this.db = new Database(dbPath, {
      readonly: options?.readonly ?? true,
      fileMustExist,
    });
    this.detectSchema();
    this.prepareStatements();
    this.log.debug(`SQLite messages DB opened at ${dbPath} (readonly=${options?.readonly ?? true})`);
    // Default-on memo: a log has few distinct (provider, eventId) pairs but many records.
    const max = options?.maxCacheEntries ?? 10_000;
    if (max > 0) {
      this.memo = new Map();
      this.memoMax = max;
    }
    if (options?.preload) {
      this.preload();
    }
  }

  private detectSchema() {
    // Inspect columns
    const msgCols = new Set<string>(this.db.prepare(`PRAGMA table_info(messages)`).all().map((r: any) => r.name));
    const provCols = new Set<string>(this.db.prepare(`PRAGMA table_info(providers)`).all().map((r: any) => r.name));
    const hasLanguage = msgCols.has('language');

    // Two-table schema (Velocidex-style): providers + messages
    if (provCols.has('id') && provCols.has('name') && msgCols.has('provider_id') && (msgCols.has('message') || msgCols.has('message_string'))) {
      this.schema = { kind: 'two-table', hasLanguage };
      this.log.debug(`Detected two-table schema (hasLanguage=${hasLanguage})`);
      return;
    }
    // Single-table schema: messages has provider_name + message_string/message
    if (msgCols.has('provider_name') && (msgCols.has('message_string') || msgCols.has('message'))) {
      this.schema = { kind: 'single-table', hasLanguage };
      this.log.debug(`Detected single-table schema (hasLanguage=${hasLanguage})`);
      return;
    }
    throw new Error('Unrecognized messages DB schema');
  }

  private prepareStatements() {
    if (this.schema.kind === 'single-table') {
      const selectCol = this.hasMessageStringColumn() ? 'message_string' : 'message';
      if (this.schema.hasLanguage) {
        this.getStmtVelocidex = this.db.prepare(
          `SELECT ${selectCol} as msg FROM messages
           WHERE provider_name = ? AND event_id = ? AND (language = ? OR language IS NULL)
           ORDER BY CASE WHEN language = ? THEN 0 ELSE 1 END LIMIT 1`
        );
        this.getAllByProviderNameStmt = this.db.prepare(
          `SELECT ${selectCol} as msg, language FROM messages
           WHERE provider_name = ? AND event_id = ?
           ORDER BY CASE WHEN language = ? THEN 0 ELSE 1 END`
        );
      } else {
        this.getStmtVelocidex = this.db.prepare(
          `SELECT ${selectCol} as msg FROM messages
           WHERE provider_name = ? AND event_id = ?
           LIMIT 1`
        );
        this.getAllByProviderNameStmt = this.db.prepare(
          `SELECT ${selectCol} as msg FROM messages
           WHERE provider_name = ? AND event_id = ?`
        );
      }
      return;
    }
    // two-table schema
    this.getProviderIdStmt = this.db.prepare(`SELECT id FROM providers WHERE name = ? LIMIT 1`);
    if (this.schema.hasLanguage) {
      this.getMsgByIdWithLangStmt = this.db.prepare(
        `SELECT message FROM messages
         WHERE provider_id = ? AND event_id = ? AND (language = ? OR language IS NULL)
         ORDER BY CASE WHEN language = ? THEN 0 ELSE 1 END LIMIT 1`
      );
      this.getAllByProviderIdStmt = this.db.prepare(
        `SELECT message, language FROM messages
         WHERE provider_id = ? AND event_id = ?
         ORDER BY CASE WHEN language = ? THEN 0 ELSE 1 END`
      );
    } else {
      const selectCol = this.hasMessageStringColumn() ? 'message_string' : 'message';
      this.getMsgByIdStmt = this.db.prepare(
        `SELECT ${selectCol} as message FROM messages WHERE provider_id = ? AND event_id = ? LIMIT 1`
      );
      this.getAllByProviderIdStmt = this.db.prepare(
        `SELECT ${selectCol} as message FROM messages WHERE provider_id = ? AND event_id = ?`
      );
    }
  }

  private hasMessageStringColumn(): boolean {
    try {
      const cols = new Set<string>(this.db.prepare(`PRAGMA table_info(messages)`).all().map((r: any) => r.name));
      return cols.has('message_string');
    } catch {
      return false;
    }
  }

  private preload(): void {
    this.preloadMap = new Map();
    this.info = { entryCount: 0, locales: new Set() };
    let iter: Iterable<any>;
    if (this.schema.kind === 'single-table') {
      const hasLang = this.schema.hasLanguage;
      const langCol = hasLang ? 'language' : 'NULL';
      const msgCol = this.hasMessageStringColumn() ? 'message_string' : 'message';
      iter = this.db
        .prepare(`SELECT provider_name as provider, event_id as eventId, ${langCol} as locale, ${msgCol} as msg FROM messages`)
        .iterate() as any;
    } else {
      const hasLang = this.schema.hasLanguage;
      const langCol = hasLang ? 'language' : 'NULL';
      const msgCol = this.hasMessageStringColumn() ? 'message_string' : 'message';
      iter = this.db
        .prepare(
          `SELECT p.name as provider, m.event_id as eventId, ${langCol} as locale, m.${msgCol} as msg
           FROM messages m JOIN providers p ON m.provider_id = p.id`
        )
        .iterate() as any;
    }
    let count = 0;
    for (const row of iter as any) {
      const key = `${row.provider}|${row.eventId}|${row.locale || ''}`;
      if (!this.preloadMap!.has(key)) {
        this.preloadMap!.set(key, row.msg);
        count++;
      }
      if (row.locale) this.info!.locales.add(row.locale);
    }
    this.info.entryCount = count;
    this.log.debug(`Preloaded ${count} message entries (${this.info.locales.size} locales)`);
  }

  getMessageSync(provider: string, eventId: number, locale = 'en-US'): string | null {
    const cacheKey = `${provider}|${eventId}|${locale || ''}`;
    if (this.preloadMap) {
      return this.preloadMap.get(cacheKey) ?? this.preloadMap.get(`${provider}|${eventId}|`) ?? null;
    }
    if (this.memo) {
      const hit = this.memo.get(cacheKey);
      if (hit !== undefined) {
        // refresh recency (O(1) with an insertion-ordered Map)
        this.memo.delete(cacheKey);
        this.memo.set(cacheKey, hit);
        return hit;
      }
    }

    let val: string | null = null;
    if (this.schema.kind === 'single-table') {
      if (this.schema.hasLanguage) {
        const row = this.getStmtVelocidex!.get(provider, eventId, locale, locale) as any;
        val = row?.msg ?? null;
      } else {
        const row = this.getStmtVelocidex!.get(provider, eventId) as any;
        val = row?.msg ?? null;
      }
    } else {
      const pid = this.providerId(provider);
      if (pid == null) { this.remember(cacheKey, null); return null; }
      if (this.schema.hasLanguage) {
        const row = this.getMsgByIdWithLangStmt!.get(pid, eventId, locale, locale) as any;
        val = row?.message ?? null;
      } else {
        const row = this.getMsgByIdStmt!.get(pid, eventId) as any;
        val = row?.message ?? null;
      }
    }

    this.remember(cacheKey, val); // also caches misses (null)
    return val;
  }

  async getMessage(provider: string, eventId: number, locale?: string): Promise<string | null> {
    return this.getMessageSync(provider, eventId, locale);
  }

  private providerId(provider: string): number | null {
    const cached = this.providerIdMemo.get(provider);
    if (cached !== undefined) return cached;
    const row = this.getProviderIdStmt!.get(provider) as any;
    const id: number | null = row?.id ?? null;
    this.providerIdMemo.set(provider, id);
    return id;
  }

  private remember(key: string, val: string | null) {
    if (!this.memo) return;
    this.memo.set(key, val);
    if (this.memo.size > this.memoMax) this.memo.delete(this.memo.keys().next().value as string);
  }

  async getMessageCandidates(provider: string, eventId: number, locale = 'en-US'): Promise<string[]> {
    const key = `${provider}|${eventId}|${locale}`;
    const hit = this.candidateMemo.get(key);
    if (hit) return hit as string[]; // shared (frozen) array; also shares the string instances across events
    const rows = this.queryCandidates(provider, eventId, locale);
    Object.freeze(rows);
    this.candidateMemo.set(key, rows);
    if (this.candidateMemo.size > Math.max(this.memoMax, 1000)) this.candidateMemo.delete(this.candidateMemo.keys().next().value as string);
    return rows;
  }

  private queryCandidates(provider: string, eventId: number, locale: string): string[] {
    try {
      if (this.schema.kind === 'single-table') {
        if (this.schema.hasLanguage) {
          const rows = this.getAllByProviderNameStmt!.all(provider, eventId, locale) as Array<{ msg: string, language?: string }>;
          return rows.map(r => r.msg).filter(Boolean);
        } else {
          const rows = this.getAllByProviderNameStmt!.all(provider, eventId) as Array<{ msg: string }>;
          return rows.map(r => r.msg).filter(Boolean);
        }
      } else {
        const pid = this.providerId(provider); if (pid == null) return [];
        if (this.schema.hasLanguage) {
          const rows = this.getAllByProviderIdStmt!.all(pid, eventId, locale) as Array<{ message: string, language?: string }>;
          return rows.map(r => (r as any).message).filter(Boolean);
        } else {
          const rows = this.getAllByProviderIdStmt!.all(pid, eventId) as Array<{ message: string }>;
          return rows.map(r => (r as any).message).filter(Boolean);
        }
      }
    } catch {
      return [];
    }
  }

  // Optional batch capability
  async getMessages(requests: Array<{ provider: string; eventId: number; locale?: string }>): Promise<Array<string | null>> {
    return requests.map(r => this.getMessageSync(r.provider, r.eventId, r.locale));
  }

  // Optional info capability
  getInfo() {
    const entryCount = this.info?.entryCount;
    const supportedLocales = this.info ? Array.from(this.info.locales) : undefined;
    return {
      source: this.schema.kind === 'two-table' ? 'velocidex' : 'custom',
      locale: 'en-US',
      supportedLocales,
      entryCount,
    };
  }

  close(): void {
    this.db.close();
  }
}
