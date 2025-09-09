import type { MessageProvider } from '../types';

export class ChainMessageProvider implements MessageProvider {
  constructor(private providers: MessageProvider[]) {}

  async getMessage(provider: string, eventId: number, locale?: string): Promise<string | null> {
    for (const p of this.providers) {
      const msg = await p.getMessage(provider, eventId, locale);
      if (msg) return msg;
    }
    return null;
  }

  getMessageSync(provider: string, eventId: number, locale?: string): string | null {
    for (const p of this.providers) {
      const sync = p.getMessageSync?.(provider, eventId, locale);
      if (sync) return sync;
    }
    return null;
  }

  async close(): Promise<void> {
    await Promise.all(this.providers.map(p => p.close?.()));
  }
}
