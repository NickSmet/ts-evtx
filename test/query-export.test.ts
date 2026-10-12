import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Writable } from 'stream';
import { evtx } from '../src/query';

const fixtures = path.join(__dirname, 'fixtures');
const SYSTEM = path.join(fixtures, 'System.evtx');
const APPLICATION = path.join(fixtures, 'Application.evtx');

/** A Writable that collects everything written to it. */
function collector() {
  const chunks: Buffer[] = [];
  const stream = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

const ts = (e: any) => e.timestamp as string;

describe('query exports stream instead of buffering', () => {
  jest.setTimeout(60000);

  it('toJSONL writes one JSON line per event and ends the stream', async () => {
    const expected = await evtx(SYSTEM).toArray();
    const out = collector();
    await evtx(SYSTEM).toJSONL(out.stream);

    const lines = out.text().split('\n').filter(Boolean);
    expect(lines.length).toBe(expected.length);
    expect(lines.map((l) => ts(JSON.parse(l)))).toEqual(expected.map(ts));
    expect(out.stream.writableEnded).toBe(true);
  });

  it('toCSV writes a header and one row per event', async () => {
    const expected = await evtx(SYSTEM).toArray();
    const out = collector();
    await evtx(SYSTEM).toCSV(out.stream);
    const text = out.text();
    expect(text.startsWith('Timestamp,Provider,EventID,Level,Message\n')).toBe(true);
    // messages can span lines, rows always start with a quoted ISO timestamp
    expect(text.split('\n').filter((l) => /^"\d{4}-\d{2}-\d{2}T/.test(l)).length).toBe(expected.length);
    expect(out.stream.writableEnded).toBe(true);
  });

  it('toCSV can omit the header', async () => {
    const out = collector();
    await evtx(SYSTEM).last(2).toCSV(out.stream, { header: false });
    expect(out.text().startsWith('"')).toBe(true);
  });

  it('writes to a file path', async () => {
    const file = path.join(os.tmpdir(), `evtx-export-${process.pid}-${Date.now()}.jsonl`);
    try {
      await evtx(SYSTEM).last(5).toJSONL(file);
      expect(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length).toBe(5);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('reports progress once per input file, like toArray does', async () => {
    const progress: string[] = [];
    const q = () => evtx([SYSTEM, APPLICATION], { onProgress: (p) => progress.push(`${p.filesDone}/${p.filesTotal}`) });
    await q().last(3).toJSONL(collector().stream);
    expect(progress).toEqual(['1/2', '2/2']);
    progress.length = 0;
    await q().last(3).toArray();
    expect(progress).toEqual(['1/2', '2/2']);
  });
});

describe('last(n) across several inputs', () => {
  jest.setTimeout(60000);

  it('returns the last n events of the combined result, not n per file', async () => {
    const all = [...(await evtx(SYSTEM).toArray()), ...(await evtx(APPLICATION).toArray())];
    const got = await evtx([SYSTEM, APPLICATION]).last(7).toArray();
    expect(got.map(ts)).toEqual(all.slice(-7).map(ts));
  });

  it('applies the predicate to the per-file tails, then keeps the last n overall', async () => {
    const n = 9;
    const pred = (e: any) => new Date(e.timestamp).getSeconds() % 2 === 0;
    const tails = [
      ...(await evtx(SYSTEM).toArray()).slice(-n),
      ...(await evtx(APPLICATION).toArray()).slice(-n),
    ].filter(pred);
    const got = await evtx([SYSTEM, APPLICATION]).where(pred).last(n).toArray();
    expect(got.map(ts)).toEqual(tails.slice(-n).map(ts));
  });

  it('exports honour the same global last(n)', async () => {
    const all = [...(await evtx(SYSTEM).toArray()), ...(await evtx(APPLICATION).toArray())];
    const out = collector();
    await evtx([SYSTEM, APPLICATION]).last(11).toJSONL(out.stream);
    expect(out.text().split('\n').filter(Boolean).map((l) => ts(JSON.parse(l)))).toEqual(all.slice(-11).map(ts));
  });
});

describe('export failures surface instead of hanging or being swallowed', () => {
  jest.setTimeout(60000);

  it('rejects when the destination cannot be created', async () => {
    const bad = path.join(os.tmpdir(), `evtx-no-such-dir-${process.pid}`, 'out.jsonl');
    await expect(evtx(SYSTEM).last(2).toJSONL(bad)).rejects.toThrow(/ENOENT/);
  });

  it('rejects when the stream errors while writing', async () => {
    let writes = 0;
    const failing = new Writable({
      highWaterMark: 1,
      write(_c, _e, cb) { cb(writes++ >= 1 ? new Error('disk full') : undefined); },
    });
    failing.on('error', () => { /* the caller has its own listener */ });
    await expect(evtx(SYSTEM).toJSONL(failing)).rejects.toThrow('disk full');
  });

  it('rejects when the stream is destroyed while we wait for it to drain', async () => {
    const dying = new Writable({ highWaterMark: 1, write() { setTimeout(() => dying.destroy(), 5); } });
    dying.on('error', () => { /* ignore */ });
    await expect(evtx(SYSTEM).toCSV(dying)).rejects.toThrow(/closed before it drained|premature close/i);
  });

  it('does not destroy a stream the caller handed in', async () => {
    const out = collector();
    await expect(
      evtx(SYSTEM).where(() => { throw new Error('predicate failed'); }).toJSONL(out.stream),
    ).rejects.toThrow('predicate failed');
    expect(out.stream.destroyed).toBe(false);
  });
});
