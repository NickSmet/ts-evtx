import { BinaryReader } from '../binary/BinaryReader';
import { ChunkHeader } from './ChunkHeader';
import { BXmlNode } from './BXmlNode';
import { NodeFactory } from './node-factory';
import { getLogger } from '../logging/logger.js';

export class TemplateNode {
  private _offset: number;
  private _nextOffset: number;
  private _templateId: number;
  private _guid: Uint8Array;
  private _dataLength: number;
  private _reader: BinaryReader;
  private _chunk: ChunkHeader;
  private _children: BXmlNode[] = [];
  private _log = getLogger('TemplateNode');

  constructor(reader: BinaryReader, offset: number, chunk: ChunkHeader) {
    this._reader = reader;
    this._offset = offset;
    this._chunk = chunk;
    
    // Debug: Show chunk information and absolute positioning
    const absoluteOffset = chunk.offset + offset;
    this._log.debug(`🏗️ Parsing template at chunk offset 0x${offset.toString(16)} (absolute: 0x${absoluteOffset.toString(16)})`);
    this._log.debug(`   📦 Chunk bounds: 0x${chunk.offset.toString(16)} to 0x${(chunk.offset + 65536).toString(16)}`);
    this._log.debug(`   📊 Reader file size: ${reader.size} bytes`);
    
    // Debug: Show raw bytes at this location
    reader.seek(absoluteOffset);
    const headerBytes = reader.readBuffer(Math.min(32, reader.size - absoluteOffset));
    const hexDump = Array.from(headerBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    this._log.debug(`   🔍 Raw bytes at offset: ${hexDump}`);
    
    // Reset to start parsing
    reader.seek(absoluteOffset);
    
    // Parse template header (24 bytes total)
    // Structure: next_offset(4) + template_id(4) + guid(16) overlapping at 0x04
    this._nextOffset = reader.u32le();     // offset 0x00
    
    // Save position to read overlapping GUID
    const templateIdPos = reader.tell();
    this._templateId = reader.u32le();     // offset 0x04
    
    // GUID overlaps starting at 0x04 (includes template_id as first 4 bytes)
    reader.seek(templateIdPos);
    this._guid = reader.readBuffer(16);    // offset 0x04-0x13 (overlaps template_id)
    
    this._dataLength = reader.u32le();     // offset 0x14 (not 0x18!)
    
    this._log.debug(`🏗️ Header parsed`);
    this._log.debug(`   Next offset: 0x${this._nextOffset.toString(16)}`);
    this._log.debug(`   Template ID: ${this._templateId}`);
    this._log.debug(`   Data length: ${this._dataLength} bytes`);
    this._log.debug(`   GUID: ${Array.from(this._guid).map(b => b.toString(16).padStart(2, '0')).join('')}`);
    
    // Analyze header validity
    if (this._dataLength > 65536) {
      this._log.warn(`⚠️ Suspiciously large data length ${this._dataLength}, this suggests wrong offset or header format`);
      this._log.warn(`   Template header breakdown:`);
      this._log.warn(`     bytes 0-3 (next_offset): 0x${this._nextOffset.toString(16)}`);
      this._log.warn(`     bytes 4-7 (template_id): 0x${this._templateId.toString(16)}`);
      this._log.warn(`     bytes 8-23 (guid): ${Array.from(this._guid).map(b => b.toString(16).padStart(2, '0')).join('')}`);
      this._log.warn(`     bytes 24-27 (data_length): 0x${this._dataLength.toString(16)}`);
    }
    if (absoluteOffset + 24 + this._dataLength > reader.size) {
      this._log.warn(`⚠️ Template data extends beyond file bounds`);
      this._log.warn(`   Template end would be: 0x${(absoluteOffset + 24 + this._dataLength).toString(16)}`);
      this._log.warn(`   File size: 0x${reader.size.toString(16)}`);
    }
    
    // Parse the template's BXML children
    this.parseChildren();
  }

  get offset(): number { return this._offset; }
  get nextOffset(): number { return this._nextOffset; }
  get templateId(): number { return this._templateId; }
  get guid(): Uint8Array { return this._guid; }
  get dataLength(): number { return this._dataLength; }
  get children(): BXmlNode[] { return this._children; }
  get tagLength(): number { return 24; } // Template header is 24 bytes like Python

  private parseChildren(): void {
    if (this._dataLength === 0) {
      this._log.debug(`⚠️ No data to parse (data length = 0)`);
      return;
    }

    // Template data starts after the 24-byte header  
    const absoluteOffset = this._chunk.offset + this._offset;
    const dataStart = absoluteOffset + 24;
    const dataEnd = dataStart + this._dataLength;
    
    this._log.debug(`🔄 Parsing BXML children from 0x${dataStart.toString(16)} to 0x${dataEnd.toString(16)}`);
    
    this._reader.seek(dataStart);
    const factory = new NodeFactory(this._reader);
    
    // Parse like Python: top-level template children only (StreamStart, OpenStartElement, EndOfStream)
    while (this._reader.tell() < dataEnd) {
      const currentPos = this._reader.tell();
      const token = this._reader.peek();
      
      this._log.debug(`🔍 At 0x${currentPos.toString(16)}, token=0x${token.toString(16)}`);
      
      if (token === 0x00) { // EndOfStream  
        this._log.debug(`🔚 EndOfStream found, parsing and stopping`);
        try {
          const dummyParent = {
            chunk: this._chunk,
            factory: factory,
            children: []
          } as any;
          
          const endNode = factory.fromStream(dummyParent);
          if (endNode) {
            this._children.push(endNode);
            this._log.debug(`✅ Parsed ${endNode.constructor.name}`);
          }
        } catch (error) {
          this._log.warn(`❌ Error parsing EndOfStream: ${error}`);
        }
        break; // End of template children
      }
      
      try {
        // Create a dummy parent for the factory
        const dummyParent = {
          chunk: this._chunk,
          factory: factory,
          children: []
        } as any;
        
        const childNode = factory.fromStream(dummyParent);
        if (childNode) {
          this._children.push(childNode);
          this._log.debug(`✅ Parsed ${childNode.constructor.name}, length=${childNode.length}`);
          
          // Show structure for key node types
          if (childNode.constructor.name === 'OpenStartElementNode') {
            this._log.debug(`   📝 OpenStartElement: name="${(childNode as any).name || 'unknown'}"`);
          } else if (childNode.constructor.name === 'StartOfStreamNode') {
            this._log.debug(`   🔄 StartOfStream marker`);
          }
        } else {
          this._log.warn(`❌ Failed to parse token 0x${token.toString(16)} at 0x${currentPos.toString(16)}`);
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this._log.warn(`❌ Error parsing at 0x${currentPos.toString(16)}: ${message}`);
        break;
      }
    }
    
    this._log.debug(`🏁 Parsed ${this._children.length} children`);
  }

  /**
   * Get a simplified XML structure representation
   */
  getXmlStructure(): string {
    const lines: string[] = [];
    this.renderStructure(this._children, lines, 0);
    return lines.join('\n');
  }

  private renderStructure(nodes: BXmlNode[], lines: string[], depth: number): void {
    const indent = '  '.repeat(depth);
    
    for (const node of nodes) {
      const nodeName = node.constructor.name;
      
      if (nodeName === 'OpenStartElementNode') {
        const elementName = (node as any).name || 'unknown';
        lines.push(`${indent}<${elementName}>`);
        
        // Render children
        if (node.children && node.children.length > 0) {
          this.renderStructure(node.children, lines, depth + 1);
        }
        
        lines.push(`${indent}</${elementName}>`);
      } else if (nodeName === 'AttributeNode') {
        const attrName = (node as any).attribute_name || 'unknown';
        lines.push(`${indent}  @${attrName}="..."`);
      } else if (nodeName === 'NormalSubstitutionNode') {
        const subId = (node as any).substitution_id || 0;
        lines.push(`${indent}  [SUBSTITUTION:${subId}]`);
      } else if (nodeName === 'CompactSubstitutionNode') {
        const subId = (node as any).substitution_id || 0;
        lines.push(`${indent}  [SUBSTITUTION:${subId}]`);
      } else if (nodeName === 'ValueNode') {
        lines.push(`${indent}  [VALUE]`);
      } else {
        lines.push(`${indent}  <!-- ${nodeName} -->`);
      }
    }
  }
} 
  
