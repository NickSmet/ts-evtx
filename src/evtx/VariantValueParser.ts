import { BinaryReader } from '../binary/BinaryReader';
import { VariantType } from './enums';
import { getLogger } from '../logging/logger.js';

// Re-export VariantType for other modules
export { VariantType };

// Placeholder for actual variant value types
export type ParsedVariant = string | number | bigint | Date | Uint8Array | object | null | boolean | string[];

export interface ParsedVariantResult {
  value: ParsedVariant;
  consumedBytes: number;
}

/**
 * Parser for EVTX variant values
 */
export class VariantValueParser {
  private _log = getLogger('VariantValueParser');
  constructor(private r: BinaryReader) {}

  /**
   * Parse a variant value based on its type
   * @param type The VariantType to parse
   * @param expectedLength Optional expected length for validation
   * @returns Object containing the parsed value and number of bytes consumed
   */
  parse(type: VariantType, expectedLength?: number): ParsedVariantResult {
    const startPos = this.r.tell();
    let value: ParsedVariant = null;
    let consumedBytes = 0;

    try {
      switch (type) {
        case VariantType.Null:
          value = null;
          consumedBytes = expectedLength || 0;
          // Skip the declared bytes for null values
          if (expectedLength && expectedLength > 0) {
            this.r.seek(startPos + expectedLength);
          }
          break;

        case VariantType.WString:
          if (expectedLength !== undefined) {
            // For substitutions, use the declared length directly (no length prefix)
            value = this.parseWStringWithLength(expectedLength);
          } else {
            // For normal parsing, use length-prefixed format
            value = this.parseWString();
          }
          consumedBytes = this.r.tell() - startPos;
          break;

        case VariantType.String:
          if (expectedLength !== undefined) {
            // For substitutions, use the declared length directly (no length prefix)
            value = this.parseStringWithLength(expectedLength);
          } else {
            // For normal parsing, use length-prefixed format
            value = this.parseString();
          }
          consumedBytes = this.r.tell() - startPos;
          break;

        case VariantType.UnsignedByte:
          value = this.r.u8();
          consumedBytes = 1;
          break;

        case VariantType.SignedByte:
          value = this.r.i8();
          consumedBytes = 1;
          break;

        case VariantType.UnsignedWord:
          value = this.r.u16le();
          consumedBytes = 2;
          break;

        case VariantType.SignedWord:
          value = this.r.i16le();
          consumedBytes = 2;
          break;

        case VariantType.UnsignedDWord:
          value = this.r.u32le();
          consumedBytes = 4;
          break;

        case VariantType.SignedDWord:
          value = this.r.i32le();
          consumedBytes = 4;
          break;

        case VariantType.UnsignedQWord:
          value = this.r.u64le();
          consumedBytes = 8;
          break;

        case VariantType.SignedQWord:
          value = this.r.i64le();
          consumedBytes = 8;
          break;

        case VariantType.Float:
          value = this.r.f32le();
          consumedBytes = 4;
          break;

        case VariantType.Double:
          value = this.r.f64le();
          consumedBytes = 8;
          break;

        case VariantType.Boolean:
          // Boolean is typically 1 byte, non-zero = true
          const boolValue = this.r.u8();
          value = boolValue !== 0;
          consumedBytes = 1;
          break;

        case VariantType.Binary:
          if (expectedLength !== undefined) {
            // For substitutions: read exactly expectedLength bytes, no length prefix
            const bytes = this.r.bytesAt(this.r.tell(), expectedLength);
            this.r.seek(this.r.tell() + expectedLength);
            value = bytes;
            consumedBytes = expectedLength;
          } else {
            value = this.parseBinary();
            consumedBytes = this.r.tell() - startPos;
          }
          break;

        case VariantType.Guid:
          value = this.parseGuid();
          consumedBytes = 16;
          break;

        case VariantType.Size:
          // Size is typically a pointer-sized value (4 or 8 bytes)
          // For EVTX, typically 4 bytes
          value = this.r.u32le();
          consumedBytes = 4;
          break;

        case VariantType.FileTime:
          value = this.parseFileTime();
          consumedBytes = 8;
          break;

        case VariantType.SystemTime:
          value = this.parseSystemTime();
          consumedBytes = 16;
          break;

        case VariantType.Sid:
          value = this.parseSid();
          consumedBytes = this.r.tell() - startPos;
          break;

        case VariantType.Hex32:
          // Hex32 is UInt32 intended for hex display
          value = this.r.u32le();
          consumedBytes = 4;
          break;

        case VariantType.Hex64:
          // Hex64 is UInt64 intended for hex display
          value = this.r.u64le();
          consumedBytes = 8;
          break;

        case VariantType.BXml:
          if (expectedLength !== undefined) {
            // For substitutions: read exactly expectedLength bytes, no length prefix
            value = this.parseBXmlWithLength(expectedLength);
            consumedBytes = expectedLength;
          } else {
            // For normal parsing: length-prefixed BXML
            value = this.parseBXml();
            consumedBytes = this.r.tell() - startPos;
          }
          break;

        case VariantType.WStringArray:
          if (expectedLength !== undefined) {
            value = this.parseWStringArrayWithLength(expectedLength);
            consumedBytes = expectedLength;
          } else {
            value = this.parseWStringArray();
            consumedBytes = this.r.tell() - startPos;
          }
          break;

        default:
          // Fallback: if expectedLength is provided, read that many bytes
          if (expectedLength !== undefined && expectedLength > 0) {
            value = this.r.bytesAt(startPos, expectedLength);
            this.r.seek(startPos + expectedLength);
            consumedBytes = expectedLength;
            this._log.warn(`Unknown VariantType 0x${(type as number).toString(16)}, returning ${expectedLength} raw bytes`);
          } else {
            this._log.warn(`Unknown VariantType 0x${(type as number).toString(16)} with no expected length, returning null`);
            value = null;
            consumedBytes = 0;
          }
          break;
      }

      // Validate expected length if provided
      if (expectedLength !== undefined && consumedBytes !== expectedLength) {
        this._log.warn(`VariantType 0x${(type as number).toString(16)}: expected ${expectedLength} bytes, consumed ${consumedBytes} bytes`);
      }

    } catch (error) {
      this._log.error(`Error parsing VariantType 0x${(type as number).toString(16)}:`, error);
      // Try to recover by skipping expected bytes
      if (expectedLength !== undefined) {
        this.r.seek(startPos + expectedLength);
        consumedBytes = expectedLength;
      }
      value = null;
    }

    return { value, consumedBytes };
  }

