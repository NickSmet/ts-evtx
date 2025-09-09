import { ChunkHeader } from './ChunkHeader';
/**
 * Utility for parsing embedded BXML data from substitutions
 * This follows Python's BXmlTypeNode approach: sub.root() returns a RootNode, then render_root_node(sub.root())
 */
export declare class BXmlParser {
    /**
     * Parse embedded BXML data and render it as XML
     * This follows Python's approach: render_root_node(sub.root())
     */
    static parseAndRenderBXml(bxmlData: Uint8Array, chunk: ChunkHeader): string;
    static parseAndRenderBXmlAtOffset(baseOffset: number, length: number, chunk: ChunkHeader): string;
    private static parseEmbeddedRootNodeAtOffset;
    static parseEmbeddedBXmlWithTrace(bxmlData: Uint8Array, chunk: ChunkHeader): {
        xml: string;
        trace: any;
    };
    static parseEmbeddedBXmlWithTraceAtOffset(baseOffset: number, length: number, chunk: ChunkHeader): {
        xml: string;
        trace: any;
    };
    /**
     * Parse embedded BXML data as a RootNode (equivalent to Python's BXmlTypeNode.root())
     */
    private static parseEmbeddedRootNode;
    /**
     * Parse embedded substitutions following Python's exact algorithm:
     * 1. Calculate children length to find substitution start position
     * 2. Read substitution count from that position
     * 3. Parse substitution declarations (size+type) then values
     */
    private static parseEmbeddedSubstitutions;
    /**
     * Render embedded RootNode to XML (like Python's render_root_node())
     */
    private static renderEmbeddedRootNode;
}
