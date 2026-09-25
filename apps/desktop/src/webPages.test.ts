import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { openWebPage } from './webPages.js';

/**
 * The `main` half of *Donate*'s pair (ADR-0095): the place the renderer named becomes an address
 * here, and only here.
 *
 * Every case records **what was handed to the opener**, because the two failures worth separating —
 * *this build has no address* and *the wrong address was opened* — both end with the application
 * looking exactly as it did.
 */

function opener(): { readonly open: (url: string) => Promise<void>; readonly opened: string[] } {
  const opened: string[] = [];
  return {
    open: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    opened,
  };
}

describe('openWebPage', () => {
  it('opens the donation page at this project’s own site, and says it did', async () => {
    const { open, opened } = opener();

    await expect(openWebPage('donate', open)).resolves.toBe(true);

    // THE WHOLE ADDRESS, and it is asserted here rather than read from the module: a case comparing
    // the constant with itself would pass whatever the constant said, including an empty string.
    expect(opened).toStrictEqual(['https://monsterapdf.com/donate']);
  });

  it('opens the Store listing at the product id Partner Center assigned', async () => {
    const { open, opened } = opener();

    await expect(openWebPage('store-listing', open)).resolves.toBe(true);

    // THE WHOLE ADDRESS, for the donation case's reason. The id is the owner's, given 2026-09-25.
    expect(opened).toStrictEqual(['https://apps.microsoft.com/detail/9NHV3B1PV3XS']);
  });

  it('opens About’s two pages: the source and the third-party notices, in this project’s repository', async () => {
    const { open, opened } = opener();
    await openWebPage('source', open);
    await openWebPage('licences', open);
    // THE WHOLE ADDRESSES, for the donation case's reason — and the repository is `package.json`'s.
    expect(opened).toStrictEqual([
      'https://github.com/tenslorai-tar/monstera',
      'https://github.com/tenslorai-tar/monstera/blob/main/NOTICE',
    ]);
    // THE COPY AGAINST ITS SOURCE: `package.json`'s repository, so a move of the repository reads here.
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../package.json'), 'utf8'),
    ) as { repository: { url: string } };
    expect(manifest.repository.url).toBe(`git+${opened[0] ?? ''}.git`);
  });

  it('a page this build has no address for OPENS NOTHING, rather than opening something wrong', async () => {
    const { open, opened } = opener();

    // No shipped build lacks an address today, so the table is the case's: the donation page present, so
    // a version that opened the wrong entry would reach the opener rather than agree by opening nothing.
    await expect(
      openWebPage('store-listing', open, {
        donate: 'https://monsterapdf.com/donate',
        'store-listing': '',
        source: 'https://github.com/tenslorai-tar/monstera',
        licences: 'https://github.com/tenslorai-tar/monstera/blob/main/NOTICE',
      }),
    ).resolves.toBe(false);

    // ASSERT THE CALL, not the answer: a version that handed `''` to the opener would also resolve
    // `false` if the opener refused it, and would have reached `shell.openExternal` on the way.
    expect(opened).toStrictEqual([]);
  });

  it('every address it does have is HTTPS — the one route refuses anything else', async () => {
    // The scheme guard lives in `entry.ts` and is not restated in `webPages.ts` (B3a), so this case
    // is what says the table cannot hand it something it must refuse. It reads the addresses through
    // the same function the application does, so an address added without a scheme fails here.
    const { open, opened } = opener();
    await openWebPage('donate', open);
    await openWebPage('store-listing', open);
    await openWebPage('source', open);
    await openWebPage('licences', open);
    expect(opened).toHaveLength(4);
    for (const url of opened) expect(new URL(url).protocol).toBe('https:');
  });
});
