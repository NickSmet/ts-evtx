import { BXmlNode } from './BXmlNode';
import { BXmlToken } from './enums';
import { ChunkHeader } from './ChunkHeader';
import { BinaryReader } from '../binary/BinaryReader';
import { ActualTemplateNode } from './ActualTemplateNode';
/**
 * A node that marks the start of a binary XML stream.
 * Token: 0x0f
 */
export declare class StartOfStreamNode extends BXmlNode {
    unknownByteAfterToken: number;
    unknownWordAfterUnknownByte: number;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
/**
 * A node that simply marks the end of a list of other nodes.
 * Token: 0x00
 */
export declare class EndOfStreamNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
/**
 * Represents an XML element opening, like `<System>` or `<EventData>`.
 * It can contain attributes and other child nodes.
 * Token: 0x01
 */
export declare class OpenStartElementNode extends BXmlNode {
    size: number;
    element_id: number;
    string_offset: number;
    private _unknown0;
    private _tag_length;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    private read_internal_structure;
    flags(): number;
    get name(): string;
    get length(): number;
}
/**
 * A node that represents a string stored in the chunk's string table.
 * These are used for tag names, attribute names, etc.
 */
export declare class NameStringNode extends BXmlNode {
    name_hash: number;
    next_string_offset: number;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null);
    get name(): string;
    get length(): number;
}
export declare class CloseStartElementNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class CloseEmptyElementNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class CloseElementNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class ValueTextNode extends BXmlNode {
    value_type: number;
    private _valueLength;
    private _parsedValue;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
    getValue(): any;
}
export declare class AttributeNode extends BXmlNode {
    private string_offset;
    private _name_string_length;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get name(): string;
    get value(): any | undefined;
    get length(): number;
}
export declare class CDataSectionNode extends BXmlNode {
    private string_length;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class ProcessingInstructionTargetNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class ProcessingInstructionDataNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class TemplateInstanceNode extends BXmlNode {
    unknownByteAfterToken: number;
    template_id: number;
    template_offset: number;
    private _data_length;
    private _embedded;
    private _startPos;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    /**
     * Check if this is a resident (inline) template
     * Python: return self.template_offset() > self.offset() - self._chunk._offset
     */
    private isResidentTemplate;
    get length(): number;
    /**
     * Get the ActualTemplateNode (enhanced template) for this instance
     */
    getActualTemplate(): ActualTemplateNode | null;
    /**
     * Render XML using this template instance with provided substitutions
     * @param substitutions Array of parsed substitution values
     * @returns Rendered XML string
     */
    renderXml(substitutions: any[]): string;
}
export declare class FragmentHeaderNode extends BXmlNode {
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class NormalSubstitutionNode extends BXmlNode {
    substitution_id: number;
    value_type: number;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class OptionalSubstitutionNode extends BXmlNode {
    substitution_id: number;
    value_type: number;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
}
export declare class CharacterReferenceNode extends BXmlNode {
    entity: number;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get length(): number;
    entityReference(): string;
}
export declare class EntityReferenceNode extends BXmlNode {
    private string_offset;
    private _name_string_length;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    get name(): string;
    entityReference(): string;
    get length(): number;
}
