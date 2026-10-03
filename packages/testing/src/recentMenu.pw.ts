import { AxeBuilder } from '@axe-core/playwright';
import { displayLocationSchema } from '@monstera/contract';
import { asDocId, asDocVersion, asFileHandle } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * File › Recent in a real browser
 * ([ADR-0143](../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)):
 * the submenu lists every file main sends, a missing one disabled and saying so, reachable by the keyboard; *Clear
 * list* empties the one list both views show; and the start screen shows only the first four of it.
 *
 * The shim answers `document.recent` with the fixture's entries as main would, `available` included — main computes
 * that flag, and `contractHandlers.test.ts` holds it to the open's own rule. What is proven here is the renderer's half:
 * that the row draws what main sent, and that each control reaches the channel it names.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000d7');

/** Six recent files, newest first; the second is not there now. */
const ENTRIES = ['Annual report.pdf', 'Site survey.pdf', 'Board minutes.pdf', 'Lease.pdf', 'Invoice 114.pdf', 'Notes.pdf'].map(
  (name, at) => ({
    handle: asFileHandle(`handle-${String(at)}`),
    name,
    location: displayLocationSchema.parse({ within: 'documents', folder: 'Reports' }),
    openedAt: new Date(Date.now() - at * 3_600_000).toISOString(),
    available: name !== 'Site survey.pdf',
  }),
);

async function started(page: Page, look: Look = LOOKS[0]): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  const bytes = await blockedPages([612, 792], 1);
  await bridgeUnder(page, look, {
    recent: ENTRIES,
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Lease.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
}

/** Opens File › Recent by the keyboard alone — the menubar pattern's keys — and answers its popup. */
async function openRecentByKeyboard(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('.m-menu-bar__trigger[data-menu="file"]').focus();
  await page.keyboard.press('Enter');
  const trigger = page.getByRole('menuitem', { name: 'Recent' });
  await expect(trigger).toBeVisible();
  // DOWN THE FILE MENU TO RECENT, and right into it: no pointer anywhere.
  for (let step = 0; step < 8; step += 1) {
    if (await trigger.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(trigger).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const popup = page.locator('[data-submenu-popup="recent"]');
  await expect(popup).toBeVisible();
  return popup;
}

test('FILE › RECENT lists every file main keeps, a missing one disabled and named so, and is keyboard reachable', async ({ page }) => {
  await started(page);

  // THE START SCREEN SHOWS FOUR of the six — its own number — and the submenu below shows all six.
  await expect(page.locator('.m-recent-list > li')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Invoice 114.pdf' })).toHaveCount(0);

  const popup = await openRecentByKeyboard(page);
  const files = popup.locator('[data-recent-file]');
  await expect(files).toHaveCount(6);
  expect(await files.evaluateAll((items) => items.map((item) => item.getAttribute('data-recent-file')))).toStrictEqual(
    ENTRIES.map((entry) => entry.name),
  );
  // THE FIRST FILE HAS THE FOCUS: the submenu was entered by ArrowRight, not by a pointer.
  await expect(popup.getByRole('menuitem', { name: 'Annual report.pdf' })).toBeFocused();

  // NEVER HIDDEN: the missing file is listed, disabled, and its state is in its name and on screen.
  const missing = popup.getByRole('menuitem', { name: 'Site survey.pdf, unavailable' });
  await expect(missing).toHaveAttribute('aria-disabled', 'true');
  await expect(missing).toContainText('Unavailable');
  // CONTROL: a file that is there is not.
  await expect(popup.getByRole('menuitem', { name: 'Lease.pdf' })).not.toHaveAttribute('aria-disabled', 'true');

  // *Clear list* at the foot, after a separator.
  const clear = popup.getByRole('menuitem', { name: 'Clear list' });
  await expect(clear).toBeEnabled();
  expect(
    await popup.evaluate((element) => {
      const separator = element.querySelector('[role="separator"]');
      return separator?.nextElementSibling?.getAttribute('data-command');
    }),
  ).toBe('document.clear-recent');

  // ENTER ON AN AVAILABLE FILE OPENS IT, through the one recent-open route: the document is on screen.
  await popup.getByRole('menuitem', { name: 'Lease.pdf' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.m-page-list canvas.m-page').first()).toBeVisible({ timeout: 20_000 });
});

test('CLEAR LIST empties the one list both views show, and the submenu then says so', async ({ page }) => {
  await started(page);
  let popup = await openRecentByKeyboard(page);
  await popup.getByRole('menuitem', { name: 'Clear list' }).click();

  // THE START SCREEN, behind the menu, read the list again: main's answer is empty now.
  await expect(page.getByText('Nothing opened yet.')).toBeVisible();
  await expect(page.locator('.m-recent-list > li')).toHaveCount(0);

  popup = await openRecentByKeyboard(page);
  await expect(popup.locator('[data-recent-file]')).toHaveCount(0);
  await expect(popup.getByRole('menuitem', { name: 'No recent files' })).toHaveAttribute('aria-disabled', 'true');
  // NOTHING LEFT TO CLEAR: the submenu's command acts on its values, and there are none.
  await expect(popup.getByRole('menuitem', { name: 'Clear list' })).toHaveAttribute('aria-disabled', 'true');
});

// IN EVERY THEME, the open submenu with a missing file passes the gate, and so does the start screen beside it: the
// submenu scoped as the menu bar's own case scopes an open menu (Base UI's portal placeholder, measured there), and the
// start screen whole, its disabled card included.
for (const look of LOOKS) {
  test(`${look.name}: File › Recent and the start screen's four cards, a missing file among them, pass axe`, async ({ page }) => {
    await started(page, look);
    const gate = async (scan: AxeBuilder): Promise<void> => {
      const results = await scan.analyze();
      const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(String(violation.impact)));
      expect(
        blocking,
        blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n'),
      ).toEqual([]);
    };
    await expect(page.getByRole('button', { name: 'Site survey.pdf' })).toHaveAttribute('aria-disabled', 'true');
    await gate(new AxeBuilder({ page }));
    const popup = await openRecentByKeyboard(page);
    await expect(popup.getByRole('menuitem', { name: 'Site survey.pdf, unavailable' })).toBeVisible();
    await gate(new AxeBuilder({ page }).include('[data-submenu-popup="recent"]'));
  });
}
