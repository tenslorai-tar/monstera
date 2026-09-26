import { getConfig } from '@testing-library/dom';
import { describe, expect, it } from 'vitest';

import { FULL_APP_TEST_TIMEOUT, FULL_APP_WAIT, applyFullAppLimits } from './fullAppTestLimit.js';

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
// ONE CALL FOR BOTH LIMITS (2026-09-26): the case limit and the wait window travel together, so the search keys on
// the call rather than on either number.
const TAKES_LIMIT = 'applyFullAppLimits();';
const NAMES_LIMIT = 'applyFullAppLimits';

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
    expect(files.filter((file) => !rendering.includes(file) && text(file).includes(NAMES_LIMIT))).toStrictEqual([]);
  });
});

describe('applyFullAppLimits', () => {
  it('sets BOTH the case limit and the wait window, each to its own figure', () => {
    // BOTH CALLS, with their arguments: a helper that set one limit and not the other, or swapped the two numbers,
    // would pass a case that asserted either alone.
    const calls: string[] = [];
    applyFullAppLimits({
      vitest: (config) => calls.push(`vitest ${String(config.testTimeout)}`),
      testingLibrary: (config) => calls.push(`testing-library ${String(config.asyncUtilTimeout)}`),
    });
    expect(calls).toStrictEqual([`vitest ${String(FULL_APP_TEST_TIMEOUT)}`, `testing-library ${String(FULL_APP_WAIT)}`]);
    expect(FULL_APP_WAIT).toBeLessThan(FULL_APP_TEST_TIMEOUT);
  });

  it('and the default setters are the real ones: the wait window in effect is the one declared', () => {
    // THE CONTROL IS THE BEFORE — Testing Library's own 1000 ms in this file, which never applied the limits — so a
    // default that pointed at nothing could not pass.
    expect(getConfig().asyncUtilTimeout).toBe(1000);
    applyFullAppLimits();
    expect(getConfig().asyncUtilTimeout).toBe(FULL_APP_WAIT);
  });
});
