import { BinaryReader } from '../binary/BinaryReader.js';
import { ChunkHeader } from './ChunkHeader.js';
import { BXmlNode } from './BXmlNode.js';
import { TemplateNode } from './TemplateNode.js';
import { VariantType } from './enums.js';
import { BXmlParser } from './BXmlParser';
import { getLogger } from '../logging/logger.js';

/**
 * Enhanced template node that provides complete template parsing and XML rendering capabilities
 * Template node with helpers to extract EventData/UserData layouts and build args
 */
export class ActualTemplateNode {
  private _templateNode: TemplateNode;
  private _rootElement: BXmlNode | null = null;
  private _log = getLogger('ActualTemplateNode');

  constructor(templateNode: TemplateNode) {
    this._templateNode = templateNode;
    this._rootElement = this.findRootElement();
    this._log.debug(`🏗️ Created from TemplateNode with ${templateNode.children.length} children`);
    this._log.debug(`   Template ID: ${templateNode.templateId}`);
    this._log.debug(`   Root element: ${this._rootElement ? (this._rootElement as any).name || 'unknown' : 'none'}`);
  }

  // Getters
  get offset(): number { return this._templateNode.offset; }
  get nextOffset(): number { return this._templateNode.nextOffset; }
  get templateId(): number { return this._templateNode.templateId; }
  get guid(): Uint8Array { return this._templateNode.guid; }
  get dataLength(): number { return this._templateNode.dataLength; }
  get rootElement(): BXmlNode | null { return this._rootElement; }
  get allNodes(): BXmlNode[] { return this._templateNode.children; }

  private findRootElement(): BXmlNode | null {
    // Find the first OpenStartElementNode which will be our root element
    for (const node of this._templateNode.children) {
      if (node.constructor.name === 'OpenStartElementNode') {
        this._log.debug(`🎯 Root element found: ${(node as any).name || 'unknown'}`);
        return node;
      }
    }
    this._log.warn(`⚠️ No root element found in ${this._templateNode.children.length} nodes`);
    return null;
  }

