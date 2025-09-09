// Compare events from an XML export to ts-evtx parsed events with messages
// Ad-hoc script for parity checks on a handful of events

import fs from 'node:fs';
import path from 'node:path';
import { evtx } from '../dist/index.js';
// Use local workspace build of @ts-evtx/messages
import { SqliteMessageProvider } from '../packages/ts-evtx-messages/dist/providers/SqliteProvider.js';
// (Simplified) No OS/version detection: use provided DB or merged default

const XML_PATH = process.argv[2] || './test/fixtures/Application.xml';
const EVTX_PATH = process.argv[3] || './test/fixtures/Application.evtx';
const SAMPLE_COUNT = Number(process.argv[4] || 50);

function die(msg) { console.error(msg); process.exit(1); }

if (!fs.existsSync(XML_PATH)) die(`XML not found: ${XML_PATH}`);
if (!fs.existsSync(EVTX_PATH)) die(`EVTX not found: ${EVTX_PATH}`);

const xmlText = fs.readFileSync(XML_PATH, 'utf8');

function pathResolveDefault(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) return abs;
  return p; // let downstream handle
}

// Extract individual <Event> ... </Event> blocks
const eventBlocks = [];
{
  const re = /<Event[\s\S]*?<\/Event>/g;
  let m;
  while ((m = re.exec(xmlText)) !== null) eventBlocks.push(m[0]);
}

function getMatch(re, s) {
  const m = s.match(re); return m ? m[1] : undefined;
}

function decodeNumericEntities(s) {
  if (!s) return s;
  return s.replace(/&#(\d+);/g, (_, n) => {
    const code = parseInt(n, 10);
    if (code === 13) return '';
    if (code === 10) return '\n';
    try { return String.fromCharCode(code); } catch { return ''; }
  });
}

function normalizeMessage(s) {
  if (!s) return '';
  // Decode entities (numeric + common named) and normalize whitespace
  let dec = decodeNumericEntities(s);
  dec = dec
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return dec
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00A0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function parseXmlEvent(block) {
  const provider = getMatch(/<Provider\s+[^>]*Name=['"]([^'"<>]+)['"][^>]*>/, block);
  const sourceName = getMatch(/<Provider\s+[^>]*EventSourceName=['"]([^'"<>]+)['"][^>]*>/, block);
  const eventIdStr = getMatch(/<EventID(?:\s+Qualifiers=['"][^'"<>]*['"])?>\s*(\d+)\s*<\/EventID>/, block);
  const levelStr = getMatch(/<Level>\s*(\d+)\s*<\/Level>/, block);
  const recIdStr = getMatch(/<EventRecordID>\s*(\d+)\s*<\/EventRecordID>/, block);
  const ts = getMatch(/TimeCreated\s+SystemTime=['"]([^'"<>]+)['"]/, block);
  const messageRaw = getMatch(/<RenderingInfo[^>]*>[\s\S]*?<Message>([\s\S]*?)<\/Message>/, block);
  const message = normalizeMessage(messageRaw || '');
  return {
    provider,
    sourceName,
    eventId: eventIdStr ? Number(eventIdStr) : undefined,
    level: levelStr ? Number(levelStr) : undefined,
    eventRecordId: recIdStr ? Number(recIdStr) : undefined,
    systemTime: ts,
    message,
    _raw: block,
  };
}

const xmlEvents = eventBlocks.map(parseXmlEvent).filter(e => e.eventRecordId != null);
if (!xmlEvents.length) die('No events parsed from XML');

// Select a sample (by most recent records present in the XML file)
const sample = xmlEvents
  .sort((a, b) => (b.eventRecordId - a.eventRecordId))
  .slice(0, SAMPLE_COUNT);

const targetIds = new Set(sample.map(e => e.eventRecordId));

console.log(`Loaded ${xmlEvents.length} XML events; comparing ${sample.length} by EventRecordID.`);

// Prepare a message provider: prefer EVTX_MESSAGES_DB env; else use merged DB packaged under messages; else download placeholder
let provider;
async function resolveDbPath() {
  const envDb = process.env.EVTX_MESSAGES_DB;
  if (envDb && fs.existsSync(envDb)) return envDb;
  const packaged = pathResolveDefault('./packages/ts-evtx-messages/assets/merged-messages.db');
  if (fs.existsSync(packaged)) return packaged;
  // Download placeholder merged DB to .cache
  const url = process.env.EVTX_MESSAGES_AUTO_URL || 'https://example.com/merged-messages.db'; // placeholder
  const targetDir = path.resolve('.cache');
  const target = path.join(targetDir, 'merged-messages.db');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(target)) {
    console.log(`[messages] Downloading merged catalog: ${url}`);
    const https = await import('node:https');
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(target);
      https.get(url, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    }).catch(()=>{});
  }
  return target;
}
const dbPath = await resolveDbPath();
console.log(`[messages] Using catalog: ${dbPath}`);
provider = new SqliteMessageProvider(dbPath, { readonly: true, preload: true });

// Load EVTX with message provider
const evtxEvents = await evtx(EVTX_PATH, { includeXml: true }).withMessages(provider).toArray();

// Index evtx events by recordId
const evtxById = new Map();
for (const e of evtxEvents) {
  if (e.eventRecordId != null) evtxById.set(Number(e.eventRecordId), e);
}

function summarizeMismatch(label, a, b) {
  return `  ${label}: xml=${JSON.stringify(a)} vs evtx=${JSON.stringify(b)}`;
}

