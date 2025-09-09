import { BXmlNode } from './BXmlNode';
import { BXmlToken, VariantType } from './enums';
import { ChunkHeader } from './ChunkHeader';
import { BinaryReader } from '../binary/BinaryReader';
import { NodeFactory } from './node-factory';
import { VariantValueParser } from './VariantValueParser';
import { ActualTemplateNode } from './ActualTemplateNode';
import { getLogger } from '../logging/logger.js';
const NS_LOG = getLogger('NodeSpecialisations');

/**
 * A node that marks the start of a binary XML stream.
 * Token: 0x0f
 */
export class StartOfStreamNode extends BXmlNode {
  public unknownByteAfterToken: number; // Corresponds to python's unknown0
  public unknownWordAfterUnknownByte: number; // Corresponds to python's unknown1

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken, // This is 0x0F, consumed by factory
  ) {
    super(r, chunk, parent, token);
    // Python's StreamStartNode reads:
    // self.declare_field("byte", "token", 0x0) // Already consumed by factory
    // self.declare_field("byte", "unknown0")
    // self.declare_field("word", "unknown1")
    this.unknownByteAfterToken = r.u8();
    this.unknownWordAfterUnknownByte = r.u16le();
  }

  public get length(): number {
    return 1 + 1 + 2; // Token(1) + unknownByte(1) + unknownWord(2) = 4 bytes
  }
}

/**
 * A node that simply marks the end of a list of other nodes.
 * Token: 0x00
 */
export class EndOfStreamNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
  }
  public get length(): number {
    return 1;
  }
}

/**
 * Represents an XML element opening, like `<System>` or `<EventData>`.
 * It can contain attributes and other child nodes.
 * Token: 0x01
 */
