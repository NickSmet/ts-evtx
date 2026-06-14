import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { EvtxFile } from '../src/evtx/EvtxFile';

/**
 * Verifies that the chunk-streaming reader (EvtxFile.streamRecords) produces the
 * exact same record sequence as the whole-file reader (EvtxFile.records). Each
 * EVTX chunk is self-contained, so streaming one 64KB chunk at a time must be
 * behavior-identical to parsing the whole file in memory.
 */

const fixturesDir = path.join(__dirname, 'fixtures');
const fixtures = ['System.evtx', 'Application.evtx', 'Security.evtx', 'test.evtx']
  .filter((f) => fs.existsSync(path.join(fixturesDir, f)));

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function recordKey(rec: any): string {
  let xml = 'ERR';
  try { xml = rec.renderXml(); } catch { xml = 'ERR'; }
  return `${rec.recordNum().toString()}|${rec.timestamp().toString()}|${sha256(xml)}`;
}

describe('chunk-streaming reader equivalence', () => {
  jest.setTimeout(600000);

  for (const name of fixtures) {
    it(`${name}: streamRecords matches whole-file records`, async () => {
      const file = path.join(fixturesDir, name);

      const wholeFile = EvtxFile.openSync(file);
      const wholeKeys: string[] = [];
      for (const rec of wholeFile.records()) wholeKeys.push(recordKey(rec));

      const streamKeys: string[] = [];
      for await (const rec of EvtxFile.streamRecords(file)) streamKeys.push(recordKey(rec));

      expect(streamKeys.length).toBe(wholeKeys.length);
      expect(streamKeys).toEqual(wholeKeys);
      expect(streamKeys.length).toBeGreaterThan(0);
    });
  }

  it('readStats matches whole-file getStats', async () => {
    for (const name of fixtures) {
      const file = path.join(fixturesDir, name);
      const whole = EvtxFile.openSync(file).getStats();
      const streamed = await EvtxFile.readStats(file);
      expect(streamed.chunkCount).toBe(whole.chunkCount);
      expect(streamed.nextRecordNumber).toBe(whole.nextRecordNumber);
      expect(streamed.isDirty).toBe(whole.isDirty);
      expect(streamed.isFull).toBe(whole.isFull);
      expect(streamed.majorVersion).toBe(whole.majorVersion);
      expect(streamed.minorVersion).toBe(whole.minorVersion);
    }
  });
});
