import { BinaryReader } from '../binary/BinaryReader';
import { ChunkHeader } from './ChunkHeader';
import { BXmlNode } from './BXmlNode';
import { NodeFactory } from './node-factory';
import { BXmlToken } from './enums';
import { VariantValueParser } from './VariantValueParser';
import { getLogger } from '../logging/logger.js';
// Note: Embedded BXML uses the same chunk address space as the outer record.

/**
 * Utility for parsing embedded BXML data from substitutions
 * This follows Python's BXmlTypeNode approach: sub.root() returns a RootNode, then render_root_node(sub.root())
 */
export class BXmlParser {
  private static _log = getLogger('BXmlParser');

  
  /**
   * Parse embedded BXML data and render it as XML
   * This follows Python's approach: render_root_node(sub.root())
   */
  static parseAndRenderBXml(bxmlData: Uint8Array, chunk: ChunkHeader): string {
    if (!bxmlData || bxmlData.length === 0) {
      return '';
    }

    try {
      this._log.debug(`🔍 Parsing ${bxmlData.length} bytes of embedded BXML`);
      
      // Create a new reader for the embedded BXML data
      const reader = new BinaryReader(bxmlData);
      
      // Parse the embedded BXML structure just like Python's BXmlTypeNode.__init__ does:
      // self._root = RootNode(buf, offset, chunk, self)
      const nestedRootNode = this.parseEmbeddedRootNode(reader, chunk);
      
      if (nestedRootNode) {
        // Now follow Python's render_root_node() approach
        return this.renderEmbeddedRootNode(nestedRootNode);
      }
      
      this._log.warn('Failed to parse embedded RootNode');
      return '';
      
    } catch (error) {
      this._log.warn('Error parsing embedded BXML:', error);
      return '';
    }
  }

  // Parse embedded BXML using an absolute file offset (python-compatible),
  // leveraging the chunk's reader to access bytes beyond the local blob.
  static parseAndRenderBXmlAtOffset(baseOffset: number, length: number, chunk: ChunkHeader): string {
    try {
      const fullReader = new BinaryReader((chunk as any).r.bytesAt(0, (chunk as any).r.size));
      fullReader.seek(baseOffset);
      const { templateInstance, substitutions } = this.parseEmbeddedRootNodeAtOffset(fullReader, chunk, baseOffset, length);
      if (!templateInstance) return '';
      const actual = (templateInstance as any).getActualTemplate?.();
      if (!actual) return '';
      return actual.renderXml(substitutions || []);
    } catch (e) {
      this._log.warn('Error parseAtOffset', (e as Error).message);
      return '';
    }
  }

  private static parseEmbeddedRootNodeAtOffset(reader: BinaryReader, chunk: ChunkHeader, baseOffset: number, length: number): any {
    const factory = new NodeFactory(reader);
    const nodes: BXmlNode[] = [];
    let templateInstance: any = null;
    let declared = 0;
    reader.seek(baseOffset);
    while (reader.tell() < baseOffset + length + 64) { // small guard
      const before = reader.tell();
      try {
        const node = factory.fromStream({ chunk, __embedded: true, factory } as any);
        const after = reader.tell();
        const logical = (node as any).length || 0;
        if (node.constructor.name !== 'EndOfStreamNode') declared += logical;
        nodes.push(node);
        if (node.constructor.name === 'TemplateInstanceNode') templateInstance = node;
        // In embedded BXML, the substitution header immediately follows the TemplateInstance bytes.
        // Do not attempt to parse further tokens (e.g., misinterpreting count as CloseElement).
        if (node.constructor.name === 'TemplateInstanceNode') break;
        if (node.constructor.name === 'EndOfStreamNode') break;
        if (after <= before) break; // avoid infinite loop
      } catch { break; }
    }
    // Python: count is at baseOffset + declared (no -1)
    let substitutions: any[] = [];
    try {
      reader.seek(baseOffset + declared);
      const count = reader.u32le();
      const decls: Array<{ size: number, type: number }> = [];
      for (let i = 0; i < count; i++) {
        const size = reader.u16le();
        const type = reader.u8();
        reader.u8();
        decls.push({ size, type });
      }
      const vals: any[] = [];
      for (const d of decls) {
        const parsed = new VariantValueParser(reader).parse(d.type as any, d.size);
        vals.push(parsed.value);
      }
      substitutions = vals;
    } catch (e) {
      // leave substitutions empty if cannot read
    }
    return { templateInstance, substitutions };
  }

