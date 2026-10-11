import { trimTrailingNuls, UTF16LE_DECODER, UTF8_DECODER } from '../src/binary/text';

describe('trimTrailingNuls', () => {
  it('matches s.replace(/\\0+$/, "") on representative inputs', () => {
    const inputs = [
      '', '\0', '\0\0\0', 'abc', 'abc\0', 'abc\0\0\0', '\0abc', 'a\0b\0', 'a\0\0b', ' \0', 'é\0', '\u2028\0', '\n\0\0',
    ];
    for (const s of inputs) expect(trimTrailingNuls(s)).toBe(s.replace(/\0+$/, ''));
  });

  it('returns the very same string when there is nothing to trim', () => {
    const s = 'no terminator';
    expect(trimTrailingNuls(s)).toBe(s);
  });

  // `/\0+$/` retries every start position inside a NUL run before failing on the trailing non-NUL
  // character, so it is quadratic: ~10 s for 80k NULs. A crafted record could stall the parser.
  it('is linear on a long NUL run followed by a non-NUL character', () => {
    const hostile = '\0'.repeat(200_000) + 'x';
    const t0 = Date.now();
    expect(trimTrailingNuls(hostile)).toBe(hostile);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('shared decoders', () => {
  it('decode UTF-16LE and UTF-8 repeatedly without carrying state between calls', () => {
    const utf16 = Uint8Array.from([0x48, 0x00, 0x69, 0x00]); // "Hi"
    const utf8 = Uint8Array.from([0x48, 0x69]);
    for (let i = 0; i < 3; i++) {
      expect(UTF16LE_DECODER.decode(utf16)).toBe('Hi');
      expect(UTF8_DECODER.decode(utf8)).toBe('Hi');
    }
  });

  it('do not leak a split multi-byte sequence into the next, unrelated, decode', () => {
    // First call ends mid-sequence (0xE2 0x82 is the start of "€"); without `stream: true` the
    // decoder must treat it as malformed and not remember it.
    UTF8_DECODER.decode(Uint8Array.from([0xe2, 0x82]));
    expect(UTF8_DECODER.decode(Uint8Array.from([0x41]))).toBe('A');
    UTF16LE_DECODER.decode(Uint8Array.from([0x41])); // odd trailing byte
    expect(UTF16LE_DECODER.decode(Uint8Array.from([0x42, 0x00]))).toBe('B');
  });
});