  /**
   * Render XML using this template with provided substitutions
   * @param substitutions Array of parsed substitution values
   * @returns Rendered XML string
   */
  renderXml(substitutions: any[]): string {
    if (!this._rootElement) {
      this._log.warn('No root element found, cannot render XML');
      return '<Event/>';
    }

    this._log.debug(`🎨 Rendering XML with ${substitutions.length} substitutions`);
    
    try {
      return this.renderNode(this._rootElement, substitutions, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._log.error(`Error rendering XML: ${message}`);
      return '<Event/>';
    }
  }

  private renderNode(node: BXmlNode, substitutions: any[], depth: number): string {
    const nodeName = node.constructor.name;
    
    if (nodeName === 'OpenStartElementNode') {
      const element = node as any;
      const elementName = element.name || 'unknown';
      
      // PYTHON APPROACH: Two separate passes like Python's rec() function
      
      // FIRST PASS: Collect attributes only (like Python's first loop)
      const attributes: string[] = [];
      if (element.children && element.children.length > 0) {
        for (const child of element.children) {
          if (child.constructor.name === 'AttributeNode') {
            const attrNode = child as any;
            const attrName = attrNode.name || 'unknown';
            
            // Find the attribute value from the AttributeNode's children
            let attrValue = '';
            if (attrNode.children && attrNode.children.length > 0) {
              const valueNode = attrNode.children[0];
              if (valueNode.constructor.name === 'NormalSubstitutionNode' || 
                  valueNode.constructor.name === 'CompactSubstitutionNode' ||
                  valueNode.constructor.name === 'OptionalSubstitutionNode') {
                const subId = (valueNode as any).substitution_id;
                const valueType = (valueNode as any).value_type;
                if (subId < substitutions.length) {
                  const rawValue = substitutions[subId];
                  attrValue = this.formatValueForXml(rawValue, valueType);
                } else {
                  attrValue = `[SUBSTITUTION:${subId}]`;
                }
              } else if (valueNode.constructor.name === 'ValueTextNode') {
                attrValue = String((valueNode as any).data || '');
              } else {
                attrValue = this.renderNode(valueNode, substitutions, 0);
              }
            }
            
            attributes.push(` ${attrName}="${this.escapeXml(attrValue)}"`);
          }
        }
      }
      
      const attributeString = attributes.join('');
      
      // SECOND PASS: Recursively render ALL children (like Python's second loop)
      // This creates the nested element structure
      const childContent = element.children
        ? element.children
            .map((child: BXmlNode) => this.renderNode(child, substitutions, depth + 1))
            .join('')
        : '';
      
      // Build the complete element with proper formatting
      if (childContent.trim()) {
        // If there's content, format it with line breaks and indentation
        const indent = '  '.repeat(depth);
        const childIndent = '  '.repeat(depth + 1);
        const formattedChildContent = childContent.includes('<') 
          ? '\n' + childContent.split('\n').map((line: string) => line ? childIndent + line : line).join('\n') + '\n' + indent
          : childContent;
        return `<${elementName}${attributeString}>${formattedChildContent}</${elementName}>`;
      } else {
        // Self-closing or empty element
        return `<${elementName}${attributeString}></${elementName}>`;
      }
    }
    
    if (nodeName === 'NormalSubstitutionNode' || 
        nodeName === 'CompactSubstitutionNode' ||
        nodeName === 'OptionalSubstitutionNode') {
      const subNode = node as any;
      const subId = subNode.substitution_id;
      const valueType = subNode.value_type;
      
      if (subId < substitutions.length) {
        const rawValue = substitutions[subId];
        const formattedString = this.formatValueForXml(rawValue, valueType);
        this._log.debug(`🎨 Substitution ${subId}: type=0x${valueType?.toString(16)}, raw=${typeof rawValue}, formatted="${formattedString}"`);
        
        // BXml substitutions already return valid XML markup, don't escape them
        if (valueType === VariantType.BXml) {
          return formattedString; // Don't escape BXml content
        }
        
        return this.escapeXml(formattedString);
      } else {
        this._log.warn(`Substitution ID ${subId} out of range (have ${substitutions.length} substitutions)`);
        return `[SUBSTITUTION:${subId}]`;
      }
    }
    
    if (nodeName === 'ValueTextNode') {
      const valueNode = node as any;
      if (valueNode.data !== undefined) {
        return this.escapeXml(String(valueNode.data));
      }
      return '';
    }

    // These structural nodes should be ignored (like Python's "pass # intended")
    if (nodeName === 'CloseStartElementNode' || 
        nodeName === 'CloseEmptyElementNode' || 
        nodeName === 'CloseElementNode' ||
        nodeName === 'AttributeNode') {
      return ''; // Python equivalent: pass # intended
    }

    // Handle other content nodes
    if (nodeName === 'CDataSectionNode') {
      const cdataNode = node as any;
      return `<![CDATA[${this.escapeXml(String(cdataNode.data || ''))}]]>`;
    }

    if (nodeName === 'EntityReferenceNode') {
      const entityNode = node as any;
      return entityNode.entity_reference || '';
    }

    if (nodeName === 'ProcessingInstructionTargetNode') {
      const piNode = node as any;
      return piNode.processing_instruction_target || '';
    }

    if (nodeName === 'ProcessingInstructionDataNode') {
      const piDataNode = node as any;
      return piDataNode.data || '';
    }

    // For debugging unhandled nodes - but don't include in XML output
    this._log.warn(`Unhandled node type ${nodeName} encountered during XML rendering`);
    return '';
  }

  /**
   * Format a substitution value for XML output based on its VariantType
   * This prevents binary data corruption in XML output
   */
  private formatValueForXml(value: any, valueType: number): string {
    if (value === null || value === undefined) {
      return '';
    }

    switch (valueType) {
      case VariantType.WString:
      case VariantType.String:
        return String(value || '');
      
      case VariantType.Hex32:
        return `0x${(value as number).toString(16)}`;
      
      case VariantType.Hex64:
        return `0x${(value as bigint).toString(16)}`;
      
      case VariantType.Binary:
        // Convert Uint8Array to hex string
        if (value instanceof Uint8Array) {
          return Array.from(value)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('').toUpperCase();
        }
        return String(value);
      
      case VariantType.Guid:
        return String(value); // Should already be formatted by VariantValueParser
      
      case VariantType.FileTime:
      case VariantType.SystemTime:
        if (value instanceof Date) {
          return value.toISOString();
        }
        return String(value);
      
      case VariantType.Sid:
        return String(value);
      
      // Handle numeric types
      case VariantType.UnsignedByte:
      case VariantType.SignedByte:
      case VariantType.UnsignedWord:
      case VariantType.SignedWord:
      case VariantType.UnsignedDWord:
      case VariantType.SignedDWord:
      case VariantType.UnsignedQWord:
      case VariantType.SignedQWord:
      case VariantType.Float:
      case VariantType.Double:
      case VariantType.Size:
        return String(value);
      
      case VariantType.Boolean:
        return String(value);
      
      case VariantType.Null:
        return '';
      
      case VariantType.WStringArray:
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        return String(value);
      
      case VariantType.BXml:
        // BXml contains embedded binary XML data that needs to be parsed and rendered
        // This follows Python's approach: if isinstance(sub, e_nodes.BXmlTypeNode): sub = render_root_node(sub.root())
        if (value && typeof value === 'object' && 'bxmlData' in value && value.isBXml) {
          this._log.debug(`🔍 Processing BXml substitution with ${value.bxmlData?.length || 0} bytes`);
          
          const bxmlData = value.bxmlData as Uint8Array;
          if (bxmlData && bxmlData.length > 0) {
            try {
              const chunk = this.getChunkReference();
              // Prefer absolute offset parsing to  (read beyond local slice when needed)
              if ('baseOffset' in (value as any)) {
                const base = (value as any).baseOffset as number;
                const len = (value as any).length as number;
                const renderedXml = BXmlParser.parseAndRenderBXmlAtOffset(base, len, chunk);
                this._log.debug(`🎨 Embedded BXML rendered as: ${renderedXml}`);
                return renderedXml;
              }
              const renderedXml = BXmlParser.parseAndRenderBXml(bxmlData, chunk);
              
              this._log.debug(`🎨 Embedded BXML rendered as: ${renderedXml}`);
              return renderedXml;
            } catch (error) {
              this._log.warn('Error parsing embedded BXML:', error);
              return '<EventData></EventData>'; // Fallback
            }
          }
        }
        this._log.warn('BXml variant type not yet implemented for XML rendering');
        return '[BXML_DATA]';
      
      default:
        this._log.warn(`Unhandled VariantType 0x${valueType?.toString(16)} for XML formatting, using string conversion`);
        return String(value || '[UNKNOWN_TYPE]');
    }
  }

  private escapeXml(text: string): string {
    if (text === null || text === undefined) return '';
    
    // First, remove invalid XML characters (control chars except tab, newline, carriage return)
    const cleanText = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    
    // Then escape XML special characters
    return cleanText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Get a debug string representation of the template structure
   */
  getStructureDebug(): string {
    const lines: string[] = [`Template ${this.templateId} (${this.allNodes.length} nodes):`];
    
    for (let i = 0; i < this.allNodes.length; i++) {
      const node = this.allNodes[i];
      const nodeName = node.constructor.name;
      
      if (nodeName === 'OpenStartElementNode') {
        const elementName = (node as any).name || 'unknown';
        lines.push(`  ${i}: <${elementName}>`);
      } else if (nodeName === 'NormalSubstitutionNode') {
        const subId = (node as any).substitution_id || 0;
        lines.push(`  ${i}: [SUBSTITUTION:${subId}]`);
      } else if (nodeName === 'CompactSubstitutionNode') {
        const subId = (node as any).substitution_id || 0;
        lines.push(`  ${i}: [COMPACT_SUBSTITUTION:${subId}]`);
      } else if (nodeName === 'AttributeNode') {
        const attrName = (node as any).attribute_name || 'unknown';
        lines.push(`  ${i}: @${attrName}`);
      } else {
        lines.push(`  ${i}: ${nodeName}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Build a canonical EventData layout (top-level + embedded)
   * Returns per-<Data> entries with ordered parts (literals and substitution refs).
   * Embedded BXML substitutions are parsed and expanded: their inner substitutions
   * are resolved to literal parts using the embedded substitution list.
   */
  getEventDataLayout(substitutions: any[]): Array<{ name?: string | null; parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> }> {
    const entries: Array<{ name?: string | null; parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> }> = [];

    const root = this._rootElement;
    if (!root) return entries;

    // Find first <EventData>
    const eventDataNodes: any[] = [];
    this.walk(root as any, (n: any) => {
      if (n?.constructor?.name === 'OpenStartElementNode' && (n.name === 'EventData')) {
        eventDataNodes.push(n);
      }
    });
    if (!eventDataNodes.length) {
      // No top-level <EventData>. Iterate all substitutions and extract any BXML-embedded EventData layouts.
      for (const raw of (substitutions || [])) {
        if (!raw || typeof raw !== 'object' || !(('bxmlData' in raw) || ('baseOffset' in raw))) continue;
        try {
          const chunk = this.getChunkReference();
          let embedded: { actual: any | null, substitutions: any[] } = { actual: null, substitutions: [] };
          if ('baseOffset' in raw && typeof (raw as any).baseOffset === 'number') embedded = BXmlParser.parseEmbeddedActualAtOffset((raw as any).baseOffset as number, (raw as any).length as number, chunk);
          else if ('bxmlData' in raw && (raw as any).bxmlData instanceof Uint8Array) embedded = BXmlParser.parseEmbeddedActual((raw as any).bxmlData as Uint8Array, chunk);
          if (embedded.actual) {
            const innerLayout = embedded.actual.getEventDataLayout(embedded.substitutions || []);
            for (const inner of innerLayout) {
              const hasSub = inner.parts.some((pp: any) => pp.kind === 'sub');
              if (hasSub) {
                for (const pp of inner.parts) {
                  if ((pp as any).kind === 'sub') {
                    const idx = (pp as any).index as number;
                    const v = embedded.substitutions?.[idx];
                    if (Array.isArray(v)) { for (const el of v) entries.push({ name: inner.name || 'Data', parts: [{ kind: 'lit', text: this.formatForMessage(el) }] as any }); }
                    else entries.push({ name: inner.name || 'Data', parts: [{ kind: 'lit', text: this.formatForMessage(v) }] as any });
                  }
                }
              } else {
                const litText = inner.parts.filter((p: any) => p.kind === 'lit').map((p: any) => p.text).join('');
                entries.push({ name: inner.name || 'Data', parts: [{ kind: 'lit', text: litText }] as any });
              }
            }
          }
        } catch { /* ignore */ }
      }
      return entries;
    }

    const ed = eventDataNodes[0];
    for (const child of (ed.children || [])) {
      if (child?.constructor?.name !== 'OpenStartElementNode') continue;
      const name = (child as any).name || '';
      if (name !== 'Data') continue;
      const parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> = [];
      // Extract Name attribute (if present)
      let dataName: string | null = null;
      try {
        const attrNodes = (child as any).children?.filter((c: any) => c?.constructor?.name === 'AttributeNode') || [];
        for (const an of attrNodes) {
          const attrName = (an as any).name || (an as any).attribute_name || '';
          if (String(attrName).toLowerCase() === 'name') {
            const valNode = (an as any).children?.[0];
            if (valNode?.constructor?.name === 'ValueTextNode') {
              dataName = String(valNode.data ?? '') || null;
            } else if (valNode && String(valNode.constructor?.name || '').includes('SubstitutionNode')) {
              const idx = (valNode as any).substitution_id ?? -1;
              if (idx >= 0 && substitutions && idx < substitutions.length) {
                dataName = this.formatForMessage(substitutions[idx]) || null;
              }
            }
          }
        }
      } catch {}
      let embeddedExpanded: Array<{ name?: string | null; parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> }> | null = null;

      // Walk this <Data> content
      const visit = (n: any) => {
        const t = n?.constructor?.name;
        if (!t) return;
        if (t === 'ValueTextNode') {
          const txt = String((n as any).data ?? '');
          if (txt) parts.push({ kind: 'lit', text: txt });
          return;
        }
        if (t === 'NormalSubstitutionNode' || t === 'CompactSubstitutionNode' || t === 'OptionalSubstitutionNode') {
          const subIndex = (n as any).substitution_id ?? -1;
          const valueType = (n as any).value_type ?? 0;
          if (subIndex >= 0) {
            const raw = substitutions?.[subIndex];
            // Embedded BXML: parse recursively and push resolved literal parts from its layout
            if (valueType === VariantType.BXml && raw && typeof raw === 'object' && (('bxmlData' in raw) || ('baseOffset' in raw))) {
              try {
                const chunk = this.getChunkReference();
                let embedded: { actual: any | null, substitutions: any[] } = { actual: null, substitutions: [] };
                if ('baseOffset' in raw && typeof (raw as any).baseOffset === 'number') {
                  embedded = BXmlParser.parseEmbeddedActualAtOffset((raw as any).baseOffset as number, (raw as any).length as number, chunk);
                } else if ('bxmlData' in raw && (raw as any).bxmlData instanceof Uint8Array) {
                  embedded = BXmlParser.parseEmbeddedActual((raw as any).bxmlData as Uint8Array, chunk);
                }
                if (embedded.actual) {
                  // Flatten: each inner <Data> becomes its own top-level layout entry.
                  const innerLayout = embedded.actual.getEventDataLayout(embedded.substitutions || []);
                  for (const inner of innerLayout) {
                    const hasSub = inner.parts.some((pp: any) => pp.kind === 'sub');
                    if (hasSub) {
                      for (const pp of inner.parts) {
                        if ((pp as any).kind === 'sub') {
                          const idx = (pp as any).index as number;
                          const v = embedded.substitutions?.[idx];
                          if (Array.isArray(v)) {
                            for (const el of v) {
                              const text = this.formatForMessage(el);
                              if (!embeddedExpanded) embeddedExpanded = [];
                              embeddedExpanded.push({ name: inner.name || 'Data', parts: [{ kind: 'lit', text }] as any });
                            }
                          } else {
                            const text = this.formatForMessage(v);
                            if (!embeddedExpanded) embeddedExpanded = [];
                            embeddedExpanded.push({ name: inner.name || 'Data', parts: [{ kind: 'lit', text }] as any });
                          }
                        } else {
                          // ignore punctuation-only literals between embedded substitutions
                        }
                      }
                    } else {
                      const litText = inner.parts.filter((p: any) => p.kind === 'lit').map((p: any) => p.text).join('');
                      if (!embeddedExpanded) embeddedExpanded = [];
                      embeddedExpanded.push({ name: inner.name || 'Data', parts: [{ kind: 'lit', text: litText }] as any });
                    }
                  }
                } else {
                  // Fallback to treating the substitution as a single message arg
                  parts.push({ kind: 'lit', text: this.formatForMessage(raw) });
                }
              } catch {
                parts.push({ kind: 'lit', text: this.formatForMessage(raw) });
              }
            } else {
              // Normal substitution: keep reference to root substitutions by index
              parts.push({ kind: 'sub', index: subIndex });
            }
          }
          return;
        }
        const kids = n?.children || [];
        for (const c of kids) visit(c);
      };
      for (const c of (child.children || [])) visit(c);

      if (embeddedExpanded && (embeddedExpanded as any[]).length) {
        const list = embeddedExpanded as any[];
        for (const e of list) entries.push(e);
      } else {
        entries.push({ name: dataName || (child as any).name || 'Data', parts });
      }
    }

    return entries;
  }

  /**
   * Build a simple layout for <UserData> by treating first-level child elements as named fields.
   * Example:
   * <UserData><RmEvent><Session>0</Session><StartTime>...</StartTime></RmEvent></UserData>
   * returns entries with names 'Session', 'StartTime'.
   */
  getUserDataLayout(substitutions: any[]): Array<{ name?: string | null; parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> }> {
    const entries: Array<{ name?: string | null; parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> }> = [];
    const root = this._rootElement as any;
    if (!root) return entries;

    const userDataNodes: any[] = [];
    this.walk(root, (n: any) => {
      if (n?.constructor?.name === 'OpenStartElementNode' && (n.name === 'UserData')) {
        userDataNodes.push(n);
      }
    });
    if (!userDataNodes.length) return entries;
    const ud = userDataNodes[0];
    const collectTextParts = (node: any, parts: any[]) => {
      const visit = (n: any) => {
        const t = n?.constructor?.name;
        if (!t) return;
        if (t === 'ValueTextNode') {
          const txt = String((n as any).data ?? '');
          parts.push({ kind: 'lit', text: txt });
          return;
        }
        if (t === 'NormalSubstitutionNode' || t === 'CompactSubstitutionNode' || t === 'OptionalSubstitutionNode') {
          const idx = (n as any).substitution_id ?? -1;
          if (idx >= 0) parts.push({ kind: 'sub', index: idx });
          return;
        }
        const kids = n?.children || [];
        for (const c of kids) visit(c);
      };
      const kids = node?.children || [];
      for (const c of kids) visit(c);
    };

    // Walk first-level container (e.g., <RmEvent>) children
    const container = (ud.children || []).find((c: any) => c?.constructor?.name === 'OpenStartElementNode');
    const fieldsParent = container || ud;

    // Case A: concrete child elements are present under UserData
    const openChildren = (fieldsParent.children || []).filter((c: any) => c?.constructor?.name === 'OpenStartElementNode');
    if (openChildren.length) {
      for (const ch of openChildren) {
        const fieldName = (ch as any).name || null;
        const parts: any[] = [];
        collectTextParts(ch, parts);
        if (parts.length) entries.push({ name: fieldName, parts });
      }
      return entries;
    }

    // Case B: content injected via BXML substitution directly under UserData
    for (const ch of (fieldsParent.children || [])) {
      const t = ch?.constructor?.name || '';
      if (t.endsWith('SubstitutionNode')) {
        const subIndex = (ch as any).substitution_id ?? -1;
        const valueType = (ch as any).value_type ?? 0;
        if (subIndex >= 0 && valueType === VariantType.BXml) {
          try {
            const raw = substitutions?.[subIndex];
            const chunk = this.getChunkReference();
            let embedded: { actual: any | null, substitutions: any[] } = { actual: null, substitutions: [] };
            if (raw && typeof raw === 'object') {
              if ('baseOffset' in raw && typeof (raw as any).baseOffset === 'number') {
                embedded = BXmlParser.parseEmbeddedActualAtOffset((raw as any).baseOffset as number, (raw as any).length as number, chunk);
              } else if ('bxmlData' in raw && (raw as any).bxmlData instanceof Uint8Array) {
                embedded = BXmlParser.parseEmbeddedActual((raw as any).bxmlData as Uint8Array, chunk);
              }
            }
            if (embedded.actual) {
              // Prefer embedded UserData if present
              let inner = [] as any[];
              if (typeof embedded.actual.getUserDataLayout === 'function') {
                inner = embedded.actual.getUserDataLayout(embedded.substitutions || []);
              }
              if (inner && inner.length) {
                for (const e of inner) {
                  // Resolve any substitution parts against embedded substitutions
                  const resolvedParts = (e.parts || []).map((p: any) => {
                    if (p.kind === 'sub') {
                      const v = embedded.substitutions?.[p.index];
                      return { kind: 'lit', text: this.formatForMessage(v) };
                    }
                    return p;
                  });
                  entries.push({ name: e.name, parts: resolvedParts });
                }
                continue;
              }
              // Otherwise, treat first-level OpenStartElementNode under embedded root as fields
              const innerRoot: any = embedded.actual.rootElement;
              const children = (innerRoot?.children || []) as any[];
              for (const kid of children) {
                if (kid?.constructor?.name !== 'OpenStartElementNode') continue;
                const fieldName = (kid as any).name || null;
                const parts: any[] = [];
                collectTextParts(kid, parts);
                const resolvedParts = parts.map((p: any) => {
                  if (p.kind === 'sub') {
                    const v = embedded.substitutions?.[p.index];
                    return { kind: 'lit', text: this.formatForMessage(v) };
                  }
                  return p;
                });
                if (resolvedParts.length) entries.push({ name: fieldName, parts: resolvedParts });
              }
            }
          } catch {}
        }
      }
    }
    return entries;
  }

  /**
   * Convert EventData layout to message insertion args.
   * Policy: for each <Data>, if it has any substitution refs, include those values;
   * otherwise include the literal content (joined) if non-empty.
   */
  buildArgsFromLayout(layout: Array<{ name?: string | null; parts: Array<{ kind: 'lit'; text: string } | { kind: 'sub'; index: number }> }>, substitutions: any[], maxPlaceholders?: number): string[] {
    const out: string[] = [];
    for (const entry of layout) {
      const hasSub = entry.parts.some((p: { kind: 'lit' | 'sub'; text?: string; index?: number }) => p.kind === 'sub');
      if (hasSub) {
        for (const p of entry.parts) {
          if ((p as any).kind === 'sub') {
            const idx = (p as any).index as number;
            const v = (idx >= 0 && idx < substitutions.length) ? substitutions[idx] : '';
            out.push(this.formatForMessage(v));
            if (maxPlaceholders && out.length >= maxPlaceholders) return out.slice(0, maxPlaceholders);
          }
        }
      } else {
        const lit = entry.parts.filter((p: any) => p.kind === 'lit').map((p: any) => p.text).join('');
        // Preserve empties to maintain positional alignment with %1..%n
        out.push(lit);
        if (maxPlaceholders && out.length >= maxPlaceholders) return out.slice(0, maxPlaceholders);
      }
    }
    return (maxPlaceholders && out.length > maxPlaceholders) ? out.slice(0, maxPlaceholders) : out;
  }

  /**
   * Backwards-compatible: derive args via layout policy (no XML scraping)
   */
  getEventDataArgs(substitutions: any[]): string[] {
    const layout = this.getEventDataLayout(substitutions);
    return this.buildArgsFromLayout(layout, substitutions);
  }

  private walk(node: any, fn: (n: any) => void): void {
    try { fn(node); } catch {}
    const kids = node?.children || [];
    for (const c of kids) this.walk(c, fn);
  }

  private collectParts(node: any): Array<{ kind: 'lit' | 'sub'; text?: string; subIndex?: number }> {
    const parts: Array<{ kind: 'lit' | 'sub'; text?: string; subIndex?: number }> = [];
    const visit = (n: any) => {
      const t = n?.constructor?.name;
      if (!t) return;
      if (t === 'ValueTextNode') {
        const txt = String((n as any).data ?? '');
        if (txt) parts.push({ kind: 'lit', text: txt });
        return;
      }
      if (t === 'NormalSubstitutionNode' || t === 'CompactSubstitutionNode' || t === 'OptionalSubstitutionNode') {
        const subIndex = (n as any).substitution_id ?? -1;
        if (subIndex >= 0) parts.push({ kind: 'sub', subIndex });
        return;
      }
      // Recurse into other container nodes
      const kids = n?.children || [];
      for (const c of kids) visit(c);
    };
    const content = node?.children || [];
    for (const c of content) visit(c);
    return parts;
  }

  private formatForMessage(v: any): string {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(x => this.formatForMessage(x)).join(', ');
    try { return String((v as any).toString ? (v as any).toString() : v); } catch { return String(v); }
  }

  private extractArgsFromEmbeddedBxml(val: { bxmlData?: Uint8Array; baseOffset?: number; length?: number }): string[] {
    try {
      const chunk = this.getChunkReference();
      let xml = '';
      if ('baseOffset' in val && typeof val.baseOffset === 'number') {
        const len = (val.length as number) || 0;
        xml = BXmlParser.parseAndRenderBXmlAtOffset(val.baseOffset as number, len, chunk);
      } else if (val.bxmlData instanceof Uint8Array) {
        xml = BXmlParser.parseAndRenderBXml(val.bxmlData, chunk);
      }
      if (!xml) return [];
      // Extract <EventData><Data>...</Data></EventData> values
      const ed = xml.match(/<EventData[^>]*>([\s\S]*?)<\/EventData>/i);
      if (!ed) return [];
      const body = ed[1];
      const args: string[] = [];
      const re = /<Data(?:\s+[^>]*?)?>([\s\S]*?)<\/Data>/gi;
      let m;
      while ((m = re.exec(body)) !== null) args.push((m[1] || '').trim());
      return args;
    } catch {
      return [];
    }
  }

  /**
   * Get chunk reference for BXML parsing
   * This is a helper method to access the chunk context
   */
  private getChunkReference(): ChunkHeader {
    // Get chunk reference from the template node
    return (this._templateNode as any)._chunk;
  }
} 
