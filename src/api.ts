import { EvtxFile } from './evtx/EvtxFile';
import path from 'path';
import fs from 'fs';
import type { MessageProvider } from './types/MessageProvider';
import { getLogger } from './logging/logger.js';

const _log = getLogger('api');

// New first-release interface
export interface ResolvedEvent {
  id: number; // EventRecordID
  timestamp: string; // ISO
  provider: { name: string; alias?: string | null; guid?: string | null };
  eventId: number;
  level?: number;
  levelName?: string; // convenience
  channel?: string;
  computer?: string;
  core?: EventCore;
  data: DataSection;
  messageResolution: MessageResolution;
  raw?: { xml?: string };
}

export interface EventCore {
  task?: number;
  opcode?: number;
  keywords?: string;
  execution?: { processId?: number; threadId?: number };
  security?: { userId?: string };
  correlation?: { activityId?: string; relatedActivityId?: string };
}

export interface DataSection {
  source: 'EventData' | 'UserData';
  fieldCount: number;
  items: Array<{ name?: string; value: string }>;
  note?: string;
}

export interface MessageResolutionAttempt {
  provider: string;
  candidateCount: number;
  selected?: boolean;
  reason?: string; // 'alias-fallback' | 'best-fit' | 'no-candidates'
}

export interface MessageSelection {
  templateText: string;
  placeholders: number;
  fit: 'exact' | 'underflow' | 'overflow';
  argsUsed: number;
  args?: string[]; // included for diagnostics levels
}

export interface MessageResolution {
  status: 'resolved' | 'fallback' | 'unresolved';
  attempts: MessageResolutionAttempt[];
  selection?: MessageSelection;
  final?: { message: string; from: 'template' | 'fallback' };
  fallback?: { builtFrom: 'EventData' | 'UserData'; itemCount: number; message: string };
  warnings?: string[];
  errors?: string[];
}

export interface EventReadOptions {
  // New options
  includeRawXml?: boolean; // inject raw.xml into raw
  includeDataItems?: 'none' | 'summary' | 'full'; // default 'summary'
  includeDiagnostics?: 'none' | 'basic' | 'full'; // default 'basic'
  enableAliasLookup?: boolean; // default true
  candidateLimit?: number; // default undefined

  // Existing
  includeXml?: boolean; // kept for back-compat of option name; maps to includeRawXml
  messageProvider?: MessageProvider;
  defaultLocale?: string; // defaults to 'en-US'
  messageStrategy?: 'none' | 'best-effort' | 'required';
  start?: number; // 1-based
  limit?: number;
  last?: number; // take last N events
  eventId?: number;
  provider?: string; // name or GUID substring match
  since?: string | Date;
  until?: string | Date;
}

function getLevelName(level: number | string | undefined): string {
  const levels: Record<number, string> = { 0: 'LogAlways', 1: 'Critical', 2: 'Error', 3: 'Warning', 4: 'Information', 5: 'Verbose' };
  if (typeof level === 'number') return levels[level] || `Unknown(${level})`;
  if (typeof level === 'string') {
    const title = level.trim();
    if (Object.values(levels).includes(title)) return title;
    const n = Number(title);
    if (!Number.isNaN(n)) return levels[n] || `Unknown(${title})`;
    return `Unknown(${title})`;
  }
  return 'Unknown';
}

