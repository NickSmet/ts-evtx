// Shared, stateless decoders. Constructing a TextDecoder allocates an ICU converter
// (~1-3 µs); doing it per string substitution shows up as `getConverter` in profiles.
export const UTF16LE_DECODER = new TextDecoder('utf-16le');
export const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * Strip trailing NUL (U+0000) characters in O(n).
 *
 * Replaces `s.replace(/\0+$/, '')`, which is O(n^2) on a string that has a long
 * NUL run followed by any non-NUL char (the regex retries every start position
 * inside the run). A 80k-NUL string takes ~10 s with the regex, ~0 ms here.
 */
export function trimTrailingNuls(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0) end--;
  return end === s.length ? s : s.slice(0, end);
}