  private parseWString(): string {
    // WString is typically length-prefixed with a WORD (2 bytes)
    const length = this.r.u16le();
    if (length === 0) {
      return '';
    }
    
    // Read length * 2 bytes for UTF-16 characters
    const bytes = this.r.bytesAt(this.r.tell(), length * 2);
    this.r.seek(this.r.tell() + length * 2);
    
    // Convert UTF-16LE to string
    return new TextDecoder('utf-16le').decode(bytes);
  }

  private parseWStringWithLength(declaredLength: number): string {
    // For substitutions: read exactly declaredLength bytes as UTF-16LE, no length prefix
    if (declaredLength === 0) {
      return '';
    }
    
    const bytes = this.r.bytesAt(this.r.tell(), declaredLength);
    this.r.seek(this.r.tell() + declaredLength);
    
    // Convert UTF-16LE to string and remove null terminators
    return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
  }

  private parseString(): string {
    // String is typically length-prefixed with a WORD (2 bytes) 
    const length = this.r.u16le();
    if (length === 0) {
      return '';
    }
    
    // Read length bytes for ANSI characters
    const bytes = this.r.bytesAt(this.r.tell(), length);
    this.r.seek(this.r.tell() + length);
    
    // Convert to string using UTF-8 (or could use windows-1252 for true ANSI)
    return new TextDecoder('utf-8').decode(bytes);
  }

