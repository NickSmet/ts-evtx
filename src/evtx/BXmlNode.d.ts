import { BinaryReader } from '../binary/BinaryReader';
import { ChunkHeader } from './ChunkHeader';
import { BXmlToken } from './enums';
import { NodeFactory } from './node-factory';
/**
 * The base class for all Binary XML node types.
 * It provides the core structure and properties that all nodes share.
 */
export declare abstract class BXmlNode {
    r: BinaryReader;
    chunk: ChunkHeader;
    parent: BXmlNode | null;
    token: BXmlToken;
    children: BXmlNode[];
    data: any;
    factory: NodeFactory;
    constructor(r: BinaryReader, chunk: ChunkHeader, parent: BXmlNode | null, token: BXmlToken);
    /**
     * The total length of the node, including its tag and all its children.
     */
    abstract get length(): number;
    /**
     * A friendly string representation for debugging.
     */
    toString(): string;
}
