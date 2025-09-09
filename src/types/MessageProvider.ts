export interface MessageProvider {
  getMessage(provider: string, eventId: number, locale?: string): Promise<string | null>;
  getMessageSync?(provider: string, eventId: number, locale?: string): string | null;
  getMessageCandidates?(provider: string, eventId: number, locale?: string): Promise<string[]>;
  close?(): void | Promise<void>;
}

export interface EvtxParseOptions {
  messageProvider?: MessageProvider;
  defaultLocale?: string; // defaults to 'en-US'
}
