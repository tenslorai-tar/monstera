import { AxeBuilder } from '@axe-core/playwright';
import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';
import { settled, startScreenListening } from './settled.js';

/**
 * The tool windows the owner had redrawn in the dialog pattern on 2 October — Cloud storage, Help, Keyboard
 * shortcuts and Camera capture — in every look, at 1280 × 800 and in a window narrower than the
 * application's floor. What each case holds is what the owner's review of them named: nothing wraps out of or overflows
 * the window, the footer is inside it whatever the list's length, and the gate is clean with the window open. A real
 * browser lays these out; happy-dom lays nothing out.
 */

const BLOCKING = new Set(['serious', 'critical']);
const DOC = asDocId('00000000-0000-4000-8000-0000000000f5');

/** The palette's way in, as a person types a command's name. */
async function palette(page: Page, title: string): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.keyboard.type(title);
  await page.getByRole('option', { name: title }).first().click();
}

/**
 * Each window, how a person opens it, and WHAT IT HOLDS ONCE ITS CONTENT HAS ARRIVED. The body's chunk arrives with
 * the dialog; a provider's state arrives afterwards over IPC, so a window measured on its footer
 * alone can be measured empty.
 */
const WINDOWS: readonly {
  readonly name: string;
  readonly title: string;
  readonly open: (page: Page) => Promise<void>;
  readonly arrived?: (dialog: Locator) => Promise<void>;
}[] = [
  {
    name: 'Cloud storage',
    title: 'Cloud storage',
    open: (page) => palette(page, 'Cloud storage…'),
    arrived: async (dialog) => {
      await expect(dialog.getByText('OneDrive', { exact: true }).first()).toBeVisible();
      await expect(dialog.getByText('Google Drive', { exact: true }).first()).toBeVisible();
    },
  },
  { name: 'Help', title: 'Help centre', open: (page) => page.keyboard.press('F1') },
  { name: 'Keyboard shortcuts', title: 'Keyboard shortcuts', open: (page) => page.keyboard.press('Control+Slash') },
  { name: 'Camera capture', title: 'Take pictures', open: (page) => palette(page, 'New PDF from camera…') },
];