  private parseStringWithLength(declaredLength: number): string {
    // For substitutions: read exactly declaredLength bytes as UTF-8, no length prefix
    if (declaredLength === 0) {
      return '';
    }
    
    const bytes = this.r.bytesAt(this.r.tell(), declaredLength);
    this.r.seek(this.r.tell() + declaredLength);
    
    // Convert to string and remove null terminators
    return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '');
  }

  private parseBinary(): Uint8Array {
    // Binary is typically length-prefixed with a DWORD (4 bytes)
    const length = this.r.u32le();
    if (length === 0) {
      return new Uint8Array(0);
    }
    
    const bytes = this.r.bytesAt(this.r.tell(), length);
    this.r.seek(this.r.tell() + length);
    return bytes;
  }

  private parseGuid(): string {
    // GUID is 16 bytes: Data1(4) + Data2(2) + Data3(2) + Data4(8)
    const data1 = this.r.u32le();
    const data2 = this.r.u16le();
    const data3 = this.r.u16le();
    const data4 = this.r.bytesAt(this.r.tell(), 8);
    this.r.seek(this.r.tell() + 8);
    
    // Format as standard GUID string
    const data4Hex = Array.from(data4).map(b => b.toString(16).padStart(2, '0')).join('');
    return `{${data1.toString(16).padStart(8, '0')}-${data2.toString(16).padStart(4, '0')}-${data3.toString(16).padStart(4, '0')}-${data4Hex.substring(0, 4)}-${data4Hex.substring(4)}}`.toUpperCase();
  }

  private parseFileTime(): Date {
    // FileTime is a 64-bit value representing 100-nanosecond intervals since January 1, 1601 UTC
    const fileTime = this.r.u64le();
    
    // Convert to JavaScript Date
    // FileTime epoch is 1601-01-01, JavaScript epoch is 1970-01-01
    // Difference is 11644473600 seconds = 11644473600000 milliseconds
    const FILETIME_EPOCH_DIFF = 11644473600000n;
    const milliseconds = Number(fileTime / 10000n) - Number(FILETIME_EPOCH_DIFF);
    
    return new Date(milliseconds);
  }

  private parseSystemTime(): Date {
    // SYSTEMTIME structure: 16 bytes
    const year = this.r.u16le();
    const month = this.r.u16le();
    const dayOfWeek = this.r.u16le(); // Not used for Date construction
    const day = this.r.u16le();
    const hour = this.r.u16le();
    const minute = this.r.u16le();
    const second = this.r.u16le();
    const milliseconds = this.r.u16le();
    
    // JavaScript Date constructor uses 0-based months
    return new Date(year, month - 1, day, hour, minute, second, milliseconds);
  }

  private parseSid(): string {
    // SID structure: Revision(1) + SubAuthorityCount(1) + IdentifierAuthority(6) + SubAuthorities(4*count)
    const revision = this.r.u8();
    const subAuthorityCount = this.r.u8();
    
    // IdentifierAuthority is 6 bytes (big-endian)
    const identifierAuthority = this.r.bytesAt(this.r.tell(), 6);
    this.r.seek(this.r.tell() + 6);
    
    // Convert IdentifierAuthority to number (typically the last 4 bytes are used)
    const authority = (identifierAuthority[2] << 24) | (identifierAuthority[3] << 16) | 
                     (identifierAuthority[4] << 8) | identifierAuthority[5];
    
    // Read SubAuthorities
    const subAuthorities: number[] = [];
    for (let i = 0; i < subAuthorityCount; i++) {
      subAuthorities.push(this.r.u32le());
    }
    
    // Format as S-R-I-S-S-S...
    return `S-${revision}-${authority}${subAuthorities.length > 0 ? '-' + subAuthorities.join('-') : ''}`;
  }

  private parseBXml(): object {
    // BXml is embedded binary XML, typically length-prefixed
    const length = this.r.u32le();
    if (length === 0) {
      return {};
    }
    
    // For now, return raw bytes - proper implementation would parse the embedded BXML
    const bytes = this.r.bytesAt(this.r.tell(), length);
    this.r.seek(this.r.tell() + length);
    
    // TODO: Parse embedded BXML using RootNode or similar
    return { bxmlData: bytes, length };
  }

  private parseBXmlWithLength(expectedLength: number): object {
    // For substitutions: read exactly expectedLength bytes as raw BXML data, no length prefix
    if (expectedLength === 0) {
      return { bxmlData: new Uint8Array(0), length: 0, isEmpty: true };
    }
    
    const startPos = this.r.tell();
    const bytes = this.r.bytesAt(startPos, expectedLength);
    this.r.seek(startPos + expectedLength);
    
    // Store the raw BXML data - it will be parsed during XML rendering
    return {
      bxmlData: bytes,
      length: expectedLength,
      isBXml: true,
      baseOffset: startPos
    };
  }

  private parseWStringArrayWithLength(declaredLength: number): string[] {
    // For substitutions: raw blob of UTF-16LE strings separated by nulls, no length prefix
    if (declaredLength === 0) return [];
    const bytes = this.r.bytesAt(this.r.tell(), declaredLength);
    this.r.seek(this.r.tell() + declaredLength);

    // Decode as UTF-16LE and split on NUL terminators, preserving empty entries
    const decoded = new TextDecoder('utf-16le').decode(bytes);
    // Remove any trailing NULs before splitting to avoid a spurious empty at the end
    const trimmed = decoded.replace(/\u0000+$/g, '');
    const parts = trimmed.split('\u0000');
    return parts;
  }

  private parseWStringArray(): string[] {
    // WStringArray typically starts with a count
    const count = this.r.u32le();
    const strings: string[] = [];
    
    for (let i = 0; i < count; i++) {
      // Each string is a WString
      const str = this.parseWString();
      strings.push(str);
    }
    
    return strings;
  }
}

// Legacy function for backward compatibility
export function parseVariant(r: BinaryReader, type: VariantType, length: number): ParsedVariant {
  const parser = new VariantValueParser(r);
  const result = parser.parse(type, length);
  return result.value;
} 
