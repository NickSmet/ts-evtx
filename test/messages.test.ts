import { evtx } from '../src/query';
import type { MessageProvider } from '../src/types/MessageProvider';

class TestProvider implements MessageProvider {
  calls: Array<{ provider: string; eventId: number; locale?: string }> = [];
  constructor(private template: string) {}
  async getMessage(provider: string, eventId: number, locale?: string): Promise<string | null> {
    this.calls.push({ provider, eventId, locale });
    return this.template;
  }
}

describe('Message resolution pipeline', () => {
  it('applies a basic template from a provider', async () => {
    const mp = new TestProvider('Test message');
    const events = await evtx('./test/fixtures/Application.evtx').withMessages(mp).last(1).toArray();
    expect(events.length).toBe(1);
    const e = events[0] as any;
    // should have called provider at least once
    expect(mp.calls.length).toBeGreaterThan(0);
    expect(e.message).toBe('Test message');
    expect(e.messageResolution?.status).toBe('resolved');
    expect(e.messageResolution?.selection?.templateText).toBe('Test message');
  });
});
