import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { type SceneShim, openApp, openDocument, openSection, runCommand, samplePdf } from './helpScreensHarness.js';
import { settled } from './settled.js';

/**
 * Six layout defects from the owner's screenshot review of 0.1.6.0, each asserted as the geometry or computed style it
 * got wrong, at the set's 1280 × 800 in the light look (the harness the Help pictures are taken with).
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element is laid out');
  return box;
}

async function openTwoDocuments(page: Page): Promise<void> {
  const bytes = await samplePdf();
  const first = asDocId('00000000-0000-4000-8000-0000000000c1');
  const second = asDocId('00000000-0000-4000-8000-0000000000c2');
  await openApp(page, {
    opens: [
      { kind: 'opened', docId: first, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Annual report.pdf' },
      { kind: 'opened', docId: second, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Appendix.pdf' },
    ],
    documentBytes: new Map([
      [first, bytes],
      [second, bytes],
    ]),
  });
  await openDocument(page);
  await page.getByRole('button', { name: 'Open another document' }).click();
  const tabs = page.getByRole('navigation', { name: 'Open documents' });
  await expect(tabs.getByRole('listitem')).toHaveCount(2);
  await tabs.getByRole('button', { name: 'Annual report.pdf', exact: true }).click();
}

test('the SEARCH TAB is drawn in the application’s controls, not the browser’s form', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.keyboard.press('Control+F');
  const panel = page.getByRole('tabpanel', { name: 'Search' });
  await expect(panel).toBeVisible();
  const read = await panel.evaluate((element) => {
    const style = (selector: string): CSSStyleDeclaration | undefined => {
      const found = element.querySelector(selector);
      return found === null ? undefined : getComputedStyle(found);
    };
    return {
      options: style('fieldset')?.borderTopWidth,
      button: style('button[type="submit"]')?.borderTopLeftRadius,
      input: style('[data-find-input]')?.borderTopLeftRadius,
    };
  });
  // NO BROWSER FRAME round the options, and the buttons and box have the primitives' rounded edge — the browser's
  // own button and text box are square-cornered in Chromium.
  expect(read.options).toBe('0px');
  expect(read.button).not.toBe('0px');
  expect(read.input).not.toBe('0px');
});

test('the SEARCH TAB lays its two boxes out alike: one width, one left edge, each with its buttons below it (F-E1)', async ({
  page,
}) => {
  await openApp(page);
  await openDocument(page);
  await page.keyboard.press('Control+F');
  const panel = page.getByRole('tabpanel', { name: 'Search' });
  await expect(panel).toBeVisible();
  const find = await boxOf(panel.getByRole('textbox', { name: 'Find text' }));
  const replace = await boxOf(panel.getByRole('textbox', { name: 'Replace with' }));
  const replaceAll = await boxOf(panel.getByRole('button', { name: 'Replace everywhere' }));
  const searchPage = await boxOf(panel.getByRole('button', { name: 'Search this page' }));

  // THE SAME COLUMN: the replace box was one item in a wrapping row, beside its label and its button.
  expect([replace.x, replace.width]).toStrictEqual([find.x, find.width]);
  // EACH HALF'S BUTTON UNDER ITS OWN BOX, as the find half's are.
  expect(searchPage.y).toBeGreaterThanOrEqual(find.y + find.height);
  expect(replaceAll.y).toBeGreaterThanOrEqual(replace.y + replace.height);
});

test('the FORMS TAB shows each field’s whole name', async ({ page }) => {
  const rect = (y: number): { x0: number; y0: number; x1: number; y1: number } => ({ x0: 72, y0: y, x1: 300, y1: y + 20 });
  await openApp(page, {
    formFields: [
      [
        { page: 0, index: 0, kind: 'text', name: 'Full name', values: [], on: null, options: [], readOnly: false, rect: rect(640) },
        { page: 0, index: 1, kind: 'text', name: 'Email', values: [], on: null, options: [], readOnly: false, rect: rect(600) },
      ],
    ],
  });
  await openDocument(page);
  await page.getByRole('tablist', { name: 'Document panels' }).getByRole('tab', { name: 'Forms' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Forms' });
  await expect(panel.getByRole('textbox', { name: 'Full name' })).toBeVisible();
  // NOT CUT: the name's button shows all of its text — no ellipsis means its content fits the box it has.
  const cut = await panel.locator('.m-forms-jump').evaluateAll((buttons) =>
    buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
  );
  expect(cut).toStrictEqual([]);
  // AND THE BOX IS WIDE ENOUGH TO READ, which `scrollWidth` alone does not say of a name allowed to wrap.
  expect((await boxOf(panel.locator('.m-forms-jump').first())).width).toBeGreaterThan(150);
});

test('the SETTINGS row keeps its description readable beside a wide control (Print quality)', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Rendering' }).click();
  const row = dialog.locator('.m-settings-row').filter({ hasText: 'Print quality' });
  await expect(row).toBeVisible();
  const text = await boxOf(row.locator('.m-settings-row__text'));
  const control = await boxOf(row.locator('[role="radiogroup"]'));
  const edge = await boxOf(row);
  // ONE WORD PER LINE was a text column a few dozen pixels wide; a readable one is hundreds.
  expect(text.width).toBeGreaterThan(200);
  // AND THE CONTROL STAYS INSIDE THE ROW rather than running past the dialog's edge.
  expect(control.x + control.width).toBeLessThanOrEqual(edge.x + edge.width + 1);
});

test('EVERY SETTINGS PAGE keeps every row’s description at its reading basis or wider, OCR’s languages included', async ({ page }) => {
  // THE CLASS, not Print quality alone: every row on every page, so a wide control added tomorrow on any page is held
  // to the same rule. The basis is the text's own `flex-basis`, resolved in its own font, so the case reads the rule
  // rather than restating a number; a row narrower than its basis may give the text the whole row instead.
  await openApp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const pages = dialog.getByRole('navigation').getByRole('button');
  await expect(pages.first()).toBeVisible();
  const names = await pages.allTextContents();
  // THE POSITIVE CONTROL: the page the owner named is among those walked, so an empty walk cannot pass.
  expect(names).toContain('OCR');
  const narrow: string[] = [];
  const measured: string[] = [];
  for (const name of names) {
    const chosen = pages.filter({ hasText: name }).first();
    await chosen.click();
    // THAT PAGE SHOWN AND ITS ROWS STILL, before they are measured: the click alone says nothing about which page's
    // rows are in the dialog, and a page's rows may arrive after its button is pressed. A page may hold no rows of
    // this kind at all (Keyboard is a list of commands), so the count is waited on to stop changing, not to be some.
    await expect(chosen).toHaveAttribute('aria-current', 'page');
    await settled(page, () => dialog.locator('.m-settings-row').count(), () => true, `the ${name} page`);
    const found = await dialog.locator('.m-settings-row').evaluateAll((all) =>
      all.map((row) => {
        const text = row.querySelector<HTMLElement>('.m-settings-row__text');
        // NO TEXT PART HAS NO DESCRIPTION TO MEASURE: every row the dialog draws carries one, so a row without it is
        // reported rather than measured as zero against a zero basis, which no width can fall short of.
        if (text === null) return null;
        const probe = document.createElement('span');
        probe.style.cssText = `position:absolute;visibility:hidden;inline-size:${getComputedStyle(text).flexBasis}`;
        text.append(probe);
        const basis = probe.getBoundingClientRect().width;
        probe.remove();
        return {
          label: text.querySelector('.m-settings-row__label')?.textContent ?? '',
          width: text.getBoundingClientRect().width,
          basis,
          row: row.getBoundingClientRect().width,
        };
      }),
    );
    for (const row of found) {
      if (row === null) {
        narrow.push(`${name} › a row with no text part`);
        continue;
      }
      measured.push(row.label);
      if (row.width + 0.5 < Math.min(row.basis, row.row)) {
        narrow.push(`${name} › ${row.label}: ${String(Math.round(row.width))} px of ${String(Math.round(row.basis))}`);
      }
    }
  }
  // MEASURED ROWS ONLY, and the row the owner named among them, so the twenty are rows whose text was read.
  expect(measured.length).toBeGreaterThan(20);
  expect(measured).toContain('Recognition languages');
  expect(narrow).toStrictEqual([]);
});

test('the FLOAT BAR covers no ORGANIZE card at 1280 × 800', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Organize');
  // THE GRID LAID OUT AND STILL: it is sized through a ResizeObserver, and the bar docks against it.
  await expect(page.locator('.m-page-grid [data-thumb-page="0"] canvas[data-drawn="true"]')).toBeAttached();
  const [bar, first] = await settled(
    page,
    async () => [
      await boxOf(page.getByRole('toolbar', { name: 'Float bar' })),
      await boxOf(page.locator('.m-page-grid').getByRole('button', { name: 'Page 1', exact: true })),
    ] as const,
    () => true,
    'the Float bar beside the Organize grid',
  );
  expect(first.x).toBeGreaterThanOrEqual(bar.x + bar.width);
});

test('a DIALOG’S OPTION GROUP has no bare frame, and each option is a line of its own (Print)', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await runCommand(page, 'Print…');
  const dialog = page.getByRole('dialog', { name: 'Print' });
  await expect(dialog).toBeVisible();
  // THE PATTERN'S GROUP: a row named for the question, its options a radiogroup in the row's control (2026-10-02).
  const group = dialog.getByRole('radiogroup', { name: 'Print quality' });
  expect(await group.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  const radios = group.getByRole('radio');
  const tops = await Promise.all([0, 1, 2].map(async (at) => (await boxOf(radios.nth(at))).y));
  // ONE TO A LINE: three distinct rows, top to bottom, rather than a run of three that wraps mid-sentence.
  expect(tops[1]).toBeGreaterThan(tops[0] ?? Number.POSITIVE_INFINITY);
  expect(tops[2]).toBeGreaterThan(tops[1] ?? Number.POSITIVE_INFINITY);
});

// EVERY DIALOG WITH A COLUMN OF CHOICES (the owner's review of 0.1.9.0, Export to Word): the question sits on its first
// option, no taller than its own words. The heading's flex basis, a width in a row, had become a 22ch height in the
// column. Every dialog that draws `.m-dialog-choices` (`DialogChoices`) is opened here: Export to Word, Split and Print.
// Signature › Type drew a column until its styles became a menu (ADR-0150), and Edit page object until it became a mode
// on the page (ADR-0153).
const scenes: readonly { readonly name: string; readonly shim?: SceneShim; readonly open: (page: Page) => Promise<void> }[] = [
  {
    name: 'Export to Word',
    open: async (page: Page): Promise<void> => {
      await openSection(page, 'Home');
      await page.locator('.m-ribbon__tools').getByRole('button', { name: 'Word', exact: true }).click();
    },
  },
  {
    name: 'Split into several PDFs',
    open: async (page: Page): Promise<void> => {
      await runCommand(page, 'Split…');
    },
  },
  {
    name: 'Print',
    open: async (page: Page): Promise<void> => {
      await runCommand(page, 'Print…');
    },
  },
];
for (const scene of scenes) {
  test(`${scene.name}: a column of choices has no gap between its question and its first option`, async ({ page }) => {
    await openApp(page, scene.shim ?? {});
    await openDocument(page);
    await scene.open(page);
    const dialog = page.getByRole('dialog', { name: scene.name });
    await expect(dialog.locator('.m-dialog-choices').first()).toBeVisible();
    const groups = await dialog.locator('.m-dialog-choices').evaluateAll((elements) =>
      elements.map((group) => {
        const heading = group.firstElementChild;
        const option = group.querySelector('.m-dialog-choice');
        if (heading === null || option === null) return null;
        const words = [...heading.children].map((child) => child.getBoundingClientRect());
        const box = heading.getBoundingClientRect();
        return {
          // THE HEADING HUGS ITS WORDS: its content box ends within a pixel of its last line.
          slack: Math.round(
            box.bottom - Number.parseFloat(getComputedStyle(heading).paddingBottom) - Math.max(...words.map((word) => word.bottom)),
          ),
          // AND THE FIRST OPTION FOLLOWS at the pattern's spacing, not after a band.
          gap: Math.round(option.getBoundingClientRect().top - Math.max(...words.map((word) => word.bottom))),
        };
      }),
    );
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group).not.toBeNull();
      expect(group?.slack, JSON.stringify(groups)).toBeLessThanOrEqual(1);
      expect(group?.gap, JSON.stringify(groups)).toBeLessThanOrEqual(12);
    }
  });
}

test('MERGE’s document list stands clear of the button under it', async ({ page }) => {
  await openTwoDocuments(page);
  await openSection(page, 'Organize');
  await page.getByRole('button', { name: 'Merge', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: /Merge/u });
  await expect(dialog.getByRole('combobox')).toBeVisible();
  const list = await boxOf(dialog.getByRole('combobox'));
  const button = await boxOf(dialog.getByRole('button', { name: 'Merge', exact: true }));
  expect(button.y - (list.y + list.height)).toBeGreaterThanOrEqual(8);
});
