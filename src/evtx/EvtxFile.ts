import { FileHeader } from "./FileHeader";
import { ChunkHeader } from "./ChunkHeader";
import { Record } from "./Record";
import { BinaryReader } from "../binary/BinaryReader";
import * as fs from 'fs';

export class EvtxFile {
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

  /** Factory method to open an EVTX file from disk */
  static async open(path: string): Promise<EvtxFile> {
    const buffer = await fs.promises.readFile(path);
    
    // Check file size (reasonable limit for EVTX files)
    if (buffer.length > 100 * 1024 * 1024) { // 100MB limit
      throw new Error(`EVTX file too large: ${buffer.length} bytes (max 100MB)`);
    }
    
    return new EvtxFile(buffer);
  }

  /** Synchronous factory method to open an EVTX file from disk */
  static openSync(path: string): EvtxFile {
    const buffer = fs.readFileSync(path);
    
    // Check file size (reasonable limit for EVTX files)
    if (buffer.length > 100 * 1024 * 1024) { // 100MB limit
      throw new Error(`EVTX file too large: ${buffer.length} bytes (max 100MB)`);
    }
    
    return new EvtxFile(buffer);
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
  