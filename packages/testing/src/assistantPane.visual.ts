import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { type Exchange, asksHeard, converse } from './assistantConverse.js';
import { blockedPages } from './blockedPages.js';
import { documentDrawn } from './documentDrawn.js';
import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';

/**
 * The Assistant pane's baselines (NEXT-UPDATE item 36): the conversation, the counter near the limit, the sentence over
 * it, a conversation that is full, an answer cut at its bound, and the History of several conversations of one file —
 * in all three looks. Cloud run 26 changed every one of these and the Visual baselines job stayed green because nothing
 * compared the pane; each is now captured on its own, so a change inside it is not diluted by the window's pixel count.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c6');

/** A history key: 64 lowercase hex characters, which `historyKeySchema` takes. */
const key = (digit: string): string => digit.repeat(64);

/** A conversation of `count` exchanges, a question and its answer, each a word or two. */
function exchanges(count: number): Exchange[] {
  return Array.from({ length: count }, (_, at) => ({ question: `Question ${String(at + 1)}?`, answer: 'An answer.' }));
}

/** What a case adds to the pane's setup. */
interface Setup {
  readonly conversations?: readonly { key: string; name: string; savedAt: string; turns: number; preview: string }[];
  /** Chat history switched off. */
  readonly historyOff?: boolean;
}

/**
 * The pane open on `look`, a provider and its model offered (a fixture key no provider sees), and every ask started so a
 * case can converse in it (`converse`). The theme is asserted before anything is captured, so a look that failed to apply
 * cannot match the light screen three times; `observe` hears every call the page makes.
 */
async function openPane(page: Page, look: Look, setup: Setup, observe: (channel: string, params: unknown) => void): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const bytes = await blockedPages([612, 792], 1);
  await bridgeUnder(
    page,
    look,
    {
      opens: [{ kind: 'opened', docId: DOC, version: asDocVersion(1), byteLength: bytes.byteLength, name: 'chat.pdf' }],
      documentBytes: new Map([[DOC, bytes]]),
      settings: { 'appearance.context-panel-open': true, 'appearance.context-panel-tab': 'assistant', 'ai.save-history': setup.historyOff !== true },
      // THE DEFAULT PROVIDER'S KEY (Anthropic), so Send is offered; a fixture no provider sees.
      secrets: { 'ai.anthropic-key': 'a-fixture-key' },
      aiModels: { source: 'fetched', models: [{ id: 'fixture-model', label: 'Fixture', capabilities: { vision: null, streaming: null } }] },
      aiAskStarts: true,
      ...(setup.conversations === undefined ? {} : { aiConversations: [...setup.conversations] }),
    },
    observe,
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const pane = page.locator('.m-context-panel');
  await expect(pane.locator('.m-assistant')).toBeVisible();
  // THE DOCUMENT DRAWN, so the status bar it brings has taken its 36 from the panel before anything is captured.
  await documentDrawn(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // THE POINTER OFF THE PANE, so no control holds a hover or a tooltip that depends on how long the run took.
  await page.mouse.move(400, 450);
  return pane;
}

// ONE PAGE PER CASE: the bridge is installed once per page, so each setup is its own test.
for (const look of LOOKS) {
  test(`${look.name}: the assistant pane's conversation, its counter and the over-limit sentence match their baselines`, async ({ page }) => {
    // THE CONVERSATION, two turns, asked and answered.
    const asks = asksHeard();
    const pane = await openPane(page, look, {}, asks.observe);
    await converse(page, pane, asks.latest, exchanges(1));
    await expect(pane.locator('.m-assistant__turn')).toHaveCount(2);
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-conversation.png`);

    // THE COUNTER, shown from 90% of MAX_CHAT_TEXT (16,384) while there is room.
    const box = pane.getByLabel('Ask about this document');
    await box.fill('x'.repeat(15_000));
    await expect(pane.getByText('15,000 of 16,384 characters')).toBeVisible();
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-counter.png`);

    // OVER THE LIMIT: the sentence, and Send off.
    await box.fill('x'.repeat(16_400));
    await expect(pane.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-over-limit.png`);
  });

  test(`${look.name}: a long conversation's note matches its baseline`, async ({ page }) => {
    // 32 QUESTIONS, which carries on with a recommendation since ADR-0277's correction of 2026-10-31.
    const asks = asksHeard();
    const pane = await openPane(page, look, {}, asks.observe);
    await converse(page, pane, asks.latest, exchanges(32));
    await expect(pane.getByText('This conversation is now long. We recommend starting a new chat to save cost.')).toBeVisible();
    await pane.locator('.m-assistant__turn').last().scrollIntoViewIfNeeded();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-long.png`);
  });

  // WITH HISTORY OFF THE PANE SAYS NOTHING OF IT (the owner, 2026-11-12, ADR-0279's correction): the baseline is the pane
  // with a conversation and no line about history.
  test(`${look.name}: with history off, the pane carries no line about it and matches its baseline`, async ({ page }) => {
    // WITH HISTORY OFF NOTHING LOADS, so the conversation is asked here and its answer streamed in.
    const asks = asksHeard();
    const pane = await openPane(page, look, { historyOff: true }, asks.observe);
    await converse(page, pane, asks.latest, [{ question: 'Who signs?', answer: 'Both parties sign on page 4.' }]);
    await expect(pane.getByText('Both parties sign on page 4.')).toBeVisible();
    await expect(pane.getByText(/history is off/iu)).toHaveCount(0);
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-history-off.png`);
  });

  test(`${look.name}: an answer cut at its bound matches its baseline`, async ({ page }) => {
    // AN ANSWER CUT AT MAX_ANSWER_TEXT: started by the shim, streamed in as main streams it, ended `answer-cut`.
    const asks = asksHeard();
    const pane = await openPane(page, look, {}, asks.observe);
    await converse(page, pane, asks.latest, [{ question: 'Summarise', answer: 'The answer as far as it went.', refusal: 'answer-cut' }]);
    await expect(pane.locator('.m-assistant__turn')).toHaveCount(2);
    await expect(pane.getByRole('button', { name: 'Send' })).toBeVisible();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-answer-cut.png`);
  });

  test(`${look.name}: the History of several conversations of one file matches its baseline`, async ({ page }) => {
    // THE HISTORY: three conversations of the open file, newest first. History lists the open PDF's alone (ADR-0279), so
    // no other file's conversation is offered here.
    const asks = asksHeard();
    const pane = await openPane(
      page,
      look,
      {
        conversations: [
          { key: key('1'), name: 'chat.pdf', savedAt: '2026-10-30T09:00:00.000Z', turns: 4, preview: 'What is this page about?' },
          { key: key('2'), name: 'chat.pdf', savedAt: '2026-10-29T15:30:00.000Z', turns: 2, preview: 'Summarise the second section.' },
          { key: key('3'), name: 'chat.pdf', savedAt: '2026-10-28T11:15:00.000Z', turns: 6, preview: 'Which dates does it name?' },
        ],
      },
      asks.observe,
    );
    // THE CONVERSATION ON SCREEN BEHIND IT, asked and answered.
    await converse(page, pane, asks.latest, exchanges(1));
    await pane.getByRole('button', { name: 'History', exact: true }).click();
    await expect(pane.getByText('Summarise the second section.', { exact: false })).toBeVisible();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-history.png`);
  });
}
