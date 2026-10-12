import * as path from 'path';
import { EvtxFile } from '../src/evtx/EvtxFile';
import { ActualTemplateNode } from '../src/evtx/ActualTemplateNode';
import { BinaryReader } from '../src/binary/BinaryReader';
import { VariantType } from '../src/evtx/enums';

/**
 * Behaviour on damaged logs. These cases were found by comparing builds on deliberately
 * corrupted copies of the fixtures; none of them occurs in the intact fixtures.
 */

const SYSTEM = path.join(__dirname, 'fixtures', 'System.evtx');

describe('a record without a template instance', () => {
  it('has no template: a missing offset is never parsed as one', () => {
    const chunk: any = EvtxFile.openSync(SYSTEM).chunks().next().value;
    for (const notAnOffset of [undefined, null, NaN, '0x1000']) {
      expect(chunk.getTemplate(notAnOffset)).toBeNull();
      expect(chunk.getActualTemplate(notAnOffset)).toBeNull();
    }
  });
});

describe('System fields read from substitutions', () => {
  const el = (name: string, ...children: any[]) => ({ kind: 'OpenStartElementNode', name, children });
  const attr = (name: string, child: any) => ({ kind: 'AttributeNode', name, children: [child] });
  const sub = (id: number, type: VariantType) => ({ kind: 'NormalSubstitutionNode', substitution_id: id, value_type: type });
  const lit = (data: string) => ({ kind: 'ValueTextNode', data });

  const template = new ActualTemplateNode({
    templateId: 1,
    children: [
      el('Event',
        el('System',
          el('Provider', attr('Name', sub(0, VariantType.WString))),
          el('EventID', sub(1, VariantType.UnsignedWord)),
          el('Channel', sub(2, VariantType.WString)),
          el('Computer', lit('HOST\u0000\u0001-01')),
        )),
    ],
  } as any);

  it('drops the control characters the XML renderer drops', () => {
    const subs = ['Prov\u0000ider\u0007', 4624, '\u0000\u0001Secu\u001Frity\tLog'];
    const info = template.extractSystemInfo(subs);
    const xml = template.renderXml(subs);

    expect(info.provider.name).toBe('Provider');
    expect(info.channel).toBe('Security\tLog'); // tab is valid XML and is kept
    expect(info.computer).toBe('HOST-01');
    expect(info.eventId).toBe(4624);

    expect(xml).toContain(`Name="${info.provider.name}"`);
    expect(xml).toContain(`<Channel>${info.channel}</Channel>`);
    expect(xml).toContain(`<Computer>${info.computer}</Computer>`);
  });
});

describe('debug logging', () => {
  // count = 1, then one declaration (size 8, UnsignedQWord), then the value 2^53 + 1
  const embedded = () => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, true);
    view.setUint16(4, 8, true);
    view.setUint8(6, VariantType.UnsignedQWord);
    view.setBigUint64(8, 9007199254740993n, true);
    return bytes;
  };

  const parseWith = (debug: boolean): any[] => {
    const before = process.env.EVTX_DEBUG;
    let out: any[] = [];
    try {
      if (debug) process.env.EVTX_DEBUG = 'true'; else delete process.env.EVTX_DEBUG;
      jest.isolateModules(() => {
        const { BXmlParser } = require('../src/evtx/BXmlParser');
        const { BinaryReader: Reader } = require('../src/binary/BinaryReader');
        out = BXmlParser.parseEmbeddedSubstitutions(new Reader(embedded()), 1, 1);
      });
    } finally {
      if (before === undefined) delete process.env.EVTX_DEBUG; else process.env.EVTX_DEBUG = before;
    }
    return out;
  };

  it('does not change what is parsed: 64-bit substitutions survive with EVTX_DEBUG=true', () => {
    expect(new BinaryReader(embedded()).size).toBe(16);
    expect(parseWith(false)).toEqual([9007199254740993n]);
    expect(parseWith(true)).toEqual([9007199254740993n]);
  });
});
