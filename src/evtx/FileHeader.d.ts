import { Block } from "./Block";
import { BinaryReader } from "../binary/BinaryReader";
import { ChunkHeader } from "./ChunkHeader";
export declare class FileHeader extends Block {
    constructor(reader: BinaryReader, offset: number);
    magic(): string;
    oldestChunk(): bigint;
    currentChunkNumber(): bigint;
    nextRecordNumber(): bigint;
    headerSize(): number;
    minorVersion(): number;
    majorVersion(): number;
    headerChunkSize(): number;
    chunkCount(): number;
    flags(): number;
    checksum(): number;
    checkMagic(): boolean;
    calculateChecksum(): number;
    verify(): boolean;
    isDirty(): boolean;
    isFull(): boolean;
    firstChunk(): ChunkHeader;
    currentChunk(): ChunkHeader;
    chunks(includeInactive?: boolean): Generator<ChunkHeader>;
    getRecord(recordNum: bigint): any | null;
}
