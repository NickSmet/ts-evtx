# TS-EVTX

TypeScript‑native EVTX parser for Node.js. Inspired by and closely aligned with Willi Ballenthin’s Python `python-evtx` parsing model (templates, substitution offsets, embedded BXML), but implemented in TypeScript — no Python, no wrappers, minimal dependencies. Clean, flexible builder API and optional message resolution.

-  Parses EVTX records: provider, eventId, level, EventData, and BXML templates + substitutions
-  Optional human‑readable Message text via companion package: `@ts-evtx/messages` (mirrors Event Viewer behavior)
-  Built for speed and correctness

Note on messages:
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

## Gentle Introduction: EVTX, Binary XML, Templates, and Substitutions

Some context on the difficulties associated with parsing evtx files. For more details please review (EVTX_Introduction.md)[./docs/EVTX_Introduction.md]

- **What EVTX is:** Windows Event Log files (EVTX) store events in fixed‑size 64KB chunks. Each chunk contains records (events) and two lookup tables: a string table and a template table. Every event is encoded as Binary XML (BXML), a compact tokenized representation rather than plain text XML.
- **Binary XML basics:** Instead of literal XML text like <Event><System>…</System></Event>, EVTX encodes nodes as one‑byte tokens (e.g., StartOfStream 0x0F, OpenStartElement 0x01, Attribute 0x06, CloseElement 0x04). Each node has a well‑defined declared length so parsers can skip and index efficiently.
- **String table:** Tag and attribute names (like Event, Provider, Name) live in the chunk’s string table. Tokens reference names by chunk‑relative offsets. Sometimes the name string appears inline near the token (“inline string”); other times it’s elsewhere in the chunk.
- **Template table:** Providers define per‑event templates that describe the XML “shape”: which tags appear and where substitutions go. A TemplateInstance node (token 0x0C) points at the Template definition by offset. Templates are small BXML snippets with a single root element and a fixed internal layout.
- **Substitutions (the dynamic data):** At the end of a BXML Root, you’ll find a substitution header: a 32‑bit count followed by that many (size, type, pad) tuples. The values that follow (numbers, strings, FILETIME, GUIDs, SID, Hex32/64, even BXml) fill the “holes” in the template.
- **Declared vs consumed bytes (mental model tip):**
  - Declared length is what the node says it spans (used to locate the substitution header exactly like python‑evtx).
  - Consumed bytes is how far the reader advanced while parsing. For correct substitution positioning, rely on declared length, not just consumed bytes.
- **Embedded BXML:** Some substitutions are self‑contained BXML fragments. They include their own TemplateInstance and substitution header. Embedded BXML uses the same absolute chunk address space as the outer record—so precise boundaries matter.

### What this library does

- **Reads EVTX structure:** FileHeader → Chunks → Records, with validation (magic values, CRCs).
- **Parses Binary XML:** Token by token, constructing nodes with accurate lengths and references to the string and template tables.
- **Resolves templates:** Loads TemplateNode (resident or table‑based) and builds an ActualTemplateNode for rendering.
- **Parses substitutions:** Finds the substitution header precisely at the end of declared BXML children, reads declarations, then parses values via VariantValueParser.
- **Renders XML:** Applies substitutions into the ActualTemplate to produce XML. Embedded BXML substitutions are parsed and rendered recursively.

### Why EVTX is structured this way

- **Space efficiency and speed:** Tokenized XML with shared strings/templates saves space and accelerates parsing.
- **Stability:** Declared lengths and fixed token formats allow skipping, indexing, and validation even if some records are partially corrupted.
- **Templating:** Providers ship templates so consumers don’t need custom parsers per event type. Substitutions carry the event’s variable parts.

## Postmortem: Partial Failures We Fixed

Recent work focused on achieving python‑evtx parity for embedded BXML. Two issues caused mismatches and confusing traces:

- **1) Misreading substitution header bytes as tokens (embedded mode):**
  - Problem: After parsing the embedded TemplateInstance, the parser kept reading tokens and accidentally treated the first substitution count byte (e.g., 0x14) as if it were a token (like CloseElement). That shifted the “declared children length” and made the count/declarations nonsensical.
  - Fix: In embedded mode, stop token parsing immediately after the TemplateInstance. The substitution header begins right after the TemplateInstance’s declared bytes. Then read count and declarations from that exact baseOffset + declared position (matching python‑evtx).

- **2) Reader side‑effects when loading strings/templates:**
  - Problem: Looking up NameStringNode or TemplateNode with the main reader advanced its position, so subsequent node parsing started from the wrong offset. This cascaded into wrong tag_length math and boundary checks.
  - Fix: Load strings/templates using a cloned BinaryReader over the full file bytes. The main parsing cursor stays stable; no hidden side‑effects.

- **3) Inline name strings and tag_length accounting (background):**
  - Context: OpenStartElement and Attribute nodes may include the name string inline. Getting these lengths right is essential because python‑evtx computes the substitution start from the sum of declared node lengths. The TS implementation now mirrors python’s semantics for inline strings and positioning.

### Outcome

- With the fixes above (bounded embedded parsing after TemplateInstance + cloned readers for string/template loads), embedded BXML mismatches dropped to zero across Application.evtx, System.evtx, and Security.evtx using the included comparison scripts.

### Helpful scripts

- `node debug_scripts/trace-top-level.mjs <file.evtx> <recordNumber>`: Trace top‑level record parsing and substitutions.
- `node debug_scripts/trace-embedded-bxml.mjs <file.evtx> <recordNumber>`: Trace embedded BXML fragments within a record.
- `node debug_scripts/compare-xml-evtx.mjs <xml> <evtx> [sampleN]`: Compare events and messages to a trusted XML export.
