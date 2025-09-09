import fs from 'fs';
import { parseResolvedEvents, readResolvedEvents } from './api';
import type { ResolvedEvent } from './api';

type MessageMode = 'auto' | 'off' | object | string; // object is a MessageProvider; string is a DB path

export interface EvtxQueryOptions {
  includeXml?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: { filesDone: number; filesTotal: number; records: number }) => void;
}

export interface EvtxQuery {
  withMessages(mode?: MessageMode): EvtxQuery;
  between(since?: Date | string, until?: Date | string): EvtxQuery;
  last(n: number): EvtxQuery;
  where(pred: Record<string, unknown> | ((e: ResolvedEvent & { message?: string }) => boolean)): EvtxQuery;
  select(paths: string[]): EvtxQuery;

  toArray(): Promise<Array<ResolvedEvent & { message?: string }>>;
  forEach(fn: (e: ResolvedEvent & { message?: string }) => void | Promise<void>): Promise<void>;
  toJSONL(pathOrStream?: string | NodeJS.WritableStream): Promise<void>;
  toCSV(pathOrStream?: string | NodeJS.WritableStream, opts?: { header?: boolean }): Promise<void>;
  stats(): Promise<any>;
}

function toDate(d?: Date | string): Date | undefined {
  if (!d) return undefined;
  return typeof d === 'string' ? new Date(d) : d;
}

function deepPick(obj: any, paths: string[]): any {
  const out: any = {};
  for (const p of paths) {
    const parts = p.split('.');
    let cur = obj as any;
    for (const part of parts) {
      if (cur == null) break;
      cur = cur[part];
    }
    out[p] = cur;
  }
  return out;
}

function matchObject(e: ResolvedEvent, cond: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(cond)) {
    switch (k) {
      case 'provider': {
        const name = (e.provider?.name || e.provider?.guid || '');
        if (Array.isArray(v)) {
          if (!v.includes(name)) return false;
        } else if (typeof v === 'string') {
          if (name !== v) return false;
        }
        break;
      }
      case 'eventId': {
        if (Array.isArray(v)) {
          if (!v.includes(e.eventId)) return false;
        } else if (typeof v === 'number') {
          if (e.eventId !== v) return false;
        }
        break;
      }
      case 'level': {
        if (Array.isArray(v)) {
          const ok = v.some((x) =>
            (typeof x === 'number' && e.level === x) ||
            (typeof x === 'string' && (e.levelName === x || String(e.level) === x))
          );
          if (!ok) return false;
        } else if (typeof v === 'number') {
          if (e.level !== v) return false;
        } else if (typeof v === 'string') {
          if (!(e.levelName === v || String(e.level) === v)) return false;
        }
        break;
      }
      default: {
        const val = (e as any)[k];
        if (Array.isArray(v)) {
          if (!v.includes(val)) return false;
        } else if (v !== val) {
          return false;
        }
      }
    }
  }
  return true;
}

class EvtxQueryImpl implements EvtxQuery {
  private inputs: string[];
  private opts: EvtxQueryOptions;
  private since?: Date;
  private until?: Date;
  private takeLast?: number;
  private predicate?: (e: ResolvedEvent & { message?: string }) => boolean;
  private projection?: string[];
  private messageMode: MessageMode = 'off';

  constructor(source: string | string[], opts: EvtxQueryOptions = {}) {
    this.inputs = Array.isArray(source) ? source : [source];
    this.opts = opts;
  }

  withMessages(mode?: MessageMode): EvtxQuery { this.messageMode = (mode === undefined ? 'auto' : mode); return this; }
  between(since?: Date | string, until?: Date | string): EvtxQuery { this.since = toDate(since); this.until = toDate(until); return this; }
  last(n: number): EvtxQuery { this.takeLast = n; return this; }
  where(pred: Record<string, unknown> | ((e: ResolvedEvent & { message?: string }) => boolean)): EvtxQuery {
    if (typeof pred === 'function') this.predicate = pred;
    else this.predicate = (e) => matchObject(e, pred);
    return this;
  }
  select(paths: string[]): EvtxQuery { this.projection = paths.slice(); return this; }

  private async resolveProvider(): Promise<any | undefined> {
    if (this.messageMode === 'off') return undefined;
    // Provided instance
    if (this.messageMode && typeof this.messageMode === 'object' && typeof (this.messageMode as any).getMessage === 'function') {
      return this.messageMode;
    }
    // Provided path (string)
    if (typeof this.messageMode === 'string' && this.messageMode !== 'auto') {
      const dbPath = this.messageMode;
      try {
        const mod: any = await import('@ts-evtx/messages');
        // SqliteMessageProvider will throw if the DB cannot be opened
        return new mod.SmartManagedMessageProvider({ customDbPath: dbPath, preload: true });
      } catch (e: any) {
        throw new Error(`Failed to initialize message provider from path: ${dbPath}. ${e?.message || e}`);
      }
    }
    // Auto (implicit): use packaged universal DB
    try {
      const mod: any = await import('@ts-evtx/messages');
      return new mod.SmartManagedMessageProvider({ preload: true });
    } catch (e: any) {
      throw new Error(`Failed to initialize built-in message provider: ${e?.message || e}`);
    }
  }

