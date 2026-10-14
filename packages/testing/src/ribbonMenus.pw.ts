import { type Locator, type Page, expect, test } from '@playwright/test';

import { openApp, openDocument, openSection } from './helpScreensHarness.js';

/**
 * A RIBBON MENU'S ITEMS DRAW THEIR COMMAND'S GLYPH — a group's More and a named menu alike, one component (`RibbonMore`).
 *
 * Found by CI on 2485608e: cloud-4 item 9c put Word, Excel and PowerPoint in Home's one Export menu, and the menu drew
 * titles only, so PowerPoint's slide glyph — the owner's own ask in the review of 0.1.9.0 — was no longer anywhere on
 * Home. The right-click menu has drawn glyphs since item 9b; the ribbon's menus now do the same, with the check mark's
 * column only in a menu that has a checkable member.
 */

/** Each item's glyph count, whether it has a mark column, and where its title starts, in CSS pixels. */
async function itemsOf(
  menu: Locator,
): Promise<readonly { glyphs: number; glyph: string; mark: boolean; titleX: number; itemX: number }[]> {
  return menu.locator('[role="menuitem"], [role="menuitemcheckbox"]').evaluateAll((items) =>
    items.map((item) => {
      const icon = item.querySelector('.m-ribbon-menu__icon');
      const title = [...item.children].find((child) => child.getAttribute('aria-hidden') !== 'true');
      return {
        glyphs: icon?.querySelectorAll('svg').length ?? 0,
        // WHICH glyph, by lucide's own class on it, so a menu of one glyph repeated is told from one of distinct ones.
        glyph: [...(icon?.querySelector('svg')?.classList ?? [])].find((name) => name.startsWith('lucide-')) ?? '',
        mark: item.querySelector('.m-ribbon-menu__mark') !== null,
        titleX: title?.getBoundingClientRect().left ?? Number.NaN,
        itemX: item.getBoundingClientRect().left,
      };
    }),
  );
}

async function openMenu(page: Page, button: Locator): Promise<Locator> {
  await button.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('Home › Export: every item draws its glyph, PowerPoint the slide, every title at one edge, and no mark column', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Home');
  const menu = await openMenu(page, page.getByRole('toolbar', { name: 'Tools', exact: true }).getByRole('button', { name: /^Export\b/u }));
  await expect(menu.getByRole('menuitem', { name: 'Export to PowerPoint…' }).locator('svg.lucide-presentation')).toHaveCount(1);

  const items = await itemsOf(menu);
  expect(items).toHaveLength(3);
  expect(items.every((item) => item.glyphs === 1 && !item.mark), JSON.stringify(items)).toBe(true);
  expect(new Set(items.map((item) => item.glyph)).size, JSON.stringify(items)).toBe(3);
  // ONE EDGE, and past the glyph: a title at the item's own edge would mean the glyph column is not there.
  expect(new Set(items.map((item) => item.titleX)).size, JSON.stringify(items)).toBe(1);
  const [first] = items;
  expect((first?.titleX ?? 0) - (first?.itemX ?? 0)).toBeGreaterThan(14);
});

test('Edit › Edit object: a menu with checkable members gives EVERY item a mark column, then its own glyph', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await openSection(page, 'Edit');
  const menu = await openMenu(page, page.getByRole('button', { name: 'Edit object choices' }));

  const items = await itemsOf(menu);
  expect(items).toHaveLength(4);
  expect(items.every((item) => item.glyphs === 1 && item.mark), JSON.stringify(items)).toBe(true);
  // ONE GLYPH EACH: four pencils would say nothing about which objects each filter outlines.
  expect(new Set(items.map((item) => item.glyph)).size, JSON.stringify(items)).toBe(4);
  expect(new Set(items.map((item) => item.titleX)).size, JSON.stringify(items)).toBe(1);
});

// THE FACE RUNS THE LAST CHOICE (ADR-0241), the owner's E2: *"Clicking the button itself should enter 'Edit all
// objects', or the last choice."* Read by the menu's own marks, which are the mode's state, so a face that only opened
// the menu, or ran the first member for ever, fails at a named step.
test('Edit › Edit object: the face enters Edit all objects, and after a choice from the arrow, that choice', async ({ page }) => {
  // A PAGE WITH OBJECTS, as the engine answers for one: with none the mode is refused with a dialog, and every mark below
  // would read *off* whatever the face did.
  await openApp(page, {
    pageObjects: [
      { index: 0, kind: 'text', left: 72, bottom: 700, right: 400, top: 720, fill: { red: 0, green: 0, blue: 0, alpha: 255 } },
      { index: 1, kind: 'image', left: 72, bottom: 420, right: 300, top: 640, fill: null },
    ],
  });
  await openDocument(page);
  await openSection(page, 'Edit');
  const tools = page.getByRole('toolbar', { name: 'Tools', exact: true });
  const face = tools.getByRole('button', { name: 'Edit object', exact: true });
  const choices = tools.getByRole('button', { name: 'Edit object choices' });
  const marked = async (title: string): Promise<string | null> => {
    const menu = await openMenu(page, choices);
    const checked = await menu.getByRole('menuitemcheckbox', { name: title }).getAttribute('aria-checked');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    return checked;
  };

  // CONTROL: nothing is on before the press, so the mark below is the press's.
  expect(await marked('Edit all objects')).toBe('false');
  await face.click();
  expect(await marked('Edit all objects')).toBe('true');
  await expect(face).toHaveAttribute('aria-pressed', 'true');

  await (await openMenu(page, choices)).getByRole('menuitemcheckbox', { name: 'Edit images' }).click();
  expect(await marked('Edit images')).toBe('true');
  // THE FACE NOW RUNS IMAGES: a press turns that filter off, and the next turns images on again, not all objects.
  await face.click();
  await expect(face).toHaveAttribute('aria-pressed', 'false');
  await face.click();
  expect(await marked('Edit images')).toBe('true');
  expect(await marked('Edit all objects')).toBe('false');
});

test('a group’s More, folded by the width, draws each tool’s glyph too', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  await page.setViewportSize({ width: 760, height: 560 });
  await openSection(page, 'Comment');
  // A BUTTON, not the unseen gauge span the fold measures a More by.
  const more = page.getByRole('toolbar', { name: 'Tools', exact: true }).locator('button.m-ribbon__more').first();
  // CONTROL: at this width the row does fold, so the case is about a real More.
  await expect(more).toBeVisible();
  const items = await itemsOf(await openMenu(page, more));
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((item) => item.glyphs === 1), JSON.stringify(items)).toBe(true);
});
