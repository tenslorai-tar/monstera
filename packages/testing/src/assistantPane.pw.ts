import { asDocId, asDocVersion, channels, contrast } from '@monstera/shared';
import { type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { LOOKS, type Look, bridge, bridgeUnder } from './pageBridge.js';

/**
 * The Assistant pane as the owner's review of 0.1.6.0 redrew it, measured in a real browser: Context and Sources
 * on one row, the conversation as a chat with the person's messages at the right, New chat a "+" at the top right,
 * and a message box that is two lines tall, grows to three and then scrolls. happy-dom lays nothing out, so every
 * one of these is a box only a browser can measure.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000a9');

/**
 * The pane open on a saved conversation. Under a `look` it is bridged by `bridgeUnder` — the media and the theme
 * setting as the one pair, never applied by hand here — and the theme is asserted before anything is measured, so a
 * look that failed to apply cannot test the light screen three times.
 */
async function openPane(
  page: Page,
  settings: Record<string, unknown> = {},
  viewport: { readonly width: number; readonly height: number } = { width: 1440, height: 900 },
  look?: Look,
): Promise<void> {
  await page.setViewportSize(viewport);
  const bytes = await blockedPages([612, 792], 1);
  const options = {
    opens: [{ kind: 'opened' as const, docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'chat.pdf' }],
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
        { role: 'user' as const, text: 'What is this page about?' },
        { role: 'assistant' as const, text: 'It is a page with a black square in its middle.' },
      ],
    },
  };
  if (look === undefined) await bridge(page, options);
  else await bridgeUnder(page, look, options);
  await page.goto('/');
  if (look !== undefined) await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await expect(page.locator('.m-assistant__turn')).toHaveCount(2, { timeout: 10_000 });
}

