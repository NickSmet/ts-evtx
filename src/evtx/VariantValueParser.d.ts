import { BinaryReader } from '../binary/BinaryReader';
import { VariantType } from './enums';
export { VariantType };
export type ParsedVariant = string | number | bigint | Date | Uint8Array | object | null | boolean | string[];
export interface ParsedVariantResult {
    value: ParsedVariant;
    consumedBytes: number;
}
/**
 * Parser for EVTX variant values
 */
export declare class VariantValueParser {
    private r;
    constructor(r: BinaryReader);
    /**
     * Parse a variant value based on its type
     * @param type The VariantType to parse
     * @param expectedLength Optional expected length for validation
     * @returns Object containing the parsed value and number of bytes consumed
     */
    parse(type: VariantType, expectedLength?: number): ParsedVariantResult;
    private parseWString;
    private parseWStringWithLength;
    private parseString;
    private parseStringWithLength;
    private parseBinary;
    private parseGuid;
    private parseFileTime;
    private parseSystemTime;
    private parseSid;
    private parseBXml;
    private parseBXmlWithLength;
    private parseWStringArrayWithLength;
    private parseWStringArray;
}
export declare function parseVariant(r: BinaryReader, type: VariantType, length: number): ParsedVariant;
