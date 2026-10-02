import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `redraw` and `redrawPage` in `pageAnnotations.ts` are the kernel's ONLY callers of MuPDF's `update()` (ADR-0103).
 *
 * `update()` regenerates an annotation's appearance and discards a blend written into it, so a
 * second caller would turn a mark a person set to Normal back to Multiply at its next move — with
 * nothing in that caller's own file looking wrong. The rule is two named functions with callers, both ending in the
 * one `reblend`: `redraw` for one annotation, `redrawPage` for a caller placing many, since the per-annotation form
 * is quadratic over a page (its comment has the measurement). This search is what keeps a third call site from being
 * written beside them, and it names the function each call sits in, so a call moved out of its owner is a finding.
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

/**
 * A call of a method named `update` with no arguments, on any receiver, in each spelling JavaScript has for
 * one: `.update()`, `.update?.()`, and the bracketed `['update']()`, spaced or not. With no arguments, so a
 * hash's `.update(bytes)` is not one.
 */
const UPDATE_CALL = /(?:\.\s*update|\[\s*['"`]update['"`]\s*\])\s*(?:\?\.)?\s*\(\s*\)/u;

/** The function a line sits in: the nearest declaration above it, by name. */
const DECLARATION = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/u;

describe('the two redraws', () => {
  const files = sources(SOURCE);
  const calls = files.flatMap((file) => {
    const lines = readFileSync(join(SOURCE, file), 'utf8').split('\n');
    let owner = '(top level)';
    return (
      lines
        .map((line, at) => {
          const text = line.trim();
          owner = DECLARATION.exec(line)?.[1] ?? owner;
          return { file, line: at + 1, text, owner };
        })
        // A COMMENT NAMING THE CALL IS NOT ONE: the redraw's own documentation says `update()`.
        .filter((entry) => !entry.text.startsWith('*') && !entry.text.startsWith('//'))
        .filter((entry) => UPDATE_CALL.test(entry.text))
    );
  });
  const named = calls.map((call) => `${call.file} ${call.owner}: ${call.text}`);

  it('the pattern sees every spelling of the call, and not a call that passes something', () => {
    // CONSTRUCTED, because the tree spells only the first: a pattern that saw one spelling would pass the
    // control below and miss the optional call a second caller is likeliest to write.
    for (const spelling of ['a.update();', 'a.update?.();', "a['update']();", 'a . update ( );']) {
      expect(UPDATE_CALL.test(spelling), spelling).toBe(true);
    }
    expect(UPDATE_CALL.test("createHash('sha256').update(bytes);")).toBe(false);
    expect(UPDATE_CALL.test('a.updateAppearance();')).toBe(false);
  });

  it('the search can see: it finds the call inside redraw itself', () => {
    // THE POSITIVE CONTROL. A search that read no files, or read them wrong, would find nothing and
    // pass the case below.
    expect(files.length).toBeGreaterThan(50);
    expect(named).toContain('pageAnnotations.ts redraw: annotation.update();');
  });

  it('the owner reading can see: a call is named by the function it sits in, not the file', () => {
    // CONSTRUCTED: the same call text under two declarations reads as two owners.
    let owner = '(top level)';
    const owners = ['export function first(): void {', '  a.update();', 'function second(): void {', '  a.update();']
      .map((line) => {
        owner = DECLARATION.exec(line)?.[1] ?? owner;
        return UPDATE_CALL.test(line) ? owner : null;
      })
      .filter((found) => found !== null);
    expect(owners).toStrictEqual(['first', 'second']);
  });

  it('and finds no other', () => {
    // BY FILE, FUNCTION AND TEXT, so a third call site — or one moved out of its owner — is named in the failure.
    expect(named).toStrictEqual([
      'pageAnnotations.ts redrawPage: page.update();',
      'pageAnnotations.ts redraw: annotation.update();',
    ]);
  });
});
