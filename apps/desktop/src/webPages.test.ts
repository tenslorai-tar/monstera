import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AI_KEY_PAGE_OF, AI_PROVIDER_IDS, AZURE_DI_PAGES, type AiKeyPage } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { openWebPage, STORE_PRODUCT_ID, STORE_URIS, webAddresses } from './webPages.js';

/** A development build's addresses: its version is no package version, so it has no tag. */
const DEVELOPMENT = webAddresses('0.0.0');

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

    await expect(openWebPage('donate', open, DEVELOPMENT)).resolves.toBe(true);

    // THE WHOLE ADDRESS, and it is asserted here rather than read from the module: a case comparing
    // the constant with itself would pass whatever the constant said, including an empty string.
    expect(opened).toStrictEqual(['https://monsterapdf.com/donate']);
  });

  it('opens the Store listing at the product id Partner Center assigned', async () => {
    const { open, opened } = opener();

    await expect(openWebPage('store-listing', open, DEVELOPMENT)).resolves.toBe(true);

    // THE WHOLE ADDRESS, for the donation case's reason. The id is the owner's, given 2026-09-25.
    expect(opened).toStrictEqual(['https://apps.microsoft.com/detail/9NHV3B1PV3XS']);
  });

  it('a packaged build opens About’s two pages AT ITS OWN VERSION’S TAG, its corresponding source (ADR-0276)', async () => {
    const { open, opened } = opener();
    const packaged = webAddresses('1.1.2610.0');
    await openWebPage('source', open, packaged);
    await openWebPage('licences', open, packaged);
    // THE WHOLE ADDRESSES, for the donation case's reason: the tag the pack step writes, `v` and the four parts.
    expect(opened).toStrictEqual([
      'https://github.com/tenslorai-tar/monstera/tree/v1.1.2610.0',
      'https://github.com/tenslorai-tar/monstera/blob/v1.1.2610.0/NOTICE',
    ]);
  });

  it('CONTROL: a version the pack step never admits has no tag, and opens the repository and main', () => {
    // A FOURTH PART THAT IS NOT 0, AND THREE PARTS: neither is a package version, so neither names a tag that exists.
    for (const version of ['1.1.2610.3', '1.1.2610', '0.0.0']) {
      expect(webAddresses(version).source).toBe('https://github.com/tenslorai-tar/monstera');
      expect(webAddresses(version).licences).toBe('https://github.com/tenslorai-tar/monstera/blob/main/NOTICE');
    }
  });

  it('a development build opens About’s two pages in this project’s repository', async () => {
    const { open, opened } = opener();
    await openWebPage('source', open, DEVELOPMENT);
    await openWebPage('licences', open, DEVELOPMENT);
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
        ...(Object.fromEntries(AI_PROVIDER_IDS.map((id) => [AI_KEY_PAGE_OF[id], 'https://example.com/'])) as Record<
          AiKeyPage,
          string
        >),
        'azure-di-create': 'https://example.com/',
        'azure-di-keys': 'https://example.com/',
        donate: 'https://monsterapdf.com/donate',
        'store-listing': '',
        source: 'https://github.com/tenslorai-tar/monstera',
        licences: 'https://github.com/tenslorai-tar/monstera/blob/main/NOTICE',
        publisher: 'https://tenslor.com',
      }),
    ).resolves.toBe(false);

    // ASSERT THE CALL, not the answer: a version that handed `''` to the opener would also resolve
    // `false` if the opener refused it, and would have reached `shell.openExternal` on the way.
    expect(opened).toStrictEqual([]);
  });

  it('opens the two Azure Document Intelligence pages, each at its own HTTPS address', async () => {
    const { open, opened } = opener();
    for (const page of AZURE_DI_PAGES) await expect(openWebPage(page, open, DEVELOPMENT)).resolves.toBe(true);
    expect(opened).toStrictEqual([
      'https://portal.azure.com/#create/Microsoft.CognitiveServicesFormRecognizer',
      'https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/create-document-intelligence-resource',
    ]);
    for (const url of opened) expect(new URL(url).protocol).toBe('https:');
  });

  it('opens each AI provider’s key page, and every provider has one at its own address (ADR-0184)', async () => {
    const { open, opened } = opener();
    for (const provider of AI_PROVIDER_IDS) await expect(openWebPage(AI_KEY_PAGE_OF[provider], open, DEVELOPMENT)).resolves.toBe(true);
    expect(opened).toHaveLength(AI_PROVIDER_IDS.length);
    // THE WHOLE ADDRESSES FOR TWO, asserted here and not read from the module, and each different from the next so a
    // page that opened its neighbour's address is seen.
    expect(opened[0]).toBe('https://platform.claude.com/settings/keys');
    expect(opened[7]).toBe('https://console.groq.com/keys');
    expect(new Set(opened).size).toBe(opened.length);
    for (const url of opened) expect(new URL(url).protocol).toBe('https:');
  });

  it('every address it does have is HTTPS — the one route refuses anything else', async () => {
    // The scheme guard lives in `entry.ts` and is not restated in `webPages.ts` (B3a), so this case
    // is what says the table cannot hand it something it must refuse. It reads the addresses through
    // the same function the application does, so an address added without a scheme fails here.
    const { open, opened } = opener();
    for (const addresses of [DEVELOPMENT, webAddresses('1.1.2610.0')]) {
      await openWebPage('donate', open, addresses);
      await openWebPage('store-listing', open, addresses);
      await openWebPage('source', open, addresses);
      await openWebPage('licences', open, addresses);
      await openWebPage('publisher', open, addresses);
    }
    expect(opened).toHaveLength(10);
    for (const url of opened) expect(new URL(url).protocol).toBe('https:');
  });

  it('"Tenslor Inc." in the © line opens EXACTLY https://tenslor.com, the owner’s address (R5)', async () => {
    const { open, opened } = opener();
    await expect(openWebPage('publisher', open, DEVELOPMENT)).resolves.toBe(true);
    // THE WHOLE ADDRESS, for the donation case's reason.
    expect(opened).toStrictEqual(['https://tenslor.com']);
  });
});

describe('the Store application’s pages', () => {
  it('every page is the Store protocol, and the update indicator’s listing names THIS product', () => {
    for (const uri of Object.values(STORE_URIS)) expect(new URL(uri).protocol).toBe('ms-windows-store:');
    // THE PRODUCT, not the Store's front page: a listing without the id would open the Store and show nothing to update.
    expect(STORE_URIS.listing).toBe(`ms-windows-store://pdp/?ProductId=${STORE_PRODUCT_ID}`);
    expect(new Set(Object.values(STORE_URIS)).size).toBe(Object.keys(STORE_URIS).length);
  });
});
