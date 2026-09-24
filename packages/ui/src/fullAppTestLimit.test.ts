import { describe, expect, it } from 'vitest';

/**
 * Which test files take `FULL_APP_TEST_TIMEOUT` is decided by SEARCHING THE SOURCE, never by a list
 * (the owner's condition, 2026-09-24): every test file that renders the whole `App` takes it, and no
 * other file does. A file added tomorrow that renders `App` without it fails here, and so does a
 * file that borrows the longer limit without rendering `App`.
 *
 * Read through Vite's `import.meta.glob` with `?raw`, `DocumentPanel.test.tsx`'s route: this package
 * never imports Node, and the glob reads the same files a filesystem walk would.
 */

const SOURCES: Readonly<Record<string, string>> = import.meta.glob<string>(['./**/*.test.ts', './**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** A JSX element named exactly `App` — `<App ` or `<App>` or `<App/>`, never `<AppRoot`. */
const RENDERS_APP = /<App[\s/>]/u;
const TAKES_LIMIT = 'vi.setConfig({ testTimeout: FULL_APP_TEST_TIMEOUT });';
const NAMES_LIMIT = /FULL_APP_TEST_TIMEOUT/u;

describe('FULL_APP_TEST_TIMEOUT', () => {
  const files = Object.keys(SOURCES)
    .map((path) => path.replace(/^\.\//u, ''))
    .filter((file) => file !== 'fullAppTestLimit.test.ts');
  const text = (file: string): string => SOURCES[`./${file}`] ?? '';
  const rendering = files.filter((file) => RENDERS_APP.test(text(file))).sort();

  it('the search can see: it finds the file known to render App, among hundreds it does not', () => {
    // THE POSITIVE CONTROL. A search that found nothing would make both cases below pass vacuously.
    expect(files.length).toBeGreaterThan(100);
    expect(rendering).toContain('App.test.tsx');
    expect(rendering.length).toBeLessThan(files.length);
  });

  it('every file that renders App takes the limit', () => {
    expect(rendering.filter((file) => !text(file).includes(TAKES_LIMIT))).toStrictEqual([]);
  });

  it('and no file that does not render App names it', () => {
    expect(files.filter((file) => !rendering.includes(file) && NAMES_LIMIT.test(text(file)))).toStrictEqual([]);
  });
});
