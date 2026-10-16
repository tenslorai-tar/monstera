import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The palette is driven by ONE function, `palette.ts`' `runCommand`, everywhere a test or a walk runs a command through
 * it (B3a). Four drivers held their own copy of the rule and some matched by substring, so "Watermark…" ran "Edit
 * watermark…" (36755ef6); a fifth copy would be written the day nobody remembers that. A query typed into the palette
 * anywhere else is a second driver, and this names it.
 *
 * Tests that are ABOUT the palette's own field (its focus, what typing does) read it and type into it without running a
 * command; only `.fill(` on the query, the driver's first move, is the shape looked for.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..');
const PLACES = [join(ROOT, 'packages', 'testing', 'src'), join(ROOT, 'scripts', 'research')];
const DRIVES = /\.m-palette-query['"]\)\s*\.fill\(/u;

function sources(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /\.(?:ts|mjs)$/u.test(name) && !name.endsWith('.test.ts'))
    .map((name) => join(directory, name));
}

describe('the palette has one driver', () => {
  it('finds the driver it is looking for in palette.ts (positive control)', () => {
    expect(DRIVES.test(readFileSync(join(import.meta.dirname, 'palette.ts'), 'utf8'))).toBe(true);
    expect(PLACES.flatMap(sources).length).toBeGreaterThan(50);
  });

  it('no other test or walk types a query into the palette to run a command', () => {
    const others = PLACES.flatMap(sources).filter((path) => !path.endsWith('palette.ts') && DRIVES.test(readFileSync(path, 'utf8')));
    expect(others).toStrictEqual([]);
  });
});
