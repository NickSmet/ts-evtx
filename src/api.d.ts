import type { MessageProvider } from './types/MessageProvider';
export interface ResolvedEvent {
    id: number;
    timestamp: string;
    provider: {
        name: string;
        alias?: string | null;
        guid?: string | null;
    };
    eventId: number;
    level?: number;
    levelName?: string;
    channel?: string;
    computer?: string;
    core?: EventCore;
    data: DataSection;
    messageResolution: MessageResolution;
    raw?: {
        xml?: string;
    };
}
export interface EventCore {
    task?: number;
    opcode?: number;
    keywords?: string;
    execution?: {
        processId?: number;
        threadId?: number;
    };
    security?: {
        userId?: string;
    };
    correlation?: {
        activityId?: string;
        relatedActivityId?: string;
    };
}
export interface DataSection {
    source: 'EventData' | 'UserData';
    fieldCount: number;
    items: Array<{
        name?: string;
        value: string;
    }>;
    note?: string;
}
export interface MessageResolutionAttempt {
    provider: string;
    candidateCount: number;
    selected?: boolean;
    reason?: string;
}
export interface MessageSelection {
    templateText: string;
    placeholders: number;
    fit: 'exact' | 'underflow' | 'overflow';
    argsUsed: number;
    args?: string[];
}
export interface MessageResolution {
    status: 'resolved' | 'fallback' | 'unresolved';
    attempts: MessageResolutionAttempt[];
    selection?: MessageSelection;
    final?: {
        message: string;
        from: 'template' | 'fallback';
    };
    fallback?: {
        builtFrom: 'EventData' | 'UserData';
        itemCount: number;
        message: string;
    };
    warnings?: string[];
    errors?: string[];
}
export interface EventReadOptions {
    includeRawXml?: boolean;
    includeDataItems?: 'none' | 'summary' | 'full';
    includeDiagnostics?: 'none' | 'basic' | 'full';
    enableAliasLookup?: boolean;
    candidateLimit?: number;
    includeXml?: boolean;
    messageProvider?: MessageProvider;
    defaultLocale?: string;
    messageStrategy?: 'none' | 'best-effort' | 'required';
    start?: number;
    limit?: number;
    last?: number;
    eventId?: number;
    provider?: string;
    since?: string | Date;
    until?: string | Date;
}
export declare function readResolvedEvents(filePath: string, options?: EventReadOptions): AsyncGenerator<ResolvedEvent>;
export declare function parseResolvedEvents(filePath: string, options?: EventReadOptions): Promise<ResolvedEvent[]>;
/**
 * Parse an EVTX file and return structured log lines with pagination support
 * NOW USES XML RENDERING FOR ACCURATE DATA EXTRACTION
 */
/**
 * Check if a file is an EVTX file
 */
export declare function isEvtxFile(filePath: string): boolean;
/**
 * Build an index for an EVTX file (simplified implementation)
 */
export declare function buildEvtxIndex(filePath: string): Promise<{
    totalRecords: number;
    indexPath: string;
}>;
/**
 * Get EVTX file statistics without full parsing
 */
export declare function getStats(filePath: string): Promise<{
    fileSize: number;
    chunkCount: number;
    totalRecords: number;
    version: string;
    isDirty: boolean;
    isFull: boolean;
}>;
/**
 * Get a specific record by number
 * NOW USES XML RENDERING FOR ACCURATE DATA EXTRACTION
 */
export declare function getRecord(filePath: string, recordNumber: number): Promise<any>;
export declare function finalMessage(e: ResolvedEvent): string | undefined;
