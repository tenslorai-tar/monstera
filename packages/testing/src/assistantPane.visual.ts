import { asDocId, asDocVersion } from '@monstera/shared';
import { type Locator, type Page, expect, test } from '@playwright/test';

import { blockedPages } from './blockedPages.js';
import { LOOKS, type Look, bridgeUnder, pushEvent } from './pageBridge.js';

/**
 * The Assistant pane's baselines (NEXT-UPDATE item 36): the conversation, the counter near the limit, the sentence over
 * it, a conversation that is full, an answer cut at its bound, and the History of several conversations of one file —
 * in all three looks. Cloud run 26 changed every one of these and the Visual baselines job stayed green because nothing
 * compared the pane; each is now captured on its own, so a change inside it is not diluted by the window's pixel count.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c6');

/** A history key: 64 lowercase hex characters, which `historyKeySchema` takes. */
const key = (digit: string): string => digit.repeat(64);

/** A conversation of `count` turns, a question and its answer in turn, each a word or two. */
function turns(count: number): { role: 'user' | 'assistant'; text: string }[] {
  return Array.from({ length: count }, (_, at) =>
    at % 2 === 0 ? { role: 'user' as const, text: `Question ${String(at / 2 + 1)}?` } : { role: 'assistant' as const, text: 'An answer.' },
  );
}

/** What a case adds to the pane's setup. */
interface Setup {
  readonly history?: { role: 'user' | 'assistant'; text: string }[];
  readonly asks?: boolean;
  readonly conversations?: readonly { key: string; file: string; name: string; savedAt: string; turns: number; preview: string }[];
  /** Chat history switched off. */
  readonly historyOff?: boolean;
}

/**
 * The pane open on `look`, a provider and its model offered (a fixture key no provider sees), and `setup`'s saved
 * conversation. The theme is asserted before anything is captured, so a look that failed to apply cannot match the
 * light screen three times; `observe` hears every call the page makes.
 */
async function openPane(page: Page, look: Look, setup: Setup, observe?: (channel: string, params: unknown) => void): Promise<Locator> {
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
      ...(setup.history === undefined ? {} : { aiHistory: { conversation: key('a'), turns: setup.history } }),
      ...(setup.asks === true ? { aiAskStarts: true } : {}),
      ...(setup.conversations === undefined ? {} : { aiConversations: [...setup.conversations] }),
    },
    observe,
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  const pane = page.locator('.m-context-panel');
  await expect(pane.locator('.m-assistant')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // THE POINTER OFF THE PANE, so no control holds a hover or a tooltip that depends on how long the run took.
  await page.mouse.move(400, 450);
  return pane;
}

// ONE PAGE PER CASE: the bridge is installed once per page, so each setup is its own test.
for (const look of LOOKS) {
  test(`${look.name}: the assistant pane's conversation, its counter and the over-limit sentence match their baselines`, async ({ page }) => {
    // THE CONVERSATION, two turns.
    const pane = await openPane(page, look, { history: turns(2) });
    await expect(pane.locator('.m-assistant__turn')).toHaveCount(2);
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
    const pane = await openPane(page, look, { history: turns(64) });
    await expect(pane.getByText('This conversation is now long. We recommend starting a new chat to save cost.')).toBeVisible();
    await pane.locator('.m-assistant__turn').last().scrollIntoViewIfNeeded();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-long.png`);
  });

  test(`${look.name}: with history off, the line beside New chat matches its baseline`, async ({ page }) => {
    // WITH HISTORY OFF NOTHING LOADS, so the conversation is asked here and its answer streamed in.
    let subscription: string | undefined;
    const pane = await openPane(page, look, { asks: true, historyOff: true }, (channel, params) => {
      if (channel === 'ai.ask') subscription = (params as { subscription: string }).subscription;
    });
    await pane.getByLabel('Ask about this document').fill('Who signs?');
    await pane.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => subscription).toBeDefined();
    const sent = subscription ?? '';
    await pushEvent(page, 'ai.delta', { subscription: sent, text: 'Both parties sign on page 4.' });
    await pushEvent(page, 'ai.done', { subscription: sent, stopped: false, web: { answer: 'fixture-answer', searched: false, sources: [] } });
    await expect(pane.getByText('History is off, so New chat clears this conversation.')).toBeVisible();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-history-off.png`);
  });

  test(`${look.name}: an answer cut at its bound matches its baseline`, async ({ page }) => {
    // AN ANSWER CUT AT MAX_ANSWER_TEXT: started by the shim, streamed in as main streams it, ended `answer-cut`.
    let subscription: string | undefined;
    const pane = await openPane(page, look, { asks: true }, (channel, params) => {
      if (channel === 'ai.ask') subscription = (params as { subscription: string }).subscription;
    });
    await pane.getByLabel('Ask about this document').fill('Summarise');
    await pane.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => subscription).toBeDefined();
    const sent = subscription ?? '';
    await pushEvent(page, 'ai.delta', { subscription: sent, text: 'The answer as far as it went.' });
    await pushEvent(page, 'ai.done', {
      subscription: sent,
      stopped: false,
      refusal: 'answer-cut',
      web: { answer: 'fixture-answer', searched: false, sources: [] },
    });
    await expect(pane.locator('.m-assistant__turn')).toHaveCount(2);
    await expect(pane.getByRole('button', { name: 'Send' })).toBeVisible();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-answer-cut.png`);
  });

  test(`${look.name}: the History of several conversations of one file matches its baseline`, async ({ page }) => {
    // THE HISTORY: three conversations of one file together, newest first, and one of another file.
    const pane = await openPane(page, look, {
      history: turns(2),
      conversations: [
        { key: key('1'), file: key('f'), name: 'chat.pdf', savedAt: '2026-10-30T09:00:00.000Z', turns: 4, preview: 'What is this page about?' },
        { key: key('2'), file: key('f'), name: 'chat.pdf', savedAt: '2026-10-29T15:30:00.000Z', turns: 2, preview: 'Summarise the second section.' },
        { key: key('3'), file: key('f'), name: 'chat.pdf', savedAt: '2026-10-28T11:15:00.000Z', turns: 6, preview: 'Which dates does it name?' },
        { key: key('4'), file: key('e'), name: 'report.pdf', savedAt: '2026-10-27T08:45:00.000Z', turns: 2, preview: 'Translate the title.' },
      ],
    });
    await pane.getByRole('button', { name: 'History', exact: true }).click();
    await expect(pane.getByText('Summarise the second section.', { exact: false })).toBeVisible();
    await page.mouse.move(400, 450);
    await expect(pane).toHaveScreenshot(`${look.name}-assistant-history.png`);
  });
}
