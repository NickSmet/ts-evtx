import { VariantType } from "./enums";
import { BinaryReader } from "../binary/BinaryReader";
import { ChunkHeader } from "./ChunkHeader";
import { BXmlNode } from "./BXmlNode";
import { getLogger } from "../logging/logger.js";

export interface VariantValue {
  readonly type: VariantType;
  /** Byte length of the encoded value */
  length(): number;
  /** String view (XML-escaped later) */
  toString(): string;
}

// Simple variant value implementations for substitution parsing
export class WStringValue implements VariantValue {
  public readonly type = VariantType.WString;
  private value: string;
  private valueLength: number;

  constructor(r: BinaryReader, declaredLength?: number) {
    if (declaredLength !== undefined) {
      // Read exactly declaredLength bytes as UTF-16
      this.valueLength = declaredLength;
      const bytes = r.readBuffer(declaredLength);
      this.value = new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
    } else {
      // Read length-prefixed string
      const strLen = r.u16le();
      this.valueLength = 2 + strLen * 2;
      this.value = r.wstring();
    }
  }

  length(): number {
    return this.valueLength;
  }

  toString(): string {
    return this.value;
  }
}

export class UnsignedDWordValue implements VariantValue {
  public readonly type = VariantType.UnsignedDWord;
  private value: number;

  constructor(r: BinaryReader) {
    this.value = r.u32le();
  }

  length(): number {
    return 4;
  }

  toString(): string {
    return this.value.toString();
  }
}

export class UnsignedWordValue implements VariantValue {
  public readonly type = VariantType.UnsignedWord;
  private value: number;

  constructor(r: BinaryReader) {
    this.value = r.u16le();
  }

  length(): number {
    return 2;
  }

  toString(): string {
    return this.value.toString();
  }
}

export class NullValue implements VariantValue {
  public readonly type = VariantType.Null;
  private valueLength: number;

  constructor(declaredLength: number = 0) {
    this.valueLength = declaredLength;
  }

  length(): number {
    return this.valueLength;
  }

  toString(): string {
    return "";
  }
}

// Factory for creating variant values
export class VariantValueFactory {
  private static _log = getLogger('VariantValue');
  public static fromStream(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode,
    type: VariantType,
    declaredLength?: number
  ): VariantValue {
    switch (type) {
      case VariantType.Null:
        // Skip declaredLength bytes for null values
        if (declaredLength && declaredLength > 0) {
          r.readBuffer(declaredLength);
        }
        return new NullValue(declaredLength || 0);
      
      case VariantType.WString:
        return new WStringValue(r, declaredLength);
      
      case VariantType.UnsignedDWord:
        return new UnsignedDWordValue(r);
      
      case VariantType.UnsignedWord:
        return new UnsignedWordValue(r);
      
      default:
        this._log.warn(`Unimplemented variant type: ${VariantType[type]} (${type}), skipping ${declaredLength || 0} bytes`);
        if (declaredLength && declaredLength > 0) {
          r.readBuffer(declaredLength);
        }
        return new NullValue(declaredLength || 0);
    }
  }
}
