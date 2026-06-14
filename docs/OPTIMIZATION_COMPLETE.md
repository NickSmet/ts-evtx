# EVTX Parser Optimization - Complete Summary

> **Update (June 2026):** The "automatic concurrent" path described below was
> **removed**. On a single Node.js thread `Promise.all()` cannot parallelize the
> synchronous, CPU-bound parsing work, so it added memory pressure without real
> speedup. The library now **always streams**. A **chunk-streaming reader**
> (`EvtxFile.streamRecords`) was added that parses one 64KB chunk at a time from
> disk, bounding peak raw-buffer memory to ~one chunk (measured **5.07MB → 0.07MB,
> ~76x** on the largest fixture; the saving scales with file size), and the old
> arbitrary 100MB file-size cap was removed. A later behavior-preserving refactor
> pass (guarded by a golden-output regression harness) tightened the hot paths.
> The historical numbers below predate these changes and refer to a 20MB sample
> file that is not in the repo; treat them as historical. Current suite: **78
> tests passing**. See the "Streaming & memory (current)" section at the end.

## Final Performance (historical)

**Original**: 55 events/sec (245 seconds for 13,426 events)  
**Optimized**: 11,207 events/sec (1.2 seconds for 13,426 events)  
**Improvement**: **204x faster** 🚀

**With Message Provider** (historical; the concurrent path has since been removed):
- Sequential: 1,709 events/sec
- ~~Automatic Concurrent: 5,144 events/sec (3x faster)~~ — removed, see update note above

## Key Achievements

### 1. Memory Fix (Critical)
**Problem**: BinaryReader was copying the entire file buffer for every node
```typescript
// BEFORE: Copied 20MB buffer for every node (50-100 per record!)
this.buffer = buffer.buffer.slice(...)

// AFTER: Shared buffer with offset/length
this.buffer = buffer.buffer;
this.dataView = new DataView(this.buffer, this.byteOffset, this.byteLength);
```

**Impact**:
- Memory: 7-8GB → 70MB (100x reduction)
- Speed: Enabled 76x performance improvement
- **This was the breakthrough that unlocked everything**

### 2. ~~Automatic Concurrent Processing~~ (removed June 2026)
This optimization was **reverted**. The query builder used to switch to a
`parseResolvedEventsConcurrent(file, options, batchSize)` path when a message
provider was present, on the assumption that batching with `Promise.all()` would
overlap the work. In practice the parsing is synchronous and CPU-bound, so on a
single thread it ran serially anyway while the batch buffered extra records in
memory. It also subtly broke the `last` option.

The builder and `parseResolvedEvents`/`readResolvedEvents` now **always stream**
record-by-record (and, since the chunk-streaming reader landed, chunk-by-chunk
from disk). See "Streaming & memory (current)" below.

### 3. Architectural Optimizations
- String table pre-loading
- Template pre-loading and caching
- RootNode caching per record
- Fast-path extraction (skip XML when not needed)
- Debug logging gates

**Combined impact**: 2.67x improvement

## User Experience

### Before
```typescript
// Slow, high memory usage
const events = await evtx('large-file.evtx')
  .withMessages()
  .toArray();

// Result: 245 seconds, 7-8GB RAM
```

### After
```typescript
// Fast and low memory: streams chunk-by-chunk
const events = await evtx('large-file.evtx')
  .withMessages()
  .toArray();

// For very large files, stream instead of collecting into an array:
await evtx('large-file.evtx')
  .withMessages()
  .forEach(e => { /* process one at a time, ~one 64KB chunk resident */ });
```

**No API changes** - users get streaming behavior automatically.

## Technical Details

### Why the concurrent path was removed

JavaScript's event loop **cannot parallelize synchronous CPU work**:
- **Pure parsing**: all synchronous → `Promise.all()` provides no benefit; batches
  simply run one after another on the single thread.
- **Message resolution**: the bundled `@ts-evtx/messages` provider reads from a
  local SQLite catalog, which `better-sqlite3` executes **synchronously**. So
  there was no async I/O to overlap either.

The net effect of the "concurrent" path was extra memory (a batch of records held
at once) for no measured speedup, plus an off-by-one in the `last` option. It was
removed in favor of always streaming. See "Streaming & memory (current)".

## Files Modified

### Core Fix
- `src/binary/BinaryReader.ts` - Share buffers, don't copy

### Optimizations
- `src/evtx/ChunkHeader.ts` - Pre-loading, caching (single string table)
- `src/evtx/Record.ts` - RootNode caching, debug gates, deterministic substitution offset
- `src/evtx/node-specialisations.ts` - Use optimized getString()
- `src/api.ts` - Fast extraction, conditional XML, streaming resolved events
- `src/logging/logger.ts` - Debug logging flag