function parseXmlContentDetailed(xml: string) {
  const data: any = {};
  try {
    const providerMatch = xml.match(/Provider Name=\"([^\"]+)\"(?:\s+Guid=\"([^\"]+)\")?/);
    if (providerMatch) data.provider = { name: providerMatch[1], guid: providerMatch[2] || null };
    const eventIdMatch = xml.match(/<EventID(?:\s+Qualifiers=\"([^\"]*)\")?[^>]*>(\d+)<\/EventID>/);
    if (eventIdMatch) { data.eventId = parseInt(eventIdMatch[2]); data.qualifiers = eventIdMatch[1] || null; }
    const levelMatch = xml.match(/<Level>(\d+)<\/Level>/);
    if (levelMatch) { data.level = parseInt(levelMatch[1]); data.levelName = getLevelName(data.level); }
    const taskMatch = xml.match(/<Task>(\d+)<\/Task>/); if (taskMatch) data.task = parseInt(taskMatch[1]);
    const opcodeMatch = xml.match(/<Opcode>(\d+)<\/Opcode>/); if (opcodeMatch) data.opcode = parseInt(opcodeMatch[1]);
    const keywordsMatch = xml.match(/<Keywords>([^<]+)<\/Keywords>/); if (keywordsMatch) data.keywords = keywordsMatch[1];
    const timeMatch = xml.match(/TimeCreated SystemTime=\"([^\"]+)\"/); if (timeMatch) data.systemTime = timeMatch[1];
    const recordIdMatch = xml.match(/<EventRecordID>(\d+)<\/EventRecordID>/); if (recordIdMatch) data.eventRecordId = parseInt(recordIdMatch[1]);
    const executionMatch = xml.match(/Execution ProcessID=\"(\d+)\" ThreadID=\"(\d+)\"/);
    if (executionMatch) data.execution = { processId: parseInt(executionMatch[1]), threadId: parseInt(executionMatch[2]) };
    const channelMatch = xml.match(/<Channel>([^<]+)<\/Channel>/); if (channelMatch) data.channel = channelMatch[1];
    const computerMatch = xml.match(/<Computer>([^<]+)<\/Computer>/); if (computerMatch) data.computer = computerMatch[1];
    const securityMatch = xml.match(/Security UserID=\"([^\"]+)\"/); if (securityMatch) data.security = { userId: securityMatch[1] };
    // EventData
    const eventDataMatch = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/);
    if (eventDataMatch) data.eventData = parseEventDataFromXml(eventDataMatch[1]);
    // UserData
    const userDataMatch = xml.match(/<UserData[^>]*>([\s\S]*?)<\/UserData>/);
    if (userDataMatch) data.userData = { raw: userDataMatch[1].trim() };
  } catch (e) {
    data.parseError = (e as Error).message;
  }
  return data;
}

// (removed old simple extractInsertionArgs; see extended version below)

function applyMessageTemplate(template: string, args: string[]): string {
  let s = template;
  // Handle FormatMessage-style with format modifiers: %1!S!, %2!s!, etc.
  s = s.replace(/%(\d+)!([^!]*)!/g, (_, n) => {
    const i = parseInt(n, 10) - 1; return args[i] ?? '';
  });
  // Plain %1..%n placeholders (but not %n for newline, %t for tab, %r for carriage return, %b for space)
  s = s.replace(/%(\d+)/g, (_, n) => {
    const i = parseInt(n, 10) - 1; return args[i] ?? '';
  });
  // Windows message formatting escape sequences
  s = s.replace(/%n/g, '\n');    // newline
  s = s.replace(/%t/g, ' ');     // tab -> space (more readable in console output)
  s = s.replace(/%r/g, '');      // carriage return -> remove
  s = s.replace(/%b/g, ' ');     // space
  s = s.replace(/%%/g, '%');     // escaped percent sign
  // Also support {0}-style placeholders
  s = s.replace(/\{(\d+)\}/g, (_, n) => {
    const i = parseInt(n, 10); return args[i] ?? '';
  });
  // Strip any leftover FormatMessage format tokens like !S!, !s!, !X!, etc.
  s = s.replace(/![A-Za-z]+!/g, '');
  return s;
}

function formatVariantForMessage(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(formatVariantForMessage).join(', ');
  // Guid, Sid or custom types often stringify well
  try { return String((v as any).toString ? (v as any).toString() : v); } catch { return String(v); }
}

// Common: pick EventData/UserData layout and render items
function buildDataSectionFromRecord(rec: any, include: 'none' | 'summary' | 'full' = 'summary'): { section: DataSection; layoutSource: 'EventData' | 'UserData' | null; entries: Array<{ name?: string | null; parts: any[] }>; substitutions: any[] } {
  const limit = include === 'summary' ? 10 : (include === 'none' ? 0 : Infinity);
  try {
    const root: any = rec?.root?.();
    if (!root) return { section: { source: 'EventData', fieldCount: 0, items: [] }, layoutSource: null, entries: [], substitutions: [] };
    const ti = root.templateInstance?.();
    const actual = root.chunk?.getActualTemplate?.(ti?.template_offset);
    const subs = root.substitutions || [];
    let entries: Array<{ name?: string | null; parts: any[] }> = [];
    let source: 'EventData' | 'UserData' | null = 'EventData';
    if (actual) {
      try { entries = actual.getEventDataLayout(subs) || []; } catch { entries = []; }
      if (!entries.length && typeof (actual as any).getUserDataLayout === 'function') {
        try { entries = (actual as any).getUserDataLayout(subs) || []; source = 'UserData'; } catch {}
      }
    }
    const items: Array<{ name?: string; value: string }> = [];
    if (limit > 0 && entries.length) {
      for (const entry of entries) {
        const val = (entry.parts || []).map((p: any) => p?.kind === 'sub' ? formatVariantForMessage(subs?.[p.index]) : String(p?.text ?? '')).join('');
        const trimmed = String(val ?? '').trim();
        if (!trimmed) continue;
        const item = entry.name ? { name: String(entry.name), value: trimmed } : { value: trimmed } as any;
        items.push(item);
        if (items.length >= limit) break;
      }
    }
    const note = source === 'UserData' ? 'derived from embedded BXML under UserData' : undefined;
    return { section: { source: source || 'EventData', fieldCount: entries.length, items, ...(note ? { note } : {}) }, layoutSource: source, entries, substitutions: subs };
  } catch {
    return { section: { source: 'EventData', fieldCount: 0, items: [] }, layoutSource: null, entries: [], substitutions: [] };
  }
}

// Build compact fallback message from a layout
function buildFallbackMessageFromLayouts(rec: any): string | null {
  try {
    const root: any = rec?.root?.();
    if (!root) return null;
    const ti = root.templateInstance?.();
    const actual = root.chunk?.getActualTemplate?.(ti?.template_offset);
    if (!actual) return null;
    const subs = root.substitutions || [];
    // Prefer EventData; if empty, try UserData
    const ed: Array<{ name?: string | null; parts: any[] }> = actual.getEventDataLayout(subs) || [];
    const ud: Array<{ name?: string | null; parts: any[] }> = (typeof (actual as any).getUserDataLayout === 'function') ? (actual as any).getUserDataLayout(subs) : [];
    const layout = (ed && ed.length) ? ed : ud;
    if (!layout || layout.length === 0) return null;
    // Render values; prefer Name=value when names exist, else raw values
    const items: string[] = [];
    for (const entry of layout) {
      const val = (entry.parts || []).map((p: any) => p?.kind === 'sub' ? formatVariantForMessage(subs?.[p.index]) : String(p?.text ?? '')).join('');
      const trimmed = String(val ?? '').trim();
      if (!trimmed) continue;
      if (entry.name && String(entry.name).length) items.push(`${entry.name}=${trimmed}`);
      else items.push(trimmed);
      // keep message compact; cap at ~10 fields
      if (items.length >= 10) break;
    }
    if (!items.length) return null;
    return items.join(' | ');
  } catch {
    return null;
  }
}

function buildArgsFromSubstitutions(rec: any, template: string, xml?: string): string[] | null {
  try {
    const root = rec?.root?.();
    if (!root || !Array.isArray(root.substitutions)) return null;
    const subs = root.substitutions.map((x: any) => formatVariantForMessage(x)).filter((s: any) => typeof s === 'string');

    // Determine expected placeholder count from template
    let maxIdx = 0; const re = /%(\d+)/g; let m;
    while ((m = re.exec(template)) !== null) { const n = parseInt(m[1], 10); if (n > maxIdx) maxIdx = n; }
    if (maxIdx <= 0) return [];

    // If XML present, use EventData text to locate the right subset in order
    let searchArea = '';
    if (xml) {
      const ed = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/i);
      if (ed) {
        searchArea = ed[1].replace(/<Data[^>]*>/g, '').replace(/<\/Data>/g, '').trim();
      }
    }

    const args: string[] = [];
    const used = new Set<number>();
    // Strategy: pick substitutions that appear in EventData text, in order of appearance
    if (searchArea) {
      let cursor = 0;
      for (let i = 0; i < subs.length && args.length < maxIdx; i++) {
        const val = subs[i];
        if (!val || val.length < 2) continue;
        const pos = searchArea.indexOf(val, cursor);
        if (pos !== -1) {
          args.push(val);
          used.add(i);
          cursor = pos + val.length; // advance to maintain order
        }
      }
    }

    // Only return if we matched at least one arg from EventData text; otherwise let XML-based path handle it
    if (args.length >= 1) return args.length > maxIdx ? args.slice(0, maxIdx) : args;
    return null;
  } catch {
    return null;
  }
}

function buildArgsFromTemplate(rec: any, template: string): string[] | null {
  try {
    const root = rec?.root?.();
    if (!root) return null;
    const ti = root.templateInstance?.();
    if (!ti) return null;
    const actual = root.chunk?.getActualTemplate?.(ti.template_offset);
    if (!actual) return null;
    // Determine how many placeholders are needed
    let maxIdx = 0; const re = /%(\d+)/g; let m;
    while ((m = re.exec(template)) !== null) { const n = parseInt(m[1], 10); if (n > maxIdx) maxIdx = n; }
    const subs = root.substitutions || [];
    const layout = actual.getEventDataLayout(subs);
    const userLayout = (layout.length === 0 && typeof actual.getUserDataLayout === 'function') ? (actual as any).getUserDataLayout(subs) : [];
    let args = actual.buildArgsFromLayout(layout.length ? layout : userLayout, subs, undefined);
    // Provider-specific ordering: RestartManager named Data
    try {
      const eventId = (typeof rec.eventId === 'function') ? rec.eventId() : undefined;
      if (eventId && (eventId === 10000 || eventId === 10001 || eventId === 10010)) {
        // Build a name->value map from layout by resolving parts
        const valueOf = (entry: any) => entry.parts.map((p: any)=> p.kind==='sub' ? (subs[p.index] ?? '') : (p.text ?? '')).join('');
        const entries = (layout.length ? layout : userLayout) as Array<{ name?: string|null, parts: any[] }>;
        const byName = new Map<string, string>();
        for (const e of entries) { if (e.name) byName.set(String(e.name), valueOf(e)); }
        const pick = (...names: string[]) => {
          for (const n of names) { if (byName.has(n)) return byName.get(n) as string; }
          return '';
        };
        if (eventId === 10000) {
          // Starting session %1 - %2
          args = [ pick('RmSessionId','Session'), pick('UTCStartTime','Time','StartTime') ].slice(0, 2);
        } else if (eventId === 10001) {
          // Ending session %1 started %2
          args = [ pick('RmSessionId','Session'), pick('UTCStartTime','StartTime','Time') ].slice(0, 2);
        } else if (eventId === 10010) {
          // Application '%1' (pid %2) cannot be restarted - %3.
          args = [ pick('FullPath','Application','AppPath','DisplayName'), pick('Pid','ProcessId'), pick('Reason','Message','Status') ].slice(0, 3);
        }
      }
    } catch {}
    if (maxIdx <= 0) return [];
    if (!args || args.length === 0) return null;
    // Ensure exact length: pad with empty strings to %n if needed
    if (args.length < maxIdx) return args.concat(Array(maxIdx - args.length).fill(''));
    return args.slice(0, maxIdx);
  } catch {
    return null;
  }
}

function extractInsertionArgs(xml: string): string[] {
  // Primary: EventData
  const ed = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/i);
  if (ed) {
    const body = ed[1];
    const args: string[] = [];
    const re = /<Data(?:\s+[^>]*?)?>([\s\S]*?)<\/Data>/gi;
    let m;
    while ((m = re.exec(body)) !== null) args.push((m[1] || '').trim());
    if (args.length) return args;
  }
  // Fallback: UserData simple element values; try to infer useful order (FullPath, Pid, Reason)
  const ud = xml.match(/<UserData[^>]*>([\s\S]*?)<\/UserData>/i);
  if (ud) {
    const body = ud[1];
    // capture first container (e.g., <RmUnsupportedRestartEvent>...</...>) if present
    const container = body.match(/<([A-Za-z0-9:_-]+)[^>]*>([\s\S]*?)<\/\1>/);
    const inner = container ? container[2] : body;
    const pairs: { name: string; value: string }[] = [];
    const re = /<([A-Za-z0-9:_-]+)[^>]*>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      const name = m[1];
      const raw = (m[2] || '').trim();
      if (raw.includes('<')) continue; // skip complex/nested
      pairs.push({ name, value: raw });
    }
    if (pairs.length) return pairs.map(p => p.value);
  }
  return [];
}

export async function* readEvents(filePath: string, options: EventReadOptions = {}): AsyncGenerator<any> {
  const { includeXml, eventId, provider, since, until, messageProvider, defaultLocale, messageStrategy = 'best-effort' } = options;
  const evtxFile = await EvtxFile.open(filePath);
  let index = 0;
  let emitted = 0;
  const sinceDate = since ? new Date(since as any) : null;
  const untilDate = until ? new Date(until as any) : null;
  // Resolve start/limit with optional 'last'
  const stats = evtxFile.getStats();
  const totalRecords = Number(stats.nextRecordNumber) - 1;
  let start = options.start ?? 1;
  if (options.last && options.last > 0) {
    start = Math.max(1, totalRecords - options.last + 1);
  }
  const limit = options.limit;

  for (const rec of evtxFile.records()) {
    index++;
    if (index < start) continue;
    if (limit && emitted >= limit) break;

    const base: any = {
      recordNumber: rec.recordNum().toString(),
      timestamp: rec.timestampAsDate().toISOString(),
      size: rec.size(),
      exportMethod: 'detailed'
    };

    // Time filters
    if (sinceDate && new Date(base.timestamp) < sinceDate) continue;
    if (untilDate && new Date(base.timestamp) > untilDate) continue;

    let xml = '';
    try { xml = rec.renderXml(); } catch {}
    const extra = xml ? parseXmlContentDetailed(xml) : {};

    // Provider/eventId filters
    if (eventId != null && extra.eventId !== eventId) continue;
    if (provider && !((extra.provider?.name || extra.provider?.guid || '').includes(provider))) continue;

    // Resolve message via provider if available
    let resolved = false;
    if (messageStrategy !== 'none' && messageProvider && extra.provider?.name && extra.eventId != null) {
      try {
        const locale = defaultLocale || 'en-US';
        // Provider alias candidates: canonical provider Name, then EventSourceName (alias) if present
        const aliasMatch = (xml || '').match(/EventSourceName="([^"]+)"/);
        const candidates = [extra.provider.name];
        if (aliasMatch && aliasMatch[1] && !candidates.includes(aliasMatch[1])) candidates.push(aliasMatch[1]);

        // Build full args once (no truncation) for best-fit template selection
        let fullArgs: string[] = [];
        try {
          const rootAny: any = rec?.root?.();
          const ti = rootAny?.templateInstance?.();
          const actual = rootAny?.chunk?.getActualTemplate?.(ti?.template_offset);
          const subs = rootAny?.substitutions || [];
          if (actual) {
            const ed = actual.getEventDataLayout(subs);
            const ud = (typeof (actual as any).getUserDataLayout === 'function') ? (actual as any).getUserDataLayout(subs) : [];
            const layoutAny = (ed && ed.length) ? ed : ud;
            fullArgs = actual.buildArgsFromLayout(layoutAny, subs);
          }
        } catch {}

        // Query candidates per provider name (canonical first, then alias) and choose best fit
        const allTemplates: string[] = [];
        for (const provName of candidates) {
          const provCandidates = (typeof (messageProvider as any).getMessageCandidates === 'function')
            ? await (messageProvider as any).getMessageCandidates(provName, extra.eventId, locale)
            : [];
          if (provCandidates.length) allTemplates.push(...provCandidates);
          const single = await messageProvider.getMessage(provName, extra.eventId, locale);
          if (single) allTemplates.push(single);
          if (allTemplates.length) break; // stop after first provider name that yields candidates
        }

        if (allTemplates.length) {
          // First, prefer templates whose placeholder count equals the number of EventData fields (layout entries)
          const placeholderMax = (tpl: string) => { let max=0; const re=/%(\d+)/g; let m; while((m=re.exec(tpl))!==null){const n=parseInt(m[1],10); if(n>max) max=n;} return max; };
          const rootAny: any = rec?.root?.();
          const ti = rootAny?.templateInstance?.();
          const actual = rootAny?.chunk?.getActualTemplate?.(ti?.template_offset);
          const subs = rootAny?.substitutions || [];
          let layoutCount = 0;
          try { if (actual) { layoutCount = actual.getEventDataLayout(subs).length; } } catch {}

          let filtered = allTemplates.filter(t => placeholderMax(t) === layoutCount);
          if (filtered.length === 0) filtered = allTemplates.slice();
          // Score candidates by closeness to available args length as tie-breaker
          let bestIdx = 0; let bestScore = -Infinity;
          for (let i=0;i<filtered.length;i++){
            const need = placeholderMax(filtered[i]);
            let score = 0;
            if (need === layoutCount) score += 1000; // exact Data field count match
            // Prefer exact args length match, then need <= args with higher need, then minimal diff
            score += (need === fullArgs.length) ? 500 : (need <= fullArgs.length ? 200 + need : 50 - Math.abs(need - fullArgs.length));
            if (score > bestScore) { bestScore = score; bestIdx = i; }
          }
          const tpl = filtered[bestIdx];
          const phMax = placeholderMax(tpl);
          extra.messageTemplate = tpl;
          const args = buildArgsFromTemplate(rec, tpl) ?? [];
          // Ensure exact placeholder count
          const needed = phMax;
          extra.message = applyMessageTemplate(tpl, needed > 0 ? (args.length < needed ? args.concat(Array(needed-args.length).fill('')) : args.slice(0, needed)) : args);
          resolved = true;
          // If there was only a single candidate originally and placeholder count does not match layout, log an issue
          if (allTemplates.length === 1 && phMax !== layoutCount) {
            _log.warn(`[messages] Placeholder/layout mismatch for provider=${candidates[0]} eventId=${extra.eventId}: placeholders=${phMax}, layoutFields=${layoutCount}`);
          }
        }
      } catch (e) {
        // Ignore provider errors
      }
    }

    if (resolved) extra.messageResolved = true;
    // Minimal, deterministic fallback: if no template resolved, but layouts have values, build a compact message
    if (!resolved && !extra.message) {
      const fallback = buildFallbackMessageFromLayouts(rec);
      if (fallback) extra.message = fallback;
    }
    if (!resolved && messageStrategy === 'required') {
      throw new Error(`Message resolution required but not found for provider=${extra.provider?.name} eventId=${extra.eventId}`);
    }
    if (xml) extra.xmlLength = xml.length;
    if (includeXml && xml) (extra as any).xml = xml;

    // Ensure levelName present
    extra.levelName = getLevelName(extra.level);

    emitted++;
    yield { ...base, ...extra } as any;
  }
}

export async function parseEvents(filePath: string, options: EventReadOptions = {}): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of readEvents(filePath, options)) out.push(ev);
  return out;
}