export class OpenStartElementNode extends BXmlNode {
  public size: number; // This is the size of the element's content, attributes, and closing tags, *excluding* this token.
  public element_id: number; // Seems unused
  public string_offset: number;
  private _unknown0: number;
  private _tag_length: number = 0; // Store the calculated tag length like Python

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken, // This is the 0x01 token passed by the factory
  ) {
    super(r, chunk, parent, token);

    const nodeStartPositionInStream = this.r.tell() - 1; // Position where this node's data starts (after token)

    this._unknown0 = this.r.u16le(); // Python: word (2 bytes)
    this.size = this.r.u32le(); // Python: dword (4 bytes) - Size of the rest of the element
    this.string_offset = this.r.u32le(); // Python: dword (4 bytes)
    this.element_id = -1; 

    NS_LOG.debug(`🔧🔧 OpenStartElement DETAILED: node_offset=0x${nodeStartPositionInStream.toString(16)}, unknown0=${this._unknown0}, size=${this.size}, string_offset=${this.string_offset}`);
    
    // Calculate tag length like Python
    let _tag_length = 11; // token(1) + unknown0(2) + size(4) + string_offset(4) = 11
    
    // Handle flags like Python
    if (this.flags() & 0x04) {
      _tag_length += 4;
      NS_LOG.debug(`🔧 OpenStartElement: Flags 0x04 detected, adding 4 bytes to tag_length`);
    }
    
    // Check for inline string like Python
    const nodeChunkRelativeOffset = nodeStartPositionInStream - chunk.offset;
    NS_LOG.debug(`🔧 OpenStartElement: node_chunk_offset=0x${nodeChunkRelativeOffset.toString(16)}, string_offset=0x${this.string_offset.toString(16)}`);
    
    if (this.string_offset > nodeChunkRelativeOffset) {
      NS_LOG.debug(`🔧 OpenStartElement: String offset > node offset, parsing inline string`);
      const stringNode = chunk.addString(this.string_offset, this);
      if (stringNode) {
        _tag_length += stringNode.length;
        NS_LOG.debug(`🔧 OpenStartElement: Added inline string, length=${stringNode.length}, new_tag_length=${_tag_length}`);
      }
    }
    
    NS_LOG.debug(`🔧 OpenStartElement FINAL: tag_length=${_tag_length}, content_should_start_at=0x${(nodeStartPositionInStream + _tag_length).toString(16)}`);
    
    // Store the calculated tag length
    this._tag_length = _tag_length;

    this.read_internal_structure(_tag_length, nodeStartPositionInStream);
  }

  private read_internal_structure(tagLength: number, nodeStart: number): void {
    // Calculate the start of content parsing
    const startOfContentParsing = nodeStart + tagLength;
    const elementContentEndPosition = startOfContentParsing + this.size;

    NS_LOG.debug(`🔧 OpenStartElement (${this.name}): Structure parsing from 0x${startOfContentParsing.toString(16)} to 0x${elementContentEndPosition.toString(16)} (${this.size} bytes)`);

    // Move reader to content start position
    this.r.seek(startOfContentParsing);

    // Parse attributes
    let attributeCount = 0;
    while (this.r.tell() < elementContentEndPosition) {
        if (this.r.tell() >= this.r.size) {
          NS_LOG.debug(`🔧 OpenStartElement (${this.name}): Hit end of file during attribute parsing`);
          break;
        }
        
        const attrPos = this.r.tell();
        const token = this.r.peek();
        NS_LOG.debug(`🔧 OpenStartElement (${this.name}): At 0x${attrPos.toString(16)}, token=0x${token.toString(16)}`);
        
        try {
          // Mask the token to get the lower 4 bits like NodeFactory does
          const maskedToken = token & 0x0F;
          if (maskedToken === BXmlToken.Attribute) {
              NS_LOG.debug(`🔧 OpenStartElement (${this.name}): Parsing attribute ${attributeCount} (token=0x${token.toString(16)}, masked=0x${maskedToken.toString(16)})`);
              const attribute = this.factory.fromStream(this);
              this.children.push(attribute);
              attributeCount++;
              NS_LOG.debug(`🔧 OpenStartElement (${this.name}): Added attribute, now at 0x${this.r.tell().toString(16)}`);
          } else {
              NS_LOG.debug(`🔧 OpenStartElement (${this.name}): Non-attribute token 0x${token.toString(16)} (masked=0x${maskedToken.toString(16)}), ending attribute parsing`);
              break;
          }
        } catch (error) {
          NS_LOG.warn(`OpenStartElement (${this.name}): Error parsing attribute at ${this.r.tell()}:`, error);
          break;
        }
    }
    
    NS_LOG.debug(`🔧 OpenStartElement (${this.name}): Parsed ${attributeCount} attributes, now at 0x${this.r.tell().toString(16)}`);

    // Expect CloseStartElement or CloseEmptyElement
    if (this.r.tell() < elementContentEndPosition) {
        try {
          const nextToken = this.r.peek();
          if (nextToken === BXmlToken.CloseStartElement) {
              const closeStartNode = this.factory.fromStream(this); // Consumes CloseStartElement
              this.children.push(closeStartNode);

              // Parse child nodes
              while (this.r.tell() < elementContentEndPosition) {
                  if (this.r.tell() >= this.r.size) break;
                  
                  try {
                    if (this.r.peek() === BXmlToken.CloseElement) {
                        break; 
                    }
                    const childNode = this.factory.fromStream(this);
                    this.children.push(childNode);
                    if (childNode.token === BXmlToken.EndOfStream || childNode.constructor.name === 'UnimplementedNode') {
                         NS_LOG.warn(`Stopping child parsing in OpenStartElement due to ${BXmlToken[childNode.token] || 'UnimplementedNode'}`);
                         break;
                    }
                  } catch (error) {
                   NS_LOG.warn(`OpenStartElement (${this.name}): Error parsing child at ${this.r.tell()}:`, error);
                    break;
                  }
              }

              // Expect CloseElement
              if (this.r.tell() < elementContentEndPosition && this.r.tell() < this.r.size) {
                try {
                  if (this.r.peek() === BXmlToken.CloseElement) {
                      const closeElementNode = this.factory.fromStream(this);
                      this.children.push(closeElementNode);
                  } else {
                      NS_LOG.warn(`OpenStartElement (${this.name}): Expected CloseElement token but found ${BXmlToken[this.r.peek()]} at ${this.r.tell()}. Element size: ${this.size}, parsed from ${startOfContentParsing} to ${this.r.tell()}`);
                  }
                } catch (error) {
                  NS_LOG.warn(`OpenStartElement (${this.name}): Error parsing CloseElement at ${this.r.tell()}:`, error);
                }
              }

          } else if (nextToken === BXmlToken.CloseEmptyElement) {
              const closeEmptyNode = this.factory.fromStream(this); // Consumes CloseEmptyElement
              this.children.push(closeEmptyNode);
          } else {
              NS_LOG.warn(`OpenStartElement (${this.name}): Expected CloseStartElement or CloseEmptyElement but found ${BXmlToken[nextToken]} at ${this.r.tell()}`);
          }
        } catch (error) {
          NS_LOG.warn(`OpenStartElement (${this.name}): Error parsing structure at ${this.r.tell()}:`, error);
        }
    }
    // Ensure reader is positioned at the end of this element as defined by its size field
    // This is tricky if parsing within this.size isn't perfect.
    // A more robust approach might be to r.seek(startOfContentParsing + this.size) if internal parsing fails,
    // but that risks desynchronization. For now, rely on internal parsing consuming correctly.
  }

  public flags(): number {
    return this.token >> 4;
  }

  public get name(): string {
    return this.chunk.strings().get(this.string_offset)?.name || `UnknownTag_0x${this.string_offset.toString(16)}`;
  }

  public get length(): number {
    // Return the tag length (header only), like Python's tag_length() method
    // This is what defines where the content starts, not the total content size
    return this._tag_length;
  }
}

