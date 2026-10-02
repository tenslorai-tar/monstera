import { asDocId, asDocVersion, channels, contrast } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { bridge } from './pageBridge.js';

/**
 * The Assistant pane as the owner's review of 0.1.6.0 redrew it, measured in a real browser: Context and Sources
 * on one row, the conversation as a chat with the person's messages at the right, New chat a "+" at the top right,
 * and a message box that is two lines tall, grows to three and then scrolls. happy-dom lays nothing out, so every
 * one of these is a box only a browser can measure.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000a9');

async function openPane(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const bytes = await blockedPages([612, 792], 1);
  await bridge(page, {
    opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'chat.pdf' }],
    documentBytes: new Map([[DOC, bytes]]),
    settings: {
      'appearance.context-panel-open': true,
      'appearance.context-panel-tab': 'assistant',
      'ai.save-history': true,
      ...settings,
    },
    // A SAVED CONVERSATION, so the chat is on screen without a provider to ask.
    aiHistory: {
      turns: [
        { role: 'user', text: 'What is this page about?' },
        { role: 'assistant', text: 'It is a page with a black square in its middle.' },
      ],
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-assistant__turn')).toHaveCount(2, { timeout: 10_000 });
}

test('CONTEXT and SOURCES each read their choice and value, whole and inside the pane', async ({ page }) => {
  await openPane(page);
  const faces = page.locator('.m-assistant [data-choice-menu]');
  await expect(faces).toHaveCount(2);
  expect(await faces.allTextContents()).toStrictEqual(['Choose context: Page 1', 'Choose sources: Document only']);
  // ONE ROW NO LONGER: at the pane's default width the row is 306 px and the two faces need 381 (measured 2026-10-02
  // at 1280 × 800), so Sources wraps under Context. What must hold either way is that each face lies inside the row
  // and shows every word it reads.
  const fit = await page.evaluate(() => {
    const row = document.querySelector('.m-assistant__choices')?.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.m-assistant [data-choice-menu]')].map((face) => {
      const box = face.getBoundingClientRect();
      return {
        inside: row !== undefined && box.left >= row.left - 0.5 && box.right <= row.right + 0.5,
        whole: face.scrollWidth <= face.clientWidth,
      };
    });
  });
  expect(fit).toStrictEqual([
    { inside: true, whole: true },
    { inside: true, whole: true },
  ]);
  // NO EXPLANATORY HINT is drawn under the box: the Enter line is a description for a screen reader only, so it is
  // present and occupies no more than the one clipped pixel `.m-visually-hidden` leaves.
  const hint = page.getByText('Enter sends. Shift+Enter starts a new line.');
  await expect(hint).toHaveCount(1);
  const drawn = await hint.boundingBox();
  expect((drawn?.width ?? 0) <= 1 && (drawn?.height ?? 0) <= 1).toBe(true);
  expect(await page.getByLabel('Ask about this document').getAttribute('aria-describedby')).toBe(await hint.getAttribute('id'));
});

test('the CHAT: the person’s message at the right in a filled bubble, the answer at the left, the text at 13 px', async ({ page }) => {
  await openPane(page);
  const shape = await page.evaluate(() => {
    const list = document.querySelector('.m-assistant__turns')?.getBoundingClientRect();
    const user = document.querySelector<HTMLElement>('.m-assistant__turn[data-assistant-role="user"]');
    const answer = document.querySelector<HTMLElement>('.m-assistant__turn[data-assistant-role="assistant"]');
    if (list === undefined || user === null || answer === null) return null;
    const u = user.getBoundingClientRect();
    const a = answer.getBoundingClientRect();
    return {
      userRightGap: Math.round(list.right - u.right),
      userLeftGap: Math.round(u.left - list.left),
      userFill: getComputedStyle(user).backgroundColor,
      answerLeftGap: Math.round(a.left - list.left),
      size: getComputedStyle(user.querySelector('.m-assistant__text') ?? user).fontSize,
    };
  });
  expect(shape).not.toBeNull();
  expect(shape?.userRightGap).toBeLessThanOrEqual(1);
  expect(shape?.userLeftGap).toBeGreaterThan(20);
  expect(shape?.userFill).not.toBe('rgba(0, 0, 0, 0)');
  expect(shape?.answerLeftGap).toBeLessThanOrEqual(1);
  expect(shape?.size).toBe('13px');
});

// A DEEP BLUE wants light text and an AMBER dark text, so a stored text colour fails one of them: each case asserting
// its own direction is what shows the text is derived where it is drawn rather than kept.
for (const [accent, wants] of [
  ['#1d4ed8', 'lighter'],
  ['#f59e0b', 'darker'],
] as const) {
  test(`a person’s bubble FOLLOWS THE ACCENT ${accent}, with text solved ${wants} than it`, async ({ page }) => {
    await openPane(page, { 'appearance.accent': accent });
    const drawn = await page.evaluate(() => {
      const user = document.querySelector<HTMLElement>('.m-assistant__turn[data-assistant-role="user"]');
      if (user === null) return null;
      // THE ACCENT IN EFFECT, read as a colour the way the bubble's background is, so the two compare as equals.
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--accent)';
      user.append(probe);
      const accentColour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { fill: getComputedStyle(user).backgroundColor, text: getComputedStyle(user).color, accentColour };
    });
    if (drawn === null) throw new Error('a person’s turn');
    expect(drawn.fill, accent).toBe(drawn.accentColour);
    const fill = channels(drawn.fill);
    const text = channels(drawn.text);
    if (fill === null || text === null) throw new Error(`colours that parse: ${drawn.fill} and ${drawn.text}`);
    expect(contrast(text, fill), `${drawn.text} on ${drawn.fill}`).toBeGreaterThanOrEqual(4.5);
    const brightness = ([r, g, b]: readonly number[]): number => (r ?? 0) + (g ?? 0) + (b ?? 0);
    expect(brightness(text) > brightness(fill) ? 'lighter' : 'darker', `${drawn.text} on ${drawn.fill}`).toBe(wants);
  });
}

test('NEW CHAT is a "+" at the top right of the pane', async ({ page }) => {
  await openPane(page);
  const plus = page.getByRole('button', { name: 'New chat' });
  await expect(plus).toBeVisible();
  expect((await plus.textContent())?.trim()).toBe('');
  const box = await plus.boundingBox();
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('.m-assistant');
    const list = document.querySelector('.m-assistant__turns');
    if (pane === null || list === null) return null;
    const style = getComputedStyle(pane);
    return {
      innerRight: pane.getBoundingClientRect().right - Number.parseFloat(style.paddingRight),
      listTop: list.getBoundingClientRect().top,
    };
  });
  if (box === null || geometry === null) throw new Error('the button and the pane have boxes');
  expect(geometry.innerRight - (box.x + box.width)).toBeLessThanOrEqual(1);
  expect(box.y + box.height).toBeLessThanOrEqual(geometry.listTop);
});

test('the MESSAGE BOX is two lines tall, grows to three, then scrolls', async ({ page }) => {
  await openPane(page);
  const box = page.getByLabel('Ask about this document');
  const measure = (): Promise<{ height: number; line: number; scrolls: boolean }> =>
    box.evaluate((element) => {
      const style = getComputedStyle(element);
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      return {
        height: element.clientHeight - padding,
        line: Number.parseFloat(style.lineHeight),
        scrolls: element.scrollHeight > element.clientHeight,
      };
    });

  const empty = await measure();
  expect(Math.round(empty.height / empty.line)).toBe(2);
  await box.fill('one line');
  expect(Math.round((await measure()).height / empty.line)).toBe(2);
  await box.fill('one\ntwo\nthree');
  const three = await measure();
  expect(Math.round(three.height / empty.line)).toBe(3);
  expect(three.scrolls).toBe(false);
  await box.fill('one\ntwo\nthree\nfour\nfive\nsix');
  const six = await measure();
  expect(Math.round(six.height / empty.line)).toBe(3);
  expect(six.scrolls).toBe(true);
});
