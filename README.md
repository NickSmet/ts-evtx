# TS-EVTX

TypeScript‑native EVTX parser for Node.js. Inspired by and closely aligned with Willi Ballenthin’s Python `python-evtx` parsing model (templates, substitution offsets, embedded BXML), but implemented in TypeScript — no Python, no wrappers, minimal dependencies. Clean, flexible builder API and optional message resolution.

-  Parses EVTX records: provider, eventId, level, EventData, and BXML templates + substitutions
-  Optional human‑readable Message text via companion package: `@ts-evtx/messages` (mirrors Event Viewer behavior)

**Note on messages:**
EVTX files don’t store the final “Message” strings. Windows keeps those in per‑provider message catalogs (DLLs) and combines them with EVTX templates at view time. To reproduce that text here, install `@ts-evtx/messages` and use `.withMessages(...)` in the builder.
Learn more: see `docs/EVTX_Introduction.md`.

## Installation

Core:

```bash
npm install @ts-evtx/core
```
For message resolution install companion package:

```bash
npm install @ts-evtx/messages
```

Note: this package was previously published as `ts-evtx`. New code should depend on `@ts-evtx/core`.

## Quick Start

```typescript
import { evtx, EvtxFile } from '@ts-evtx/core';
import { writeFileSync } from 'fs';

// 1) Save to JSON (array)
const events = await evtx('./Application.evtx').toArray();
writeFileSync('events.json', JSON.stringify(events));

// 2) Stream events (low memory)
await evtx('./Application.evtx').forEach(e => {
  console.log(e.timestamp, e.provider?.name, e.eventId);
});

// 3) Builder with messages (simple message included)
// Requires the optional package to be INSTALLED:
//   npm install @ts-evtx/messages
// If not installed, withMessages() throws; install @ts-evtx/messages first.
const withMsgs = await evtx('./Application.evtx').withMessages().last(50).toArray();
// Each event has a convenient e.message when withMessages(...) is used
for (const e of withMsgs) {
  console.log(e.timestamp, e.provider.name, e.message);
}

// If you prefer the detailed object, you can still access
// e.messageResolution.final.message and other diagnostics.

// 4) Advanced: low-level XML (EvtxFile)
const file = await EvtxFile.open('./Application.evtx');
for (const record of file.records()) {
  console.log(record.renderXml());
  break; // show first
}
```

## API Reference

### EvtxFile

The main class for working with EVTX files.

#### Static Methods

- `EvtxFile.open(path: string): Promise<EvtxFile>` - Open an EVTX file asynchronously
- `EvtxFile.openSync(path: string): EvtxFile` - Open an EVTX file synchronously

#### Properties

- `buffer: Uint8Array` - Raw file buffer
- `header: FileHeader` - Parsed file header

#### Methods

- `chunks(): Generator<ChunkHeader>` - Iterate over all chunks
- `records(): Generator<Record>` - Iterate over all records
- `getRecord(num: bigint): Record | null` - Find a specific record by number
- `getStats()` - Get file statistics including version info and dirty flag

### FileHeader

Represents the EVTX file header.

#### Methods

- `magic(): string` - File magic ("ElfFile\0")
- `chunkCount(): number` - Number of chunks in file
- `nextRecordNumber(): bigint` - Next record number to be written
- `majorVersion(): number` - File format major version
- `minorVersion(): number` - File format minor version
- `verify(): boolean` - Verify header CRC and magic
- `isDirty(): boolean` - Check if file was not cleanly closed
- `isFull(): boolean` - Check if file has reached size limit

### ChunkHeader

Represents an EVTX chunk header.

#### Methods

- `magic(): string` - Chunk magic ("ElfChnk\0")
- `logFirstRecordNumber(): bigint` - First record number in chunk
- `logLastRecordNumber(): bigint` - Last record number in chunk
- `verify(): boolean` - Verify chunk CRC
- `records(): Generator<Record>` - Iterate over records in chunk

### Record

Represents an individual EVTX record with full XML rendering support.

#### Methods

- `magic(): number` - Record magic (0x2a2a)
- `size(): number` - Record size in bytes
- `recordNum(): bigint` - Record number
- `timestamp(): bigint` - Record timestamp as Windows FILETIME
- `timestampAsDate(): Date` - Record timestamp as JavaScript Date
- `verify(): boolean` - Verify record integrity
- `data(): Uint8Array` - Raw record data
- `root(): BXmlNode` - Get the root Binary XML node
- `renderXml(): string` - Render complete XML using templates and substitutions

### Builder API

- `evtx(source).withMessages(mode)` – `'auto' | 'off' | provider`
- `.between(since?, until?)` – filter by time range
- `.last(n)` – take last N events
- `.where(object|fn)` – filter by fields or predicate
- `.select(paths)` – pick fields (experimental)
- `.toArray()` – collect in memory
- `.forEach(fn)` – stream events (low memory)
- `.toJSONL(path?)`, `.toCSV(path?)` – write outputs
- `.stats()` – quick file stats

