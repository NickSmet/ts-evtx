import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { EvtxFile } from '../src/evtx/EvtxFile';
import { parseResolvedEvents } from '../src/api';

/**
 * Golden-output regression harness.
 *
 * Produces deterministic digests of the parser output (rendered XML + resolved
 * events) for each fixture and compares them against committed expectations in
 * test/__golden__/digests.json.
 *
 * This is the safety net used when refactoring the parser: any change that alters
 * observable parsing output will flip a digest and fail here. If output is
 * intentionally changed, regenerate with:
 *
 *   EVTX_GOLDEN_REGEN=1 npx jest golden
 */

const fixturesDir = path.join(__dirname, 'fixtures');
const goldenDir = path.join(__dirname, '__golden__');
const goldenFile = path.join(goldenDir, 'digests.json');

const fixtures = ['System.evtx', 'Application.evtx', 'Security.evtx', 'test.evtx']
  .filter((f) => fs.existsSync(path.join(fixturesDir, f)));

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function xmlDigest(file: string): { records: number; rendered: number; hash: string } {
  const evtx = EvtxFile.openSync(file);
  const parts: string[] = [];
  let records = 0;
  let rendered = 0;
  for (const rec of evtx.records()) {
    records++;
    let xml = 'ERR';
    try { xml = rec.renderXml(); rendered++; } catch { xml = 'ERR'; }
    parts.push(`${rec.recordNum().toString()}|${rec.timestamp().toString()}|${sha256(xml)}`);
  }
  return { records, rendered, hash: sha256(parts.join('\n')) };
}

async function resolvedDigest(file: string): Promise<{ count: number; hash: string }> {
  // includeDiagnostics:'none' strips volatile diagnostic fields; we hash the stable,
  // user-facing shape: identity, classification, data items, and final message.
  const events = await parseResolvedEvents(file, {
    includeDataItems: 'full',
    includeDiagnostics: 'none',
  });
  const parts = events.map((e) =>
    JSON.stringify({
      id: e.id,
      eventId: e.eventId,
      provider: e.provider?.name ?? null,
      guid: e.provider?.guid ?? null,
      level: e.level ?? null,
      channel: e.channel ?? null,
      computer: e.computer ?? null,
      data: (e.data?.items || []).map((it) => [it.name ?? null, it.value]),
      message: e.messageResolution?.final?.message ?? null,
    })
  );
  return { count: events.length, hash: sha256(parts.join('\n')) };
}

describe('golden parser output', () => {
  jest.setTimeout(600000);

  const regen = process.env.EVTX_GOLDEN_REGEN === '1';
  let expected: Record<string, any> = {};
  if (!regen) {
    if (!fs.existsSync(goldenFile)) {
      throw new Error(`Golden file missing: ${goldenFile}. Run EVTX_GOLDEN_REGEN=1 npx jest golden`);
    }
    expected = JSON.parse(fs.readFileSync(goldenFile, 'utf8'));
  }
  const produced: Record<string, any> = {};

  for (const name of fixtures) {
    it(`${name}: rendered XML + resolved events match golden`, async () => {
      const file = path.join(fixturesDir, name);
      const xml = xmlDigest(file);
      const resolved = await resolvedDigest(file);
      produced[name] = { xml, resolved };

      if (!regen) {
        expect(produced[name]).toEqual(expected[name]);
      }
    });
  }

  afterAll(() => {
    if (regen) {
      fs.mkdirSync(goldenDir, { recursive: true });
      fs.writeFileSync(goldenFile, JSON.stringify(produced, null, 2) + '\n');
      // eslint-disable-next-line no-console
      console.log(`\n[golden] wrote ${goldenFile}`);
    }
  });
});
