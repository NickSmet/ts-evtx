import { Block } from '../src/evtx/Block';
import { BinaryReader } from '../src/binary/BinaryReader';

// Test implementation of Block
class TestBlock extends Block {
  constructor(reader: BinaryReader, offset: number) {
    super(reader, offset);
  }

  // Expose protected methods for testing
  public testU8(rel: number) { return this.u8(rel); }
  public testU16(rel: number) { return this.u16(rel); }
  public testU32(rel: number) { return this.u32(rel); }
  public testU64(rel: number) { return this.u64(rel); }
  public testBytes(rel: number, len: number) { return this.bytes(rel, len); }
  public testCheckBounds(rel: number, len: number) { return this.checkBounds(rel, len); }

  // Test memoization
  private callCount = 0;

  // @memoize - temporarily disabled for ES module compatibility
  expensiveOperation(input: number): number {
    this.callCount++;
    return input * 2;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

describe('Block', () => {
  let reader: BinaryReader;
  let block: TestBlock;

  beforeEach(() => {
    // Create test buffer with known values
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    
    // Set up test data at offset 16 (where our block will start)
    view.setUint8(16, 0x42);
    view.setUint16(17, 0x1234, true);
    view.setUint32(19, 0x12345678, true);
    view.setUint32(23, 0x12345678, true);
    view.setUint32(27, 0x9ABCDEF0, true);
    
    reader = new BinaryReader(buffer);
    block = new TestBlock(reader, 16); // Block starts at offset 16
  });

  describe('helper methods', () => {
    it('should read u8 correctly with relative offset', () => {
      expect(block.testU8(0)).toBe(0x42);
    });

    it('should read u16 correctly with relative offset', () => {
      expect(block.testU16(1)).toBe(0x1234);
    });

    it('should read u32 correctly with relative offset', () => {
      expect(block.testU32(3)).toBe(0x12345678);
    });

    it('should read u64 correctly with relative offset', () => {
      const result = block.testU64(7);
      const expected = (0x9ABCDEF0n << 32n) | 0x12345678n;
      expect(result).toBe(expected);
    });

    it('should read bytes correctly with relative offset', () => {
      const bytes = block.testBytes(0, 4);
      expect(bytes[0]).toBe(0x42);
      expect(bytes.length).toBe(4);
    });
  });

  describe('bounds checking', () => {
    it('should not throw for valid bounds', () => {
      expect(() => block.testCheckBounds(0, 1)).not.toThrow();
      expect(() => block.testCheckBounds(0, 48)).not.toThrow(); // 64 - 16 = 48 max
    });

    it('should throw for out-of-bounds access', () => {
      expect(() => block.testCheckBounds(48, 1)).toThrow(/overrun/i);
      expect(() => block.testCheckBounds(0, 49)).toThrow(/overrun/i);
      expect(() => block.testCheckBounds(-1, 1)).toThrow(/overrun/i);
    });

    it('should throw when reading beyond buffer', () => {
      expect(() => block.testU8(48)).toThrow(/overrun/i);
      expect(() => block.testU32(45)).toThrow(/overrun/i);
    });
  });

  describe('memoization', () => {
    it('should track call count (no cache active)', () => {
      const r1 = block.expensiveOperation(5);
      expect(r1).toBe(10);
      expect(block.getCallCount()).toBe(1);

      const r2 = block.expensiveOperation(5);
      expect(r2).toBe(10);
      expect(block.getCallCount()).toBe(2);

      const r3 = block.expensiveOperation(7);
      expect(r3).toBe(14);
      expect(block.getCallCount()).toBe(3);
    });

    it('should handle multiple instances independently', () => {
      const block2 = new TestBlock(reader, 32);
      
      block.expensiveOperation(5);
      expect(block.getCallCount()).toBe(1);
      expect(block2.getCallCount()).toBe(0);

      block2.expensiveOperation(5);
      expect(block.getCallCount()).toBe(1);
      expect(block2.getCallCount()).toBe(1);
    });
  });
});
