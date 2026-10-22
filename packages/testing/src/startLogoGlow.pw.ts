import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * The start screen's logo glow (the owner, 2026-10-23), on pinned Chromium against the compiled bundle: the website's
 * mark rule, drawn by `--logo-hero-glow` on the start screen's logo ALONE — a thin edge and a soft glow in dark, a much
 * fainter glow in light, none in high contrast — and on no other logo the application draws.
 *
 * What is read is the COMPUTED filter, which is what the browser draws with: a rule naming a token that is not defined is
 * invalid at computed-value time and computes to `none`, so a case reading the stylesheet's text would pass on a glow
 * that is never drawn.
 */

/** How many drop shadows each look's glow computes to: the edge and the glow, the glow alone, nothing. */
const SHADOWS: Readonly<Record<Look['name'], number>> = { dark: 2, light: 1, hc: 0 };

async function startShown(page: Page, look: Look): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeUnder(page, look, {});
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
  await expect.poll(() => page.locator('.m-start-logo').evaluate((logo) => (logo as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

/** The computed `filter` of the first element `selector` names. */
function filterOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((element) => getComputedStyle(element).filter);
}

/** The drop shadows a computed filter draws. */
function shadows(filter: string): number {
  return filter.match(/drop-shadow\(/gu)?.length ?? 0;
}

for (const look of LOOKS) {
  test(`the start screen's logo alone carries the glow, ${look.name}`, async ({ page }) => {
    await startShown(page, look);
    const hero = await filterOf(page, '.m-start-logo');
    expect(shadows(hero), `the start logo's computed filter: ${hero}`).toBe(SHADOWS[look.name]);
    if (look.name === 'hc') expect(hero).toBe('none');

    // NO OTHER LOGO: the menu row's mark, on this screen, and About's, in its dialog.
    expect(await filterOf(page, '.m-menu-bar__logo')).toBe('none');
    await page.locator('.m-start-footer').getByRole('button', { name: 'About' }).click();
    const about = page.getByRole('dialog', { name: 'About Monstera' });
    await expect(about.locator('.m-about__logo')).toBeVisible();
    expect(await filterOf(page, '.m-about__logo')).toBe('none');
  });
}

test('CONTROL: with the token removed, the start logo computes no glow, so the case above reads the token', async ({ page }) => {
  const dark = LOOKS.find((look) => look.name === 'dark');
  if (dark === undefined) throw new Error('the bridge has no dark look');
  await startShown(page, dark);
  expect(shadows(await filterOf(page, '.m-start-logo'))).toBe(2);
  // `initial` is the guaranteed-invalid value, what an undeclared custom property holds: the token as if deleted.
  await page.addStyleTag({ content: ':root, [data-theme] { --logo-hero-glow: initial; }' });
  expect(await filterOf(page, '.m-start-logo')).toBe('none');
});
