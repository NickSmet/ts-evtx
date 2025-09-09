import { Block } from "./Block";
import { BinaryReader } from "../binary/BinaryReader";
import { ChunkHeader } from "./ChunkHeader";
import { BXmlNode } from "./BXmlNode";
import { NodeFactory } from "./node-factory";
import { BXmlToken } from "./enums";
import { TemplateInstanceNode } from "./node-specialisations";
import { VariantValueParser, ParsedVariant, VariantType } from "./VariantValueParser";
import { getLogger } from "../logging/logger.js";

export class InvalidRecordException extends Error {
  constructor(message: string = "Invalid record") {
    super(message);
    this.name = "InvalidRecordException";
  }
}

// Root node with two-phase parsing approach (children, then substitutions)
class RootNode extends BXmlNode {
  public substitutions: ParsedVariant[] = []; // Substitution values for template instances
  private _parsedBxmlChildrenLength: number = 0;
  private _substitutionsBlockLength: number = 0;
  private _templateInstance: TemplateInstanceNode | null = null;
  private _parentRecord: Record;
  private _log = getLogger('Record');

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parentRecord: Record, // Changed from recordDataOffset to parentRecord
    recordDataOffset: number,
  ) {
    super(r, chunk, null, BXmlToken.FragmentHeader); // Use a generic token for RootNode itself
    this.factory = new NodeFactory(r); // NodeFactory uses the same reader `r`
    this._parentRecord = parentRecord;

    r.seek(recordDataOffset);

    // --- Phase 1: Parse BXML Children (e.g., StreamStart, TemplateInstance, EndOfStream) ---
    let hasTemplateInstance = false;
    const bxmlChildrenEndTokens = [BXmlToken.EndOfStream]; // Python RootNode._children stops at EndOfStream

    // Correctly define the end position based on the record's actual BXML data length
    const bxmlDataLength = parentRecord.size() - 0x18; // 0x18 is the size of the record header
    const endPosition = recordDataOffset + bxmlDataLength;

    this._log.debug(`🔄 RootNode Phase 1: Starting BXML children parsing at offset 0x${r.tell().toString(16)}`);
    this._log.debug(`📊 RootNode: Record size=${parentRecord.size()}, BXML data length=${bxmlDataLength}, end position=0x${endPosition.toString(16)}`);

    while (r.tell() < endPosition) {
      if (r.tell() >= r.size) {
        this._log.debug(`Reached end of buffer at position ${r.tell()}`);
        break;
      }
      const currentTokenAt = r.tell();
      const tokenPeek = r.peek();

      this._log.debug(`🔍 RootNode: At offset 0x${currentTokenAt.toString(16)}, peeking token 0x${tokenPeek.toString(16)}`);

      let currentToken: number;
      try {
        currentToken = r.peek();
      } catch (error) {
        this._log.debug(`Cannot peek at position ${r.tell()}, stopping parsing`);
        break;
      }

      if (bxmlChildrenEndTokens.includes(currentToken)) {
        this._log.debug(`🛑 RootNode: Found EndOfStream token 0x${currentToken.toString(16)}, stopping BXML parsing`);
        if (currentToken === BXmlToken.EndOfStream) {
          // Don't parse EndOfStream as a child node, just break
          break; // End of BXML children block
        }
      }

      try {
        this._log.debug(`📝 RootNode: Creating node from token 0x${currentToken.toString(16)}`);
        const node = this.factory.fromStream(this);
        this.children.push(node);
        this._parsedBxmlChildrenLength += node.length;
        this._log.debug(`✅ RootNode: Added ${node.constructor.name}, length=${node.length}, total children: ${this.children.length}`);

        if (node instanceof TemplateInstanceNode) {
          hasTemplateInstance = true;
          this._templateInstance = node;
          this._log.debug(`🎯 RootNode: Found TemplateInstanceNode!`);
        }

        if (node.constructor.name === 'UnimplementedNode') {
          this._log.warn(`Got unimplemented node at ${r.tell()}, stopping parsing to prevent issues`);
          break;
        }
      } catch (error) {
        this._log.warn(`Error parsing node at position ${r.tell()}:`, error);
        // Consider how to handle errors: break, skip, or attempt recovery.
        // For now, breaking is safer if node parsing is incomplete.
        break;
      }
    }

    this._log.debug(`🏁 RootNode Phase 1 Complete: ${this.children.length} children, hasTemplateInstance=${hasTemplateInstance}`);
    this._log.debug(`📍 RootNode: Now at offset 0x${r.tell().toString(16)} for Phase 2`);
    

    // --- Phase 2: Parse Substitutions (only if a template instance was involved or if data remains) ---

    this._log.debug(`🔄 RootNode Phase 2: Starting substitution parsing, hasTemplateInstance=${hasTemplateInstance}`);
    
    // Use relative offset from the end of parsed children
    const rootNodeStartOffset = recordDataOffset;
    // CRITICAL FIX: Subtract 1 byte - the BXML children length calculation includes 1 extra byte
    // This was discovered through surgical debugging comparing Python vs TypeScript behavior
    const substitutionDataOffset = rootNodeStartOffset + this._parsedBxmlChildrenLength - 1;
    
    this._log.debug(`🔧 RootNode: Substitution offset calculation:`);
    this._log.debug(`   RootNode starts at: 0x${rootNodeStartOffset.toString(16)}`);
    this._log.debug(`   BXML children length: ${this._parsedBxmlChildrenLength} bytes`);
    this._log.debug(`   Substitutions should start at: 0x${substitutionDataOffset.toString(16)}`);
    
    r.seek(substitutionDataOffset);
    
    // Check if there's data left that could be substitutions
    if (r.tell() + 4 <= r.size) { // Minimum 4 bytes for substitution_count
      const subCountPos = r.tell();
      
      // Try both little-endian and big-endian to see which gives reasonable value
      const substitutionCountLE = r.u32le();
      r.seek(subCountPos);
      const substitutionCountBE = r.u32be();
      r.seek(subCountPos + 4); // Move past the count for continuation
      
      this._log.debug(`🔍 RootNode: At 0x${subCountPos.toString(16)}:`);
      this._log.debug(`   substitution_count (LE): ${substitutionCountLE} (0x${substitutionCountLE.toString(16)})`);
      this._log.debug(`   substitution_count (BE): ${substitutionCountBE} (0x${substitutionCountBE.toString(16)})`);
      
      // Use the one that looks reasonable
      const substitutionCount = (substitutionCountBE > 0 && substitutionCountBE < 1024) ? substitutionCountBE : substitutionCountLE;
      this._log.debug(`   Using: ${substitutionCount} (${substitutionCount === substitutionCountBE ? 'BE' : 'LE'})`);
      
      if (substitutionCount > 0 && substitutionCount < 1024) { // Sanity check count
        this._log.debug(`✅ RootNode: Valid substitution count, proceeding to parse`);
      } else {
        this._log.debug(`❌ RootNode: Invalid substitution count, likely this is not substitution data`);
      }
      
      if (substitutionCount > 0 && substitutionCount < 1024) { // Sanity check count
        this._substitutionsBlockLength += 4; // For the count itself

        const subDeclarations: { size: number; type: number }[] = [];
        for (let i = 0; i < substitutionCount; i++) {
          if (r.tell() + 4 <= r.size) { // 2 for size, 1 for type, 1 for reserved
            const size = r.u16le();
            const type = r.u8();
            r.u8(); // Skip reserved byte
            subDeclarations.push({ size, type });
            this._substitutionsBlockLength += 4;
          } else {
            this._log.warn("RootNode: Truncated substitution declarations.");
            break;
          }
        }

        this.substitutions = [];
        const parser = new VariantValueParser(r);
        for (const decl of subDeclarations) {
          if (r.tell() + decl.size <= r.size) {
            const result = parser.parse(decl.type, decl.size);
            this.substitutions.push(result.value);
            this._substitutionsBlockLength += result.consumedBytes;
            // Debug: Log substitution type without printing binary garbage
            const valueDesc = typeof result.value === 'string' ? `"${result.value.substring(0, 50)}${result.value.length > 50 ? '...' : ''}"` : 
                             (result.value instanceof Uint8Array || Array.isArray(result.value)) ? `[binary data, ${result.consumedBytes} bytes]` :
                             result.value;
            this._log.debug(`✅ Parsed substitution: type=0x${decl.type.toString(16)}, value=${valueDesc}, consumed=${result.consumedBytes} bytes`);
          } else {
            this._log.warn(`RootNode: Truncated substitution value for type ${decl.type}, size ${decl.size}.`);
            break;
          }
        }
      } else if (substitutionCount > 0) { // Count > 0 but too large
        this._log.warn(`RootNode: Suspiciously large substitution count: ${substitutionCount} at offset ${r.tell()-4}`);
        // Do not attempt to parse, reader stays put.
      }
      // If substitutionCount is 0, _substitutionsBlockLength remains 0 for this part.
    }
  }

  public get length(): number {
    return this._parsedBxmlChildrenLength + this._substitutionsBlockLength;
  }

  /**
   * Get the template instance node (if any)
   */
  public templateInstance(): TemplateInstanceNode | null {
    return this._templateInstance;
  }

  /**
   * Get the template definition for this root node
   * Similar to Python's RootNode.template() method
   */
  public template(): any | null {
    if (!this._templateInstance) {
      return null;
    }

    // template_offset is already chunk-relative, don't add chunk.offset
    const templateOffset = this._templateInstance.template_offset;
    this._log.debug(`🔍 RootNode.template(): Looking for template at chunk-relative offset 0x${templateOffset.toString(16)}`);

    // Use chunk's template cache or create new template
    return this.chunk.getTemplate(templateOffset);
  }

  // public toXml(): string {... }
}

