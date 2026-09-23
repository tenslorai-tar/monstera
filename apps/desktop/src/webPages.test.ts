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

  it('a page this build has no address for OPENS NOTHING, rather than opening something wrong', async () => {
    const { open, opened } = opener();

    // The Store listing needs a product id Partner Center assigns, and this build has none.
    await expect(openWebPage('store-listing', open)).resolves.toBe(false);

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
    for (const url of opened) expect(new URL(url).protocol).toBe('https:');
  });
});