  /**
   * Parse embedded BXML using absolute file offset and return the ActualTemplateNode and its substitutions.
   * This is used by the message-arg layout builder to avoid XML scraping.
   */
  static parseEmbeddedActualAtOffset(baseOffset: number, length: number, chunk: ChunkHeader): { actual: any | null, substitutions: any[] } {
    try {
      const fullReader = new BinaryReader((chunk as any).r.bytesAt(0, (chunk as any).r.size));
      fullReader.seek(baseOffset);
      const { templateInstance, substitutions } = this.parseEmbeddedRootNodeAtOffset(fullReader, chunk, baseOffset, length);
      const actual = templateInstance ? (templateInstance as any).getActualTemplate?.() : null;
      return { actual, substitutions: substitutions || [] };
    } catch (e) {
      this._log.warn('Error parseEmbeddedActualAtOffset', (e as Error).message);
      return { actual: null, substitutions: [] };
    }
  }

  /**
   * Parse embedded BXML from an in-memory blob and return ActualTemplateNode and substitutions.
   */
  static parseEmbeddedActual(bxmlData: Uint8Array, chunk: ChunkHeader): { actual: any | null, substitutions: any[] } {
    if (!bxmlData || bxmlData.length === 0) return { actual: null, substitutions: [] };
    try {
      const reader = new BinaryReader(bxmlData);
      const { templateInstance, substitutions } = this.parseEmbeddedRootNode(reader, chunk) || {};
      const actual = templateInstance ? (templateInstance as any).getActualTemplate?.() : null;
      return { actual, substitutions: substitutions || [] };
    } catch (e) {
      this._log.warn('Error parseEmbeddedActual', (e as Error).message);
      return { actual: null, substitutions: [] };
    }
  }

  // Debug/trace variant: returns both XML and parsing trace
  static parseEmbeddedBXmlWithTrace(bxmlData: Uint8Array, chunk: ChunkHeader): { xml: string, trace: any } {
    const trace: any = { size: bxmlData?.length || 0, nodes: [], childrenConsumed: 0, countPos: null, count: 0, declarations: [], values: [] };
    if (!bxmlData || bxmlData.length === 0) return { xml: '', trace };

    const reader = new BinaryReader(bxmlData);
    const factory = new NodeFactory(reader);
    let templateInstance: any = null;
    let childrenConsumed = 0;

    while (reader.tell() < reader.size) {
      try {
        const before = reader.tell();
        const node = factory.fromStream({ chunk, __embedded: true, factory } as any);
        if (!node) break;
        const after = reader.tell();
        const consumed = Math.max(0, after - before);
        childrenConsumed += consumed;
        trace.nodes.push({ name: node.constructor.name, before, after, consumed, logicalLen: (node as any).length || null });
        if (node.constructor.name === 'TemplateInstanceNode') templateInstance = node;
        if (node.constructor.name === 'EndOfStreamNode') break;
      } catch { break; }
    }

    trace.childrenConsumed = childrenConsumed;

    // Substitutions
    const candidates: number[] = [];
    for (let delta = -8; delta <= 24; delta++) {
      const pos = childrenConsumed + delta;
      if (pos >= 0 && pos + 4 <= reader.size) candidates.push(pos);
    }
    for (const pos of candidates) {
      try {
        reader.seek(pos);
        const cnt = reader.u32le();
        const dpos = pos + 4;
        const bytesLeft = reader.size - dpos;
        if (cnt <= 0 || cnt > 256) continue;
        if (bytesLeft < cnt * 4) continue;
        reader.seek(dpos);
        const decls: Array<{ size: number, type: number }> = [];
        let sum = 0, ok = true;
        for (let i = 0; i < cnt; i++) {
          const size = reader.u16le(); const type = reader.u8(); reader.u8();
          sum += size; decls.push({ size, type }); if (sum > (bytesLeft - cnt * 4)) { ok = false; break; }
        }
        if (!ok) continue;
        trace.countPos = pos; trace.count = cnt; trace.declarations = decls;
        const values: any[] = [];
        for (const d of decls) {
          if (reader.tell() + d.size > reader.size) { values.push(null); continue; }
          const parsed = new VariantValueParser(reader).parse(d.type as any, d.size);
          values.push({ type: d.type, size: d.size, kind: typeof parsed.value, preview: typeof parsed.value === 'string' ? parsed.value.slice(0, 120) : parsed.value });
        }
        trace.values = values;
        break;
      } catch { /* try next */ }
    }

    let xml = '';
    try {
      if (templateInstance) {
        const actual = (templateInstance as any).getActualTemplate?.();
        const subs = (trace.values || []).map((v: any) => v && v.preview !== undefined ? v.preview : null);
        if (actual) xml = actual.renderXml(subs as any);
      }
    } catch {}

    return { xml, trace };
  }