  private applyFilters(events: Array<ResolvedEvent & { message?: string }>): Array<ResolvedEvent & { message?: string }> {
    let out = events;
    if (this.predicate) out = out.filter(this.predicate);
    if (this.takeLast && this.takeLast > 0) out = out.slice(-this.takeLast);
    if (this.projection) out = out.map(e => ({ ...e, _select: deepPick(e, this.projection!) } as any));
    return out;
  }

  private buildSimpleMessage(e: ResolvedEvent): string {
    const final = e.messageResolution?.final?.message;
    if (final && final.length) return final;
    const items = (e.data?.items || []).map((it, i) => `${i + 1}. "${it.value}"${it.name ? ` (${it.name})` : ''}`);
    const itemsBlock = items.length ? `Data Items:\n${items.join('\n')}` : 'Data Items: <none>';
    const sel = e.messageResolution?.selection;
    if (sel && sel.templateText) {
      return `[Template/data mismatch]\nTemplate: \`${sel.templateText}\`\n${itemsBlock}`;
    }
    return `[Template not found]\n${itemsBlock}`;
  }

  async toArray(): Promise<Array<ResolvedEvent & { message?: string }>> {
    const provider = await this.resolveProvider();
    const all: Array<ResolvedEvent & { message?: string }> = [];
    const total = this.inputs.length;
    let done = 0;
    for (const input of this.inputs) {
      const exists = typeof input === 'string' ? fs.existsSync(input) : true;
      if (!exists) continue;
      const evs = await parseResolvedEvents(input as string, {
        includeXml: this.opts.includeXml,
        includeDiagnostics: 'basic',
        includeDataItems: 'summary',
        messageProvider: provider,
        since: this.since,
        until: this.until,
        last: this.takeLast, // last per file; we will still slice again post-filter if needed
      } as any);
      if (this.messageMode !== 'off') {
        all.push(...evs.map(e => ({ ...e, message: this.buildSimpleMessage(e) })));
      } else {
        all.push(...(evs as any));
      }
      done++;
      this.opts.onProgress?.({ filesDone: done, filesTotal: total, records: evs.length });
    }
    return this.applyFilters(all);
  }

  async forEach(fn: (e: ResolvedEvent & { message?: string }) => void | Promise<void>): Promise<void> {
    const provider = await this.resolveProvider();
    for (const input of this.inputs) {
      const exists = typeof input === 'string' ? fs.existsSync(input) : true;
      if (!exists) continue;
      for await (const e of readResolvedEvents(input as string, {
        includeXml: this.opts.includeXml,
        includeDiagnostics: 'basic',
        includeDataItems: 'summary',
        messageProvider: provider,
        since: this.since,
        until: this.until,
      } as any)) {
        const withMsg = this.messageMode !== 'off' ? ({ ...e, message: this.buildSimpleMessage(e) }) : e;
        if (this.predicate && !this.predicate(withMsg as any)) continue;
        await fn(withMsg as any);
      }
    }
  }

  async toJSONL(pathOrStream?: string | NodeJS.WritableStream): Promise<void> {
    const out = typeof pathOrStream === 'string' ? fs.createWriteStream(pathOrStream) : (pathOrStream || process.stdout);
    const arr = await this.toArray();
    for (const e of arr) {
      (out as NodeJS.WritableStream).write(JSON.stringify(e) + '\n');
    }
    if (typeof (out as any).end === 'function' && out !== process.stdout) (out as any).end();
  }

  async toCSV(pathOrStream?: string | NodeJS.WritableStream, opts?: { header?: boolean }): Promise<void> {
    const out = typeof pathOrStream === 'string' ? fs.createWriteStream(pathOrStream) : (pathOrStream || process.stdout);
    const header = opts?.header !== false;
    const fields = ['timestamp', 'provider.name', 'eventId', 'levelName'];
    if (header) (out as NodeJS.WritableStream).write('Timestamp,Provider,EventID,Level,Message\n');
    const arr = await this.toArray();
    for (const e of arr) {
      const row = deepPick(e, fields);
      const providerName = e.provider?.name || '';
      const rawMsg = this.messageMode !== 'off' ? (e as any).message : (e as any).messageResolution?.final?.message;
      const msg = String(rawMsg || '').replace(/"/g, '""');
      (out as NodeJS.WritableStream).write(`"${e.timestamp}","${providerName}",${e.eventId ?? ''},${e.levelName ?? ''},"${msg}"\n`);
    }
    if (typeof (out as any).end === 'function' && out !== process.stdout) (out as any).end();
  }

  async stats(): Promise<any> {
    // Basic: return stats for the first input
    const { getStats } = await import('./api');
    const first = this.inputs[0];
    return getStats(first);
  }
}

export function evtx(source: string | string[], opts: EvtxQueryOptions = {}): EvtxQuery {
  return new EvtxQueryImpl(source, opts);
}
