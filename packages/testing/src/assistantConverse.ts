import { type Locator, type Page, expect } from '@playwright/test';

import { pushEvent } from './pageBridge.js';

/**
 * A CONVERSATION PUT ON SCREEN THE WAY A PERSON'S GETS THERE: typed into the box, sent, and its answer streamed in as
 * `main` streams one. Opening a PDF loads no saved conversation (ADR-0279 Decision 8), so this is the one way a rendered
 * case reaches a pane holding turns; every case that needs one takes it from here rather than spelling the steps again.
 *
 * The shim must be bridged with `aiAskStarts: true` and a provider's key, so Send is offered and `ai.ask` answers
 * *started*, and with `asksHeard().observe` as the bridge's observer, so the subscription each ask names can be read.
 */

/** One exchange: what the person asks, what the answer streams, and the refusal its end carries, if any. */
export interface Exchange {
  readonly question: string;
  readonly answer: string;
  /** How the answer ended, as `ai.done` carries it; absent is an answer that ended whole. */
  readonly refusal?: 'answer-cut';
}

/** The subscriptions the page's `ai.ask` calls named, heard through `bridge`'s observer, newest last. */
export interface AsksHeard {
  readonly observe: (channel: string, params: unknown) => void;
  readonly latest: () => string | undefined;
}

export function asksHeard(): AsksHeard {
  const heard: string[] = [];
  return {
    observe: (channel, params) => {
      if (channel === 'ai.ask') heard.push((params as { subscription: string }).subscription);
    },
    latest: () => heard.at(-1),
  };
}

/**
 * Asks each exchange's question in `scope` (the pane or anything holding its box), waits for the ask it starts, and
 * streams that ask's answer in. Each exchange waits for a subscription OTHER than the one before it, so an answer is
 * never pushed to the previous ask's stream, and for its two turns to be drawn before the next question is typed.
 */
export async function converse(page: Page, scope: Locator, latest: () => string | undefined, exchanges: readonly Exchange[]): Promise<void> {
  const turns = scope.locator('.m-assistant__turn');
  for (const exchange of exchanges) {
    const before = latest();
    const drawn = await turns.count();
    await scope.getByLabel('Ask about this document').fill(exchange.question);
    await scope.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => latest()).not.toBe(before);
    const subscription = latest() ?? '';
    await pushEvent(page, 'ai.delta', { subscription, text: exchange.answer });
    await pushEvent(page, 'ai.done', {
      subscription,
      stopped: false,
      ...(exchange.refusal === undefined ? {} : { refusal: exchange.refusal }),
      web: { answer: 'fixture-answer', searched: false, sources: [] },
    });
    await expect(turns).toHaveCount(drawn + 2);
  }
}
