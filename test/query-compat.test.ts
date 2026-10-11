import * as path from 'path';
import { evtx } from '../src/query';

const SYSTEM = path.join(__dirname, 'fixtures', 'System.evtx');

describe('exports to something that is not a stream', () => {
  jest.setTimeout(60000);

  it('writes to and ends a bare { write, end } object', async () => {
    let text = '';
    let ended = 0;
    const sink: any = { write(s: string) { text += s; }, end() { ended++; } };
    await evtx(SYSTEM).last(40).toJSONL(sink);
    expect(text.split('\n').filter(Boolean).map((l) => JSON.parse(l).timestamp).length).toBe(40);
    expect(ended).toBe(1);
  });

  it('does not need end() either', async () => {
    let text = '';
    await evtx(SYSTEM).last(3).toCSV({ write(s: string) { text += s; return true; } } as any);
    expect(text.startsWith('Timestamp,Provider,EventID,Level,Message\n')).toBe(true);
  });
});

/**
 * @ts-evtx/messages is versioned separately from core. Releases without getMessageCandidates()
 * only find the packaged catalog's rows after a preload, so core must keep asking for one.
 */
describe.each([
  ['a release with getMessageCandidates', true, {}],
  ['a release without getMessageCandidates', false, { preload: true }],
])('built-in messages from %s', (_name, hasCandidates, extra) => {
  const created: any[] = [];

  beforeEach(() => {
    created.length = 0;
    jest.resetModules();
    jest.doMock('@ts-evtx/messages', () => {
      class SmartManagedMessageProvider {
        constructor(options: any) { created.push(options); }
        async getMessage() { return 'from the catalog'; }
      }
      if (hasCandidates) (SmartManagedMessageProvider.prototype as any).getMessageCandidates = async () => [];
      return { SmartManagedMessageProvider };
    });
  });
  afterEach(() => jest.dontMock('@ts-evtx/messages'));

  it('creates the packaged provider with the right options', async () => {
    const { evtx: query } = require('../src/query');
    const [event] = await query(SYSTEM).withMessages().last(1).toArray();
    expect(created).toEqual([extra]);
    expect(event.message).toBe('from the catalog');
  });

  it('creates a provider for a catalog path with the right options', async () => {
    const { evtx: query } = require('../src/query');
    await query(SYSTEM).withMessages('/some/catalog.db').last(1).toArray();
    expect(created).toEqual([{ customDbPath: '/some/catalog.db', ...extra }]);
  });
});
