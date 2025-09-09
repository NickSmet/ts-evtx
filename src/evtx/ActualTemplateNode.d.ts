import { BXmlNode } from './BXmlNode.js';
import { TemplateNode } from './TemplateNode.js';
/**
 * Enhanced template node that provides complete template parsing and XML rendering capabilities
 * Template node helpers to extract layouts and build args
 */
export declare class ActualTemplateNode {
    private _templateNode;
    private _rootElement;
    constructor(templateNode: TemplateNode);
    get offset(): number;
    get nextOffset(): number;
    get templateId(): number;
    get guid(): Uint8Array;
    get dataLength(): number;
    get rootElement(): BXmlNode | null;
    get allNodes(): BXmlNode[];
    private findRootElement;
    /**
     * Render XML using this template with provided substitutions
     * @param substitutions Array of parsed substitution values
     * @returns Rendered XML string
     */
    renderXml(substitutions: any[]): string;
    private renderNode;
    /**
     * Format a substitution value for XML output based on its VariantType
     * This prevents binary data corruption in XML output
     */
    private formatValueForXml;
    private escapeXml;
    /**
     * Get a debug string representation of the template structure
     */
    getStructureDebug(): string;
    /**
     * Get chunk reference for BXML parsing
     * This is a helper method to access the chunk context
     */
    private getChunkReference;
}
