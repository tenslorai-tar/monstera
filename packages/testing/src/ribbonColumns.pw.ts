import { expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * No ribbon group leaves a SMALL tool alone in its column while it has others (the owner's review of 0.1.12.0: Organize ›
 * Adjust drew three tools and then a fourth by itself, Tools › Application a lone Settings, Comment › Markup a lone Callout).
 *
 * The columns are read from the DRAWN ribbon, every section, at a window wide enough that nothing is folded — a lone column
 * can be the fold's doing at a narrow width and that is not this rule. A group whose only unit is one column of one tool is
 * allowed: there is nothing for it to share a column with.
 */

interface Violation {
  readonly section: string;
  readonly group: string;
  readonly columns: readonly number[];
}

/** The rule itself, over `[group, [column sizes]]`: a column of one in a group that has another column of small tools. */
function lonely(section: string, groups: readonly { readonly group: string; readonly columns: readonly number[] }[]): Violation[] {
  return groups
    .filter((entry) => entry.columns.length > 1 && entry.columns.includes(1))
    .map((entry) => ({ section, group: entry.group, columns: entry.columns }));
}

test('NO GROUP draws a small tool alone in a column beside other columns of small tools, in any section', async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openDocument(page);
  const rail = page.getByRole('navigation', { name: 'Sections' });
  const names = (await rail.getByRole('button').allTextContents()).map((name) => name.trim());
  // THE SECTIONS WERE FOUND, or the loop below is the reassuring answer from a lookup that saw nothing.
  expect(names).toContain('Comment');
  expect(names).toContain('Organize');
  const found: Violation[] = [];
  let columnsSeen = 0;
  for (const name of names) {
    await rail.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.m-ribbon__tools .m-ribbon__group').first()).toBeVisible();
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll('.m-ribbon__tools .m-ribbon__group')].map((group) => ({
        group: group.querySelector('.m-ribbon__caption')?.textContent ?? '',
        // ONLY THE STACKS: a large tool or a named menu is a button of its own, never a column of small ones.
        columns: [...(group.querySelector('.m-ribbon__buttons')?.querySelectorAll(':scope > .m-ribbon__stack') ?? [])].map(
          (stack) => stack.children.length,
        ),
      })),
    );
    columnsSeen += groups.reduce((sum, entry) => sum + entry.columns.length, 0);
    found.push(...lonely(name, groups));
  }
  // COLUMNS WERE READ: the drawn ribbon has dozens, so a walk that found none read nothing.
  expect(columnsSeen).toBeGreaterThan(20);
  expect(found).toStrictEqual([]);
});

test('CONTROL: the rule reports a group drawn as three tools and then one, and a group of one column of one is allowed', () => {
  expect(lonely('Organize', [{ group: 'Adjust', columns: [3, 1] }])).toStrictEqual([
    { section: 'Organize', group: 'Adjust', columns: [3, 1] },
  ]);
  expect(lonely('Organize', [{ group: 'Adjust', columns: [2, 2] }])).toStrictEqual([]);
  expect(lonely('Tools', [{ group: 'Solo', columns: [1] }])).toStrictEqual([]);
});
