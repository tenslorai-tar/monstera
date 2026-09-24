import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Which test files take `FULL_APP_TEST_TIMEOUT` is decided by SEARCHING THE SOURCE, never by a list
 * (the owner's condition, 2026-09-24): every test file that renders the whole `App` takes it, and no
 * other file does. A file added tomorrow that renders `App` without it fails here, and so does a
 * file that borrows the longer limit without rendering `App`.
 */

const SOURCE = dirname(fileURLToPath(import.meta.url));

/** Every `*.test.tsx` / `*.test.ts` under `packages/ui/src`, as paths relative to it. */
function testFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/u.test(entry.name) ? [relative(SOURCE, path).replaceAll('\\', '/')] : [];
  });
}

/** A JSX element named exactly `App` — `<App ` or `<App>` or `<App/>`, never `<AppRoot`. */
const RENDERS_APP = /<App[\s/>]/u;
const TAKES_LIMIT = 'vi.setConfig({ testTimeout: FULL_APP_TEST_TIMEOUT });';
const NAMES_LIMIT = /FULL_APP_TEST_TIMEOUT/u;

describe('FULL_APP_TEST_TIMEOUT', () => {
  const files = testFiles(SOURCE).filter((file) => file !== 'fullAppTestLimit.test.ts');
  const text = new Map(files.map((file) => [file, readFileSync(join(SOURCE, file), 'utf8')]));
  const rendering = files.filter((file) => RENDERS_APP.test(text.get(file) ?? '')).sort();

  it('the search can see: it finds the file known to render App, among hundreds it does not', () => {
    // THE POSITIVE CONTROL. A search that found nothing would make both cases below pass vacuously.
    expect(files.length).toBeGreaterThan(100);
    expect(rendering).toContain('App.test.tsx');
    expect(rendering.length).toBeLessThan(files.length);
  });

  it('every file that renders App takes the limit', () => {
    expect(rendering.filter((file) => !(text.get(file) ?? '').includes(TAKES_LIMIT))).toStrictEqual([]);
  });

  it('and no file that does not render App names it', () => {
    expect(files.filter((file) => !rendering.includes(file) && NAMES_LIMIT.test(text.get(file) ?? ''))).toStrictEqual([]);
  });
});