  // Debug/trace using absolute file offset (preferred when available)
  static parseEmbeddedBXmlWithTraceAtOffset(baseOffset: number, length: number, chunk: ChunkHeader): { xml: string, trace: any } {
    const trace: any = { baseOffset, length, nodes: [], childrenDeclared: 0, countPos: null, count: 0, declarations: [], values: [] };
    try {
      const reader = new BinaryReader((chunk as any).r.bytesAt(0, (chunk as any).r.size));
      const factory = new NodeFactory(reader);
      reader.seek(baseOffset);
      let declared = 0;
      let templateInstance: any = null;
      while (reader.tell() < baseOffset + length + 64) {
        const before = reader.tell();
        try {
          const node = factory.fromStream({ chunk, __embedded: true, factory } as any);
          const after = reader.tell();
          const logical = (node as any).length || 0;
          if (node.constructor.name !== 'EndOfStreamNode') declared += logical;
          trace.nodes.push({ name: node.constructor.name, before, after, logical });
          if (node.constructor.name === 'TemplateInstanceNode') templateInstance = node;
          // Stop after TemplateInstance to avoid treating substitution header bytes as tokens
          if (node.constructor.name === 'TemplateInstanceNode') break;
          if (node.constructor.name === 'EndOfStreamNode') break;
          if (after <= before) break;
        } catch {
          break;
        }
      }
      trace.childrenDeclared = declared;
      // Count + decls
      reader.seek(baseOffset + declared);
      const count = reader.u32le();
      trace.countPos = baseOffset + declared;
      trace.count = count;
      for (let i = 0; i < count; i++) {
        const size = reader.u16le();
        const type = reader.u8();
        reader.u8();
        trace.declarations.push({ size, type });
      }
      const vals: any[] = [];
      for (const d of trace.declarations) {
        const parsed = new VariantValueParser(reader).parse(d.type as any, d.size);
        vals.push({ type: d.type, size: d.size, kind: typeof parsed.value, preview: typeof parsed.value === 'string' ? parsed.value.slice(0, 120) : parsed.value });
      }
      trace.values = vals;
      // Render
      let xml = '';
      if (templateInstance) {
        const actual = (templateInstance as any).getActualTemplate?.();
        if (actual) xml = actual.renderXml(vals.map(v => v.preview));
      }
      return { xml, trace };
    } catch (e) {
      return { xml: '', trace };
    }
  }

