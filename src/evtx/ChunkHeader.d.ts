import { Block } from "./Block";
import { BinaryReader } from "../binary/BinaryReader";
import { Record } from "./Record";
import { NameStringNode } from './node-specialisations';
import { TemplateNode } from './TemplateNode';
import { ActualTemplateNode } from './ActualTemplateNode';
import { BXmlNode } from './BXmlNode';
export declare class ChunkHeader extends Block {
    private _strings;
    private _templates;
    private _actualTemplates;
    constructor(reader: BinaryReader, offset: number);
    magic(): string;
    fileFirstRecordNumber(): bigint;
    fileLastRecordNumber(): bigint;
    logFirstRecordNumber(): bigint;
    logLastRecordNumber(): bigint;
    headerSize(): number;
    lastRecordOffset(): number;
    nextRecordOffset(): number;
    dataChecksum(): number;
    headerChecksum(): number;
    checkMagic(): boolean;
    calculateHeaderChecksum(): number;
    calculateDataChecksum(): number;
    verify(): boolean;
    /**
     * Parses and caches the string table for this chunk.
     */
    private _loadStrings;
    /**
     * Get the chunk's string table
     */
    strings(): Map<number, NameStringNode>;
    /**
     * Add a string to the chunk's string table
     */
    addString(offset: number, parent?: BXmlNode): NameStringNode;
    /**
     * Get a string from the chunk's string table by offset
     */
    getString(offset: number): string | null;
    /**
     * Get a template from the chunk's template cache, or create it if not cached
     */
    getTemplate(offset: number): TemplateNode | null;
    /**
     * Add a template to the chunk's template cache (for resident templates)
     * Python equivalent: chunk.add_template(offset, parent)
     */
    addTemplate(offset: number, parent?: BXmlNode): TemplateNode;
    /**
     * Get an ActualTemplateNode (enhanced template) from cache, or create it if not cached
     */
    getActualTemplate(offset: number): ActualTemplateNode | null;
    firstRecord(): Record;
    records(): Generator<Record>;
}
