import { Block } from "./Block";
import { BinaryReader, crc32Checksum } from "../binary/BinaryReader";
import { Record, InvalidRecordException } from "./Record";
import { NameStringNode } from './node-specialisations';
import { TemplateNode } from './TemplateNode';
import { ActualTemplateNode } from './ActualTemplateNode';
import { getLogger } from '../logging/logger.js';
import { BXmlNode } from './BXmlNode';
// import { TemplateNode } from "./node-specialisations";

// Field offsets for ChunkHeader
const OFF_MAGIC = 0x00;                  // 8 bytes
const OFF_FILE_FIRST_RECORD_NUMBER = 0x08; // 8 bytes
const OFF_FILE_LAST_RECORD_NUMBER = 0x10;  // 8 bytes
const OFF_LOG_FIRST_RECORD_NUMBER = 0x18;  // 8 bytes
const OFF_LOG_LAST_RECORD_NUMBER = 0x20;   // 8 bytes
const OFF_HEADER_SIZE = 0x28;              // 4 bytes
const OFF_LAST_RECORD_OFFSET = 0x2C;       // 4 bytes
const OFF_NEXT_RECORD_OFFSET = 0x30;       // 4 bytes
const OFF_DATA_CHECKSUM = 0x34;            // 4 bytes
const OFF_UNUSED = 0x38;                   // 0x44 bytes
const OFF_HEADER_CHECKSUM = 0x7C;          // 4 bytes

// String/template hash table starts at 0x80, 64 entries of 4 bytes each
const OFF_STRING_TABLE = 0x80;
const OFF_TEMPLATE_TABLE = 0x180;

export class ChunkHeader extends Block {
  private _strings: Map<number, NameStringNode> | null = null;
  private _templates: Map<number, TemplateNode> = new Map();
  private _actualTemplates: Map<number, ActualTemplateNode> = new Map();
  private _log = getLogger('ChunkHeader');

  constructor(reader: BinaryReader, offset: number) {
    super(reader, offset);
  }

  /* Field accessors ----------------------------------------------------------- */
  magic(): string {
    const bytes = this.bytes(OFF_MAGIC, 8);
    return new TextDecoder('utf-8').decode(bytes);
  }

  fileFirstRecordNumber(): bigint {
    return this.u64(OFF_FILE_FIRST_RECORD_NUMBER);
  }

  fileLastRecordNumber(): bigint {
    return this.u64(OFF_FILE_LAST_RECORD_NUMBER);
  }

  logFirstRecordNumber(): bigint {
    return this.u64(OFF_LOG_FIRST_RECORD_NUMBER);
  }

  logLastRecordNumber(): bigint {
    return this.u64(OFF_LOG_LAST_RECORD_NUMBER);
  }

  headerSize(): number {
    return this.u32(OFF_HEADER_SIZE);
  }

  lastRecordOffset(): number {
    return this.u32(OFF_LAST_RECORD_OFFSET);
  }

  nextRecordOffset(): number {
    return this.u32(OFF_NEXT_RECORD_OFFSET);
  }

  dataChecksum(): number {
    return this.u32(OFF_DATA_CHECKSUM);
  }

  headerChecksum(): number {
    return this.u32(OFF_HEADER_CHECKSUM);
  }

  /* Helper methods ------------------------------------------------------------ */
  checkMagic(): boolean {
    try {
      return this.magic() === "ElfChnk\0";
    } catch {
      return false;
    }
  }

  calculateHeaderChecksum(): number {
    // Header checksum covers first 0x78 bytes + template index block (0x80-0x200)
    const headerData = this.bytes(0x0, 0x78);
    const templateData = this.bytes(0x80, 0x180);
    
    // Combine the two parts
    const combined = new Uint8Array(headerData.length + templateData.length);
    combined.set(headerData, 0);
    combined.set(templateData, headerData.length);
    
    return crc32Checksum(combined) >>> 0; // Convert to unsigned 32-bit
  }

  calculateDataChecksum(): number {
    const dataLength = this.nextRecordOffset() - 0x200;
    if (dataLength <= 0) return 0;
    
    const data = this.bytes(0x200, dataLength);
    return crc32Checksum(data) >>> 0; // Convert to unsigned 32-bit
  }

  verify(): boolean {
    return (
      this.checkMagic() &&
      this.calculateHeaderChecksum() === this.headerChecksum() &&
      this.calculateDataChecksum() === this.dataChecksum()
    );
  }