#### ResolvedEvent shape
One event per EVTX record with explicit message-resolution lifecycle:

```
{
  id: number,
  timestamp: string,
  provider: { name: string, alias?: string|null, guid?: string|null },
  eventId: number,
  level?: number, levelName?: string,
  channel?: string, computer?: string,
  core?: { task?, opcode?, keywords?, execution?, security?, correlation? },
  data: { source: 'EventData'|'UserData', fieldCount: number, items: [{name?, value}], note? },
  messageResolution: {
    status: 'resolved'|'fallback'|'unresolved',
    attempts: [{ provider, candidateCount, selected?, reason? }],
    selection?: { templateText, placeholders, fit, argsUsed, args? },
    final?: { message, from: 'template'|'fallback' },
    fallback?: { builtFrom, itemCount, message },
    warnings?: string[], errors?: string[]
  },
  raw?: { xml?: string }
}
```

Simple path: use `messageResolution.final.message` or the helper `finalMessage(e)` to get the display string regardless of template vs fallback.

## Architecture

This library follows the same structure as the original Python implementation with full Binary XML support:

```
src/
├── binary/
│   └── BinaryReader.ts     # Low-level binary parsing
├── evtx/
│   ├── Block.ts           # Base class for all structures
│   ├── FileHeader.ts      # EVTX file header
│   ├── ChunkHeader.ts     # Chunk header
│   ├── Record.ts          # Individual records + XML rendering
│   ├── BXmlNode.ts        # Binary XML node parsing
│   ├── TemplateNode.ts    # Template definitions and rendering
│   ├── VariantValue.ts    # Value type parsing and conversion
│   ├── EvtxFile.ts        # High-level API
│   └── enums.ts           # Constants and enums
└── index.ts               # Main exports
```

## Performance

The library is designed for performance:

- Uses `DataView` for optimal binary parsing
- Streaming iteration to handle large files
- Efficient memory usage with views instead of copies
- CRC32 validation for data integrity
- Full template caching for repeated template usage

## Structured JSON & Streaming

- Use the builder: `.forEach(fn)` for streaming or `.toArray()` to collect.
- Level names are normalized (e.g., numeric 4 → Information).
- Embedded Binary XML (BXML) is fully parsed, including resident templates and substitutions.

### Message provider (optional; preferred)

Many providers store human‑readable messages in external catalogs (message DLLs). To render the final “Message”, supply a `messageProvider` that returns a raw template for `(provider, eventId, locale)`. The parser fills placeholders (`%1`, `%2`, `{0}`, `{1}`) from `<EventData>` automatically.

### Future: deterministic catalog lookups

- Today, catalogs may use provider aliases and loose keys; we record attempts, selection fit, and fallbacks for transparency.
- Once the catalog schema supports canonical keys (e.g., Provider GUID + EventID + discriminators like opcode/task/version), resolution becomes a single lookup: either found or not. In that world, the complex hit‑or‑miss diagnostics largely go away.
- The `ResolvedEvent` shape remains stable — consumers keep using `messageResolution.final.message` (or `e.message` via builder) and may ignore diagnostics entirely.

Companion package (install on demand):

```bash
npm install @ts-evtx/messages
```

Usage with builder:

```ts
import { evtx } from '@ts-evtx/core';
import { SmartManagedMessageProvider } from '@ts-evtx/messages';

// Use the packaged universal catalog (no config)
const provider = new SmartManagedMessageProvider({ preload: true });
// Or specify a custom DB path:
// const provider = new SmartManagedMessageProvider({ customDbPath: './my-catalog.db', preload: true });
const rows = await evtx('Application.evtx').withMessages(provider).last(100).toArray();

Important:
- withMessages() uses a dynamic import. You only need to install `@ts-evtx/messages`; you do not need to import it in your code.
- If the package is not installed, `withMessages()` will throw. Install `@ts-evtx/messages` to enable message resolution.
- For quick use, you can also omit the provider: evtx(file).withMessages(). This uses the packaged universal catalog automatically.
```

For a lower-level custom provider, implement the `MessageProvider` interface and pass it via `.withMessages(provider)`.

## XML Rendering

The library now includes complete Binary XML parsing and rendering:

- **Template System**: Full support for EVTX template instances
- **Substitution Values**: Proper parsing and formatting of all substitution types
- **XML Output**: Generated XML matches Microsoft's Event Viewer output
- **Value Types**: Support for strings, integers, GUIDs, timestamps, binary data, and more

