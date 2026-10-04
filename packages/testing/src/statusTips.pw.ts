import { type Page, expect, test } from '@playwright/test';

import { openApp, openDocument } from './helpScreensHarness.js';

/**
 * The status bar's tips (the owner's items 18a to 18c, ADR-0159), through the real application on the pinned Chromium.
 *
 * Which tips exist, that each names only registered commands, and the order a round goes in are `tips.test.ts` and
 * `App.test.tsx`'s. These are what only a browser can answer: where the tip sits in the bar, that a tip with no room is
 * hidden whole, that it fades, that it changes, and that its round reaches the settings file.
 */

const TIP = '.m-status-start .m-status-tip';

/** What the shim holds as main's settings file, asked through the page's own bridge. */
async function storedSettings(page: Page): Promise<Readonly<Record<string, unknown>>> {
  const answer = await page.evaluate(() =>
    (window as unknown as { __monsteraInvoke: (channel: string, params: unknown) => Promise<unknown> }).__monsteraInvoke(
      'settings.load',
      {},
    ),
  );
  const parsed = answer as { readonly ok?: boolean; readonly value?: { readonly stored?: Record<string, unknown> } };
  if (parsed.ok !== true || parsed.value?.stored === undefined) throw new Error('the shim refused settings.load');
  return parsed.value.stored;
}

async function storedRound(page: Page): Promise<readonly string[]> {
  const round = (await storedSettings(page))['appearance.tips-shown'];
  return Array.isArray(round) ? round.filter((id): id is string => typeof id === 'string') : [];
}

test('at 1280 x 800 a tip is shown WHOLE in the room after the tool line, clear of the page controls, and is not announced', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const tip = page.locator(TIP);
  await expect(tip).toHaveAttribute('data-shown', 'true');
  await expect(tip).toHaveAttribute('data-fits', 'true');
  await expect(tip).toHaveAttribute('aria-hidden', 'true');
  await expect(tip).not.toHaveText('');
  const measured = await tip.evaluate((span) => {
    const centre = document.querySelector('.m-status-centre');
    if (centre === null) throw new Error('the status bar has no centre');
    return {
      right: span.getBoundingClientRect().right,
      centre: centre.getBoundingClientRect().left,
      scroll: span.scrollWidth,
      client: span.clientWidth,
      opacity: getComputedStyle(span).opacity,
    };
  });
  expect(measured.right).toBeLessThanOrEqual(measured.centre);
  // WHOLE: no word runs past the span's box, which is what `data-fits` claims.
  expect(measured.scroll).toBeLessThanOrEqual(measured.client + 1);
  expect(measured.opacity).toBe('1');
  // THE ROUND REACHED THE SETTINGS FILE, naming the tip on show.
  const id = await tip.getAttribute('data-tip');
  await expect.poll(() => storedRound(page)).toContain(id);
});

test('at 1280 x 800 EVERY tip in the round fits whole, so none is hidden at the size a person most often has', async ({ page }) => {
  await page.clock.install();
  await openApp(page);
  await openDocument(page);
  const tip = page.locator(TIP);
  const seen = new Map<string, { readonly fits: string | null; readonly text: string }>();
  for (;;) {
    await expect(tip).toHaveAttribute('data-shown', 'true');
    const id = await tip.getAttribute('data-tip');
    if (id === null) throw new Error('no tip was shown');
    // A NEW ROUND begins with a tip already seen: every tip has been shown once.
    if (seen.has(id)) break;
    seen.set(id, {
      fits: await tip.getAttribute('data-fits'),
      // THE WORDS' OWN WIDTH, from a range over them: `scrollWidth` never reads below the box, so it cannot say how
      // close a tip that fits comes to the edge.
      text: await tip.evaluate((span) => {
        const range = document.createRange();
        range.selectNodeContents(span);
        return `${range.getBoundingClientRect().width.toFixed(1)} of ${String(span.clientWidth)} px: ${span.textContent}`;
      }),
    });
    await page.clock.fastForward(40_000);
    await expect(tip).not.toHaveAttribute('data-tip', id);
  }
  // CONTROL: the walk saw the whole round, well over a hundred, rather than stopping early.
  expect(seen.size).toBeGreaterThan(150);
  const cut = [...seen].filter(([, reading]) => reading.fits !== 'true').map(([id, reading]) => `${id}: ${reading.text}`);
  expect(cut, `\n${cut.join('\n')}\n`).toStrictEqual([]);
});

