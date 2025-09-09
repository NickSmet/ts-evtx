import Database from 'better-sqlite3';
import type { MessageProvider } from '../types';
// Piggyback on ts-evtx logger so apps configure logging once
import { getLogger } from 'ts-evtx';

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
  private cache?: Map<string, string>;
  private cacheOrder?: string[];
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
    const max = options?.maxCacheEntries;
    if (max && max > 0) {
      this.cache = new Map();
      this.cacheOrder = [];
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
           WHERE provider_name = ? AND event_id = ? AND (language = ? OR ? IS NULL)
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
         WHERE provider_id = ? AND event_id = ? AND (language = ? OR ? IS NULL)
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
    if (this.cache && this.cache.has(cacheKey)) {
      const val = this.cache.get(cacheKey)!;
      // maintain LRU order
      const idx = this.cacheOrder!.indexOf(cacheKey);
      if (idx >= 0) this.cacheOrder!.splice(idx, 1);
      this.cacheOrder!.push(cacheKey);
      return val;
    }

    let val: string | null = null;
    if (this.schema.kind === 'single-table') {
      if (this.schema.hasLanguage) {
        const row = this.getStmtVelocidex!.get(provider, eventId, locale, locale, locale) as any;
        val = row?.msg ?? null;
      } else {
        const row = this.getStmtVelocidex!.get(provider, eventId) as any;
        val = row?.msg ?? null;
      }
    } else {
      const pidRow = this.getProviderIdStmt!.get(provider) as any;
      const pid = pidRow?.id;
      if (pid == null) return null;
      if (this.schema.hasLanguage) {
        const row = this.getMsgByIdWithLangStmt!.get(pid, eventId, locale, locale, locale) as any;
        val = row?.message ?? null;
      } else {
        const row = this.getMsgByIdStmt!.get(pid, eventId) as any;
        val = row?.message ?? null;
      }
    }

    if (val != null && this.cache) {
      this.cache.set(cacheKey, val);
      this.cacheOrder!.push(cacheKey);
      // Optional: control size if cacheOrder length is too big
      if (this.cacheOrder!.length > 50000) {
        const drop = this.cacheOrder!.splice(0, this.cacheOrder!.length - 50000);
        for (const k of drop) this.cache.delete(k);
      }
    }
    return val;
  }

  async getMessage(provider: string, eventId: number, locale?: string): Promise<string | null> {
    return this.getMessageSync(provider, eventId, locale);
  }

  async getMessageCandidates(provider: string, eventId: number, locale = 'en-US'): Promise<string[]> {
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
        const pidRow = this.getProviderIdStmt!.get(provider) as any;
        const pid = pidRow?.id; if (pid == null) return [];
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
