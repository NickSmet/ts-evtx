// Import CRC32
import CRC32 from 'crc-32';

export class BinaryReader {
  private readonly dataView: DataView;
  private readonly buffer: ArrayBuffer;
  private position: number = 0; // Current reading position for streaming

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } else {
      this.buffer = buffer;
    }
    this.dataView = new DataView(this.buffer);
  }

  /* streaming position methods ------------------------------------------------ */
  tell(): number {
    return this.position;
  }

  seek(position: number): void {
    if (position < 0 || position > this.buffer.byteLength) {
      throw new Error(`Invalid seek position: ${position}, buffer size is ${this.buffer.byteLength}`);
    }
    this.position = position;
  }

  peek(): number {
    if (this.position >= this.buffer.byteLength) {
      throw new Error(`Buffer overrun: trying to peek at position ${this.position}, buffer size is ${this.buffer.byteLength}`);
    }
    return this.dataView.getUint8(this.position);
  }

  /* streaming read methods ---------------------------------------------------- */
  // These methods read from the current position and advance it
  u8(): number {
    const value = this.u8At(this.position);
    this.position += 1;
    return value;
  }

  u16le(): number {
    const value = this.u16leAt(this.position);
    this.position += 2;
    return value;
  }

  u32le(): number {
    const value = this.u32leAt(this.position);
    this.position += 4;
    return value;
  }

  u32be(): number {
    const value = this.u32beAt(this.position);
    this.position += 4;
    return value;
  }

  u64le(): bigint {
    const value = this.u64leAt(this.position);
    this.position += 8;
    return value;
  }

  i8(): number {
    const value = this.i8At(this.position);
    this.position += 1;
    return value;
  }

  i16le(): number {
    const value = this.i16leAt(this.position);
    this.position += 2;
    return value;
  }

  i32le(): number {
    const value = this.i32leAt(this.position);
    this.position += 4;
    return value;
  }

  i64le(): bigint {
    const value = this.i64leAt(this.position);
    this.position += 8;
    return value;
  }

  f32le(): number {
    const value = this.f32leAt(this.position);
    this.position += 4;
    return value;
  }

  f64le(): number {
    const value = this.f64leAt(this.position);
    this.position += 8;
    return value;
  }

  wstring(): string {
    const length = this.u16le(); // String length in characters
    let result = '';
    for (let i = 0; i < length; i++) {
      const char = this.u16le();
      result += String.fromCharCode(char);
    }
    return result;
  }

  readBuffer(length: number): Uint8Array {
    const value = this.bytesAt(this.position, length);
    this.position += length;
    return value;
  }

  /* absolute position methods (original) ------------------------------------- */
  u8At(offset: number): number {
    this.checkBounds(offset, 1);
    return this.dataView.getUint8(offset);
  }

  i8At(offset: number): number {
    this.checkBounds(offset, 1);
    return this.dataView.getInt8(offset);
  }

  u16leAt(offset: number): number {
    this.checkBounds(offset, 2);
    return this.dataView.getUint16(offset, true); // little endian
  }

  i16leAt(offset: number): number {
    this.checkBounds(offset, 2);
    return this.dataView.getInt16(offset, true);
  }

  u32leAt(offset: number): number {
    this.checkBounds(offset, 4);
    return this.dataView.getUint32(offset, true);
  }

  u32beAt(offset: number): number {
    this.checkBounds(offset, 4);
    return this.dataView.getUint32(offset, false); // big endian
  }

  i32leAt(offset: number): number {
    this.checkBounds(offset, 4);
    return this.dataView.getInt32(offset, true);
  }

  u64leAt(offset: number): bigint {
    this.checkBounds(offset, 8);
    // Compose from two 32-bit parts for compatibility
    const lo = BigInt(this.dataView.getUint32(offset, true));
    const hi = BigInt(this.dataView.getUint32(offset + 4, true));
    return (hi << 32n) | lo;
  }

  i64leAt(offset: number): bigint {
    this.checkBounds(offset, 8);
    // Read as signed by converting from unsigned
    const unsignedValue = this.u64leAt(offset);
    // Check if the sign bit is set (bit 63)
    if (unsignedValue >= (1n << 63n)) {
      return unsignedValue - (1n << 64n);
    }
    return unsignedValue;
  }

  /* floating point ------------------------------------------------------------ */
  f32leAt(offset: number): number {
    this.checkBounds(offset, 4);
    return this.dataView.getFloat32(offset, true);
  }

  f64leAt(offset: number): number {
    this.checkBounds(offset, 8);
    return this.dataView.getFloat64(offset, true);
  }

  // Aliases for backward compatibility (these conflict with streaming methods, removing)
  // f32le(offset: number): number {
  //   return this.f32leAt(offset);
  // }

  // f64le(offset: number): number {
  //   return this.f64leAt(offset);
  // }

  /* raw slices ---------------------------------------------------------------- */
  bytesAt(offset: number, length: number): Uint8Array {
    this.checkBounds(offset, length);
    return new Uint8Array(this.buffer, offset, length);
  }

  // Alias for backward compatibility
  bytes(offset: number, length: number): Uint8Array {
    return this.bytesAt(offset, length);
  }

  /* bounds checking ----------------------------------------------------------- */
  private checkBounds(offset: number, length: number): void {
    if (offset < 0 || offset + length > this.buffer.byteLength) {
      throw new Error(`Buffer overrun: trying to read ${length} bytes at offset ${offset}, buffer size is ${this.buffer.byteLength}`);
    }
  }

  /* size and utilities -------------------------------------------------------- */
  get size(): number {
    return this.buffer.byteLength;
  }
}

/* Utility functions ---------------------------------------------------------- */

/**
 * Align offset to the nearest greater given alignment
 */
export function align(offset: number, alignment: number): number {
  if (offset % alignment === 0) {
    return offset;
  }
  return offset + (alignment - (offset % alignment));
}

/**
 * Convert Windows FILETIME (100ns intervals since 1601-01-01) to JavaScript Date
 */
export function filetimeToDate(qword: bigint): Date {
  if (qword === 0n) {
    return new Date(0);
  }

  try {
    // FILETIME epoch starts at 1601-01-01, Unix epoch at 1970-01-01
    // Difference is 11644473600 seconds = 116444736000000000 * 100ns intervals
    const unixTimeNs = qword - 116444736000000000n;
    const unixTimeMs = Number(unixTimeNs / 10000n); // Convert to milliseconds
    return new Date(unixTimeMs);
  } catch {
    return new Date(0);
  }
}

/**
 * Re-export CRC32 function
 */
export function crc32Checksum(buffer: Uint8Array): number {
  return CRC32.buf(buffer);
}