export interface MessageProvider {
  getMessage(provider: string, eventId: number, locale?: string): Promise<string | null>;
  getMessageSync?(provider: string, eventId: number, locale?: string): string | null;
  // Optional: return all candidate templates for a provider+eventId (used for best-fit selection)
  getMessageCandidates?(provider: string, eventId: number, locale?: string): Promise<string[]>;
  close?(): void | Promise<void>;
}

export interface WindowsVersion {
  majorVersion: number;
  minorVersion: number;
  buildNumber: number;
  productType: 'workstation' | 'server' | 'domainController';
  edition?: string;
  architecture?: 'x86' | 'amd64';
  servicepack?: string;
}

// Optional capability: batch lookups
export interface BatchMessageProvider extends MessageProvider {
  getMessages(requests: Array<{ provider: string; eventId: number; locale?: string }>): Promise<Array<string | null>>;
}

// Optional capability: provider metadata
export interface InfoCapableProvider extends MessageProvider {
  getInfo(): {
    source: string; // 'velocidex' | 'custom' | 'system'
    version?: string;
    locale?: string;
    supportedLocales?: string[];
    entryCount?: number;
    lastUpdated?: Date;
  };
  hasProvider?(provider: string): Promise<boolean>;
}

export class MessageProviderError extends Error {
  constructor(
    message: string,
    public code: 'CATALOG_NOT_FOUND' | 'DOWNLOAD_FAILED' | 'INVALID_DB' | 'VERSION_DETECTION_FAILED',
    public details?: any
  ) {
    super(message);
    this.name = 'MessageProviderError';
  }
}