/**
 * A node that represents a string stored in the chunk's string table.
 * These are used for tag names, attribute names, etc.
 */
export class NameStringNode extends BXmlNode {
  public name_hash: number;
  public next_string_offset: number;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
  ) {
    // We don't have a token for this, so we pass a placeholder.
    // This node type is not created by the NodeFactory from a token.
    super(r, chunk, parent, BXmlToken.Name);
    this.next_string_offset = this.r.u32le(); // Store for chaining
    this.name_hash = this.r.u16le();
    this.data = this.r.wstring();
  }

  public get name(): string {
    return this.data;
  }

  public get length(): number {
    // 4 (next_offset) + 2 (hash) + 2 (string_length) + (string_length * 2) (UTF-16 string) + 2 (Python's "two bytes unaccounted for")
    return 8 + this.data.length * 2 + 2;
  }
}

export class CloseStartElementNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
  }
  public get length(): number {
    return 1;
  }
}

export class CloseEmptyElementNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
  }
  public get length(): number {
    return 1;
  }
}

export class CloseElementNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
  }
  public get length(): number {
    return 1;
  }
}

export class ValueTextNode extends BXmlNode {
  public value_type: number;
  private _valueLength: number = 0; // Length of the actual variant value data
  private _parsedValue: any = null;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this.value_type = this.r.u8();
    
    // Use VariantValueParser to parse the value
    try {
      const parser = new VariantValueParser(this.r);
      const result = parser.parse(this.value_type as VariantType);
      this._parsedValue = result.value;
      this._valueLength = result.consumedBytes;
      this.data = this._parsedValue;
      
      NS_LOG.debug(`✅ ValueTextNode: token=${token.toString(16)}, type=0x${this.value_type.toString(16)}, value=${typeof this._parsedValue === 'string' ? `"${this._parsedValue}"` : this._parsedValue}, consumed=${this._valueLength} bytes`);
    } catch (error) {
      NS_LOG.warn(`❌ ValueTextNode: Error parsing variant type 0x${this.value_type.toString(16)}:`, error);
      this._parsedValue = null;
      this._valueLength = 0;
    }
  }

  public get length(): number {
    // Length is 1 (token) + 1 (type) + length of the encoded value data.
    return 2 + this._valueLength;
  }

  // Method to get the actual value
  public getValue(): any {
    return this._parsedValue;
  }
}

export class AttributeNode extends BXmlNode {
  private string_offset: number;
  private _name_string_length: number = 0; // Length of inline string data like Python

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    
    const startOffset = r.tell() - 1; // AttributeNode start position
    NS_LOG.debug(`🔧🔧 AttributeNode: Starting at 0x${startOffset.toString(16)}`);
    
