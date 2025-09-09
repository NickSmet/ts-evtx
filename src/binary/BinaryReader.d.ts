export declare class BinaryReader {
    private readonly dataView;
    private readonly buffer;
    private position;
    constructor(buffer: ArrayBuffer | Uint8Array);
    tell(): number;
    seek(position: number): void;
    peek(): number;
    u8(): number;
    u16le(): number;
    u32le(): number;
    u32be(): number;
    u64le(): bigint;
    i8(): number;
    i16le(): number;
    i32le(): number;
    i64le(): bigint;
    f32le(): number;
    f64le(): number;
    wstring(): string;
    readBuffer(length: number): Uint8Array;
    u8At(offset: number): number;
    i8At(offset: number): number;
    u16leAt(offset: number): number;
    i16leAt(offset: number): number;
    u32leAt(offset: number): number;
    u32beAt(offset: number): number;
    i32leAt(offset: number): number;
    u64leAt(offset: number): bigint;
    i64leAt(offset: number): bigint;
    f32leAt(offset: number): number;
    f64leAt(offset: number): number;
    bytesAt(offset: number, length: number): Uint8Array;
    bytes(offset: number, length: number): Uint8Array;
    private checkBounds;
    get size(): number;
}
/**
 * Align offset to the nearest greater given alignment
 */
export declare function align(offset: number, alignment: number): number;
/**
 * Convert Windows FILETIME (100ns intervals since 1601-01-01) to JavaScript Date
 */
export declare function filetimeToDate(qword: bigint): Date;
/**
 * Re-export CRC32 function
 */
export declare function crc32Checksum(buffer: Uint8Array): number;