### Streaming (June 2026)
- `src/evtx/EvtxFile.ts` - `streamRecords()` / `readStats()`; removed 100MB cap
- `src/api.ts` - `readResolvedEvents()` streams chunk-by-chunk; concurrent path removed
- `src/query.ts` - always streams (no concurrent detection)
- `index.ts` - exports `parseResolvedEvents` / `readResolvedEvents` only (no concurrent export)

## Validation

✅ All 78 tests pass (incl. golden-output regression + streaming equivalence)  
✅ Memory: streaming keeps peak raw buffer at ~one 64KB chunk (5.07MB → 0.07MB on the largest fixture)  
✅ Performance: large historical gains from the buffer-sharing fix retained  
✅ Backward compatible: public API unchanged (concurrent helper was internal-only)  
✅ Automatic: streaming is the default; no user intervention needed

## What We Learned

### 1. Memory Profiling is Critical
- Tests passed with the buffer copying bug
- Only memory profiling revealed the issue
- Small test files masked the problem
- **Lesson**: Always profile memory, not just correctness

### 2. ArrayBuffer.slice() is a Trap
- Looks like it creates a view, but it **copies**
- Use `DataView(buffer, offset, length)` instead
- This one line caused 100x memory bloat

### 3. Concurrent Processing Needs Async Work
- Promise.all() can't parallelize CPU-bound sync code
- Only helps when there are genuine async operations (I/O)
- Here both parsing and the SQLite catalog reads are synchronous, so it never helped — the "automatic concurrent" path was ultimately removed

### 4. Simplicity Wins
- Removed the concurrent path entirely; the library always streams
- Fewer moving parts, lower memory, and a fix for the `last` off-by-one
- Users get streaming behavior with zero configuration

## Comparison to Alternatives

### Worker Threads (Rejected)
- Overhead: 80ms per worker
- 315 chunks × 80ms = 25 seconds just for workers
- **Result**: 25x slower than sequential
- **Verdict**: Not viable for this use case

### Promise.all() Concurrent (tried, then removed)
- Overhead: < 1ms
- Only helps when there is genuine async I/O to overlap
- **Result**: no speedup here (parsing and the SQLite catalog reads are synchronous), and it buffered a batch of records in memory
- **Verdict**: removed in favor of always streaming ❌

## Future Considerations

### Potential Optimizations (Not Implemented)
1. **Streaming XML rendering**: Build XML incrementally
2. **Binary search on record offsets**: O(log n) record lookup
3. **Shared template cache across files**: Reuse templates
4. **WASM for critical paths**: 2-3x additional speedup?

**Why not now?**
- 204x improvement is sufficient
- Diminishing returns
- Added complexity
- Current performance meets real-world needs

## Conclusion

Starting from 55 events/sec, we achieved:
1. **Large pure-parsing improvement** through the memory fix + caching/fast-path optimizations
2. **100x memory reduction** from the original buffer-copying bug (7-8GB → 70MB on the 20MB sample)
3. **Zero configuration** - works transparently

The key was finding and fixing the critical buffer copying bug in BinaryReader, which was hiding underneath the initial optimizations and blocking all further progress.

## Streaming & memory (current)

After the optimization work above, a follow-up pass focused on memory and
correctness:

- **Always stream**: the fake "concurrent" path was removed; the builder and
  `parseResolvedEvents`/`readResolvedEvents` stream record-by-record.
- **Chunk-streaming reader**: `EvtxFile.streamRecords(path)` reads one 64KB chunk
  at a time from disk (plus a 4KB header via `EvtxFile.readStats`). Each EVTX
  chunk is self-contained, so this is behavior-identical to whole-file parsing —
  asserted by a streaming-equivalence test (same record number, timestamp and
  rendered XML for every record). Peak raw-buffer memory dropped from **5.07MB to
  0.07MB (~76x)** on the largest fixture and scales with file size.
- **No size cap**: the arbitrary 100MB limit in `open`/`openSync` was removed.
- **Behavior-preserving refactor**: deterministic substitution offset, one-pass
  XML escaping, `TextDecoder`-based wide-string decoding, per-record layout
  memoization, a typed node-`kind` discriminant, and removal of a duplicate
  per-chunk string table — all validated byte-for-byte by a golden-output
  regression harness.

---

**Date**: October 1, 2025 (updated June 2026)  
**Status**: Optimization complete ✅  
**Memory**: streaming keeps peak raw buffer at ~one 64KB chunk  
**API**: Clean and automatic (always streaming)  
**Tests**: 78 passing (golden-output + streaming equivalence included)  
**Ready for production**: Yes! 🚀

