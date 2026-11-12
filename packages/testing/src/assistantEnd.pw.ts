import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { asksHeard, converse } from './assistantConverse.js';
import { blockedPages } from './blockedPages.js';
import { documentDrawn } from './documentDrawn.js';
import { bridge } from './pageBridge.js';

/**
 * A CONVERSATION AT ITS END STAYS AT ITS END WHEN THE PANE'S HEIGHT CHANGES; one the person scrolled up stays where they
 * put it (`useEndKept`). The status bar arriving once a document's pages are known took 36 px from the pane after a
 * scroll to the end, and the last turn's buttons went out of view below it (the assistant pane's visual case,
 * 2026-10-31). Any height change does the same, so the cases change the height two ways and never through the status
 * bar: a 36 px row added below the conversation, and the window made 36 px shorter.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c7');

/** Thirty-two questions and their answers, sixty-four turns: far more than the pane shows. */
const EXCHANGES = Array.from({ length: 32 }, (_, at) => ({ question: `Question ${String(at + 1)}?`, answer: 'An answer.' }));

/** How far a box may sit past the list's bottom edge and still be wholly in view: a layout rounds to a fraction. */
const ROUNDING = 0.5;

async function openConversation(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const bytes = await blockedPages([612, 792], 1);
  const asks = asksHeard();
  await bridge(
    page,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'chat.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      settings: { 'appearance.context-panel-open': true, 'appearance.context-panel-tab': 'assistant', 'ai.save-history': true },
      secrets: { 'ai.anthropic-key': 'a-fixture-key' },
      aiModels: { source: 'fetched', models: [{ id: 'fixture-model', label: 'Fixture', capabilities: { vision: null, streaming: null } }] },
      aiAskStarts: true,
    },
    asks.observe,
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  // THE WINDOW SETTLED FIRST, so the height changes below are the cases' own and not the status bar arriving.
  await documentDrawn(page);
  const pane = page.locator('.m-assistant');
  await converse(page, pane, asks.latest, EXCHANGES);
  const list = page.locator('.m-assistant__turns');
  await expect(list.locator('.m-assistant__turn')).toHaveCount(EXCHANGES.length * 2);
  return list;
}

/** How far the last turn's last button reaches past the list's bottom edge; zero or less is wholly in view. */
function lastButtonOverhang(list: Locator): Promise<number> {
  return list.evaluate((element) => {
    const buttons = element.querySelectorAll('.m-assistant__turn:last-child button');
    const last = buttons.item(buttons.length - 1);
    return last.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
  });
}

function scrollTo(list: Locator, where: 'end' | 'middle'): Promise<number> {
  return list.evaluate((element, at) => {
    element.scrollTop = at === 'end' ? element.scrollHeight : element.scrollHeight / 2;
    return element.scrollTop;
  }, where);
}

/**
 * A row added below the conversation inside the pane, as a panel opening below it would, sized so the list loses
 * exactly 36 px: the pane is a flex column whose gap comes with the row, so the row is 36 less that gap.
 */
function rowBelow(list: Locator): Promise<number> {
  return list.evaluate((element) => {
    const before = element.clientHeight;
    const gap = Number.parseFloat(getComputedStyle(element.parentElement ?? element).rowGap) || 0;
    const row = document.createElement('div');
    row.style.blockSize = `${String(36 - gap)}px`;
    row.style.flex = 'none';
    element.after(row);
    return before - element.clientHeight;
  });
}

test('a conversation at its end keeps its last turn in view when a row below takes 36 px', async ({ page }) => {
  const list = await openConversation(page);
  await scrollTo(list, 'end');
  expect(await lastButtonOverhang(list)).toBeLessThanOrEqual(ROUNDING);
  expect(await rowBelow(list), 'the row made the list 36 px shorter').toBe(36);
  await expect.poll(() => lastButtonOverhang(list)).toBeLessThanOrEqual(ROUNDING);
});

test('a conversation at its end keeps its last turn in view when the window is made 36 px shorter', async ({ page }) => {
  const list = await openConversation(page);
  await scrollTo(list, 'end');
  const before = await list.evaluate((element) => element.clientHeight);
  await page.setViewportSize({ width: 1440, height: 864 });
  await expect.poll(() => list.evaluate((element) => element.clientHeight)).toBe(before - 36);
  await expect.poll(() => lastButtonOverhang(list)).toBeLessThanOrEqual(ROUNDING);
});

test('CONTROL: a conversation the person scrolled up stays where they put it when the height changes', async ({ page }) => {
  const list = await openConversation(page);
  const put = await scrollTo(list, 'middle');
  expect(await lastButtonOverhang(list), 'the middle is not the end').toBeGreaterThan(36);
  expect(await rowBelow(list)).toBe(36);
  // TWO FRAMES, so a ResizeObserver callback has run before the position is read.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await list.evaluate((element) => element.scrollTop)).toBe(put);
});