    // Header parsing
    this.string_offset = this.r.u32le(); // Offset to the attribute's name in the string table
    NS_LOG.debug(`🔧🔧 AttributeNode: string_offset=0x${this.string_offset.toString(16)}, now at 0x${r.tell().toString(16)}`);
    
    // Inline String Detection (like Python)
    const nodeChunkRelativeOffset = startOffset - chunk.offset;
    const shouldHaveInlineString = this.string_offset > nodeChunkRelativeOffset;
    NS_LOG.debug(`🔧🔧 AttributeNode: chunk_rel_offset=0x${nodeChunkRelativeOffset.toString(16)}, should_have_inline=${shouldHaveInlineString}`);
    
    // Inline String Parsing (if needed)
    if (shouldHaveInlineString) {
      const beforeInlineString = r.tell();
      NS_LOG.debug(`🔧🔧 AttributeNode: Parsing inline string from 0x${beforeInlineString.toString(16)}`);
      
      // Parse inline NameStringNode structure like Python
      const nextOffset = r.u32le();
      const hash = r.u16le();
      const stringLength = r.u16le();
    NS_LOG.debug(`🔧🔧 AttributeNode: inline string - next=0x${nextOffset.toString(16)}, hash=0x${hash.toString(16)}, len=${stringLength}`);
      
      if (stringLength > 0) {
        const stringData = r.readBuffer(stringLength * 2); // UTF-16LE
        const decoded = new TextDecoder('utf-16le').decode(stringData);
        NS_LOG.debug(`🔧🔧 AttributeNode: read string data "${decoded}", now at 0x${r.tell().toString(16)}`);
        r.u16le(); // null terminator
        const afterNullTerminator = r.tell();
        NS_LOG.debug(`🔧🔧 AttributeNode: read null terminator, now at 0x${afterNullTerminator.toString(16)}`);
      }
      
      // Calculate total inline string length like Python NameStringNode
      // Python: tag_length() + 2, where tag_length = (string_length * 2) + 8
      // So total = 8 + (string_length * 2) + 2 = 10 + (string_length * 2)
      this._name_string_length = 4 + 2 + 2 + (stringLength * 2) + 2; // next+hash+len+data+null
      NS_LOG.debug(`🔧🔧 AttributeNode: calculated inline string length=${this._name_string_length}`);
      
      // Add the inline string to chunk's string table like Python
      try {
        chunk.addString(this.string_offset, this);
      } catch (error) {
        // Ignore errors for now
      }
    }
    
    // Calculate expected child position like Python
    const expectedTagLength = 5 + this._name_string_length; // 1 token + 4 string_offset + inline string
    const expectedChildPosition = startOffset + expectedTagLength;
    const actualPosition = r.tell();
    
    NS_LOG.debug(`🔧🔧 AttributeNode: tag_length=${expectedTagLength}, expected_child_at=0x${expectedChildPosition.toString(16)}, actual_at=0x${actualPosition.toString(16)}, diff=${actualPosition - expectedChildPosition}`);
    
    // Fix: Use Python's approach - explicitly seek to the calculated child position
    r.seek(expectedChildPosition);
    NS_LOG.debug(`🔧 AttributeNode: Positioned reader to expected child position 0x${expectedChildPosition.toString(16)}, next token=0x${r.peek()?.toString(16) || 'EOF'}`);
    
    if (r.tell() < r.size) {
      try {
        const childNode = this.factory.fromStream(this);
        this.children.push(childNode);
        NS_LOG.debug(`✅ AttributeNode: Successfully parsed child: ${childNode.constructor.name}`);
      } catch (error) {
        NS_LOG.error(`❌ AttributeNode: Failed to parse child:`, error);
      }
    }
  }

  public get name(): string {
    return this.chunk.strings().get(this.string_offset)?.name || `UnknownAttribute_0x${this.string_offset.toString(16)}`;
  }

  public get value(): any | undefined {
    // Assuming the first child is the ValueTextNode (or similar) holding the attribute's value
    if (this.children.length > 0 && this.children[0] instanceof ValueTextNode) {
      return (this.children[0] as ValueTextNode).getValue();
    }
    return undefined;
  }

  public get length(): number {
    // Length is 1 (token) + 4 (string_offset) + inline_string + length of its value node(s).
    let valueNodesLength = 0;
    if (this.children.length > 0) {
        valueNodesLength = this.children[0].length; // Assuming one value node as child
    }
    return 1 + 4 + this._name_string_length + valueNodesLength;
  }
}

