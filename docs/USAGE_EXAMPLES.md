# TS-EVTX Usage Examples

Copy-paste ready examples for common scenarios.

## Fluent Builder

```typescript
import { evtx } from '@ts-evtx/core';

// Last 100 Application events with auto messages → CSV
await evtx('./Application.evtx')
  .withMessages()
  .last(100)
  .toCSV('last-100.csv');

// January 2025 Security logon events → JSONL
await evtx('./Security.evtx')
  .between('2025-01-01', '2025-01-31')
  .where({ eventId: [4624, 4625] })
  .toJSONL('logons.jsonl');
```

## Basic Parsing

### Just get the events as JSON
```typescript
import { evtx } from '@ts-evtx/core';

const events = await evtx('./Security.evtx').toArray();
console.log(JSON.stringify(events, null, 2));
```

### Stream through large files without loading everything
```typescript
import { evtx } from '@ts-evtx/core';

await evtx('./Security.evtx').forEach(event => {
  console.log(`${event.timestamp}: ${event.provider?.name} - Event ${event.eventId}`);
});
```

### Get only the last 100 events
```typescript
import { evtx } from '@ts-evtx/core';

const events = await evtx('./Application.evtx').last(100).toArray();
```

### Filter by date range
```typescript
import { evtx } from '@ts-evtx/core';

await evtx('./System.evtx')
  .between('2025-01-01T00:00:00Z', '2025-01-31T23:59:59Z')
  .forEach(() => { /* Process January 2025 events only */ });
```

## With Message Resolution

### One‑liner: auto messages via builder
```typescript
import { evtx } from '@ts-evtx/core';

const events = await evtx('./Application.evtx')
  .withMessages()
  .last(50)
  .toArray();
// Each event includes a simple top-level `message` when messages are enabled.
// Detailed diagnostics are also available under `messageResolution`.
```

### Auto-detect Windows version and download matching catalog
```typescript
import { evtx } from '@ts-evtx/core';
import { SmartManagedMessageProvider } from '@ts-evtx/messages';

const provider = new SmartManagedMessageProvider({ systemEvtxPath: './System.evtx' });
const events = await evtx('./Application.evtx').withMessages(provider).toArray();
// In most cases `e.message` is the final template-rendered text.
// If the catalog lacks the template, a compact diagnostic is emitted instead.
```

### Use a specific pre-downloaded catalog (concrete Velocidex DB)
```typescript
import { evtx } from '@ts-evtx/core';
import { SqliteMessageProvider } from '@ts-evtx/messages';

const provider = new SqliteMessageProvider('./catalogs/windows.10.enterprise.10.0.17763.amd64.db', { preload: true });
const events = await evtx('./Security.evtx').withMessages(provider).toArray();
// Optionally tune diagnostics verbosity via includeDiagnostics / includeDataItems.
```

### Offline environment (no auto-download)
```typescript
import { SmartManagedMessageProvider } from '@ts-evtx/messages';

const provider = new SmartManagedMessageProvider({
  customDbPath: '/path/to/predownloaded-catalog.db',
  autoDownload: false,
  preload: true
});
```

## Filtering Events

### By Event ID
```typescript
import { evtx } from '@ts-evtx/core';

await evtx('./Security.evtx').where({ eventId: [4624, 4625] }).forEach(e => {
  console.log(`${e.timestamp}: ${e.eventData?.TargetUserName}`);
});
```

### By Provider
```typescript
await evtx('./Application.evtx').where({ provider: 'Microsoft-Windows-RestartManager' }).forEach(e => console.log(e));
```

### By Level (errors and warnings only)
```typescript
await evtx('./System.evtx').where(e => typeof e.level === 'number' && e.level <= 3).forEach(e => console.log(`${e.levelName}: ${e.message}`));
```

## Exporting Data

### To CSV
```typescript
import { evtx } from '@ts-evtx/core';
import { createWriteStream } from 'fs';

const csv = createWriteStream('events.csv');
csv.write('Timestamp,Provider,EventID,Level,Message\n');

await evtx('./Application.evtx').forEach(event => {
  const message = (event.message || '').replace(/"/g, '""');
  csv.write(`"${event.timestamp}","${event.provider?.name}",${event.eventId},${event.levelName},"${message}"\n`);
});
csv.end();
```

### To SQLite
```typescript
import { evtx } from '@ts-evtx/core';
import Database from 'better-sqlite3';

const db = new Database('events.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    record_number TEXT PRIMARY KEY,
    timestamp TEXT,
    provider TEXT,
    event_id INTEGER,
    level TEXT,
    message TEXT,
    raw_xml TEXT
  )
`);

const insert = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)');
await evtx('./Security.evtx').forEach(e => {
  insert.run(e.recordNumber, e.timestamp, e.provider?.name, e.eventId, e.levelName, e.message, (e as any).xml);
});
db.close();
```

### To Elasticsearch/OpenSearch
```typescript
import { evtx } from '@ts-evtx/core';
import { Client } from '@elastic/elasticsearch';

