import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `main` reads a setting only through the contract's definition (`storedSetting`), never by indexing the settings
 * document itself — row 265's Stage 10 audit, `check:secondwiring`'s question asked of settings.
 *
 * Twelve readers in `main` indexed the document and re-derived what the registry already said: `!== false` for a
 * switch on by default, `=== true` for one off, a literal `'production'`, a count from `.one`. Each agreed with the
 * registry on 2026-10-01, and nothing compared them. The shape this refuses is that one, wherever it is written next.
 *
 * Out of scope, and why: the SECRET store (`secrets.read()[…]`) holds strings whose absence is *not given* — there is
 * no default to disagree with — and a computed key in an object literal is a write, not a read.
 */

const SOURCE = dirname(fileURLToPath(import.meta.url));

/** What a direct read of the settings document looks like. */
const DIRECT_READS = [
  // The document itself, indexed by anything.
  /settings\.read\(\)\s*\[/gu,
  // A setting's id used as an index on anything that is not the secret store, and not as an object literal's key.
  /(?<!secrets\??\.read\(\)|secretStore\.read\(\))\[\s*[A-Z][A-Z0-9_]*_SETTING_ID\s*\](?!\s*:)/gu,
];

/** Every direct read in `text`, as the matched source. */
function directReads(text: string): string[] {
  return DIRECT_READS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
}

/** `main`'s shipped modules: this directory's `.ts` files that are not tests. */
function shippedModules(): string[] {
  return readdirSync(SOURCE).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'));
}

describe('main reads settings through the contract’s definitions', () => {
  it('CONTROL: the scan finds the shapes the twelve readers had, and passes the ones that are not reads', () => {
    expect(directReads('return stored[CRASH_REPORTS_SETTING_ID] !== false;')).toHaveLength(1);
    expect(directReads('const value = settings.read()[id];')).toHaveLength(1);
    expect(directReads('enabled: () => settings.read()[UPDATE_CHECK_SETTING_ID] !== false,')).toHaveLength(2);
    expect(directReads('const key = secrets?.read()[AZURE_KEY_SETTING_ID];')).toStrictEqual([]);
    expect(directReads('settings.write({ [AI_SETUP_AT_START_SETTING_ID]: false });')).toStrictEqual([]);
  });

  it('no shipped module in main indexes the settings document directly', () => {
    const modules = shippedModules();
    // VACUITY GUARD: 90 shipped modules on 2026-10-01; an empty walk, or one in the wrong directory, would pass anything.
    expect(modules.length).toBeGreaterThan(50);
    const found = modules.flatMap((name) =>
      directReads(readFileSync(join(SOURCE, name), 'utf8')).map((read) => `${name}: ${read}`),
    );
    expect(found).toStrictEqual([]);
  });
});
