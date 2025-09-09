import { BinaryReader, align, filetimeToDate, crc32Checksum } from '../src/binary/BinaryReader';

describe('BinaryReader', () => {
  let reader: BinaryReader;
  let buffer: ArrayBuffer;

  beforeEach(() => {
    // Create a test buffer with known values
    buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    
    // Set up test data
    view.setUint8(0, 0x42);  // u8
    view.setInt8(1, -128);   // i8
    view.setUint16(2, 0x1234, true);  // u16le
    view.setInt16(4, -32768, true);   // i16le
    view.setUint32(6, 0x12345678, true);  // u32le
    view.setInt32(10, -2147483648, true); // i32le
    
    // 64-bit values
    view.setUint32(14, 0x12345678, true);  // lo
    view.setUint32(18, 0x9ABCDEF0, true);  // hi
    
    view.setFloat32(22, 3.14159, true);    // f32le
    view.setFloat64(26, 2.718281828, true); // f64le
    
    reader = new BinaryReader(buffer);
  });

  describe('unsigned integers', () => {
    it('should read u8 correctly', () => {
      expect(reader.u8At(0)).toBe(0x42);
    });

    it('should read u16le correctly', () => {
      expect(reader.u16leAt(2)).toBe(0x1234);
    });

    it('should read u32le correctly', () => {
      expect(reader.u32leAt(6)).toBe(0x12345678);
    });

    it('should read u64le correctly', () => {
      const result = reader.u64leAt(14);
      const expected = (0x9ABCDEF0n << 32n) | 0x12345678n;
      expect(result).toBe(expected);
    });
  });

  describe('signed integers', () => {
    it('should read i8 correctly', () => {
      expect(reader.i8At(1)).toBe(-128);
    });

    it('should read i16le correctly', () => {
      expect(reader.i16leAt(4)).toBe(-32768);
    });

    it('should read i32le correctly', () => {
      expect(reader.i32leAt(10)).toBe(-2147483648);
    });

    it('should read i64le correctly', () => {
      // Test with a negative value
      const buffer = new ArrayBuffer(8);
      const view = new DataView(buffer);
      view.setUint32(0, 0xFFFFFFFF, true);  // lo = -1
      view.setUint32(4, 0xFFFFFFFF, true);  // hi = -1
      const reader = new BinaryReader(buffer);
      
      expect(reader.i64leAt(0)).toBe(-1n);
    });
  });

  describe('floating point', () => {
    it('should read f32le correctly', () => {
      const result = reader.f32leAt(22);
      expect(result).toBeCloseTo(3.14159, 5);
    });

    it('should read f64le correctly', () => {
      const result = reader.f64leAt(26);
      expect(result).toBeCloseTo(2.718281828, 9);
    });
  });

  describe('raw slices', () => {
    it('should return correct bytes slice', () => {
      const bytes = reader.bytesAt(0, 4);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(4);
      expect(bytes[0]).toBe(0x42);
    });

    it('should return view without copying', () => {
      const bytes = reader.bytesAt(0, 4);
      // This should be a view, not a copy
      expect(bytes.buffer).toBe(buffer);
    });
  });

  describe('bounds checking', () => {
    it('should throw on out-of-bounds read', () => {
      expect(() => reader.u8At(64)).toThrow('Buffer overrun');
      expect(() => reader.u32leAt(61)).toThrow('Buffer overrun');
      expect(() => reader.bytesAt(60, 10)).toThrow('Buffer overrun');
    });

    it('should throw on negative offset', () => {
      expect(() => reader.u8At(-1)).toThrow('Buffer overrun');
    });
  });

  describe('utilities', () => {
    it('should return correct buffer size', () => {
      expect(reader.size).toBe(64);
    });
  });

  describe('construction from Uint8Array', () => {
    it('should work with Uint8Array input', () => {
      const uint8Array = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
      const reader = new BinaryReader(uint8Array);
      
      expect(reader.u8At(0)).toBe(0x12);
      expect(reader.u32leAt(0)).toBe(0x78563412);
    });
  });
});

describe('Utility functions', () => {
  describe('align', () => {
    it('should align correctly', () => {
      expect(align(0, 4)).toBe(0);
      expect(align(1, 4)).toBe(4);
      expect(align(3, 4)).toBe(4);
      expect(align(4, 4)).toBe(4);
      expect(align(5, 4)).toBe(8);
      expect(align(7, 8)).toBe(8);
      expect(align(8, 8)).toBe(8);
      expect(align(9, 8)).toBe(16);
    });
  });

  describe('filetimeToDate', () => {
    it('should handle zero correctly', () => {
      const result = filetimeToDate(0n);
      expect(result.getTime()).toBe(0);
    });

    it('should convert FILETIME correctly', () => {
      // Test with a known FILETIME value
      // January 1, 2000 00:00:00 UTC = 125911584000000000 in FILETIME
      const filetime = 125911584000000000n;
      const result = filetimeToDate(filetime);
      const expected = new Date('2000-01-01T00:00:00.000Z');
      
      expect(result.getTime()).toBe(expected.getTime());
    });

    it('should handle epoch correctly', () => {
      // Unix epoch in FILETIME = 116444736000000000
      const filetime = 116444736000000000n;
      const result = filetimeToDate(filetime);
      const expected = new Date('1970-01-01T00:00:00.000Z');
      
      expect(result.getTime()).toBe(expected.getTime());
    });
  });

  describe('crc32Checksum', () => {
    it('should calculate CRC32 correctly', () => {
      const data = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
      const result = crc32Checksum(data);
      
      // CRC32 of "Hello" should be a specific value
      expect(typeof result).toBe('number');
      expect(result).not.toBe(0);
    });
  });
}); 