  /**
   * Parse embedded BXML data as a RootNode (equivalent to Python's BXmlTypeNode.root())
   */
  private static parseEmbeddedRootNode(reader: BinaryReader, chunk: ChunkHeader): any {
    try {
      const factory = new NodeFactory(reader);
      
      // Parse the structure - embedded BXML typically contains a TemplateInstanceNode
      const nodes: BXmlNode[] = [];
      let templateInstance = null;
      let substitutions: any[] = [];
      let childrenConsumed = 0; // Actual bytes consumed in this embedded buffer
      let childrenDeclared = 0; // Sum of node.length() like python's tag_and_children_length
      
      // Keep reading until we hit end of stream or run out of data
      while (reader.tell() < reader.size) {
        try {
          // Create a minimal parent with the REAL chunk context and a marker flag
          const dummyParent = { chunk, __embedded: true, factory } as any;
          
          const before = reader.tell();
          const node = factory.fromStream(dummyParent);
          if (!node) break;
          
          nodes.push(node);
          const after = reader.tell();
          const consumed = Math.max(0, after - before);
          childrenConsumed += consumed;
          const logical = (node as any).length || 0;
          // Exclude EndOfStream from declared length like python RootNode.children end_tokens
          if (node.constructor.name !== 'EndOfStreamNode') childrenDeclared += logical;
          this._log.debug(`🔍 Parsed embedded node: ${node.constructor.name} (consumed=${consumed}, logicalLen=${logical})`);
          
          // Look for TemplateInstanceNode
          if (node.constructor.name === 'TemplateInstanceNode') {
            templateInstance = node;
            this._log.debug(`🏠 Found TemplateInstanceNode in embedded BXML`);
          }
          
          // Stop at EndOfStream
          if (node.constructor.name === 'EndOfStreamNode') {
            this._log.debug(`🏁 Hit EndOfStream in embedded BXML`);
            // Do not include EndOfStream in children length (mirror top-level RootNode)
            break;
          }
        } catch (parseError) {
          this._log.debug(`🔍 Finished parsing embedded nodes (${nodes.length} nodes)`);
          break;
        }
      }
      
      // Parse substitutions if there's remaining data (like Python's RootNode.substitutions())
      if (reader.tell() < reader.size) {
        try {
          this._log.debug(`🔄 Parsed children consumed=${childrenConsumed} bytes; declared=${childrenDeclared} bytes; computing substitution start`);
          substitutions = this.parseEmbeddedSubstitutions(reader, childrenDeclared, childrenConsumed);
          this._log.debug(`🔄 Found ${substitutions.length} substitutions in embedded BXML`);
        } catch (subError) {
          this._log.debug(`🔄 No substitutions found in embedded BXML: ${String(subError)}`);
        }
      }
      
      return {
        nodes,
        templateInstance,
        substitutions,
        hasTemplate: !!templateInstance
      };
      
    } catch (error) {
      this._log.warn('Error parsing embedded RootNode:', error);
      return null;
    }
  }

