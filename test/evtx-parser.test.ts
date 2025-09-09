import { evtx } from '../src/query';
import { EvtxFile } from '../src/evtx/EvtxFile';
import * as path from 'path';
import * as fs from 'fs';

describe('EVTX Builder API', () => {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const testFiles = {
    system: path.join(fixturesDir, 'System.evtx'),
    security: path.join(fixturesDir, 'Security.evtx'),
    application: path.join(fixturesDir, 'Application.evtx')
  };
  const primary = testFiles.system;

  describe('toArray/last', () => {
    it('parses with last N', async () => {
      const results = await evtx(primary).last(10).toArray();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(10);
      const first = results[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('timestamp');
      expect(first).toHaveProperty('provider');
    });
  });

  describe('stats', () => {
    it('returns friendly stats via builder', async () => {
      const stats = await evtx(primary).stats();
      expect(stats).toHaveProperty('recordCount');
      expect(stats).toHaveProperty('fileSizeBytes');
    });
  });

  describe('low-level EvtxFile (advanced)', () => {
    it('can open file and iterate records', async () => {
      const f = await EvtxFile.open(primary);
      let count = 0;
      for (const rec of f.records()) { count++; if (count > 3) break; }
      expect(count).toBeGreaterThan(0);
    });
  });
});
