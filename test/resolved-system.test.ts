import * as path from 'path';
import * as fs from 'fs';
import { EvtxFile } from '../src/evtx/EvtxFile';
import { readResolvedEvents } from '../src/api';

/**
 * Without a message provider, readResolvedEvents() must still report the System fields
 * (EventID, Channel, Computer, ids, ...). They are extracted straight from the record's
 * substitutions; the rendered XML of the same record is the ground truth.
 */

const fixturesDir = path.join(__dirname, 'fixtures');
// RDSH_Security.evtx is deliberately not listed: it is large and not needed for coverage here.
const fixtures = ['System.evtx', 'Application.evtx', 'Security.evtx', 'test.evtx']
  .filter((f) => fs.existsSync(path.join(fixturesDir, f)));

const num = (re: RegExp, xml: string): number | undefined => {
  const m = re.exec(xml);
  return m ? parseInt(m[1], 10) : undefined;
};
const text = (re: RegExp, xml: string): string | undefined => {
  const m = re.exec(xml);
  return m && m[1].length && !m[1].includes('&') ? m[1] : undefined;
};

describe('resolved events without a message provider', () => {
  jest.setTimeout(120000);

  for (const name of fixtures) {
    it(`${name}: System fields agree with the rendered XML of the same record`, async () => {
      const file = path.join(fixturesDir, name);
      const compared: Record<string, number> = {};
      const check = (field: string, actual: unknown, expected: unknown, index: number) => {
        if (expected === undefined) return; // not present in this record's XML
        compared[field] = (compared[field] ?? 0) + 1;
        if (actual !== expected) {
          throw new Error(`${name} #${index}: ${field} = ${JSON.stringify(actual)}, XML says ${JSON.stringify(expected)}`);
        }
      };

      const events = readResolvedEvents(file);
      let i = 0;
      for await (const rec of EvtxFile.streamRecords(file)) {
        const next = await events.next();
        if (next.done) throw new Error(`${name}: fewer resolved events than records at #${i}`);
        const ev: any = next.value;
        const xml = rec.renderXml();

        check('id', ev.id, num(/<EventRecordID>(\d+)<\/EventRecordID>/, xml), i);
        check('eventId', ev.eventId, num(/<EventID(?:\s[^>]*)?>(\d+)<\/EventID>/, xml), i);
        check('level', ev.level, num(/<Level>(\d+)<\/Level>/, xml), i);
        check('task', ev.core?.task, num(/<Task>(\d+)<\/Task>/, xml), i);
        check('opcode', ev.core?.opcode, num(/<Opcode>(\d+)<\/Opcode>/, xml), i);
        check('keywords', ev.core?.keywords, text(/<Keywords>([^<]*)<\/Keywords>/, xml), i);
        check('channel', ev.channel, text(/<Channel>([^<]*)<\/Channel>/, xml), i);
        check('computer', ev.computer, text(/<Computer>([^<]*)<\/Computer>/, xml), i);
        const exec = /<Execution ProcessID='?"?(\d+)'?"? ThreadID='?"?(\d+)'?"?/.exec(xml);
        if (exec) {
          check('processId', ev.core?.execution?.processId, parseInt(exec[1], 10), i);
          check('threadId', ev.core?.execution?.threadId, parseInt(exec[2], 10), i);
        }
        i++;
      }
      expect((await events.next()).done).toBe(true);

      // Guard against a vacuous pass: the core fields must really have been compared.
      expect(i).toBeGreaterThan(0);
      for (const f of ['id', 'eventId']) expect(compared[f]).toBe(i);
      for (const f of ['channel', 'computer']) expect(compared[f]).toBeGreaterThan(0);
    });
  }
});
