import { evtx } from '../src/query';
import { templatePlaceholderMax } from '../src/api';
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

describe('templates with parameter-message references', () => {
  it('counts insertions up to %99 and ignores larger numbers', () => {
    expect(templatePlaceholderMax('no placeholders')).toBe(0);
    expect(templatePlaceholderMax('%1 and %3!s! and %2')).toBe(3);
    expect(templatePlaceholderMax("failed with error code '%4'%%100790273")).toBe(4);
    expect(templatePlaceholderMax('%%100790273')).toBe(0);
    expect(templatePlaceholderMax('%99')).toBe(99);
  });

  // Regression: "%%100790273" was read as insertion 100790273 and the argument list was padded with
  // Array(100790273).fill(''), exhausting the heap on a 1 MB file.
  it('resolves a template ending in %%<large number> without allocating for it', async () => {
    const mp = new TestProvider("failed with error code '%1'%%100790273");
    const before = process.memoryUsage().heapUsed;
    const events = await evtx('./test/fixtures/Application.evtx').withMessages(mp).last(1).toArray();
    const grown = process.memoryUsage().heapUsed - before;
    expect(events.length).toBe(1);
    const message = (events[0] as any).message as string;
    expect(message).toMatch(/^failed with error code '/);
    expect(message).not.toContain('100790273');
    expect(grown).toBeLessThan(200 * 1024 * 1024);
  });
});
