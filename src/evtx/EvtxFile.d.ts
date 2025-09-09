import { FileHeader } from "./FileHeader";
import { ChunkHeader } from "./ChunkHeader";
import { Record } from "./Record";
export declare class EvtxFile {
    private readonly _buffer;
    private readonly _reader;
    private readonly _header;
    private constructor();
    /** Memory buffer of entire file */
    get buffer(): Uint8Array;
    /** Parsed file header */
    get header(): FileHeader;
    /** Iterate over all chunks in the file */
    chunks(): Generator<ChunkHeader>;
    /** Iterate over all records in the file */
    records(): Generator<Record>;
    /** Get a specific record by record number */
    getRecord(num: bigint): Record | null;
    /** Factory method to open an EVTX file from disk */
    static open(path: string): Promise<EvtxFile>;
    /** Synchronous factory method to open an EVTX file from disk */
    static openSync(path: string): EvtxFile;
    /** Get file statistics */
    getStats(): {
        fileSize: number;
        chunkCount: number;
        nextRecordNumber: bigint;
        isDirty: boolean;
        isFull: boolean;
        majorVersion: number;
        minorVersion: number;
    };
}
export interface XmlEscaper {
    attr(value: string): string;
    text(value: string): string;
}
