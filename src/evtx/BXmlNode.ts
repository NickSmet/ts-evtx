import { BinaryReader } from '../binary/BinaryReader';
import { ChunkHeader } from './ChunkHeader';
import { BXmlToken } from './enums';
import { NodeFactory } from './node-factory';

/**
 * The base class for all Binary XML node types.
 * It provides the core structure and properties that all nodes share.
 */
export abstract class BXmlNode {
  public r: BinaryReader;
  public chunk: ChunkHeader;
  public parent: BXmlNode | null;
  public token: BXmlToken;
  public children: BXmlNode[] = [];
  public data: any;
  public factory: NodeFactory;

  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode | null,
    token: BXmlToken,
  ) {
    this.r = r;
    this.chunk = chunk;
    this.parent = parent;
    this.token = token;
    // The factory is created by the root node and passed down.
    if (parent) {
      this.factory = parent.factory;
    } else {
      // This case should only be for the RootNode, which will create it.
      // We will assign it post-construction in that case.
      this.factory = null as any;
    }
  }

  /**
   * The total length of the node, including its tag and all its children.
   */
  public abstract get length(): number;

  /**
   * A friendly string representation for debugging.
   */
  public toString(): string {
    const tokenName =
      BXmlToken[this.token] || `UnknownToken(0x${this.token.toString(16)})`;
    return `${this.constructor.name}(${tokenName})`;
  }
}