Example XML output:
```xml
<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">
  <System>
    <Provider Name="Microsoft-Windows-Kernel-General" Guid="{A68CA8B7-004F-D7B6-9A87-0E0C40C1F72D}"/>
    <EventID Qualifiers="">1</EventID>
    <Version>0</Version>
    <Level>4</Level>
    <Task>0</Task>
    <Opcode>0</Opcode>
    <Keywords>0x8000000000000000</Keywords>
    <TimeCreated SystemTime="2024-01-15T10:30:45.123456Z"/>
    <EventRecordID>12345</EventRecordID>
    <Correlation ActivityID="{12345678-1234-5678-9ABC-DEF012345678}"/>
    <Execution ProcessID="1234" ThreadID="5678"/>
    <Channel>System</Channel>
    <Computer>DESKTOP-ABC123</Computer>
    <Security UserID="S-1-5-18"/>
  </System>
</Event>
```

## Testing

Run the test suite:

```bash
npm test
```

## Logging

The library does not write to the console by default. Internals use a centralized logger abstraction that is a no‑op until you configure it. This avoids noisy output in consuming apps while still allowing deep diagnostics when needed.

- Default: silent (no logs emitted).
- Global config: call `setLogger(...)` once in your app.
- Namespaces: each module logs under a namespace (e.g., `TemplateNode`, `Record`, `BXmlParser`).

Quick start

```ts
import { setLogger, ConsoleLogger } from '@ts-evtx/core';

// Simple: enable console logging (may be verbose in debug flows)
setLogger(new ConsoleLogger());
```

Filtering log levels

```ts
import { setLogger, ConsoleLogger, withMinLevel } from '@ts-evtx/core';

// Only show info/warn/error (hide debug/trace)
setLogger(withMinLevel(new ConsoleLogger(), 'info'));
```

Integrating with your logger

```ts
import pino from 'pino';
import { setLogger } from '@ts-evtx/core';
const p = pino();
setLogger({
  trace: (m, ...a) => p.trace(m, ...a),
  debug: (m, ...a) => p.debug(m, ...a),
  info:  (m, ...a) => p.info(m, ...a),
  warn:  (m, ...a) => p.warn(m, ...a),
  error: (m, ...a) => p.error(m, ...a),
  child: (ns) => p.child({ ns }) as any,
});
```

Level guidelines used internally

- debug: parsing flow and detailed traces (tokens, offsets, counts)
- info: high‑level lifecycle (e.g., building indexes)
- warn: recoverable anomalies, unimplemented tokens, fallbacks
- error: unexpected exceptions or corrupt data that prevents parsing

Notes

- Examples and debug scripts in this repo intentionally use `console.*` for ad‑hoc debugging; the published library remains silent unless a logger is provided.

## More Examples

For more details and advanced usage (CSV/JSONL sinks, batching), see USAGE_EXAMPLES.md.

## Debugging & Tracing (dev-only)

Preferred workflow is XML parity against an exported log from the same system.

- Export the `.evtx` and a full `.xml` export for the same channel from Event Viewer.
- Use `debug_scripts/compare-xml-evtx.mjs` to compare a sample of events by `EventRecordID`:

  ```bash
  # Compare Application channel (defaults bundled as fixtures):
  npm run compare:app

  # Custom files and sample size
  node debug_scripts/compare-xml-evtx.mjs ./path/Application.xml ./path/Application.evtx 100
  ```

The script resolves messages via `@ts-evtx/messages` and reports mismatches in provider, eventId, timestamp and message. This is more reliable than cross‑language comparisons and keeps iteration focused on our own rendering logic.

## CLI Utilities

Two helper scripts are included for common workflows (kept outside the library API to keep the core minimal):

- `evtx-query.mjs` — flexible JSON exporter with filters and message provider support
  - Examples:
    - Last 100 events (pretty JSON):
      - `node evtx-query.mjs --input ./test/fixtures/Application.evtx --last 100 --pretty --out last-100.json`
    - With message provider for final message formatting (via @ts-evtx/messages):
      - `node evtx-query.mjs --input ./test/fixtures/Application.evtx --last 200 --out last-200.json`
    - Provider/eventId/temporal filters:
      - `node evtx-query.mjs --input Application.evtx --provider Microsoft-Windows-CAPI2 --event-id 4097 --since 2025-06-01T00:00:00Z`

- `evtx-to-json.mjs` — export all events; has `--structured-only`, `--include-xml`, and pagination options.


## Demo Script

See `demo-application-events.mjs` for a complete example of parsing Application event logs.

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass (`npm test`)
2. Code follows TypeScript best practices
3. New features include tests
4. Documentation is updated

## License

This project is licensed under the MIT License.

## Acknowledgments

This library is based on the excellent work of the [python-evtx](https://github.com/williballenthin/python-evtx) project by Willi Ballenthin.