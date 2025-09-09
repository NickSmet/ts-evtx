import { EvtxFile } from '../src/evtx/EvtxFile';
import * as path from 'path';

describe('EvtxFile', () => {
  let evtxFile: EvtxFile;
  const testFilePath = path.join(__dirname, 'fixtures', 'System.evtx');

  beforeAll(async () => {
    evtxFile = await EvtxFile.open(testFilePath);
  });

  describe('Factory methods', () => {
    it('should open file asynchronously', async () => {
      const file = await EvtxFile.open(testFilePath);
      expect(file).toBeInstanceOf(EvtxFile);
      expect(file.buffer).toBeInstanceOf(Uint8Array);
      expect(file.buffer.length).toBeGreaterThan(0);
    });

    it('should open file synchronously', () => {
      const file = EvtxFile.openSync(testFilePath);
      expect(file).toBeInstanceOf(EvtxFile);
      expect(file.buffer).toBeInstanceOf(Uint8Array);
      expect(file.buffer.length).toBeGreaterThan(0);
    });

    it('should throw on invalid file', async () => {
      // Create a buffer with invalid magic
      const invalidBuffer = new Uint8Array(1024);
      invalidBuffer.set(new TextEncoder().encode('Invalid'), 0);
      
      expect(() => new (EvtxFile as any)(invalidBuffer)).toThrow('Invalid EVTX file');
    });
  });

  describe('Properties', () => {
    it('should have valid buffer', () => {
      expect(evtxFile.buffer).toBeInstanceOf(Uint8Array);
      expect(evtxFile.buffer.length).toBeGreaterThan(1000);
    });

    it('should have valid header', () => {
      expect(evtxFile.header).toBeDefined();
      expect(evtxFile.header.magic()).toBe('ElfFile\0');
      expect(evtxFile.header.verify()).toBe(true);
    });
  });

  describe('Iteration methods', () => {
    it('should iterate chunks', () => {
      const chunks = Array.from(evtxFile.chunks());
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBe(evtxFile.header.chunkCount());
      
      for (const chunk of chunks) {
        expect(chunk.magic()).toBe('ElfChnk\0');
        expect(chunk.verify()).toBe(true);
      }
    });

    it('should iterate records', () => {
      let recordCount = 0;
      let lastRecordNum = 0n;
      
      for (const record of evtxFile.records()) {
        recordCount++;
        expect(record.magic()).toBe(0x2a2a);
        expect(record.verify()).toBe(true);
        expect(record.recordNum()).toBeGreaterThan(lastRecordNum);
        lastRecordNum = record.recordNum();
        
        // Only check first 10 records for performance
        if (recordCount >= 10) break;
      }
      
      expect(recordCount).toBe(10);
    });

    it('should count all records efficiently', () => {
      let totalRecords = 0;
      
      for (const chunk of evtxFile.chunks()) {
        for (const record of chunk.records()) {
          totalRecords++;
        }
      }
      
      expect(totalRecords).toBeGreaterThan(0);
    });
  });

  describe('Record lookup', () => {
    it('should find existing records', () => {
      // Get the first record number from the first chunk
      const firstChunk = Array.from(evtxFile.chunks())[0];
      const firstRecordNum = firstChunk.logFirstRecordNumber();
      
      const record = evtxFile.getRecord(firstRecordNum);
      expect(record).not.toBeNull();
      expect(record!.recordNum()).toBe(firstRecordNum);
    });

    it('should return null for non-existent records', () => {
      const record = evtxFile.getRecord(999999999n);
      expect(record).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should provide file statistics', () => {
      const stats = evtxFile.getStats();
      
      expect(stats.fileSize).toBeGreaterThan(0);
      expect(stats.chunkCount).toBeGreaterThan(0);
      expect(stats.nextRecordNumber).toBeGreaterThan(0n);
      expect(typeof stats.isDirty).toBe('boolean');
      expect(typeof stats.isFull).toBe('boolean');
      expect(stats.majorVersion).toBe(3);
      expect([1, 2]).toContain(stats.minorVersion);
    });
  });

  describe('Performance', () => {
    it('should handle large iteration efficiently', () => {
      const start = Date.now();
      let count = 0;
      
      // Count first 1000 records
      for (const record of evtxFile.records()) {
        count++;
        if (count >= 1000) break;
      }
      
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
      expect(count).toBe(1000);
    });
  });
}); 
