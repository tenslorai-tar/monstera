import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `redraw` in `pageAnnotations.ts` is the kernel's ONLY caller of MuPDF's `update()` (ADR-0103).
 *
 * `update()` regenerates an annotation's appearance and discards a blend written into it, so a
 * second caller would turn a mark a person set to Normal back to Multiply at its next move — with
 * nothing in that caller's own file looking wrong. The rule is a named function with callers, and
 * this search is what keeps a ninth call site from being written beside it.
 */

const SOURCE = dirname(fileURLToPath(import.meta.url));

/** Every non-test `.ts` under `packages/kernel/src`, relative to it. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [relative(SOURCE, path).replaceAll('\\', '/')]
      : [];
  });
}

/** A call of a method named `update` with no arguments, on any receiver. */
const UPDATE_CALL = '.update()';

describe('the one redraw', () => {
  const files = sources(SOURCE);
  const calls = files.flatMap((file) =>
    readFileSync(join(SOURCE, file), 'utf8')
      .split('\n')
      .map((line, at) => ({ file, line: at + 1, text: line.trim() }))
      // A COMMENT NAMING THE CALL IS NOT ONE: the redraw's own documentation says `update()`.
      .filter((entry) => !entry.text.startsWith('*') && !entry.text.startsWith('//'))
      .filter((entry) => entry.text.includes(UPDATE_CALL)),
  );

  it('the search can see: it finds the call inside redraw itself', () => {
    // THE POSITIVE CONTROL. A search that read no files, or read them wrong, would find nothing and
    // pass the case below.
    expect(files.length).toBeGreaterThan(50);
    expect(calls.map((call) => `${call.file}: ${call.text}`)).toContain('pageAnnotations.ts: annotation.update();');
  });

  it('and finds no other', () => {
    // BY FILE AND TEXT, so a second call site is named in the failure rather than counted.
    expect(calls.map((call) => `${call.file}: ${call.text}`)).toStrictEqual(['pageAnnotations.ts: annotation.update();']);
  });
});
