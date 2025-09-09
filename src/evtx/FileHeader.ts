import { Block } from "./Block";
import { BinaryReader, crc32Checksum } from "../binary/BinaryReader";
import { ChunkHeader } from "./ChunkHeader";

// Field offsets for FileHeader
const OFF_MAGIC = 0x00;              // 8 bytes
const OFF_OLDEST_CHUNK = 0x08;       // 8 bytes
const OFF_CURRENT_CHUNK_NUMBER = 0x10; // 8 bytes
const OFF_NEXT_RECORD_NUMBER = 0x18;   // 8 bytes
const OFF_HEADER_SIZE = 0x20;          // 4 bytes
const OFF_MINOR_VERSION = 0x24;        // 2 bytes
const OFF_MAJOR_VERSION = 0x26;        // 2 bytes
const OFF_HEADER_CHUNK_SIZE = 0x28;    // 2 bytes
const OFF_CHUNK_COUNT = 0x2A;          // 2 bytes
const OFF_UNUSED1 = 0x2C;              // 0x4C bytes
const OFF_FLAGS = 0x78;                // 4 bytes
const OFF_CHECKSUM = 0x7C;             // 4 bytes

export class FileHeader extends Block {
  constructor(reader: BinaryReader, offset: number) {
    super(reader, offset);
  }

  /* Field accessors ----------------------------------------------------------- */
  magic(): string {
    const bytes = this.bytes(OFF_MAGIC, 8);
    return new TextDecoder('utf-8').decode(bytes);
  }

  oldestChunk(): bigint {
    return this.u64(OFF_OLDEST_CHUNK);
  }

  currentChunkNumber(): bigint {
    return this.u64(OFF_CURRENT_CHUNK_NUMBER);
  }

  nextRecordNumber(): bigint {
    return this.u64(OFF_NEXT_RECORD_NUMBER);
  }

  headerSize(): number {
    return this.u32(OFF_HEADER_SIZE);
  }

  minorVersion(): number {
    return this.u16(OFF_MINOR_VERSION);
  }

  majorVersion(): number {
    return this.u16(OFF_MAJOR_VERSION);
  }

  headerChunkSize(): number {
    return this.u16(OFF_HEADER_CHUNK_SIZE);
  }

  chunkCount(): number {
    return this.u16(OFF_CHUNK_COUNT);
  }

  flags(): number {
    return this.u32(OFF_FLAGS);
  }

  checksum(): number {
    return this.u32(OFF_CHECKSUM);
  }

  /* Helper methods ------------------------------------------------------------ */
  checkMagic(): boolean {
    try {
      return this.magic() === "ElfFile\0";
    } catch {
      return false;
    }
  }

  calculateChecksum(): number {
    const data = this.bytes(0, 0x78);
    return crc32Checksum(data) >>> 0; // Convert to unsigned 32-bit
  }

  verify(): boolean {
    return (
      this.checkMagic() &&
      this.majorVersion() === 0x3 &&
      (this.minorVersion() === 0x1 || this.minorVersion() === 0x2) && // Accept both 3.1 and 3.2
      this.headerChunkSize() === 0x1000 &&
      this.checksum() === this.calculateChecksum()
    );
  }

  isDirty(): boolean {
    return (this.flags() & 0x1) === 0x1;
  }

  isFull(): boolean {
    return (this.flags() & 0x2) === 0x2;
  }

  /* Chunk navigation ---------------------------------------------------------- */
  firstChunk(): ChunkHeader {
    const offset = this.offset + this.headerChunkSize();
    return new ChunkHeader(this.r, offset);
  }

  currentChunk(): ChunkHeader {
    const offset = this.offset + this.headerChunkSize() + Number(this.currentChunkNumber()) * 0x10000;
    return new ChunkHeader(this.r, offset);
  }

  *chunks(includeInactive: boolean = false): Generator<ChunkHeader> {
    const maxChunks = includeInactive ? Number.MAX_SAFE_INTEGER : this.chunkCount();
    let i = 0;
    let offset = this.offset + this.headerChunkSize();
    
    while (offset + 0x10000 <= this.r.size && i < maxChunks) {
      yield new ChunkHeader(this.r, offset);
      offset += 0x10000;
      i++;
    }
  }

  /* Record lookup ------------------------------------------------------------- */
  getRecord(recordNum: bigint): any | null {
    for (const chunk of this.chunks()) {
      const firstRecord = chunk.logFirstRecordNumber();
      const lastRecord = chunk.logLastRecordNumber();
      
      if (!(firstRecord <= recordNum && recordNum <= lastRecord)) {
        continue;
      }
      
      for (const record of chunk.records()) {
        if (record.recordNum() === recordNum) {
          return record;
        }
      }
    }
    return null;
  }
}