// *CHOOSE*, CONTEXT, SOURCES — ONE ROW at the pane's default width, in every look (the owner, 2 October). The pane is
// at its default width because nothing has resized it, and 1280 × 800 is the smallest window this suite lays screens
// out at, so it is the narrowest default the row meets.
for (const look of LOOKS) {
  test(`${look.name}: CHOOSE, then CONTEXT and SOURCES by NAME, on ONE row across the pane`, async ({ page }) => {
    await openPane(page, {}, { width: 1280, height: 800 }, look);
    const faces = page.locator('.m-assistant [data-choice-menu]');
    await expect(faces).toHaveCount(2);
    // THE NAMES, NOT THE VALUES (the owner's review of 0.1.9.0): *Choose · Context · Sources*.
    expect(await faces.allTextContents()).toStrictEqual(['Context', 'Sources']);
    await expect(page.getByRole('group', { name: 'Choose' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Context: Page 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sources: Document only' })).toBeVisible();
    const row = await page.evaluate(() => {
      const group = document.querySelector('.m-assistant__choices');
      const box = group?.getBoundingClientRect();
      const parts = [...(group?.children ?? [])].map((part) => part.getBoundingClientRect());
      return {
        // ONE ROW: every part's vertical middle within a pixel of the first's. A wrapped part sits a whole control
        // lower, about 24 px, so the tolerance cannot hide one.
        middles: parts.map((part) => Math.round(part.top + part.height / 2)),
        inside: box !== undefined && parts.every((part) => part.left >= box.left - 0.5 && part.right <= box.right + 0.5),
        whole: [...document.querySelectorAll<HTMLElement>('.m-assistant [data-choice-menu]')].every(
          (face) => face.scrollWidth <= face.clientWidth,
        ),
        // SPREAD ACROSS THE ROW, not bunched at its start: the last part ends at the row's end.
        endGap: box === undefined ? Number.NaN : Math.round(box.right - Math.max(...parts.map((part) => part.right))),
        count: parts.length,
      };
    });
    expect(row.count).toBe(3);
    const first = row.middles[0] ?? Number.NaN;
    expect(row.middles.every((middle) => Math.abs(middle - first) <= 1), JSON.stringify(row.middles)).toBe(true);
    expect(row.inside).toBe(true);
    expect(row.whole).toBe(true);
    expect(row.endGap).toBeLessThanOrEqual(1);
  });
}

test('an OPEN choice menu is headed by its name, then its values with the chosen one marked', async ({ page }) => {
  // STILL, so the boxes are where they settle rather than where the popup's entrance has them.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPane(page);
  await page.getByRole('button', { name: 'Context: Page 1' }).click();
  const group = page.getByRole('group', { name: 'Context' });
  await expect(group).toBeVisible();
  const items = group.getByRole('menuitemradio');
  expect(await items.allTextContents()).toStrictEqual(['Page 1', 'Document', 'Comments', 'Picture', 'None']);
  await expect(items.first()).toHaveAttribute('aria-checked', 'true');
  // THE HEADING IS ABOVE THE FIRST VALUE, drawn, not only a name — both read in one moment, so a popup still being
  // placed cannot move one between the two readings.
  const order = await group.evaluate((element) => {
    const heading = element.querySelector('.m-choice-menu__heading')?.getBoundingClientRect();
    const first = element.querySelector('[role="menuitemradio"]')?.getBoundingClientRect();
    return heading === undefined || first === undefined ? null : { headingBottom: heading.bottom, firstTop: first.top, text: element.querySelector('.m-choice-menu__heading')?.textContent };
  });
  expect(order?.text).toBe('Context');
  expect(order?.headingBottom ?? Infinity).toBeLessThanOrEqual((order?.firstTop ?? 0) + 0.5);
});

// AT EVERY WIDTH THE PANE ALLOWS (the owner's review of 0.1.9.0, where Send was pushed out of the box and the box
// scrolled sideways): nothing in the pane extends past it or scrolls sideways, the paperclip, the text and Send are
// inside the box, and the provider and model are a row UNDER it. 216 is the pane's floor, 340 its default and 1600 its
// ceiling, which a 1600 px window holds to what the page area leaves. The old foot pushed Send out at 340, so the
// default is a case that separates, and a long unbroken line typed into the box is in every case, because a text box
// that sizes to its content can widen itself.
for (const width of [216, 340, 1600]) {
  test(`at a ${String(width)} px pane the message box holds the paperclip, the text and Send, and nothing overflows`, async ({
    page,
  }) => {
    await openPane(page, { 'appearance.context-panel-width': width }, { width: 1600, height: 900 });
    await page.getByLabel('Ask about this document').fill('x'.repeat(400));
    const shape = await page.evaluate(() => {
      const pane = document.querySelector('.m-assistant');
      const box = document.querySelector('.m-assistant__composer');
      const models = document.querySelector('[data-assistant-models]');
      if (pane === null || box === null) return null;
      const p = pane.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const within = (selector: string): boolean => {
        const r = box.querySelector(selector)?.getBoundingClientRect();
        return r !== undefined && r.width > 0 && r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom;
      };
      const past = [...pane.querySelectorAll<HTMLElement>('*')]
        .filter((element) => element.closest('.m-visually-hidden') === null)
        .filter((element) => {
          const r = element.getBoundingClientRect();
          return (r.width > 0 && (r.right > p.right + 0.5 || r.left < p.left - 0.5)) || element.scrollWidth > element.clientWidth + 1;
        })
        .map((element) => element.className);
      return {
        paneWidth: Math.round(p.width),
        past,
        paperclip: within('button[aria-label="Attach files"]'),
        text: within('textarea'),
        send: within('button[aria-label="Send"]'),
        modelsBelow: models !== null && models.getBoundingClientRect().top >= b.bottom,
        pickersInBox: box.querySelectorAll('select').length,
      };
    });
    expect(shape).not.toBeNull();
    // THE PANE IS AT THE WIDTH ASKED, less its 1 px border each side — or, at the ceiling, as wide as the window lets it.
    if (width < 1600) expect(shape?.paneWidth).toBe(width - 2);
    else expect(shape?.paneWidth).toBeGreaterThan(500);
    expect(shape?.past, JSON.stringify(shape?.past)).toStrictEqual([]);
    expect(shape?.paperclip).toBe(true);
    expect(shape?.text).toBe(true);
    expect(shape?.send).toBe(true);
    expect(shape?.modelsBelow).toBe(true);
    expect(shape?.pickersInBox).toBe(0);
  });
}

test('the message box carries its Enter hint for a screen reader only', async ({ page }) => {
  await openPane(page);
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
// its own direction is what shows the text is derived where it is drawn rather than kept. IN EVERY LOOK, at that look's
// own text floor — 7:1 under high contrast, which clears a person's accent for the theme's, so the direction is asserted
// only where the chosen accent is the one drawn.
for (const look of LOOKS) {
  for (const [accent, wants] of [
    ['#1d4ed8', 'lighter'],
    ['#f59e0b', 'darker'],
  ] as const) {
    test(`${look.name}: a person’s bubble FOLLOWS THE ACCENT in effect under ${accent}, its text solved to the look’s floor`, async ({
      page,
    }) => {
      await openPane(page, { 'appearance.accent': accent }, undefined, look);
      const drawn = await page.evaluate(() => {
        const user = document.querySelector<HTMLElement>('.m-assistant__turn[data-assistant-role="user"]');
        if (user === null) return null;
        // THE ACCENT IN EFFECT, read as a colour the way the bubble's background is, so the two compare as equals.
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--accent)';
        user.append(probe);
        const accentColour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          fill: getComputedStyle(user).backgroundColor,
          text: getComputedStyle(user).color,
          accentColour,
          // A PERSON'S ACCENT IS WRITTEN ON THE ROOT (`applyAccent`), and cleared there under high contrast.
          personsAccent: document.documentElement.style.getPropertyValue('--accent'),
        };
      });
      if (drawn === null) throw new Error('a person’s turn');
      expect(drawn.fill, accent).toBe(drawn.accentColour);
      const fill = channels(drawn.fill);
      const text = channels(drawn.text);
      if (fill === null || text === null) throw new Error(`colours that parse: ${drawn.fill} and ${drawn.text}`);
      const floor = look.name === 'hc' ? 7 : 4.5;
      expect(contrast(text, fill), `${drawn.text} on ${drawn.fill}`).toBeGreaterThanOrEqual(floor);
      if (look.name === 'hc') {
        // CLEARED: the theme's accent is the one drawn, so the person's is not on the root.
        expect(drawn.personsAccent).toBe('');
      } else {
        expect(drawn.personsAccent).not.toBe('');
        const brightness = ([r, g, b]: readonly number[]): number => (r ?? 0) + (g ?? 0) + (b ?? 0);
        expect(brightness(text) > brightness(fill) ? 'lighter' : 'darker', `${drawn.text} on ${drawn.fill}`).toBe(wants);
      }
    });
  }
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
