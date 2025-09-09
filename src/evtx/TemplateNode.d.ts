import { BinaryReader } from '../binary/BinaryReader';
import { ChunkHeader } from './ChunkHeader';
import { BXmlNode } from './BXmlNode';
export declare class TemplateNode {
    private _offset;
    private _nextOffset;
    private _templateId;
    private _guid;
    private _dataLength;
    private _reader;
    private _chunk;
    private _children;
    constructor(reader: BinaryReader, offset: number, chunk: ChunkHeader);
    get offset(): number;
    get nextOffset(): number;
    get templateId(): number;
    get guid(): Uint8Array;
    get dataLength(): number;
    get children(): BXmlNode[];
    get tagLength(): number;
    private parseChildren;
    /**
     * Get a simplified XML structure representation
     */
    getXmlStructure(): string;
    private renderStructure;
}