for (const tool of WINDOWS) {
  for (const look of LOOKS) {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 760, height: 560 },
    ]) {
      test(`${look.name}: ${tool.name} at ${String(size.width)} × ${String(size.height)} — in the pattern, nothing overflows, the footer in view, axe clean`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        const bytes = await samplePdf();
        await bridgeUnder(page, look, {
          opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'report.pdf' }],
          documentBytes: new Map([[DOC, bytes]]),
          // EACH WINDOW WITH SOMETHING IN IT: a provider signed in and one signed out.
          cloudStatus: {
            providers: [
              { provider: 'onedrive', state: 'signed-out' },
              { provider: 'google-drive', state: 'signed-in' },
            ],
          },
        });
        await page.goto('/');
        await page.getByRole('button', { name: /^Open PDF/u }).first().click();
        await expect(page.locator('canvas[data-page-canvas="0"]')).toBeVisible();
        await tool.open(page);
        const dialog = page.getByRole('dialog', { name: tool.title });
        await expect(dialog).toBeVisible();
        const footer = dialog.locator('.m-dialog-footer');
        await expect(footer).toBeVisible();
        await tool.arrived?.(dialog);
        await settled(page, () => dialog.boundingBox(), (box) => box !== null, tool.name);

        const shape = await dialog.evaluate((popup) => {
          const box = popup.getBoundingClientRect();
          const foot = popup.querySelector('.m-dialog-footer')?.getBoundingClientRect();
          // PAST THE WINDOW'S EDGE, or SCROLLING SIDEWAYS: a box that clips or scrolls whose content is wider than it. A box
          // that shows its overflow is judged by where its content lands, the first half.
          const wide = [...popup.querySelectorAll<HTMLElement>('*')]
            .filter((element) => element.closest('.m-visually-hidden') === null)
            .filter((element) => {
              const r = element.getBoundingClientRect();
              const clips = getComputedStyle(element).overflowX !== 'visible';
              return (
                (r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5)) ||
                (clips && element.scrollWidth > element.clientWidth + 1)
              );
            })
            .map((element) => `${element.tagName}.${element.className}`);
          // NOTHING PASSES UNDER THE FOOTER: it is drawn after the scrolling body, not inside it, and on the dialog's own
          // ground. Pinned inside the body it had to cover the rows, and an opaque cover drew a band the glass ground
          // cannot match (the gallery's reading, 2026-10-03).
          const body = popup.querySelector('.m-dialog__body');
          const footer = popup.querySelector('.m-dialog-footer');
          const bodyBox = body?.getBoundingClientRect();
          return {
            inWindow: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
            footInPopup: foot !== undefined && foot.bottom <= box.bottom + 0.5 && foot.top >= box.top,
            footBelowBody:
              footer !== null && body !== null && !body.contains(footer) && foot !== undefined && bodyBox !== undefined && foot.top >= bodyBox.bottom - 0.5,
            footGround: footer === null ? null : getComputedStyle(footer).backgroundColor,
            wide,
            sections: popup.querySelectorAll('.m-dialog-section, .m-dialog-row').length,
          };
        });
        expect(shape.inWindow).toBe(true);
        expect(shape.footInPopup).toBe(true);
        expect(shape.footBelowBody, 'the footer is after the scrolling body, not in it').toBe(true);
        expect(shape.footGround, 'the footer is drawn on the dialog’s ground').toBe('rgba(0, 0, 0, 0)');
        expect(shape.wide, JSON.stringify(shape.wide)).toStrictEqual([]);
        // IN THE PATTERN: the window is built of its sections or rows, not a layout of its own. Help and Shortcuts are
        // a list and a table inside the pattern's scroll, so the scroll is what is asked of them.
        if (tool.name === 'Help' || tool.name === 'Keyboard shortcuts') {
          await expect(dialog.locator('.m-dialog-scroll')).toHaveCount(1);
        } else {
          expect(shape.sections).toBeGreaterThan(0);
        }

        const results = await new AxeBuilder({ page }).include('.m-dialog').analyze();
        const blocking = results.violations.filter((violation) => BLOCKING.has(String(violation.impact)));
        expect(blocking, blocking.map((violation) => `${String(violation.impact)}: ${violation.id} — ${violation.help}`).join('\n')).toEqual(
          [],
        );
      });
    }
  }
}

// FOCUS FOLLOWS HELP'S VIEW in a real browser, where the pressed control is removed under the dialog's focus manager:
// Enter on an article opens it on its heading, and Enter on Back returns to the search field rather than the popup.
test('Help: Enter opens an article on its heading, and Back returns focus to the search field', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeUnder(page, LOOKS[0]);
  await page.goto('/');
  await startScreenListening(page);
  await page.keyboard.press('F1');
  const dialog = page.getByRole('dialog', { name: 'Help centre' });
  await expect(dialog).toBeFocused();
  await dialog.locator('[data-article]').first().focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading', { level: 3 }).first()).toBeFocused();
  await dialog.getByRole('button', { name: 'Back to the list' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('textbox', { name: 'Search help' })).toBeFocused();
});

// A LONG LIST SCROLLS UNDER THE FOOTER rather than carrying it away: the shortcuts table is longer than any window,
// so its scroll region is what moves, and the footer and the title bar stay where they are.
test('a long list scrolls inside the window while its footer and title stay in view (Keyboard shortcuts)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await bridgeUnder(page, LOOKS[0]);
  await page.goto('/');
  await startScreenListening(page);
  await page.keyboard.press('Control+Slash');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  const before = await dialog.locator('.m-dialog-footer').boundingBox();
  const scroll = dialog.locator('.m-dialog-scroll');
  const reach = await scroll.evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight }));
  // CONTROL: the list IS longer than its region, so the scroll below is a scroll and not a no-op.
  expect(reach.content).toBeGreaterThan(reach.height + 100);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  expect(await dialog.locator('.m-dialog-footer').boundingBox()).toStrictEqual(before);
  // THE FOOTER'S OWN CLOSE: the list is read-only here (ADR-0191), and Reset all is Settings'.
  await expect(dialog.locator('.m-dialog-footer').getByRole('button', { name: 'Close' })).toBeInViewport();
});
