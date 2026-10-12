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
  /**
   * Exports resolve once everything has been flushed. A stream is written in chunks of whole lines
   * and its backpressure is honoured, so it has to be consumed while the export runs.
   */
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

/**
 * Options for the packaged message provider. Versions of @ts-evtx/messages that predate
 * getMessageCandidates() only find the rows of the packaged catalog (language = NULL) once the
 * catalog is preloaded, so keep preloading for them; newer versions look rows up on demand.
 */
function smartProviderOptions(mod: any, options: Record<string, unknown>): Record<string, unknown> {
  const looksUpOnDemand = typeof mod.SmartManagedMessageProvider?.prototype?.getMessageCandidates === 'function';
  return looksUpOnDemand ? options : { ...options, preload: true };
}

/** Real streams report errors and backpressure through events; a bare `{ write, end }` object cannot. */
function hasStreamEvents(out: any): boolean {
  return typeof out.on === 'function' && typeof out.once === 'function' && typeof out.off === 'function';
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
        return new mod.SmartManagedMessageProvider(smartProviderOptions(mod, { customDbPath: dbPath }));
      } catch (e: any) {
        throw new Error(`Failed to initialize message provider from path: ${dbPath}. ${e?.message || e}`);
      }
    }
    // Auto (implicit): use packaged universal DB
    try {
      const mod: any = await import('@ts-evtx/messages');
      return new mod.SmartManagedMessageProvider(smartProviderOptions(mod, {}));
    } catch (e: any) {
      throw new Error(`Failed to initialize built-in message provider: ${e?.message || e}`);
    }
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

  /**
   * Stream events through the same pipeline the buffered API used:
   * messages -> predicate -> global last(n) -> projection.
   *
   * `forEach` historically honoured neither `last()` nor `select()`, so both are opt-in here
   * to keep its behaviour unchanged.
   */
  private async *iterate(opts: {
    last: boolean;
    project: boolean;
    onFile?: (count: number) => void;
  }): AsyncGenerator<ResolvedEvent & { message?: string }> {
    const provider = await this.resolveProvider();
    const last = opts.last && this.takeLast && this.takeLast > 0 ? this.takeLast : 0;
    const project = (e: ResolvedEvent & { message?: string }) =>
      (opts.project && this.projection ? ({ ...e, _select: deepPick(e, this.projection) } as any) : e);
    // last(n) applies across all inputs, so keep a bounded window (<= 2n events) instead of everything.
    const window: Array<ResolvedEvent & { message?: string }> = [];

    for (const input of this.inputs) {
      const exists = typeof input === 'string' ? fs.existsSync(input) : true;
      if (!exists) continue;
      let count = 0;
      for await (const e of readResolvedEvents(input as string, {
        includeXml: this.opts.includeXml,
        includeDiagnostics: 'basic',
        includeDataItems: 'summary',
        messageProvider: provider,
        since: this.since,
        until: this.until,
        last: opts.last ? this.takeLast : undefined,
      } as any)) {
        count++;
        const withMsg = this.messageMode !== 'off' ? ({ ...e, message: this.buildSimpleMessage(e) }) : e;
        if (this.predicate && !this.predicate(withMsg as any)) continue;
        if (last) {
          window.push(withMsg as any);
          if (window.length > 2 * last) window.splice(0, window.length - last); // amortised O(1)
          continue;
        }
        yield project(withMsg as any);
      }
      opts.onFile?.(count);
    }

    if (last) for (const e of window.slice(-last)) yield project(e);
  }

  private progressReporter(): (count: number) => void {
    const total = this.inputs.length;
    let done = 0;
    return (count) => {
      done++;
      this.opts.onProgress?.({ filesDone: done, filesTotal: total, records: count });
    };
  }

  async toArray(): Promise<Array<ResolvedEvent & { message?: string }>> {
    const all: Array<ResolvedEvent & { message?: string }> = [];
    // push one by one: `all.push(...bigArray)` overflows the call stack above ~100k elements
    for await (const e of this.iterate({ last: true, project: true, onFile: this.progressReporter() })) all.push(e);
    return all;
  }

  async forEach(fn: (e: ResolvedEvent & { message?: string }) => void | Promise<void>): Promise<void> {
    for await (const e of this.iterate({ last: false, project: false })) await fn(e);
  }

  /**
   * Coalesces small writes into large chunks and honours backpressure.
   * Never waits on a stream that has errored or closed: the failure is surfaced instead.
   */
  private static sink(out: NodeJS.WritableStream, chunkChars = 1 << 18) {
    let buf = '';
    let failure: Error | undefined;
    const events = hasStreamEvents(out);
    const onError = (e: Error) => { failure ??= e; };
    if (events) out.on('error', onError);

    const flush = async () => {
      if (failure) throw failure;
      if (!buf) return;
      const chunk = buf;
      buf = '';
      if (out.write(chunk) !== false || !events) return;
      await new Promise<void>((resolve, reject) => {
        const settle = (err?: Error) => {
          out.off('drain', onDrain); out.off('close', onClose); out.off('error', onErr);
          if (err) reject(err); else resolve();
        };
        const onDrain = () => settle();
        const onClose = () => settle(failure ?? new Error('Output stream closed before it drained'));
        const onErr = (e: Error) => settle(e);
        out.once('drain', onDrain); out.once('close', onClose); out.once('error', onErr);
      });
    };

    return {
      async write(line: string) {
        buf += line;
        if (buf.length >= chunkChars) await flush();
      },
      flush,
      dispose() { if (events) out.off('error', onError); },
    };
  }

  private static async finish(out: NodeJS.WritableStream): Promise<void> {
    if (typeof (out as any).end !== 'function') return;
    if (!hasStreamEvents(out)) { (out as any).end(); return; }
    await new Promise<void>((resolve, reject) => {
      out.once('finish', resolve);
      out.once('error', reject);
      (out as any).end();
    });
  }

  /** Shared driver for line-oriented exports: streams lines to `out` without buffering the result set. */
  private async export(
    pathOrStream: string | NodeJS.WritableStream | undefined,
    lines: (emit: (line: string) => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const owned = typeof pathOrStream === 'string';
    const out = owned ? fs.createWriteStream(pathOrStream as string) : (pathOrStream || process.stdout);
    const sink = EvtxQueryImpl.sink(out);
    try {
      await lines((line) => sink.write(line));
      await sink.flush();
      // Like before, every stream except stdout is ended when we are done.
      if (out !== process.stdout) await EvtxQueryImpl.finish(out);
    } catch (err) {
      // A stream we opened must be released (an open fd keeps the process alive); a caller's stream stays theirs.
      if (owned) (out as any).destroy?.();
      throw err;
    } finally {
      sink.dispose();
    }
  }

  async toJSONL(pathOrStream?: string | NodeJS.WritableStream): Promise<void> {
    await this.export(pathOrStream, async (emit) => {
      for await (const e of this.iterate({ last: true, project: true, onFile: this.progressReporter() })) {
        await emit(JSON.stringify(e) + '\n');
      }
    });
  }

  async toCSV(pathOrStream?: string | NodeJS.WritableStream, opts?: { header?: boolean }): Promise<void> {
    const header = opts?.header !== false;
    await this.export(pathOrStream, async (emit) => {
      if (header) await emit('Timestamp,Provider,EventID,Level,Message\n');
      for await (const e of this.iterate({ last: true, project: true, onFile: this.progressReporter() })) {
        const providerName = e.provider?.name || '';
        const rawMsg = this.messageMode !== 'off' ? (e as any).message : (e as any).messageResolution?.final?.message;
        const msg = String(rawMsg || '').replace(/"/g, '""');
        await emit(`"${e.timestamp}","${providerName}",${e.eventId ?? ''},${e.levelName ?? ''},"${msg}"\n`);
      }
    });
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
