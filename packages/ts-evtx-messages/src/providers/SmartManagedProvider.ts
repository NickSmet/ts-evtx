import type { MessageProvider } from '../types';
import { SqliteMessageProvider } from './SqliteProvider';

export class SmartManagedMessageProvider implements MessageProvider {
  private provider?: SqliteMessageProvider;
  private init?: Promise<void>;

  constructor(private options: {
    customDbPath?: string;    // use a local DB file directly
    universalDbPath?: string; // optional override, else resolve packaged asset
    maxCacheEntries?: number; // pass down to sqlite provider cache size
    preload?: boolean;
  } = {}) {}

  private async ensure(): Promise<void> {
    if (this.provider) return;
    if (this.init) return this.init;
    this.init = this.initialize();
    await this.init;
  }

  private async initialize(): Promise<void> {
    if (this.options.customDbPath) {
      this.provider = new SqliteMessageProvider(this.options.customDbPath);
      return;
    }
    // Universal packaged DB: resolve relative to the package dist location
    const resolvedPath = this.options.universalDbPath ?? new URL('../../assets/merged-messages.db', import.meta.url).pathname;
    this.provider = new SqliteMessageProvider(resolvedPath, { readonly: true, maxCacheEntries: this.options.maxCacheEntries, preload: this.options.preload });
  }

  async getMessage(provider: string, eventId: number, locale?: string): Promise<string | null> {
    await this.ensure();
    return this.provider!.getMessage(provider, eventId, locale);
  }

  getMessageSync(): string | null {
    throw new Error('SmartManagedMessageProvider requires async initialization');
  }

  async close(): Promise<void> {
    await this.provider?.close();
  }
}