export class CDataSectionNode extends BXmlNode {
  private string_length: number;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    // Based on Python: token(1) + string_length(2) + wstring data
    this.string_length = this.r.u16le();
    
    // Skip the actual string data for now to prevent buffer issues
    NS_LOG.debug(`CDataSectionNode: string_length=${this.string_length} at offset ${r.tell()}`);
    
    // For safety, don't try to read the wstring yet
    // this.data = read wstring of length (this.string_length - 2)
  }

  public get length(): number {
    // Python: tag_length = 0x3 + string_length
    return 3 + this.string_length;
  }
}



export class ProcessingInstructionTargetNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this.data = this.r.wstring();
  }

  public get length(): number {
    return 1 + 2 + this.data.length * 2;
  }
}

export class ProcessingInstructionDataNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this.data = this.r.wstring();
  }

  public get length(): number {
    return 1 + 2 + this.data.length * 2;
  }
}

export class TemplateInstanceNode extends BXmlNode {
  public unknownByteAfterToken: number; // python: unknown0
  public template_id: number;
  public template_offset: number; // Chunk-relative offset to the TemplateNode definition
  private _data_length: number = 0; // For resident templates
  private _embedded: boolean = false; // When parsing inside an embedded BXML substitution
  private _startPos: number = 0; // Absolute offset of token start

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken, // This is 0x0C, consumed by factory
  ) {
    super(r, chunk, parent, token);
    
    const startPos = r.tell() - 1;
    this._startPos = startPos;
    NS_LOG.debug(`🎯 TemplateInstanceNode: Starting at 0x${startPos.toString(16)}, token=0x${token.toString(16)}`);
    
    // Python's TemplateInstanceNode reads:
    // self.declare_field("byte", "token", 0x0) // Consumed by factory
    // self.declare_field("byte", "unknown0")
    // self.declare_field("dword", "template_id")
    // self.declare_field("dword", "template_offset")
    this.unknownByteAfterToken = r.u8();
    this.template_id = r.u32le();
    this.template_offset = r.u32le();
    
    NS_LOG.debug(`🎯 TemplateInstanceNode: unknown=0x${this.unknownByteAfterToken.toString(16)}, id=${this.template_id}, offset=0x${this.template_offset.toString(16)}`);
    
    // Detect embedded parsing via parent marker (set by BXmlParser)
    this._embedded = !!(parent && (parent as any).__embedded === true);

    // CRITICAL FIX: Handle resident templates like Python
    if (this.isResidentTemplate()) {
      NS_LOG.debug(`🏠 TemplateInstanceNode: This is a RESIDENT template at 0x${this.template_offset.toString(16)}`);
      try {
        // Add the resident template to the chunk's template cache
        const newTemplate = chunk.addTemplate(this.template_offset, this);
        // IMPORTANT: Include template header (24 bytes) + data_length like Python
        this._data_length += newTemplate.tagLength + newTemplate.dataLength;
        NS_LOG.debug(`✅ TemplateInstanceNode: Added resident template, total_length=${this._data_length} (header=${newTemplate.tagLength} + data=${newTemplate.dataLength})`);
      } catch (error) {
        NS_LOG.error(`❌ TemplateInstanceNode: Failed to add resident template:`, error);
      }
    } else {
      NS_LOG.debug(`🗂️ TemplateInstanceNode: Using template table template at 0x${this.template_offset.toString(16)}`);
    }

    // Reader advancement:
    // - At top-level (record stream), resident template bytes live inline → advance past them.
    // - In embedded BXML, resident template bytes are not present in the embedded buffer → do NOT advance.
    if (!this._embedded) {
      const endPos = startPos + this.length;
      if (r.tell() !== endPos) {
        r.seek(endPos);
      }
    }

    NS_LOG.debug(`🎯 TemplateInstanceNode: Final length=${this.length}, now at 0x${r.tell().toString(16)}`);
  }

  /**
   * Check if this is a resident (inline) template
   * Python: return self.template_offset() > self.offset() - self._chunk._offset
   */
  private isResidentTemplate(): boolean {
    const nodeChunkRelativeOffset = this._startPos - this.chunk.offset; // Node start offset relative to chunk
    const isResident = this.template_offset > nodeChunkRelativeOffset;
    NS_LOG.debug(`🔍 TemplateInstanceNode.isResidentTemplate():`);
    NS_LOG.debug(`   Node chunk-relative offset: 0x${nodeChunkRelativeOffset.toString(16)}`);
    NS_LOG.debug(`   Template offset: 0x${this.template_offset.toString(16)}`);
    NS_LOG.debug(`   Is resident: ${isResident}`);
    return isResident;
  }

  public get length(): number {
    // Token(1) + unknownByte(1) + template_id(4) + template_offset(4) + resident_template_data
    // Python counts resident template bytes into the node length even in embedded BXML.
    const base = 1 + 1 + 4 + 4;
    return base + this._data_length;
  }

  /**
   * Get the ActualTemplateNode (enhanced template) for this instance
   */
  getActualTemplate(): ActualTemplateNode | null {
    return this.chunk.getActualTemplate(this.template_offset);
  }

  /**
   * Render XML using this template instance with provided substitutions
   * @param substitutions Array of parsed substitution values 
   * @returns Rendered XML string
   */
  renderXml(substitutions: any[]): string {
    const template = this.getActualTemplate();
    if (!template) {
      NS_LOG.warn(`TemplateInstanceNode: Could not load template at offset 0x${this.template_offset.toString(16)}`);
      return '<Event/>';
    }

    NS_LOG.debug(`🎨 TemplateInstanceNode: Rendering with template ${template.templateId} using ${substitutions.length} substitutions`);
    return template.renderXml(substitutions);
  }

  // Optional: Method to retrieve the TemplateNode definition
  // public getDefinition(this: TemplateInstanceNode): TemplateNode | undefined {
  //     // This would require ChunkHeader to have a map of TemplateNodes
  //     return this.chunk.templates().get(this.template_offset);
  // }
}

