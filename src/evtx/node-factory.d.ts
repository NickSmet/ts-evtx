import { BinaryReader } from '../binary/BinaryReader';
import { BXmlNode } from './BXmlNode';
export declare class NodeFactory {
    private r;
    constructor(r: BinaryReader);
    fromStream(parent: BXmlNode): BXmlNode;
}
