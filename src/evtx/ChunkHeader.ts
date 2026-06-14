import { Block } from "./Block";
import { BinaryReader, crc32Checksum } from "../binary/BinaryReader";
import { Record, InvalidRecordException } from "./Record";
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
  // Chunk string table: chunk-relative offset -> decoded name string.
  private _stringCache: Map<number, string> | null = null;
  private _templates: Map<number, TemplateNode> = new Map();
  private _actualTemplates: Map<number, ActualTemplateNode> = new Map();
  private _templatesPreloaded = false; // PERFORMANCE: Track if templates are pre-loaded
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
   * PERFORMANCE OPTIMIZED: Pre-load all strings from the chunk's string table.
   * Stores plain strings instead of NameStringNode objects and uses single reader.
   */
  private _loadStringCache(): void {
    if (this._stringCache !== null) return;
    
    this._stringCache = new Map<number, string>();
    const visited = new Set<number>();
    const savedPos = this.r.tell();
    
    try {
      // Parse the 64 string table entries at 0x80
      for (let i = 0; i < 64; i++) {
        let ofs = this.u32(OFF_STRING_TABLE + (i * 4));
        
        while (ofs > 0 && ofs < this.nextRecordOffset() && !visited.has(ofs)) {
          visited.add(ofs);
          
          // Seek to string location and parse inline (no BinaryReader cloning)
          this.r.seek(this.offset + ofs);
          const nextOfs = this.r.u32le();
          const hash = this.r.u16le();
          const str = this.r.wstring(); // wstring() reads length automatically
          
          this._stringCache.set(ofs, str);
          ofs = nextOfs;
        }
      }
      
      // Ensure offset 0 is present (common case)
      if (!this._stringCache.has(0)) {
        try {
          this.r.seek(this.offset + 0);
          this.r.u32le(); // next offset
          this.r.u16le(); // hash
          const str = this.r.wstring(); // wstring() reads length automatically
          this._stringCache.set(0, str);
        } catch {}
      }
    } finally {
      this.r.seek(savedPos); // Always restore reader position
    }
  }

  /**
   * Byte footprint of the name-string record stored at the given chunk-relative
   * offset: next_offset(4) + hash(2) + length(2) + UTF-16 data(2*len) + null(2).
   * Used to size inline-string tags without materialising NameStringNode objects.
   */
  getStringByteLength(offset: number): number {
    const cached = this.getString(offset);
    if (cached !== null) {
      return 10 + cached.length * 2;
    }
    // Inline strings whose offset is not chained from the 64 string-table buckets
    // are parsed directly for their length, without polluting the lookup cache.
    const savedPos = this.r.tell();
    try {
      this.r.seek(this.offset + offset);
      this.r.u32le(); // next_offset
      this.r.u16le(); // hash
      const len = this.r.wstring().length;
      return 10 + len * 2;
    } finally {
      this.r.seek(savedPos);
    }
  }

  /**
   * Get a string from the chunk's string table by offset (PERFORMANCE OPTIMIZED)
   */
  getString(offset: number): string | null {
    // Use optimized string cache
    if (this._stringCache === null) {
      this._loadStringCache();
    }
    return this._stringCache!.get(offset) || null;
  }

  /**
   * PERFORMANCE: Pre-load all templates from the template table
   * This is called lazily on first template access
   */
  private _preloadTemplates(): void {
    if (this._templatesPreloaded) return;
    this._templatesPreloaded = true;
    
    try {
      const visited = new Set<number>();
      const savedPos = this.r.tell();
      
      // Parse the 64 template table entries at 0x180
      for (let i = 0; i < 64; i++) {
        let ofs = this.u32(OFF_TEMPLATE_TABLE + (i * 4));
        
        while (ofs > 0 && ofs < this.nextRecordOffset() && !visited.has(ofs)) {
          visited.add(ofs);
          
          try {
            // Create template if not already cached
            if (!this._templates.has(ofs)) {
              const templateNode = new TemplateNode(this.r, ofs, this);
              this._templates.set(ofs, templateNode);
              
              // PERFORMANCE: Also pre-create ActualTemplateNode
              const actualTemplate = new ActualTemplateNode(templateNode);
              this._actualTemplates.set(ofs, actualTemplate);
            }
            
            // Templates in the table have next_offset at the beginning
            // Read next offset to follow the chain
            this.r.seek(this.offset + ofs);
            ofs = this.r.u32le();
          } catch (error) {
            // Skip invalid templates
            break;
          }
        }
      }
      
      this.r.seek(savedPos); // Restore position
    } catch (error) {
      // Pre-loading failed, will load on-demand
      this._log.warn('Template pre-loading failed, will use on-demand loading', error);
    }
  }

  /**
   * Get a template from the chunk's template cache, or create it if not cached
   * PERFORMANCE: Now pre-loads all templates on first access
   */
  getTemplate(offset: number): TemplateNode | null {
    // PERFORMANCE: Pre-load templates on first access
    if (!this._templatesPreloaded) {
      this._preloadTemplates();
    }
    
    if (this._templates.has(offset)) {
      return this._templates.get(offset)!;
    }

    try {
      // Fallback: create template if pre-loading missed it
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
   * PERFORMANCE: Benefits from template pre-loading
   */
  getActualTemplate(offset: number): ActualTemplateNode | null {
    // PERFORMANCE: Pre-load templates on first access (also preloads ActualTemplateNode)
    if (!this._templatesPreloaded) {
      this._preloadTemplates();
    }
    
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