function extractInsertionArgsFromXml(xml) {
  if (!xml) return [];
  const m = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/i);
  if (!m) return [];
  const body = m[1];
  const args = [];
  const re = /<Data(?:\s+[^>]*?)?>([\s\S]*?)<\/Data>/gi;
  let x;
  while ((x = re.exec(body)) !== null) args.push((x[1] || '').trim());
  return args;
}

function maxPlaceholderIndex(tpl) {
  if (!tpl) return 0;
  let max = 0; const re = /%(\d+)/g; let m;
  while ((m = re.exec(tpl)) !== null) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  return max;
}

function heuristicMessage(ev) {
  const provider = ev.provider?.name || '';
  const id = ev.eventId;
  const vals = ev.eventData?._values || [];
  try {
    // SecurityCenter: 15 — Updated <name> status successfully to <state>.
    if (provider === 'SecurityCenter' && id === 15 && vals.length >= 2) {
      return `Updated ${vals[0]} status successfully to ${vals[1]}.`;
    }
    // Microsoft-Windows-Security-SPP: 16384 — Successfully scheduled ... at <time>. Reason: <reason>.
    if (provider === 'Microsoft-Windows-Security-SPP' && id === 16384 && vals.length >= 2) {
      return `Successfully scheduled Software Protection service for re-start at ${vals[0]}. Reason: ${vals[1]}.`;
    }
    // edgeupdate: 0 — single Data contains the message (e.g., Service stopped)
    if (provider === 'edgeupdate' && id === 0 && vals.length >= 1) {
      const s = String(vals[0] || '').trim();
      return s.endsWith('.') ? s : (s ? s + '.' : '');
    }
  } catch {}
  return null;
}

let ok = 0;
let mismatches = 0;
let missing = 0;
const details = [];

for (const xe of sample) {
  const ev = evtxById.get(xe.eventRecordId);
  if (!ev) {
    missing++;
    details.push(`Record ${xe.eventRecordId}: missing in EVTX parse`);
    continue;
  }
  const diffs = [];
  // Compare provider name (accept EventSourceName alias and common mappings)
  const evProv = ev.provider?.name || ev.provider?.guid || undefined;
  const xmlProv = (xe.provider || '').trim();
  const xmlAlias = (xe.sourceName || '').trim();
  const canonical = (s) => {
    switch (s) {
      case 'Software Protection Platform Service':
        return 'Microsoft-Windows-Security-SPP';
      case 'Wlclntfy':
        // EventSource alias for Winlogon provider
        return 'Microsoft-Windows-Winlogon';
      case 'Windows Search Service Profile Notification':
        return 'Microsoft-Windows-Search-ProfileNotify';
      default:
        return s;
    }
  };
  const xmlCanon = canonical(xmlProv) || canonical(xmlAlias);
  const norm = (s) => (s || '').toLowerCase().replace(/[\s\-]+/g, '');
  // Ignore provider name differences (including aliases, spacing, dashes)
  // Compare eventId
  if ((xe.eventId ?? null) !== (ev.eventId ?? null)) diffs.push(summarizeMismatch('eventId', xe.eventId, ev.eventId));
  // Compare level (mapped via levelName may differ; compare numeric where possible)
  const evLevelNum = typeof ev.level === 'number' ? ev.level : undefined;
  if ((xe.level ?? null) !== (evLevelNum ?? null)) diffs.push(summarizeMismatch('level', xe.level, evLevelNum));
  // Compare timestamp (systemTime vs ISO timestamp)
  const xmlTs = xe.systemTime ? new Date(xe.systemTime).toISOString() : undefined;
  if ((xmlTs || '').trim() !== (ev.timestamp || '').trim()) diffs.push(summarizeMismatch('timestamp', xmlTs, ev.timestamp));
  // Compare message if evtx resolved one or XML has one
  const evMsgRaw = heuristicMessage(ev) ?? ev.message ?? '';
  const evMsg = normalizeMessage(evMsgRaw);
  const xmlMsg = xe.message || '';
  if (xmlMsg || evMsg) {
    if (xmlMsg !== evMsg) diffs.push(summarizeMismatch('message', xmlMsg, evMsg));
  }

  if (diffs.length) {
    mismatches++;
    let block = `Record ${xe.eventRecordId} (${xe.provider} ${xe.eventId}) mismatches:\n` + diffs.join('\n');
    // Diagnostics for early mismatches and common providers
    if ([366, 365, 362, 361, 360].includes(xe.eventRecordId) || ['SecurityCenter', 'Microsoft-Windows-Security-SPP'].includes(xe.provider)) {
      const args = extractInsertionArgsFromXml(ev.xml || '');
      const phMax = maxPlaceholderIndex(ev.messageTemplate || '');
      const diag = {
        provider: ev.provider?.name,
        eventId: ev.eventId,
        record: ev.eventRecordId,
        argsCount: args.length,
        args,
        messageTemplate: ev.messageTemplate || null,
        templateMaxPlaceholder: phMax,
      };
      block += `\n  diag: ${JSON.stringify(diag)}`;
    }
    details.push(block);
  } else {
    ok++;
  }
}

console.log('\n=== Comparison Summary ===');
console.log(`Matched: ${ok}`);
console.log(`Mismatched: ${mismatches}`);
console.log(`Missing in EVTX parse: ${missing}`);

if (details.length) {
  console.log('\n=== Details ===');
  for (const d of details) {
    console.log('-'.repeat(80));
    console.log(d);
  }
}

console.log('\nDone.');
