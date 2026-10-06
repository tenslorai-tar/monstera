import { type Page, expect, test } from '@playwright/test';

import { SAMPLE_DOC_ID, openApp, openDocument, runCommand } from './helpScreensHarness.js';

/**
 * A dialog asked while another is open WAITS for it (CR-COR-08), through the real application on the pinned Chromium.
 *
 * The finding's own trigger: Delete pages is open with a page range typed, the autosave timer fires, the shim refuses
 * the save, and the save's problem is asked over the open dialog. The host used to give the slot to the latest ask, so
 * Delete pages vanished under the typing and its command heard a cancel. `DialogHost.test.tsx` holds the queue's rules;
 * this holds the path from a timer to the host, and the one thing happy-dom cannot say — that the dialog which waited
 * opens as a dialog of its own, with the focus in it.
 */

/** Waits until the page has run what follows the save's answer: a round trip through the bridge queued behind it. */
async function pastTheSave(page: Page, saves: () => number): Promise<void> {
  await expect.poll(saves).toBeGreaterThan(0);
  for (let round = 0; round < 2; round += 1) {
    await page.evaluate(() =>
      (window as unknown as { __monsteraInvoke: (channel: string, params: unknown) => Promise<unknown> }).__monsteraInvoke(
        'settings.load',
        {},
      ),
    );
  }
  // AND A COMMIT: React renders from a message posted after the ask, so one posted after that arrives after it.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          done();
        };
        channel.port2.postMessage(0);
      }),
  );
}

test('a refused autosave WAITS behind an open dialog, which keeps what was typed, then opens as its own', async ({ page }) => {
  await page.clock.install();
  let saves = 0;
  await openApp(
    page,
    {
      settings: { 'saving.autosave': '1min' },
      saveRefusals: new Map([[SAMPLE_DOC_ID, 'write-failed']]),
    },
    (channel) => {
      if (channel === 'document.save') saves += 1;
    },
  );
  await openDocument(page);
  // AN EDIT, so the timer has a document to save.
  await runCommand(page, 'Rotate page');
  await runCommand(page, 'Delete pages…');
  const deleting = page.getByRole('dialog', { name: 'Delete pages' });
  await expect(deleting).toBeVisible();
  const range = deleting.getByRole('textbox', { name: 'Pages to delete' });
  await range.fill('2-3');

  await page.clock.fastForward(65_000);
  await pastTheSave(page, () => saves);
  // THE LOAD-BEARING LINES: the save was refused and its problem asked, and the dialog being answered is still the one
  // showing, with what was typed.
  expect(saves).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(deleting).toBeVisible();
  await expect(range).toHaveValue('2-3');
  await expect(range).toBeFocused();

  await deleting.getByRole('button', { name: 'Cancel' }).click();
  // THEN THE ONE THAT WAITED, with no further tick of the clock: it was asked while Delete pages was open.
  const problem = page.getByRole('dialog', { name: 'The document was not saved' });
  await expect(problem).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect.poll(() => problem.evaluate((popup) => popup.contains(document.activeElement))).toBe(true);
  await problem.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
