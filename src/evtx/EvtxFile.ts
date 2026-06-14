import { FileHeader } from "./FileHeader";
import { ChunkHeader } from "./ChunkHeader";
import { Record } from "./Record";
import { BinaryReader } from "../binary/BinaryReader";
import * as fs from 'fs';

export class EvtxFile {
  /** Size of the EVTX file header region (bytes). */
  static readonly FILE_HEADER_SIZE = 0x1000;
  /** Size of a single EVTX chunk (bytes). */
  static readonly CHUNK_SIZE = 0x10000;

  private readonly _buffer: Uint8Array;
  private readonly _reader: BinaryReader;
  private readonly _header: FileHeader;

  private constructor(buffer: Uint8Array) {
    this._buffer = buffer;
    this._reader = new BinaryReader(buffer);
    this._header = new FileHeader(this._reader, 0);

    // Verify the file header
    if (!this._header.verify()) {
      throw new Error('Invalid EVTX file: header verification failed');
    }
  }

  /** Memory buffer of entire file */
  get buffer(): Uint8Array {
    return this._buffer;
  }

  /** Parsed file header */
  get header(): FileHeader {
    return this._header;
  }

  /** Iterate over all chunks in the file */
  *chunks(): Generator<ChunkHeader> {
    yield* this._header.chunks();
  }

  /** Iterate over all records in the file */
  *records(): Generator<Record> {
    for (const chunk of this.chunks()) {
      yield* chunk.records();
    }
  }

  /** Get a specific record by record number */
  getRecord(num: bigint): Record | null {
    return this._header.getRecord(num);
  }

  /**
   * Factory method to open an EVTX file from disk (loads the whole file).
   *
   * This keeps the entire file resident in memory, which is convenient for
   * random access (e.g. getRecord). For large files prefer streamRecords(),
   * which keeps only the file header and the current 64KB chunk resident.
   */
  static async open(path: string): Promise<EvtxFile> {
    const buffer = await fs.promises.readFile(path);
    return new EvtxFile(buffer);
  }

  /** Synchronous factory method to open an EVTX file from disk (loads the whole file). */
  static openSync(path: string): EvtxFile {
    const buffer = fs.readFileSync(path);
    return new EvtxFile(buffer);
  }

  /**
   * Read just the file header (first 4KB) and return file-level statistics
   * without loading the whole file. Useful for the streaming path, where the
   * total record count (nextRecordNumber) is needed up front.
   */
  static async readStats(path: string): Promise<{
    fileSize: number;
    chunkCount: number;
    nextRecordNumber: bigint;
    isDirty: boolean;
    isFull: boolean;
    majorVersion: number;
    minorVersion: number;
  }> {
    const fd = await fs.promises.open(path, 'r');
    try {
      const headerBuf = new Uint8Array(EvtxFile.FILE_HEADER_SIZE);
      const { bytesRead } = await fd.read(headerBuf, 0, headerBuf.length, 0);
      if (bytesRead < headerBuf.length) {
        throw new Error(`EVTX file too small: ${bytesRead} bytes`);
      }
      const header = new FileHeader(new BinaryReader(headerBuf), 0);
      if (!header.verify()) {
        throw new Error('Invalid EVTX file: header verification failed');
      }
      const { size } = await fd.stat();
      return {
        fileSize: size,
        chunkCount: header.chunkCount(),
        nextRecordNumber: header.nextRecordNumber(),
        isDirty: header.isDirty(),
        isFull: header.isFull(),
        majorVersion: header.majorVersion(),
        minorVersion: header.minorVersion(),
      };
    } finally {
      await fd.close();
    }
  }

  /**
   * Stream records by reading one 64KB chunk at a time from disk.
   *
   * Unlike open()/openSync(), which load the entire file into memory, this keeps
   * only the file header (4KB) and the current chunk (64KB) resident, so peak
   * raw-buffer memory stays bounded regardless of file size. Each EVTX chunk is
   * self-contained — records, templates and the string table all use
   * chunk-relative offsets — so per-chunk parsing is equivalent to whole-file
   * parsing. Records are yielded in the same order as records().
   */
  static async *streamRecords(path: string): AsyncGenerator<Record> {
    const fd = await fs.promises.open(path, 'r');
    try {
      const headerBuf = new Uint8Array(EvtxFile.FILE_HEADER_SIZE);
      const { bytesRead: hdrRead } = await fd.read(headerBuf, 0, headerBuf.length, 0);
      if (hdrRead < headerBuf.length) {
        throw new Error(`EVTX file too small: ${hdrRead} bytes`);
      }
      const header = new FileHeader(new BinaryReader(headerBuf), 0);
      if (!header.verify()) {
        throw new Error('Invalid EVTX file: header verification failed');
      }

      const baseOffset = header.headerChunkSize();
      const chunkCount = header.chunkCount();
      for (let i = 0; i < chunkCount; i++) {
        // Allocate a fresh buffer per chunk so that yielded records never alias
        // a buffer that a later iteration would overwrite.
        const chunkBuf = new Uint8Array(EvtxFile.CHUNK_SIZE);
        const { bytesRead } = await fd.read(
          chunkBuf,
          0,
          chunkBuf.length,
          baseOffset + i * EvtxFile.CHUNK_SIZE
        );
        // Mirror records()/chunks(): only whole 64KB chunks are processed.
        if (bytesRead < chunkBuf.length) break;
        const chunk = new ChunkHeader(new BinaryReader(chunkBuf), 0);
        // records() throws InvalidRecordException internally for non-chunk
        // regions and yields nothing, matching the whole-file behavior.
        yield* chunk.records();
      }
    } finally {
      await fd.close();
    }
  }

  /** Get file statistics */
  getStats() {
    return {
      fileSize: this._buffer.length,
      chunkCount: this._header.chunkCount(),
      nextRecordNumber: this._header.nextRecordNumber(),
      isDirty: this._header.isDirty(),
      isFull: this._header.isFull(),
      majorVersion: this._header.majorVersion(),
      minorVersion: this._header.minorVersion(),
    };
  }
}

/* ------------------------------------------------------------------
 File: src/xml/escape.ts
 Tiny helpers replacing `xml.sax.saxutils` + regex logic.
 ------------------------------------------------------------------*/
export interface XmlEscaper {
  attr(value: string): string;          // `"foo & bar"` →  `"foo &amp; bar"`
  text(value: string): string;          // includes restricted-char stripping
}
  