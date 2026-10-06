import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * A page delete leaves no bookmark going nowhere in the Outline panel
 * ([ADR-0155](../../../docs/DECISIONS/0155-a-page-that-leaves-takes-every-reference-to-it.md); the owner's L1).
 *
 * ## What this half proves, and what the other half does
 *
 * The kernel decides what the outline holds after a delete: `pageReferences.test.ts` deletes page 2 and reads the
 * outline back as the panel reads it (`readDestinations`), a heading kept over its children and no entry going nowhere,
 * and save and reopen keeps it. This half runs against the browser shim, whose kernel is stubbed, so the outline main
 * answers after the delete is given to it. What it proves is the renderer's part: the panel is the one main answers
 * for the version on show, read again after the delete, and none of the entries it showed before comes back.
 *
 * The CONTROL is the first screen: before the delete the panel shows the entry that the delete takes away, so its
 * absence afterwards is the delete's and not a panel that never drew it.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000d5');

const BEFORE = [
  { title: 'Chapter one', page: 0, depth: 0 },
  { title: 'Chapter two', page: 1, depth: 0 },
  { title: 'Part three', page: null, depth: 0 },
  { title: 'Section 3.1', page: 2, depth: 1 },
];

// WHAT `readDestinations` ANSWERS after page 2 is deleted, by ADR-0155's rule: `Chapter two` named only page 2 and
// went; `Part three` is a heading over a child that stays, now on page 2.
const AFTER = [
  { title: 'Chapter one', page: 0, depth: 0 },
  { title: 'Part three', page: null, depth: 0 },
  { title: 'Section 3.1', page: 1, depth: 1 },
];

async function openWithOutline(page: Page, sent: { channel: string; params: unknown }[]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 3);
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'outline.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      destinations: BEFORE,
      destinationsFrom: { 2: AFTER },
      settings: { 'appearance.ribbon-section': 'organize' },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // EVERY CARD DRAWN, the state the grid's gestures act on (Organize shows no page pane to wait for).
  await expect(page.getByRole('region', { name: 'Pages to organize' }).locator('[data-thumb-page] canvas[data-drawn="true"]')).toHaveCount(3);
}

test('after a page delete the Outline panel shows what main answers for the new version, and no entry going nowhere', async ({
  page,
}) => {
  const sent: { channel: string; params: unknown }[] = [];
  await openWithOutline(page, sent);
  await page.getByRole('tab', { name: 'Bookmarks' }).click();
  const outline = page.getByRole('navigation', { name: 'Outline' });
  /** Each row as a person reads it: a link to its page, a heading, or an entry marked as going nowhere. */
  const rows = (): Promise<string[]> =>
    outline.getByRole('listitem').evaluateAll((items) =>
      items.map((item) => {
        const link = item.querySelector('.m-destination-title');
        if (link !== null) return `${link.textContent} → page ${item.querySelector('.m-destination-page')?.textContent ?? '?'}`;
        if (item.querySelector('.m-destination-heading') !== null) return `heading: ${item.textContent}`;
        return `NOWHERE: ${item.textContent}`;
      }),
    );

  // THE CONTROL: the entry the delete takes is on show before it.
  await expect.poll(rows).toStrictEqual(['Chapter one → page 1', 'Chapter two → page 2', 'heading: Part three', 'Section 3.1 → page 3']);

  const grid = page.getByRole('region', { name: 'Pages to organize' });
  await grid.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.keyboard.press('Delete');
  // ASKED FIRST (CR-COR-06), and confirmed.
  await page.getByRole('dialog', { name: 'Delete pages' }).getByRole('button', { name: 'Delete pages' }).click();
  // THE COMMAND ITSELF, kind and pages, not any execute whose payload happens to carry `"pages":[1]`.
  await expect
    .poll(() =>
      sent
        .filter(({ channel }) => channel === 'document.execute')
        .map(({ params }) => {
          const command = (params as { readonly command?: { readonly kind?: unknown; readonly pages?: unknown } }).command;
          return [command?.kind, command?.pages];
        }),
    )
    .toContainEqual(['deletePages', [1]]);

  // NOTHING GOING NOWHERE: the entry that named page 2 is gone, the heading reads as a heading, and its child names
  // the page it is now.
  await expect.poll(rows).toStrictEqual(['Chapter one → page 1', 'heading: Part three', 'Section 3.1 → page 2']);
});