test('a tip with NO ROOM is hidden whole, never cut, and comes back when the room does', async ({ page }) => {
  // THE SAME TIP every run, the first written one, so the room it needs is the case's and not a draw's.
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await openApp(page);
  await openDocument(page);
  const tip = page.locator(TIP);
  await expect(tip).toHaveAttribute('data-fits', 'true');
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(tip).toHaveAttribute('data-fits', 'false');
  const narrow = await tip.evaluate((span) => ({
    scroll: span.scrollWidth,
    client: span.clientWidth,
    visibility: getComputedStyle(span).visibility,
  }));
  // CONTROL: the words really do not fit, so hiding them is the rule working, not a measure that always says no.
  expect(narrow.scroll).toBeGreaterThan(narrow.client + 1);
  expect(narrow.visibility).toBe('hidden');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(tip).toHaveAttribute('data-fits', 'true');
  await expect(tip).toHaveCSS('visibility', 'visible');
});

test('the tip CHANGES every so often, a new one from the round, and the round carries what was already shown', async ({ page }) => {
  await page.clock.install();
  // A ROUND A PREVIOUS SESSION LEFT: none of these is shown again until every tip has been.
  const earlier = ['help', 'palette', 'undo', 'find'];
  await openApp(page, { settings: { 'appearance.tips-shown': earlier } });
  await openDocument(page);
  const tip = page.locator(TIP);
  await expect(tip).toHaveAttribute('data-shown', 'true');
  const first = await tip.getAttribute('data-tip');
  if (first === null) throw new Error('no tip was shown');
  expect(earlier).not.toContain(first);
  await expect.poll(() => storedRound(page)).toStrictEqual([...earlier, first]);

  await page.clock.fastForward(40_000);
  await expect(tip).not.toHaveAttribute('data-tip', first);
  await expect(tip).toHaveAttribute('data-shown', 'true');
  const second = await tip.getAttribute('data-tip');
  if (second === null) throw new Error('no second tip was shown');
  expect(earlier).not.toContain(second);
  await expect.poll(() => storedRound(page)).toStrictEqual([...earlier, first, second]);
});

test('a tip STAYS its time while a person works: the registry rebuilt under it changes no tip and writes no round', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const tip = page.locator(TIP);
  await expect(tip).toHaveAttribute('data-shown', 'true');
  const first = await tip.getAttribute('data-tip');
  await expect.poll(() => storedRound(page)).toHaveLength(1);
  // THE REGISTRY IS REBUILT on a selection and on the document's state, and already while the document opens: with the
  // timer restarted by each rebuild, the round holds two tips before the first of these keys (measured 2026-10-04).
  await page.locator('.m-page-list canvas.m-page').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Escape');
  await expect(tip).toHaveAttribute('data-tip', first ?? '');
  expect(await storedRound(page)).toHaveLength(1);
});

test('the FIRST tip fades in, as every later one does', async ({ page }) => {
  await openApp(page);
  // THE FADE, which every look's reduced motion turns off.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  await page.evaluate(() => {
    const runs: string[] = [];
    (window as unknown as { tipFades: string[] }).tipFades = runs;
    document.addEventListener('transitionrun', (event) => {
      if (event.target instanceof Element && event.target.classList.contains('m-status-tip')) runs.push(event.propertyName);
    });
  });
  await openDocument(page);
  const tip = page.locator(TIP);
  await expect(tip).toHaveAttribute('data-shown', 'true');
  await expect(tip).toHaveCSS('transition-duration', '0.4s');
  // A TRANSITION RAN on the first tip: drawn already at 1 it would have none.
  await expect.poll(() => page.evaluate(() => (window as unknown as { tipFades: string[] }).tipFades)).toContain('opacity');
  await expect(tip).toHaveCSS('opacity', '1');
});

test('with tips TURNED OFF no tip is drawn and no round is written', async ({ page }) => {
  await openApp(page, { settings: { 'appearance.status-tips': false } });
  await openDocument(page);
  // CONTROL: the bar is there, so an absent tip is the setting rather than an absent bar.
  await expect(page.locator('.m-status-centre')).toBeVisible();
  await expect(page.locator('.m-status-start')).toHaveCount(1);
  await expect(page.locator(TIP)).toHaveCount(0);
  expect(await storedRound(page)).toStrictEqual([]);
});

test('the Settings switch turns the tip off where it is shown', async ({ page }) => {
  await openApp(page);
  await openDocument(page);
  const tip = page.locator(TIP);
  await expect(tip).toHaveAttribute('data-shown', 'true');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();
  const toggle = dialog.getByRole('switch', { name: 'Show tips in the status bar' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(tip).toHaveCount(0);
  await expect.poll(async () => (await storedSettings(page))['appearance.status-tips']).toBe(false);
});
