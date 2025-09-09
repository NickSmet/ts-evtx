import { BinaryReader } from "../binary/BinaryReader";

// Memoization decorator
export function memoize(
  target: any,
  key: string,
  descriptor: PropertyDescriptor
) {
  const fn = descriptor.value;
  const cacheKey = Symbol(key);
  descriptor.value = function (this: any, ...args: any[]) {
    const map = this.__cache ?? (this.__cache = new Map());
    const k = JSON.stringify(args);
    if (!map.has(cacheKey)) map.set(cacheKey, new Map());
    const sub = map.get(cacheKey);
    if (!sub.has(k)) sub.set(k, fn.apply(this, args));
    return sub.get(k);
  };
}

export abstract class Block {
  private __cache?: Map<symbol, Map<string, any>>;

  constructor(protected readonly r: BinaryReader, public readonly offset: number) {}

  /** Convert relative → absolute offset */
  protected abs(rel: number): number {
    return this.offset + rel;
  }

  /** Check bounds to prevent buffer overruns */
  protected checkBounds(rel: number, len: number): void {
    if (rel < 0 || len < 0) {
      throw new Error(`Block overrun: negative offset or length not allowed (rel=${rel}, len=${len})`);
    }
    const absOffset = this.abs(rel);
    if (absOffset + len > this.r.size) {
      throw new Error(`Block overrun: trying to read ${len} bytes at relative offset ${rel} (absolute ${absOffset}), buffer size is ${this.r.size}`);
    }
  }

  /* Short-hand readers (delegate to BinaryReader) ----------------------------- */
  protected u8(rel: number): number {
    return this.r.u8At(this.abs(rel));
  }

  protected i8(rel: number): number {
    return this.r.i8At(this.abs(rel));
  }

  protected u16(rel: number): number {
    return this.r.u16leAt(this.abs(rel));
  }

  protected i16(rel: number): number {
    return this.r.i16leAt(this.abs(rel));
  }

  protected u32(rel: number): number {
    return this.r.u32leAt(this.abs(rel));
  }

  protected i32(rel: number): number {
    return this.r.i32leAt(this.abs(rel));
  }

  protected u64(rel: number): bigint {
    return this.r.u64leAt(this.abs(rel));
  }

  protected i64(rel: number): bigint {
    return this.r.i64leAt(this.abs(rel));
  }

  protected f32(rel: number): number {
    this.checkBounds(rel, 4);
    return this.r.f32leAt(this.abs(rel));
  }

  protected f64(rel: number): number {
    this.checkBounds(rel, 8);
    return this.r.f64leAt(this.abs(rel));
  }

  protected bytes(rel: number, len: number): Uint8Array {
    this.checkBounds(rel, len);
    return this.r.bytes(this.abs(rel), len);
  }

  string8(offset: number, length: number): string {
    const bytes = this.bytes(offset, length);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * Reads a null-terminated UTF-16 little-endian string.
   * @param offset The offset from the start of the block.
   * @param length The maximum length to read.
   */
  wstring(offset: number, length: number): string {
    const bytes = this.bytes(offset, length * 2);
    // Use TextDecoder for robust UTF-16 LE decoding
    const decoded = new TextDecoder('utf-16le').decode(bytes);
    // Trim any trailing null characters
    return decoded.replace(/\0+$/, '');
  }
}