export class FragmentHeaderNode extends BXmlNode {
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this.r.u8(); // major version
    this.r.u8(); // minor version
    this.r.u16le(); // magic

    while (this.r.peek() != BXmlToken.EndOfStream) {
      const node = this.factory.fromStream(this);
      this.children.push(node);
      if (node.token === BXmlToken.EndOfStream) {
        break;
      }
    }
  }

  public get length(): number {
    return 5;
  }
}

export class NormalSubstitutionNode extends BXmlNode {
  public substitution_id: number;
  public value_type: number;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this.substitution_id = this.r.u16le();
    this.value_type = this.r.u8();
  }

  public get length(): number {
    return 4;
  }
}

export class OptionalSubstitutionNode extends BXmlNode {
  public substitution_id: number;
  public value_type: number;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this.substitution_id = this.r.u16le();
    this.value_type = this.r.u8();
  }

  public get length(): number {
    return 4;
  }
}

export class CharacterReferenceNode extends BXmlNode {
  public entity: number;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    // Python: token(1) + entity(2)
    this.entity = r.u16le();
  }

  get length(): number {
    return 3; // token + entity(2 bytes)
  }

  public entityReference(): string {
    return `&#x${this.entity.toString(16).padStart(4, '0')};`;
  }
}

export class EntityReferenceNode extends BXmlNode {
  private string_offset: number;
  private _name_string_length: number = 0;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    // Python: token(1) + string_offset(4)
    this.string_offset = r.u32le();
    
    // Handle string length calculation like Python does
    if (this.string_offset > r.tell() - chunk.offset) {
      // String is beyond current position - would need to add to chunk strings
      // For now, just track base length
      this._name_string_length = 0;
    }
  }

  public get name(): string {
    return this.chunk.strings().get(this.string_offset)?.name || 'UnknownEntity';
  }

  public entityReference(): string {
    return `&${this.name};`;
  }

  get length(): number {
    return 5 + this._name_string_length; // token + string_offset + potential string data
  }
} 