/**
 * Parse EventData section from XML
 */
function parseEventDataFromXml(eventDataXml: string): Record<string, any> | null {
  const data: Record<string, any> = {};
  
  try {
    // Parse Data elements with Name attributes
    const dataMatches = eventDataXml.matchAll(/<Data Name="([^"]+)"[^>]*>([^<]*)<\/Data>/g);
    for (const match of dataMatches) {
      data[match[1]] = match[2] || null;
    }

    // Parse simple Data elements without names
    const simpleDataMatches = eventDataXml.matchAll(/<Data[^>]*>([^<]+)<\/Data>/g);
    if (simpleDataMatches) {
      const values = Array.from(simpleDataMatches).map(match => match[1]);
      if (values.length > 0) {
        data._values = values;
      }
    }

    return Object.keys(data).length > 0 ? data : null;
  } catch (error) {
    return null;
  }
}

/**
 * Parse an EVTX file and return structured log lines with pagination support
 * NOW USES XML RENDERING FOR ACCURATE DATA EXTRACTION
 */
// Legacy parseEvtxFile removed in favor of readEvents/parseEvents

/**
 * Check if a file is an EVTX file
 */
export function isEvtxFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.evtx');
}

/**
 * Build an index for an EVTX file (simplified implementation)
 */
export async function buildEvtxIndex(filePath: string): Promise<{ totalRecords: number; indexPath: string }> {
  try {
    _log.info(`[buildEvtxIndex] Building index for EVTX file: ${filePath}`);
    
    const evtxFile = await EvtxFile.open(filePath);
    const stats = evtxFile.getStats();
    
    // Create a simple index file with metadata
    const indexData = {
      filePath,
      fileSize: stats.fileSize,
      chunkCount: stats.chunkCount,
      totalRecords: Number(stats.nextRecordNumber) - 1, // nextRecordNumber is 1-based
      majorVersion: stats.majorVersion,
      minorVersion: stats.minorVersion,
      isDirty: stats.isDirty,
      isFull: stats.isFull,
      createdAt: new Date().toISOString(),
      chunks: [] as Array<{
        chunkNumber: number;
        firstRecord: number;
        lastRecord: number;
        recordCount: number;
      }>
    };
    
    // Collect chunk information
    let chunkNumber = 0;
    for (const chunk of evtxFile.chunks()) {
      chunkNumber++;
      const recordCount = Array.from(chunk.records()).length;
      
      indexData.chunks.push({
        chunkNumber,
        firstRecord: Number(chunk.logFirstRecordNumber()),
        lastRecord: Number(chunk.logLastRecordNumber()),
        recordCount
      });
    }
    
    // Write index file
    const indexPath = filePath + '.index.json';
    await fs.promises.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    
    _log.info(`[buildEvtxIndex] Index built successfully: ${indexPath}`);
    
    return {
      totalRecords: indexData.totalRecords,
      indexPath
    };
    
  } catch (error) {
    _log.error(`[buildEvtxIndex] Error building EVTX index: ${error}`);
    throw new Error(`EVTX indexing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get EVTX file statistics without full parsing
 */
export async function getStats(filePath: string) {
  const evtxFile = await EvtxFile.open(filePath);
  const stats = evtxFile.getStats();
  const totalRecords = Number(stats.nextRecordNumber) - 1;

  // Derive oldest/newest by scanning timestamps (simple, accurate)
  let oldest: string | null = null;
  let newest: string | null = null;
  try {
    for (const rec of evtxFile.records()) {
      const ts = rec.timestampAsDate().toISOString();
      if (!oldest || ts < oldest) oldest = ts;
      if (!newest || ts > newest) newest = ts;
    }
  } catch {}

  return {
    // Friendly fields matching usage docs
    recordCount: totalRecords,
    fileSizeBytes: stats.fileSize,
    isDirty: stats.isDirty,
    isFull: stats.isFull,
    oldestRecord: oldest || null,
    newestRecord: newest || null,

    // Back-compat
    fileSize: stats.fileSize,
    chunkCount: stats.chunkCount,
    totalRecords,
    version: `${stats.majorVersion}.${stats.minorVersion}`,
  } as any;
}

/**
 * Get a specific record by number
 * NOW USES XML RENDERING FOR ACCURATE DATA EXTRACTION
 */
export async function getRecord(filePath: string, recordNumber: number): Promise<any | null> {
  const evtxFile = await EvtxFile.open(filePath);
  const record = evtxFile.getRecord(BigInt(recordNumber));
  
  if (!record) {
    return null;
  }
  
  let eventInfo: any = {};
  
  try {
    // Use XML rendering for accurate data extraction
    const xmlContent = record.renderXml();
    eventInfo = parseXmlContentDetailed(xmlContent);
  } catch (xmlError) {
    _log.warn(`XML rendering failed for record ${recordNumber}: ${xmlError}`);
    eventInfo = {};
  }
  
  const xml = (() => { try { return record.renderXml(); } catch { return undefined; } })();
  const base: any = {
    recordNumber: record.recordNum().toString(),
    timestamp: record.timestampAsDate().toISOString(),
    size: record.size(),
    exportMethod: 'detailed',
    ...(xml ? { xmlLength: xml.length } : {})
  };
  const out = { ...base, ...eventInfo } as any;
  return out;
} 

// New resolved API: helpers and streaming

function placeholderMax(tpl: string): number {
  let max = 0; const re = /%(\d+)/g; let m; while ((m = re.exec(tpl)) !== null) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  return max;
}

async function buildResolvedEventFromRecord(rec: any, options: EventReadOptions = {}): Promise<ResolvedEvent> {
  const {
    includeXml, // legacy
    includeRawXml = includeXml ?? false,
    includeDataItems = 'summary',
    includeDiagnostics = 'basic',
    enableAliasLookup = true,
    candidateLimit,
    messageProvider,
    defaultLocale,
    messageStrategy = 'best-effort',
  } = options;

  const timestamp = rec.timestampAsDate().toISOString();
  
  // PERFORMANCE: Use fast extraction first, only render XML if needed
  let info = extractBasicInfoFast(rec);
  let xml = '';
  let xmlRendered = false;
  
  // Fallback: If we need message resolution and don't have provider/eventId, render XML
  if (messageProvider && messageStrategy !== 'none' && (!info.provider?.name || info.eventId == null)) {
    try {
      xml = rec.renderXml();
      xmlRendered = true;
      // Merge with XML-extracted info
      const xmlInfo = parseXmlContentDetailed(xml);
      info = { ...xmlInfo, ...info }; // Prefer fast-extracted fields if available
    } catch (e) { _log.debug('XML fallback extraction failed', e); }
  }

  const dataBuild = buildDataSectionFromRecord(rec, includeDataItems);

  // Resolution lifecycle
  const attempts: MessageResolutionAttempt[] = [];
  let selection: MessageSelection | undefined;
  let finalMessageText: string | undefined;
  let finalFrom: 'template' | 'fallback' | undefined;
  const warnings: string[] = [];
  const errors: string[] = [];

  const locale = defaultLocale || 'en-US';
  const canonicalName = info.provider?.name;
  const eventIdNum = info.eventId as number | undefined;
  let providerUsedForSelection: string | undefined;

  if (messageStrategy !== 'none' && messageProvider && canonicalName && eventIdNum != null) {
    try {
      const provNames: string[] = [];
      provNames.push(canonicalName);
      if (enableAliasLookup) {
        // EventSourceName comes straight from the structured System/Provider node,
        // so no XML render or regex is needed here.
        const alias = (info.eventSourceName as string | undefined) || canonicalName.replace(/^Microsoft-Windows-/, '');
        if (alias && alias !== canonicalName) provNames.push(alias);
      }

      // Pre-compute layoutCount and baseline args
      let layoutCount = 0; let baselineArgs: string[] = [];
      try {
        const rootAny: any = rec?.root?.();
        const ti = rootAny?.templateInstance?.();
        const actual = rootAny?.chunk?.getActualTemplate?.(ti?.template_offset);
        const subs = rootAny?.substitutions || [];
        if (actual) {
          const ed = actual.getEventDataLayout(subs) || [];
          layoutCount = ed.length;
          const ud = (!ed.length && typeof actual.getUserDataLayout === 'function') ? (actual as any).getUserDataLayout(subs) : [];
          const layoutAny = ed.length ? ed : ud;
          baselineArgs = actual.buildArgsFromLayout(layoutAny, subs);
        }
      } catch (e) { _log.debug('baseline args computation failed', e); }

      // Gather candidates
      let chosenTemplate: string | undefined;
      for (let i = 0; i < provNames.length; i++) {
        const provName = provNames[i];
        const list = (typeof (messageProvider as any).getMessageCandidates === 'function')
          ? await (messageProvider as any).getMessageCandidates(provName, eventIdNum, locale)
          : [];
        const single = await messageProvider.getMessage(provName, eventIdNum, locale);
        const all = [...list, ...(single ? [single] : [])];
        const limited = (typeof candidateLimit === 'number' && candidateLimit > 0) ? all.slice(0, candidateLimit) : all;
        attempts.push({ provider: provName, candidateCount: limited.length, ...(limited.length ? {} : { reason: 'no-candidates' }) });
        if (!limited.length) continue;
        // Pick best template by fit
        let bestIdx = 0; let bestScore = -Infinity;
        for (let j = 0; j < limited.length; j++) {
          const tpl = limited[j];
          const need = placeholderMax(tpl);
          let score = 0;
          if (need === layoutCount) score += 1000;
          score += (need === baselineArgs.length) ? 500 : (need <= baselineArgs.length ? 200 + need : 50 - Math.abs(need - baselineArgs.length));
          if (score > bestScore) { bestScore = score; bestIdx = j; }
        }
        chosenTemplate = limited[bestIdx];
        providerUsedForSelection = provName;
        break;
      }

      if (chosenTemplate) {
        const need = placeholderMax(chosenTemplate);
        const args = buildArgsFromTemplate(rec, chosenTemplate) ?? [];
        const argsUsed = need > 0 ? Math.min(args.length, need) : args.length;
        const fit: 'exact' | 'underflow' | 'overflow' = (need === argsUsed) ? 'exact' : (need > argsUsed ? 'underflow' : 'overflow');
        selection = { templateText: chosenTemplate, placeholders: need, fit, argsUsed, ...(includeDiagnostics === 'full' ? { args } : {}) };
        const finalArgs = need > 0 ? (args.length < need ? args.concat(Array(need - args.length).fill('')) : args.slice(0, need)) : args;
        finalMessageText = applyMessageTemplate(chosenTemplate, finalArgs);
        finalFrom = 'template';
        const selected = attempts.find(a => a.provider === providerUsedForSelection);
        if (selected) { selected.selected = true; selected.reason = (providerUsedForSelection && providerUsedForSelection !== canonicalName) ? 'alias-fallback' : 'best-fit'; }
        if (selection.fit !== 'exact') warnings.push(`placeholder/layout mismatch: placeholders=${selection.placeholders}, argsUsed=${selection.argsUsed}`);
      }
    } catch (e: any) {
      errors.push(`provider error: ${e?.message || String(e)}`);
    }
  }

  if (!finalMessageText) {
    const fb = buildFallbackMessageFromLayouts(rec);
    if (fb) { finalMessageText = fb; finalFrom = 'fallback'; if (!attempts.length && (canonicalName || '').length) attempts.push({ provider: canonicalName!, candidateCount: 0, reason: 'no-candidates' }); }
  }
  if (!finalMessageText && messageStrategy === 'required') {
    throw new Error(`Message resolution required but not found for provider=${info.provider?.name} eventId=${info.eventId}`);
  }

  const status: 'resolved' | 'fallback' | 'unresolved' = finalFrom === 'template' ? 'resolved' : (finalFrom === 'fallback' ? 'fallback' : 'unresolved');
  if (status !== 'resolved' && attempts.every(a => !a.candidateCount)) {
    if (!warnings.includes('No template in catalog')) warnings.push('No template in catalog');
  }

  const core: EventCore = {};
  if (typeof info.task === 'number') core.task = info.task;
  if (typeof info.opcode === 'number') core.opcode = info.opcode;
  if (typeof info.keywords === 'string') core.keywords = info.keywords;
  if (info.execution) core.execution = info.execution;
  if (info.security) core.security = info.security;
  const corr: any = {};
  if (info.activityId) corr.activityId = info.activityId;
  if (Object.keys(corr).length) core.correlation = corr;

  const providerObj = {
    name: info.provider?.name || '',
    alias: providerUsedForSelection && providerUsedForSelection !== (info.provider?.name || '') ? providerUsedForSelection : undefined,
    guid: info.provider?.guid || null,
  } as { name: string; alias?: string | null; guid?: string | null };

    const ev: ResolvedEvent = {
    id: (typeof info.eventRecordId === 'number' ? info.eventRecordId : Number(rec.recordNum())) || Number(rec.recordNum()),
    timestamp,
    provider: providerObj,
    eventId: typeof info.eventId === 'number' ? info.eventId : 0,
    level: typeof info.level === 'number' ? info.level : undefined,
    levelName: getLevelName(info.level),
    channel: info.channel,
    computer: info.computer,
    core: Object.keys(core).length ? core : undefined,
    data: dataBuild.section,
      messageResolution: {
      status,
      attempts: includeDiagnostics === 'none' ? [] : attempts,
      selection: includeDiagnostics === 'none' ? undefined : selection,
      final: finalMessageText ? { message: finalMessageText, from: (finalFrom || 'fallback') } : undefined,
      ...(finalFrom === 'fallback' && dataBuild.section ? { fallback: { builtFrom: dataBuild.section.source, itemCount: dataBuild.section.fieldCount, message: finalMessageText! } } : {}),
      warnings: includeDiagnostics === 'full' ? (warnings.length ? warnings : undefined) : (includeDiagnostics === 'basic' ? (warnings.length ? warnings.slice(0, 1) : undefined) : undefined),
      errors: includeDiagnostics === 'full' ? (errors.length ? errors : undefined) : undefined,
    },
    // PERFORMANCE: Only render XML if explicitly requested
    ...((includeRawXml) ? (() => {
      if (!xmlRendered) {
        try { xml = rec.renderXml(); xmlRendered = true; } catch {}
      }
      return xml ? { raw: { xml } } : {};
    })() : {}),
  };

  return ev;
}

/**
 * PERFORMANCE OPTIMIZED: Fast extraction of basic fields without XML rendering
 * Extracts common fields directly from template structure
 */
function extractBasicInfoFast(rec: any): any {
  try {
    const rootNode = rec.root() as any;
    const ti = rootNode.templateInstance?.();
    if (!ti) return {};
    
    const chunk = rootNode.chunk;
    const actual = chunk.getActualTemplate(ti.template_offset);
    if (!actual) return {};
    
    const subs = rootNode.substitutions || [];
    const result: any = {};
    
    // Helper to extract value from node
    const extractValue = (node: any): any => {
      if (node?.data != null) return node.data;
      if ((node as any)?.substitution_id != null) {
        const idx = (node as any).substitution_id;
        if (idx >= 0 && idx < subs.length) return subs[idx];
      }
      return null;
    };
    
    // Try to extract fields from template System section
    const rootElem = actual.rootElement;
    if (rootElem && rootElem.children) {
      for (const child of rootElem.children) {
        if ((child as any).name === 'System' && child.children) {
          for (const sysChild of child.children) {
            const childName = (sysChild as any).name;
            
            // Provider
            if (childName === 'Provider' && sysChild.children) {
              for (const attr of sysChild.children) {
                if ((attr as any).name === 'Name') {
                  const val = extractValue(attr.children?.[0]);
                  if (val != null) {
                    result.provider = result.provider || {};
                    result.provider.name = String(val);
                  }
                }
                if ((attr as any).name === 'Guid') {
                  const val = extractValue(attr.children?.[0]);
                  if (val != null) {
                    result.provider = result.provider || {};
                    result.provider.guid = String(val);
                  }
                }
                if ((attr as any).name === 'EventSourceName') {
                  const val = extractValue(attr.children?.[0]);
                  if (val != null) result.eventSourceName = String(val);
                }
              }
            }
            
            // EventID
            if (childName === 'EventID' && sysChild.children?.[0]) {
              const val = extractValue(sysChild.children[0]);
              if (val != null) result.eventId = parseInt(String(val), 10);
            }
            
            // Level
            if (childName === 'Level' && sysChild.children?.[0]) {
              const val = extractValue(sysChild.children[0]);
              if (val != null) result.level = parseInt(String(val), 10);
            }
            
            // Channel
            if (childName === 'Channel' && sysChild.children?.[0]) {
              const val = extractValue(sysChild.children[0]);
              if (val != null) result.channel = String(val);
            }
            
            // Computer
            if (childName === 'Computer' && sysChild.children?.[0]) {
              const val = extractValue(sysChild.children[0]);
              if (val != null) result.computer = String(val);
            }
            
            // EventRecordID
            if (childName === 'EventRecordID' && sysChild.children?.[0]) {
              const val = extractValue(sysChild.children[0]);
              if (val != null) result.eventRecordId = parseInt(String(val), 10);
            }
          }
        }
      }
    }
    
    return result;
  } catch {
    return {};
  }
}

export async function* readResolvedEvents(filePath: string, options: EventReadOptions = {}): AsyncGenerator<ResolvedEvent> {
  const { eventId, provider, since, until, start, last, limit } = options;
  const evtxFile = await EvtxFile.open(filePath);
  const sinceDate = since ? new Date(since as any) : null;
  const untilDate = until ? new Date(until as any) : null;
  const stats = evtxFile.getStats();
  const totalRecords = Number(stats.nextRecordNumber) - 1;
  let startAt = start ?? 1;
  if (last && last > 0) startAt = Math.max(1, totalRecords - last + 1);

  let index = 0;
  let emitted = 0;
  
  for (const chunk of evtxFile.chunks()) {
    for (const rec of chunk.records()) {
      index++;
      if (index < startAt) continue;
      if (limit && emitted >= limit) break;

      // PERFORMANCE: Use fast extraction for filtering (no XML rendering)
      const info = extractBasicInfoFast(rec);

      // Time filters
      const ts = rec.timestampAsDate().toISOString();
      if (sinceDate && new Date(ts) < sinceDate) continue;
      if (untilDate && new Date(ts) > untilDate) continue;

      // Provider/eventId filters
      if (eventId != null && info.eventId !== eventId) continue;
      if (provider && !((info.provider?.name || info.provider?.guid || '').includes(provider))) continue;

      const ev = await buildResolvedEventFromRecord(rec, options);
      emitted++;
      yield ev;
    }
  }
}

export async function parseResolvedEvents(filePath: string, options: EventReadOptions = {}): Promise<ResolvedEvent[]> {
  const out: ResolvedEvent[] = [];
  for await (const ev of readResolvedEvents(filePath, options)) out.push(ev);
  return out;
}

export function finalMessage(e: ResolvedEvent): string | undefined {
  return e.messageResolution.final?.message;
}