  /**
   * Parse embedded substitutions following Python's exact algorithm:
   * 1. Calculate children length to find substitution start position
   * 2. Read substitution count from that position  
   * 3. Parse substitution declarations (size+type) then values
   */
  private static parseEmbeddedSubstitutions(bxmlReader: BinaryReader, childrenDeclared: number, childrenConsumed: number): any[] {
    // Try multiple candidate positions near the python-like declared length and the consumed length
    const bases = Array.from(new Set([
      Math.max(0, childrenDeclared),
      Math.max(0, childrenConsumed)
    ]));
    const candidates: number[] = [];
    for (const base of bases) {
      for (let delta = -16; delta <= 32; delta++) {
        const pos = base + delta - 1; // python uses ofs = tag_and_children_length(); they read at ofs (no -1); our earlier calc subOffset=ofs-1
        if (pos >= 0 && pos + 4 <= bxmlReader.size) candidates.push(pos);
      }
    }

    let chosenCount = 0;
    let countPos = -1;
    let declsPos = -1;

    for (const pos of candidates) {
      bxmlReader.seek(pos);
      const cnt = bxmlReader.u32le();
      const dpos = pos + 4;
      const bytesLeft = bxmlReader.size - dpos;
      if (cnt <= 0 || cnt > 256) continue; // sanity bound
      if (bytesLeft < cnt * 4) continue; // need at least declarations
      // Peek declarations and ensure total sizes plausible
      bxmlReader.seek(dpos);
      let ok = true;
      let totalSizes = 0;
      for (let i = 0; i < cnt; i++) {
        const size = bxmlReader.u16le();
        const type = bxmlReader.u8();
        bxmlReader.u8(); // reserved
        totalSizes += size;
        if (size > bytesLeft) { ok = false; break; }
      }
      const bytesAfterDecls = bytesLeft - cnt * 4;
      if (ok && totalSizes <= bytesAfterDecls) {
        chosenCount = cnt;
        countPos = pos;
        declsPos = dpos;
        break;
      }
    }

    if (countPos < 0) {
      this._log.warn(`🔄 Could not locate a plausible substitution header (declared=${childrenDeclared}, consumed=${childrenConsumed})`);
      return [];
    }

    bxmlReader.seek(countPos);
    this._log.debug(`🔄 Using substitution count ${chosenCount} at 0x${countPos.toString(16)} (u32le)`);
    bxmlReader.seek(declsPos);

    if (chosenCount === 0) {
      this._log.debug(`🔄 No substitutions in embedded BXML`);
      return [];
    }

    this._log.debug(`🔄 Parsing ${chosenCount} embedded substitutions (validated layout)`);

    try {
      // Phase 1: Read substitution declarations (following Python's RootNode.substitutions())
      const declarations: Array<{size: number, type: number}> = [];
      
      for (let i = 0; i < chosenCount; i++) {
        if (bxmlReader.tell() + 4 > bxmlReader.size) {
          this._log.warn(`🔄 Not enough bytes for declaration ${i}`);
          break;
        }
        
        // Python: size = self.unpack_word(ofs), type_ = self.unpack_byte(ofs + 0x2)
        const size = bxmlReader.u16le();   // 2 bytes: size
        const type = bxmlReader.u8();      // 1 byte: type  
        const padding = bxmlReader.u8();   // 1 byte: padding (to make 4 bytes total)
        
        declarations.push({size, type});
        this._log.debug(`🔄 Declaration ${i}: size=${size}, type=0x${type.toString(16)}`);
      }
      
      // Phase 2: Read substitution values using declarations
      const substitutions: any[] = [];
      
      for (let i = 0; i < declarations.length; i++) {
        const {size, type} = declarations[i];

        if (bxmlReader.tell() + size > bxmlReader.size) {
          this._log.warn(`🔄 Not enough bytes for substitution ${i} value (need ${size} bytes)`);
          substitutions.push(null);
          continue;
        }
        
        // Parse the substitution value with the specific size
        const parser = new VariantValueParser(bxmlReader);
        const result = parser.parse(type, size);
        const value = result.value;
        substitutions.push(value);
        
        if (value !== null) {
          this._log.debug(`✅ Parsed embedded substitution ${i}: type=0x${type.toString(16)}, size=${size}, value=${JSON.stringify(value)}`);
        } else {
          this._log.warn(`❌ Failed to parse embedded substitution ${i}: type=0x${type.toString(16)}, size=${size}`);
        }
      }
      
      this._log.debug(`🔄 Successfully parsed ${substitutions.length} embedded substitutions`);
      return substitutions;
      
    } catch (error) {
      this._log.error(`❌ Error parsing embedded substitutions:`, error);
      return [];
    }
  }

  /**
   * Render embedded RootNode to XML (like Python's render_root_node())
   */
  private static renderEmbeddedRootNode(rootNode: any): string {
    try {
      if (!rootNode.hasTemplate || !rootNode.templateInstance) {
        this._log.debug(`🎨 No template in embedded BXML, returning empty`);
        return '';
      }
      
      const templateInstance = rootNode.templateInstance;
      this._log.debug(`🎨 Rendering embedded template`);
      
      // Get the actual template and render it
      const actualTemplate = templateInstance.getActualTemplate?.();
      if (actualTemplate && actualTemplate.rootElement) {
        const substitutions = rootNode.substitutions || [];
        this._log.debug(`🎨 Rendering with ${substitutions.length} substitutions`);
        
        // Recursively render the embedded XML (like Python's render_root_node(sub.root()))
        const embeddedXml = actualTemplate.renderXml(substitutions);
        this._log.debug(`🎨 Embedded XML: ${embeddedXml}`);
        return embeddedXml;
      }
      
      this._log.warn('Could not get actual template from embedded BXML');
      return '';
      
    } catch (error) {
      this._log.warn('Error rendering embedded RootNode:', error);
      return '';
    }
  }
} 
