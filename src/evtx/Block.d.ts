import { BinaryReader } from "../binary/BinaryReader";
export declare function memoize(target: any, key: string, descriptor: PropertyDescriptor): void;
export declare abstract class Block {
    protected readonly r: BinaryReader;
    readonly offset: number;
    private __cache?;
    constructor(r: BinaryReader, offset: number);
    /** Convert relative → absolute offset */
    protected abs(rel: number): number;
    /** Check bounds to prevent buffer overruns */
    protected checkBounds(rel: number, len: number): void;
    protected u8(rel: number): number;
    protected i8(rel: number): number;
    protected u16(rel: number): number;
    protected i16(rel: number): number;
    protected u32(rel: number): number;
    protected i32(rel: number): number;
    protected u64(rel: number): bigint;
    protected i64(rel: number): bigint;
    protected f32(rel: number): number;
    protected f64(rel: number): number;
    protected bytes(rel: number, len: number): Uint8Array;
    string8(offset: number, length: number): string;
    /**
     * Reads a null-terminated UTF-16 little-endian string.
     * @param offset The offset from the start of the block.
     * @param length The maximum length to read.
     */
    wstring(offset: number, length: number): string;
}