export class Record extends Block {
  private _chunk: ChunkHeader;
  private _log = getLogger('Record');

  constructor(reader: BinaryReader, offset: number, chunk: ChunkHeader) {
    super(reader, offset);
    this._chunk = chunk;

    // Validate magic number
    if (this.magic() !== 0x00002a2a) {
      throw new InvalidRecordException(`Invalid magic: 0x${this.magic().toString(16)}`);
    }

    // Validate size
    if (this.size() > 0x10000) {
      throw new InvalidRecordException(`Record too large: ${this.size()}`);
    }
  }

  /**
   * Magic number (should be 0x00002a2a)
   */
  magic(): number {
    return this.u32(0x0);
  }

  /**
   * Record size in bytes
   */
  size(): number {
    return this.u32(0x4);
  }

  /**
   * Record number
   */
  recordNum(): bigint {
    return this.u64(0x8);
  }

  /**
   * Timestamp as Windows FILETIME
   */
  timestamp(): bigint {
    return this.u64(0x10);
  }

  /**
   * Timestamp converted to JavaScript Date
   */
  timestampAsDate(): Date {
    const filetime = this.timestamp();
    // FILETIME is 100-nanosecond intervals since January 1, 1601 UTC
    // JavaScript Date uses milliseconds since January 1, 1970 UTC
    const FILETIME_EPOCH_DIFF = 11644473600000n; // milliseconds between 1601 and 1970
    const timestampMs = Number(filetime / 10000n - FILETIME_EPOCH_DIFF);
    return new Date(timestampMs);
  }

  /**
   * Size field at the end of the record (should match size())
   */
  size2(): number {
    return this.u32(this.size() - 4);
  }

  /**
   * Total length of this record
   */
  length(): number {
    return this.size();
  }

  /**
   * Verify record integrity
   */
  verify(): boolean {
    return this.size() === this.size2();
  }

  /**
   * Get the root BXml node for this record
   */
  root(): BXmlNode {
    // Pass 'this' (the Record instance) to the RootNode constructor
    return new RootNode(this.r, this._chunk, this, this.offset + 0x18);
  }

  /**
   * Get raw data for this record
   */
  data(): Uint8Array {
    return this.bytes(0, this.size());
  }

  /**
   * Render the complete XML for this record using template + substitutions
   */
  public renderXml(): string {
    const rootNode = this.root() as RootNode;
    const templateInstance = rootNode.templateInstance();
    if (!templateInstance) {
      this._log.warn('Record: No TemplateInstanceNode found, cannot render XML');
      return '<Event/>';
    }

    this._log.debug(`📄 Record: Rendering XML using template instance with ${rootNode.substitutions.length} substitutions`);
    return templateInstance.renderXml(rootNode.substitutions);
  }
}
