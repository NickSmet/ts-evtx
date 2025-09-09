import { VariantType } from "./enums";
import { BinaryReader } from "../binary/BinaryReader";
import { ChunkHeader } from "./ChunkHeader";
import { BXmlNode } from "./BXmlNode";
export interface VariantValue {
    readonly type: VariantType;
    /** Byte length of the encoded value */
    length(): number;
    /** String view (XML-escaped later) */
    toString(): string;
}
export declare class WStringValue implements VariantValue {
    readonly type = VariantType.WString;
    private value;
    private valueLength;
    constructor(r: BinaryReader, declaredLength?: number);
    length(): number;
    toString(): string;
}
export declare class UnsignedDWordValue implements VariantValue {
    readonly type = VariantType.UnsignedDWord;
    private value;
    constructor(r: BinaryReader);
    length(): number;
    toString(): string;
}
export declare class UnsignedWordValue implements VariantValue {
    readonly type = VariantType.UnsignedWord;
    private value;
    constructor(r: BinaryReader);
    length(): number;
    toString(): string;
}
export declare class NullValue implements VariantValue {
    readonly type = VariantType.Null;
    private valueLength;
    constructor(declaredLength?: number);
    length(): number;
    toString(): string;
}
export declare class VariantValueFactory {
    static fromStream(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode, type: VariantType, declaredLength?: number): VariantValue;
}