const client = new Client({ node: 'http://localhost:9200' });
await evtx('./Security.evtx').forEach(async e => {
  await client.index({ index: 'windows-events', body: e });
});
```

## Batch Processing

### Process all EVTX files in a directory
```typescript
import { evtx } from '@ts-evtx/core';
import { SmartManagedMessageProvider } from '@ts-evtx/messages';
import { readdirSync } from 'fs';
import { join } from 'path';

const logsDir = 'C:\\Windows\\System32\\winevt\\Logs';
const provider = new SmartManagedMessageProvider({
  systemEvtxPath: join(logsDir, 'System.evtx')
});

const files = readdirSync(logsDir).filter(f => f.endsWith('.evtx')).map(f => join(logsDir, f));
await evtx(files).withMessages(provider).forEach(e => {
  // Process each event
});
```

### Parallel processing with worker threads
```typescript
// main.js
import { Worker } from 'worker_threads';
import { readdirSync } from 'fs';

const files = readdirSync('./logs').filter(f => f.endsWith('.evtx'));

for (const file of files) {
  const worker = new Worker('./worker.js', {
    workerData: { file: `./logs/${file}` }
  });
  
  worker.on('message', (event) => {
    console.log('Processed:', event);
  });
}

// worker.js
import { parentPort, workerData } from 'worker_threads';
import { evtx } from '@ts-evtx/core';

await evtx(workerData.file).forEach(e => parentPort.postMessage(e));
```

## Advanced Scenarios

### Include only specific fields
```typescript
import { evtx } from '@ts-evtx/core';

await evtx('./Application.evtx').forEach(event => {
  const minimal = { time: event.timestamp, id: event.eventId, msg: event.message?.substring(0, 100) };
  console.log(minimal);
});
```

### Chain multiple message providers with fallback
```typescript
import { ChainMessageProvider, SqliteMessageProvider } from '@ts-evtx/messages';

const provider = new ChainMessageProvider([
  new SqliteMessageProvider('./custom-messages.db'),
  new SqliteMessageProvider('./catalogs/windows.10.enterprise.10.0.17763.amd64.db')
]);
```

### Monitor EVTX file for new events (tail -f style)
```typescript
import { EvtxFile } from '@ts-evtx/core';
import { watch } from 'fs';

let lastRecord = 0n;

async function checkNewEvents(path: string) {
  const file = await EvtxFile.open(path);
  
  for (const record of file.records()) {
    if (record.recordNum() > lastRecord) {
      console.log('New event:', record.renderXml());
      lastRecord = record.recordNum();
    }
  }
}

// Initial read
await checkNewEvents('./Application.evtx');

// Watch for changes
watch('./Application.evtx', async (eventType) => {
  if (eventType === 'change') {
    await checkNewEvents('./Application.evtx');
  }
});
```

### Parse from memory buffer instead of file
```typescript
import { EvtxFile } from '@ts-evtx/core';
import { readFileSync } from 'fs';

const buffer = readFileSync('./Security.evtx');
const file = new EvtxFile(new Uint8Array(buffer));

for (const record of file.records()) {
  console.log(record.renderXml());
}
```

### Get statistics before processing
```typescript
import { evtx } from '@ts-evtx/core';

const stats = await evtx('./Application.evtx').stats();
console.log(`
  Records: ${stats.recordCount}
  File size: ${stats.fileSizeBytes}
  Dirty: ${stats.isDirty}
  Full: ${stats.isFull}
  First record: ${stats.oldestRecord}
  Last record: ${stats.newestRecord}
`);
```

## CLI One-Liners

### Export last 1000 events to JSON
```bash
node evtx-query.mjs --input Application.evtx --last 1000 --out recent.json
```

### Filter by provider and event ID
```bash
node evtx-query.mjs --input Security.evtx \
  --provider Microsoft-Windows-Security-Auditing \
  --event-id 4624,4625 \
  --out logons.json
```

### Export with message resolution
```bash
# Auto-detect, download, and export with messages
node evtx-query.mjs --input Application.evtx --with-messages --system System.evtx --out events.json

# Or choose an OS hint (no System.evtx required)
node evtx-query.mjs --input Application.evtx --with-messages --os-hint win10 --out events.json
```

### Convert entire log to JSON
```bash
node evtx-to-json.mjs Application.evtx > application.json
```

## Performance Tips

### For maximum speed (no messages, no XML)
```typescript
await evtx('./huge.evtx', { includeXml: false }).withMessages('off').forEach(() => { /* fastest */ });
```

### Pre-cache messages for batch processing
```typescript
const provider = new SmartManagedMessageProvider({
  systemEvtxPath: './System.evtx',
  preload: true,  // Load entire DB into memory
  maxCacheEntries: 10000
});
```

### Process in chunks to manage memory
```typescript
import { evtx } from '@ts-evtx/core';

const CHUNK_SIZE = 1000;
let batch = [];

await evtx('./massive.evtx').forEach(async e => {
  batch.push(e);
  if (batch.length >= CHUNK_SIZE) {
    await processBatch(batch);
    batch = [];
  }
});
if (batch.length > 0) await processBatch(batch);
```

### Future: deterministic lookups

- As the message catalog adds canonical keys (Provider GUID + EventID + discriminators), message resolution becomes a single lookup.
- When that lands, the hit-or-miss template candidate selection goes away; consumers can treat messages as either found or not.