  /* String and template loading ----------------------------------------------- */
  /**
   * Parses and caches the string table for this chunk.
   */
  private _loadStrings(): void {
    if (this._strings !== null) return;
    
    this._strings = new Map<number, NameStringNode>();
    
    // Ensure offset 0 string is loaded for common lookups
    if (!this._strings.has(0)) {
      try {
        this.addString(0);
      } catch (error) {
        this._log.warn('Could not load string at offset 0:', error);
      }
    }
    
    // Parse the 64 string table entries at 0x80
    for (let i = 0; i < 64; i++) {
      let ofs = this.u32(OFF_STRING_TABLE + (i * 4));
      while (ofs > 0 && ofs < this.nextRecordOffset()) {
        // Skip if we've already loaded this string
        if (this._strings.has(ofs)) {
          break;
        }
        
        const stringNode = this.addString(ofs);
        
        // Follow the chain to the next string
        ofs = stringNode.next_string_offset;
        
        // Safety check to prevent infinite loops
        if (ofs === 0 || this._strings.has(ofs)) {
          break;
        }
      }
    }
  }

  /**
   * Get the chunk's string table
   */
  strings(): Map<number, NameStringNode> {
    if (this._strings === null) {
      this._loadStrings();
    }
    return this._strings!;
  }

  /**
   * Add a string to the chunk's string table
   */
  addString(offset: number, parent?: BXmlNode): NameStringNode {
    if (this._strings === null) {
      this._loadStrings();
    }

    // IMPORTANT: Do not disturb the main reader position used for BXML parsing.
    // Clone a reader over the full file bytes and parse the string from there.
    const cloned = new BinaryReader(this.r.bytesAt(0, this.r.size));
    cloned.seek(this.offset + offset);

    const stringNode = new NameStringNode(
      cloned,
      this,
      parent || null
    );
    this._strings!.set(offset, stringNode);
    return stringNode;
  }

  /**
   * Get a string from the chunk's string table by offset
   */
  getString(offset: number): string | null {
    const stringNode = this.strings().get(offset);
    return stringNode ? stringNode.name : null;
  }

  /**
   * Get a template from the chunk's template cache, or create it if not cached
   */
  getTemplate(offset: number): TemplateNode | null {
    if (this._templates.has(offset)) {
      return this._templates.get(offset)!;
    }

    try {
      // Create a new TemplateNode at the specified offset
      const templateNode = new TemplateNode(this.r, offset, this);
      this._templates.set(offset, templateNode);
      return templateNode;
    } catch (error) {
      this._log.warn(`Failed to create template at offset 0x${offset.toString(16)}:`, error);
      return null;
    }
  }

  /**
   * Add a template to the chunk's template cache (for resident templates)
   * Python equivalent: chunk.add_template(offset, parent)
   */
  addTemplate(offset: number, parent?: BXmlNode): TemplateNode {
    if (this._templates.has(offset)) {
      return this._templates.get(offset)!;
    }

    this._log.debug(`🔧 addTemplate(): Creating template at offset 0x${offset.toString(16)}`);
    
    try {
      // Create a new TemplateNode at the specified offset using a cloned reader
      // so we do not move the main parsing reader position.
      const cloned = new BinaryReader(this.r.bytesAt(0, this.r.size));
      const templateNode = new TemplateNode(cloned, offset, this);
      this._templates.set(offset, templateNode);
      this._log.debug(`✅ addTemplate(): Successfully added template, dataLength=${templateNode.dataLength}`);
      return templateNode;
    } catch (error) {
      this._log.error(`❌ addTemplate(): Failed to create template at offset 0x${offset.toString(16)}:`, error);
      throw error;
    }
  }

  /**
   * Get an ActualTemplateNode (enhanced template) from cache, or create it if not cached
   */
  getActualTemplate(offset: number): ActualTemplateNode | null {
    if (this._actualTemplates.has(offset)) {
      return this._actualTemplates.get(offset)!;
    }

    // First get the basic TemplateNode
    const templateNode = this.getTemplate(offset);
    if (!templateNode) {
      this._log.warn(`Failed to get TemplateNode at offset 0x${offset.toString(16)}`);
      return null;
    }

    try {
      // Create ActualTemplateNode from the parsed TemplateNode
      const actualTemplate = new ActualTemplateNode(templateNode);
      this._actualTemplates.set(offset, actualTemplate);
      return actualTemplate;
    } catch (error) {
      this._log.warn(`Failed to create ActualTemplateNode at offset 0x${offset.toString(16)}:`, error);
      return null;
    }
  }

  // // @memoize - temporarily disabled for ES module compatibility
  // templates(): ReadonlyMap<number, TemplateNode> {
  //   this._loadTemplates();
  //   return this._templates!;
  // }

  /* Record iteration ---------------------------------------------------------- */
  firstRecord(): Record {
    return new Record(this.r, this.offset + 0x200, this);
  }

  *records(): Generator<Record> {
    try {
      let record = new Record(this.r, this.offset + 0x200, this);
      const endOffset = this.offset + this.nextRecordOffset();
      
      while (record.offset < endOffset && record.length() > 0) {
        yield record;
        try {
          record = new Record(this.r, record.offset + record.length(), this);
        } catch (error) {
          if (error instanceof InvalidRecordException) {
            return;
          }
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof InvalidRecordException) {
        return;
      }
      throw error;
    }
  }
}
