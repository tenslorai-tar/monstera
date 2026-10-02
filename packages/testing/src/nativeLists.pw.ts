import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * Every native select's list is readable, in every theme.
 *
 * ## Why this reads computed colours and not the list
 *
 * Chromium draws a select's list in a popup of its own, outside the page, so no screenshot or locator here can
 * see it. What decides it is in the page: the list takes its text from the select's `color` and its ground from
 * the select's `background-color` made opaque against white (and each row from its option's). So the case
 * asserts, for every select on screen and every option in it, an OPAQUE background and the theme's text contrast
 * against it: 4.5:1, 7:1 in high contrast. The assistant's pickers had `background: transparent` and the settings
 * fields a translucent token, which over white is a near-white list under light text (`assistant_3`).
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000d6');

interface Read {
  readonly where: string;
  readonly background: string;
  readonly color: string;
}

/** Every select and option on screen, with its computed ground and text colour. */
async function lists(page: Page): Promise<Read[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLSelectElement>('select')].flatMap((select, index) => {
      const read = (element: Element, where: string) => {
        const style = getComputedStyle(element);
        return { where, background: style.backgroundColor, color: style.color };
      };
      return [
        read(select, `select ${String(index)} (${select.getAttribute('aria-label') ?? select.name})`),
        ...[...select.options].map((option) => read(option, `select ${String(index)} option "${option.text}"`)),
      ];
    }),
  );
}

function channels(colour: string): [number, number, number, number] {
  const parts = /rgba?\(([^)]+)\)/u.exec(colour)?.[1]?.split(',').map((part) => Number.parseFloat(part)) ?? [];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const linear = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(text: string, ground: string): number {
  const a = luminance(channels(text));
  const b = luminance(channels(ground));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const look of LOOKS) {
  test(`${look.name}: every NATIVE LIST is opaque and its text meets the theme's contrast`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const bytes = await blockedPages([612, 792], 1);
    await bridgeUnder(page, look, {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'lists.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      settings: { 'appearance.context-panel-open': true, 'appearance.context-panel-tab': 'assistant' },
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
    await page.getByRole('button', { name: 'Open PDF…' }).click();
    await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });

    // THE ASSISTANT'S PICKERS, which were transparent: they must be on screen, or the case reads no select at all.
    await expect(page.locator('.m-assistant__picker select').first()).toBeVisible({ timeout: 10_000 });
    const floor = look.name === 'hc' ? 7 : 4.5;
    const unreadable = (read: Read[]): Read[] =>
      read.filter((each) => channels(each.background)[3] < 1 || contrast(each.color, each.background) < floor);
    const beside = await lists(page);
    expect(beside.length).toBeGreaterThan(2);
    expect(unreadable(beside)).toStrictEqual([]);

    // AND THE SETTINGS DIALOG'S, which sat on a translucent field token.
    await page.keyboard.press('Control+K');
    await page.locator('.m-palette-query').fill('Settings');
    await page.getByRole('option', { name: /^Settings\b/u }).first().click();
    // EVERY PAGE OF IT, since each page mounts only its own rows.
    const pages = page.getByRole('navigation', { name: 'Settings pages' }).getByRole('button');
    await expect(pages.first()).toBeVisible();
    let seen = 0;
    for (let at = 0; at < (await pages.count()); at += 1) {
      await pages.nth(at).click();
      const settings = await lists(page);
      seen += settings.length - beside.length;
      expect(unreadable(settings)).toStrictEqual([]);
    }
    // SOME PAGE HAD A SELECT, or the loop read nothing new and proved nothing about the dialog.
    expect(seen).toBeGreaterThan(0);
  });
}
