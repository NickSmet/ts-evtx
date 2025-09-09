import { Block } from "./Block";
import { BinaryReader } from "../binary/BinaryReader";
import { ChunkHeader } from "./ChunkHeader";
import { BXmlNode } from "./BXmlNode";
export declare class InvalidRecordException extends Error {
    constructor(message?: string);
}
export declare class Record extends Block {
    private _chunk;
    constructor(reader: BinaryReader, offset: number, chunk: ChunkHeader);
    /**
     * Magic number (should be 0x00002a2a)
     */
    magic(): number;
    /**
     * Record size in bytes
     */
    size(): number;
    /**
     * Record number
     */
    recordNum(): bigint;
    /**
     * Timestamp as Windows FILETIME
     */
    timestamp(): bigint;
    /**
     * Timestamp converted to JavaScript Date
     */
    timestampAsDate(): Date;
    /**
     * Size field at the end of the record (should match size())
     */
    size2(): number;
    /**
     * Total length of this record
     */
    length(): number;
    /**
     * Verify record integrity
     */
    verify(): boolean;
    /**
     * Get the root BXml node for this record
     */
    root(): BXmlNode;
    /**
     * Get raw data for this record
     */
    data(): Uint8Array;
    /**
     * Render the complete XML for this record using template + substitutions
     */
    renderXml(): string;
}
