export interface MessageProvider {
    getMessage(provider: string, eventId: number, locale?: string): Promise<string | null>;
    getMessageSync?(provider: string, eventId: number, locale?: string): string | null;
    close?(): void | Promise<void>;
}
export interface EvtxParseOptions {
    messageProvider?: MessageProvider;
    defaultLocale?: string;
}
