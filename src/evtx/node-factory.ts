import { BinaryReader } from '../binary/BinaryReader';
import { ChunkHeader } from './ChunkHeader';
import { BXmlNode } from './BXmlNode';
import { BXmlToken } from './enums';
import { getLogger } from '../logging/logger.js';
import {
  StartOfStreamNode,
  EndOfStreamNode,
  OpenStartElementNode,
  CloseStartElementNode,
  CloseEmptyElementNode,
  CloseElementNode,
  ValueTextNode,
  AttributeNode,
  CDataSectionNode,
  CharacterReferenceNode,
  EntityReferenceNode,
  ProcessingInstructionTargetNode,
  ProcessingInstructionDataNode,
  TemplateInstanceNode,
  FragmentHeaderNode,
  NormalSubstitutionNode,
  OptionalSubstitutionNode,
} from './node-specialisations';

class UnimplementedNode extends BXmlNode {
  private _log = getLogger('NodeFactory');
  constructor(
    r: BinaryReader,
    chunk: ChunkHeader,
    parent: BXmlNode,
    token: BXmlToken,
  ) {
    super(r, chunk, parent, token);
    this._log.warn(`Unimplemented token ${BXmlToken[token]} at offset ${r.tell()}`);
  }
  get length(): number {
    return 0;
  }
}

export class NodeFactory {
  private r: BinaryReader;
  private _log = getLogger('NodeFactory');

  constructor(r: BinaryReader) {
    this.r = r;
  }

  public fromStream(parent: BXmlNode): BXmlNode {
    const token: BXmlToken = this.r.u8();
    // Python masks tokens to lower 4 bits: token & 0x0F
    // Upper 4 bits are used as flags
    const maskedToken = token & 0x0F;
    switch (maskedToken) {
      case BXmlToken.StartOfStream:
        return new StartOfStreamNode(this.r, parent.chunk, parent, token);
      case BXmlToken.EndOfStream:
        return new EndOfStreamNode(this.r, parent.chunk, parent, token);
      case BXmlToken.OpenStartElement:
        return new OpenStartElementNode(this.r, parent.chunk, parent, token);
      case BXmlToken.CloseStartElement:
        return new CloseStartElementNode(this.r, parent.chunk, parent, token);
      case BXmlToken.CloseEmptyElement:
        return new CloseEmptyElementNode(this.r, parent.chunk, parent, token);
      case BXmlToken.CloseElement:
        return new CloseElementNode(this.r, parent.chunk, parent, token);
      case BXmlToken.Value:
        return new ValueTextNode(this.r, parent.chunk, parent, token);
      case BXmlToken.Attribute:
        return new AttributeNode(this.r, parent.chunk, parent, token);
      case BXmlToken.CDataSection:
        return new CDataSectionNode(this.r, parent.chunk, parent, token);
      case 0x08: // CharacterReference
        return new CharacterReferenceNode(this.r, parent.chunk, parent, token);
      case 0x09: // EntityReference
        return new EntityReferenceNode(this.r, parent.chunk, parent, token);
      case BXmlToken.ProcessingInstructionTarget:
        return new ProcessingInstructionTargetNode(
          this.r,
          parent.chunk,
          parent,
          token,
        );
      case BXmlToken.ProcessingInstructionData:
        return new ProcessingInstructionDataNode(
          this.r,
          parent.chunk,
          parent,
          token,
        );
      case BXmlToken.TemplateInstance:
        return new TemplateInstanceNode(this.r, parent.chunk, parent, token);
      case BXmlToken.FragmentHeader:
        return new FragmentHeaderNode(this.r, parent.chunk, parent, token);
      case BXmlToken.NormalSubstitution:
        return new NormalSubstitutionNode(this.r, parent.chunk, parent, token);
      case BXmlToken.OptionalSubstitution:
        return new OptionalSubstitutionNode(this.r, parent.chunk, parent, token);
      default:
        return new UnimplementedNode(this.r, parent.chunk, parent, token);
    }
  }
} 
