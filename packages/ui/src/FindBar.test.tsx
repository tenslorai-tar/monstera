// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FindBar } from './FindBar.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000fd');

/**
 * Match navigation.
 *
 * ## The fixture puts the matches on pages 0 and 2, and page 1 has none
 *
 * That gap is the whole point of the fixture rather than incidental colour. A
 * bar that navigated by a match's **position in the list** rather than by the
 * page it carries would send the reader to page 1 for the second match, and on
 * a fixture where every page matched, that defect and the correct build produce
 * the same jumps for ever. The reader also starts on page 1 — the middle,
 * matchless one — so a jump that went nowhere is separable from a jump that
 * landed.
 */
const PAGES = 3;
const MATCHED = [0, 2];

/**
 * A client whose per-page answer depends on the page asked for.
 *
 * Built through `createClient(channels, …)`, so every answer invented here
 * crosses the real schemas: a shape the channel cannot carry fails in this file
 * rather than in the product.
 */
function clientAnswering(): { client: ContractClient; asked: number[] } {
  const asked: number[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.searchPage') throw new Error(`unexpected channel ${id}`);
    const page = (params as { page: number }).page;
    asked.push(page);
    return Promise.resolve(
      ok({
        version: asDocVersion(1),
        matches: MATCHED.includes(page) ? [{ line: 0, offset: 0, text: `hit on ${String(page)}` }] : [],
        truncated: false,
      }),
    );
  });
  return { client, asked };
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * The one element a selector must find, or a named failure.
 *
 * A `!` assertion would report the absence as *cannot read properties of null*
 * at whatever line happened to touch it next — this says which control the bar
 * did not render, which is the sentence a reader of a red run needs.
 */
function only<T extends Element>(
  container: HTMLElement,
  selector: string,
  kind: new () => T,
): T {
  const found = container.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`the bar renders ${selector}`);
  return found;
}

/** Renders the bar over the fixture and runs a whole-document walk. */
async function afterWalking(): Promise<{
  readonly container: HTMLElement;
  readonly jumped: ReturnType<typeof vi.fn>;
}> {
  const { client } = clientAnswering();
  const jumped = vi.fn();
  const { container } = render(
    <Wrapped>
      <FindBar client={client} docId={DOC} page={1} pageCount={PAGES} onJump={jumped} />
    </Wrapped>,
  );

  await act(async () => {
    fireEvent.change(only(container, '[data-find-input]', HTMLInputElement), {
      target: { value: 'hit' },
    });
    await Promise.resolve();
  });
  await act(async () => {
    only(container, '[data-find-all]', HTMLButtonElement).click();
    await Promise.resolve();
  });
  // One turn per page, plus one for the walk's own resolution.
  await act(async () => {
    for (let turn = 0; turn <= PAGES; turn += 1) await Promise.resolve();
  });

  return { container, jumped };
}

/** Clicks a navigation control by the attribute the surface is found by. */
async function press(container: HTMLElement, control: string): Promise<void> {
  const button = container.querySelector(`[${control}]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`the bar renders a ${control} control`);
  }
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe('FindBar match navigation', () => {
  it('TAKES THE READER TO THE FIRST MATCH when the walk completes', async () => {
    // The decision, asserted as a call rather than as a screen state: a walk
    // that reported its count and left the reader where they were produces the
    // same readout as this one.
    const { container, jumped } = await afterWalking();

    expect(container.textContent).toContain('2 matches in this document');
    expect(jumped).toHaveBeenCalledTimes(1);
    // Page 0, the first MATCHED page — not 1, which is where the reader was.
    expect(jumped).toHaveBeenLastCalledWith(0);
    expect(container.querySelector('.m-find-position')?.textContent).toBe('Match 1 of 2');
  });

  it('MOVES TO THE NEXT MATCH BY ITS PAGE, not by its place in the list', async () => {
    // The separating assertion. The second match is list index 1 and lives on
    // page 2; a bar that jumped to the index would go to page 1, which holds no
    // match at all — and the readout would say the same thing either way, which
    // is why both are asserted here.
    const { container, jumped } = await afterWalking();

    await press(container, 'data-find-next');

    expect(jumped).toHaveBeenLastCalledWith(2);
    expect(container.querySelector('.m-find-position')?.textContent).toBe('Match 2 of 2');
  });

  it('WRAPS BACKWARDS from the first match to the last', async () => {
    // The modulo's own case. `(0 - 1) % 2` is `-1` in JavaScript, because `%`
    // keeps the sign of its left operand — so the spelling without `+ count`
    // indexes off the front of the list and jumps nowhere. That failure and a
    // deliberate refusal to wrap are the same observation from outside, so this
    // asserts the landing page rather than that something happened.
    const { container, jumped } = await afterWalking();

    await press(container, 'data-find-previous');

    expect(jumped).toHaveBeenLastCalledWith(2);
    expect(container.querySelector('.m-find-position')?.textContent).toBe('Match 2 of 2');
  });

  it('offers NO navigation for a single-page search, whose matches are already on screen', async () => {
    // The control for the pair above, and it is not decoration: navigation
    // exists because a match can be on a page the reader cannot see. Every
    // match a page search finds is on the page they are looking at, so a
    // *match 2 of 7* there would step a number and move nothing — the
    // display-only defect with a readout on it.
    const { client } = clientAnswering();
    const jumped = vi.fn();
    const { container } = render(
      <Wrapped>
        <FindBar client={client} docId={DOC} page={0} pageCount={PAGES} onJump={jumped} />
      </Wrapped>,
    );

    await act(async () => {
      fireEvent.change(only(container, '[data-find-input]', HTMLInputElement), {
        target: { value: 'hit' },
      });
      await Promise.resolve();
    });
    await act(async () => {
      only(container, 'form', HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // The page search DID find something — without this the case passes for a
    // bar that rendered no results at all, which is the vacuous version.
    expect(container.textContent).toContain('1 matches on this page');
    expect(container.querySelector('[data-find-next]')).toBeNull();
    expect(jumped).not.toHaveBeenCalled();
  });
});
