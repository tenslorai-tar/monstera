import { getConfig } from '@testing-library/dom';
import { describe, expect, it } from 'vitest';

import { DIALOG_BODIES, FULL_APP_TEST_TIMEOUT, applyFullAppLimits } from './fullAppTestLimit.js';

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

describe('applyFullAppLimits and the dialog bodies it brings', () => {
  it('sets the case limit, and leaves Testing Library’s wait at its own default', () => {
    const calls: number[] = [];
    applyFullAppLimits({ vitest: (config) => calls.push(config.testTimeout) });
    expect(calls).toStrictEqual([FULL_APP_TEST_TIMEOUT]);
    // THE WAIT IS NOT WIDENED (the audit of 1e1bfad..e24eca0e withdrew the 10 s window): a missing body must be a red
    // case, not a slow one.
    expect(getConfig().asyncUtilTimeout).toBe(1000);
  });

  it('holds EVERY dialog body there is — the set is the folder, so none can be left off', () => {
    // COMPARED WITH THE FOLDER READ A SECOND WAY, as raw text, so a glob that matched nothing would not agree with it.
    // And the POSITIVE CONTROL: the body whose absence reddened main at 7539dd80 is in it.
    const onDisk = Object.keys(import.meta.glob('./dialogs/*Body.tsx', { query: '?raw', import: 'default' })).sort();
    expect(Object.keys(DIALOG_BODIES).sort()).toStrictEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(50);
    expect(Object.keys(DIALOG_BODIES)).toContain('./dialogs/CommandProblemBody.tsx');
  });
});
