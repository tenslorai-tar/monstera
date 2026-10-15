import { asDocId, asDocVersion } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { SELECT_TOOL, armTool, samplePdf } from './helpScreensHarness.js';
import { LOOKS, bridgeUnder } from './pageBridge.js';

/**
 * A link under the pointer, in every tool (the owner's E1, 2026-10-14, the reviewer's decision): the pointer is a hand
 * and a tooltip says where the link goes; a plain click follows it where the page is being read (Hand, selecting
 * text, no tool); where a click edits links or draws, a click is the tool's and Ctrl+click follows. A web link always
 * asks first. Measured against 0.1.15.0's code before the fix: in the Comment section with Select, and in the Home
 * section with a tool left on, the drawing overlay covered every link, so the pointer stayed an arrow and no click
 * reached it.
 */

const ID = asDocId('00000000-0000-4000-8000-0000000000e1');
/** Display space at scale 1 on the sample's first page: over its title line, and over its first body line. */
const TO_PAGE_TWO = { kind: 'internal' as const, page: 1, bounds: { x0: 72, y0: 70, x1: 400, y1: 96 } };
const TO_WEB = { kind: 'external' as const, uri: 'https://example.org/annual-report', bounds: { x0: 72, y0: 120, x1: 500, y1: 136 } };

type Sent = { channel: string; params: unknown }[];

async function openWithLinks(page: Page, section: 'home' | 'comment', sent: Sent): Promise<{ x: (at: number) => number; y: (at: number) => number }> {
  const bytes = await samplePdf();
  await page.setViewportSize({ width: 1280, height: 860 });
  await bridgeUnder(
    page,
    LOOKS[0],
    {
      opens: [{ kind: 'opened' as const, docId: ID, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'Links.pdf' }],
      documentBytes: new Map([[ID, bytes]]),
      pageLinks: [[TO_PAGE_TWO, TO_WEB]],
      settings: { 'appearance.ribbon-section': section },
    },
    (channel, params) => {
      sent.push({ channel, params });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: /^Open PDF/u }).first().click();
  await expect(page.locator('[data-link-layer="0"] [data-page-link="1"]')).toBeAttached();
  const slot = await page.locator('.m-page-slot').first().boundingBox();
  if (slot === null) throw new Error('the first page has no box');
  const scale = slot.width / 612;
  return { x: (at) => slot.x + at * scale, y: (at) => slot.y + at * scale };
}

const opened = (sent: Sent): unknown[] => sent.filter((call) => call.channel === 'document.openLink').map((call) => call.params);

/** The hover's words, the pointer over the page at `x`, `y`, and the cursor the page shows there. */
async function hoverAt(page: Page, x: number, y: number): Promise<{ tip: string; cursor: string }> {
  await page.mouse.move(x, y);
  const tip = page.locator('[data-link-hover]');
  await expect(tip).toBeVisible();
  const cursor = await page.evaluate(([px, py]) => {
    const under = document.elementFromPoint(px ?? 0, py ?? 0);
    return under === null ? '' : getComputedStyle(under).cursor;
  }, [x, y]);
  return { tip: (await tip.textContent()) ?? '', cursor };
}

test('reading, with no tool: a hand and where it goes, and a plain click follows a page link', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'home', sent);
  expect(await hoverAt(page, at.x(200), at.y(83))).toStrictEqual({ tip: 'Go to page 2', cursor: 'pointer' });
  await page.mouse.click(at.x(200), at.y(83));
  await expect(page.locator('[data-goto-input="true"]')).toHaveValue('2');
});

test('the Hand tool: a plain click on a link follows it', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'home', sent);
  const hand = page.getByRole('button', { name: 'Hand', exact: true }).first();
  await hand.click();
  await expect(hand).toHaveAttribute('aria-pressed', 'true');
  expect((await hoverAt(page, at.x(200), at.y(83))).tip).toBe('Go to page 2');
  await page.mouse.click(at.x(200), at.y(83));
  await expect(page.locator('[data-goto-input="true"]')).toHaveValue('2');
});

test('Select in Comment: the hover says Ctrl+click follows, a click selects, and Ctrl+click goes to the page', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'comment', sent);
  await armTool(page, 'Select', SELECT_TOOL);
  expect(await hoverAt(page, at.x(200), at.y(83))).toStrictEqual({ tip: 'Go to page 2 · Ctrl+click to follow', cursor: 'pointer' });
  await page.mouse.click(at.x(200), at.y(83));
  await expect(page.locator('[data-selection-kind="link"] [data-selection-handle]')).toHaveCount(8);
  // CONTROL: the plain click selected and went nowhere.
  await expect(page.locator('[data-goto-input="true"]')).toHaveValue('1');
  await page.keyboard.down('Control');
  await page.mouse.click(at.x(200), at.y(83));
  await page.keyboard.up('Control');
  await expect(page.locator('[data-goto-input="true"]')).toHaveValue('2');
});

test('a tool left on from Comment, back in Home: the links still answer the pointer', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'comment', sent);
  await armTool(page, 'Select', SELECT_TOOL);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home' }).click();
  expect((await hoverAt(page, at.x(280), at.y(128))).cursor).toBe('pointer');
});

test('a web link asks first, with Ctrl+click under Select, and Cancel opens nothing', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'comment', sent);
  await armTool(page, 'Select', SELECT_TOOL);
  expect((await hoverAt(page, at.x(280), at.y(128))).tip).toBe('Open https://example.org/annual-report · Ctrl+click to follow');
  await page.keyboard.down('Control');
  await page.mouse.click(at.x(280), at.y(128));
  await page.keyboard.up('Control');
  const dialog = page.getByRole('dialog', { name: 'Open this link?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  // NOTHING WAS OPENED: no call reached main.
  expect(opened(sent)).toStrictEqual([]);
});

test('Follow link in Properties asks first for a web link, and Open link opens it', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'comment', sent);
  await armTool(page, 'Select', SELECT_TOOL);
  await page.mouse.click(at.x(280), at.y(128));
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByRole('button', { name: 'Follow link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open this link?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open link' }).click();
  await expect.poll(() => opened(sent)).toStrictEqual([{ docId: ID, version: 1, page: 0, index: 1 }]);
});

test('the Links list has its own heading, and each link’s edge on the page is the colour its swatch shows', async ({ page }) => {
  const sent: Sent = [];
  await openWithLinks(page, 'comment', sent);
  await page.getByRole('tab', { name: 'Bookmarks' }).click();
  await expect(page.getByRole('heading', { name: 'Links on this page' })).toBeVisible();
  const swatch = await page.locator('[data-links-colour="1"]').inputValue();
  const edge = await page.locator('[data-link-layer="0"] [data-page-link="1"]').evaluate((element) => getComputedStyle(element).outlineColor);
  // THE WRITER'S DEFAULT, the sample's links giving no /C: #0066cc in the list, the same on the page.
  expect({ swatch, edge }).toStrictEqual({ swatch: '#0066cc', edge: 'rgb(0, 102, 204)' });
});

test('CONTROL: a click on the page beside a link follows nothing, and no hover is shown there', async ({ page }) => {
  const sent: Sent = [];
  const at = await openWithLinks(page, 'home', sent);
  await page.mouse.move(at.x(200), at.y(110));
  await expect(page.locator('[data-link-hover]')).toHaveCount(0);
  await page.mouse.click(at.x(200), at.y(110));
  await expect(page.locator('[data-goto-input="true"]')).toHaveValue('1');
  await expect(page.getByRole('dialog', { name: 'Open this link?' })).toHaveCount(0);
  expect(opened(sent)).toStrictEqual([]);
});
