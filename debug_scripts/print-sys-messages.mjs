// Print a few random events from System.evtx with resolved messages
import { evtx } from '../dist/index.js';
import { VelocidexDownloader } from '../packages/ts-evtx-messages/dist/downloader/VelocidexDownloader.js';
import { VelocidexCatalogMapper } from '../packages/ts-evtx-messages/dist/catalog/CatalogMapper.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const INPUT = './System.evtx';

if (!fs.existsSync(INPUT)) {
  console.error(`Input not found: ${INPUT}`);
  process.exit(1);
}

async function ensureCatalog() {
  const candidates = VelocidexCatalogMapper.selectByLabelCandidates('win10', { architecture: 'amd64' });
  return VelocidexDownloader.downloadAny(candidates, { cacheDir: './.cache' });
}

function extractInsertionArgs(xml) {
  const m = xml?.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/i);
  if (!m) return [];
  const body = m[1];
  const out = [];
  const re = /<Data(?:\s+[^>]*?)?>([\s\S]*?)<\/Data>/gi;
  let match;
  while ((match = re.exec(body)) !== null) out.push((match[1] || '').trim());
  return out;
}

function applyMessageTemplate(template, args) {
  if (!template) return null;
  let s = template;
  s = s.replace(/%(\d+)/g, (_, n) => args[parseInt(n, 10) - 1] ?? '');
  s = s.replace(/%n/g, '\n');
  s = s.replace(/\{(\d+)\}/g, (_, n) => args[parseInt(n, 10)] ?? '');
  return s;
}

function lookupTemplate(dbPath, provider, eventId) {
  try {
    const sql = `select m.message from messages m join providers p on m.provider_id=p.id where p.name = '${provider.replace(/'/g, "''")}' and m.event_id = ${eventId} limit 1;`;
    const cmd = `sqlite3 -readonly ${dbPath} \"${sql.replace(/\n/g, ' ')}\"`;
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function pickRandom(arr, count) {
  const idxs = new Set();
  while (idxs.size < Math.min(count, arr.length)) {
    idxs.add(Math.floor(Math.random() * arr.length));
  }
  return Array.from(idxs).map(i => arr[i]);
}

const dbPath = await ensureCatalog();

// Read a manageable window and sample from it
const events = await evtx(INPUT, { includeXml: true }).last(500).toArray();
const sample = pickRandom(events, 7);

for (const e of sample) {
  const provider = e.provider?.name;
  const eventId = e.eventId;
  const args = extractInsertionArgs(e.xml || '');
  const tmpl = (provider && typeof eventId === 'number') ? lookupTemplate(dbPath, provider, eventId) : null;
  const msg = tmpl ? applyMessageTemplate(tmpl, args) : null;
  console.log('—'.repeat(80));
  console.log(`Record: ${e.recordNumber}`);
  console.log(`Time:   ${e.timestamp}`);
  console.log(`Prov:   ${provider}`);
  console.log(`Event:  ${eventId}`);
  console.log(`Level:  ${e.levelName}`);
  if (tmpl) {
    console.log('Message:');
    console.log(msg || '(empty)');
  } else {
    console.log('(no template found in catalog)');
  }
}
