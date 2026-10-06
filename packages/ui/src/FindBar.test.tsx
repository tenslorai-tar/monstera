// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, MAX_QUERY_LENGTH, channels, createClient } from '@monstera/contract';
import { type DocVersion, asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FindBar } from './FindBar.js';
import type { SearchHighlight } from './searchHighlight.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000fd');
/** The version every fixture answer is read from, and the one on screen unless a case moves it. */
const V1 = asDocVersion(1);

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
function clientAnswering(readFrom: (page: number) => DocVersion = () => V1): { client: ContractClient; asked: number[] } {
  const asked: number[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.searchPage') throw new Error(`unexpected channel ${id}`);
    const page = (params as { page: number }).page;
    asked.push(page);
    return Promise.resolve(
      ok({
        version: readFrom(page),
        matches: MATCHED.includes(page)
          ? [{ line: 0, offset: 0, endLine: 0, endOffset: 3, text: `hit on ${String(page)}` }]
          : [],
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
/**
 * A spy on `onHighlight`, TYPED.
 *
 * `vi.fn()` alone answers `any` for `lastCall`, and a case reading a field off
 * `any` cannot tell a renamed field from a wrong value — both arrive as
 * `undefined`. The signature is the one the prop declares.
 */
type PaintSpy = ReturnType<typeof vi.fn<(highlight: SearchHighlight | null) => void>>;

async function afterWalking(): Promise<{
  readonly container: HTMLElement;
  readonly jumped: ReturnType<typeof vi.fn>;
  readonly painted: PaintSpy;
}> {
  const { client } = clientAnswering();
  const jumped = vi.fn();
  const painted: PaintSpy = vi.fn();
  const { container } = render(
    <Wrapped>
      <FindBar
        client={client}
        docId={DOC}
        version={V1}
        page={1}
        pageCount={PAGES}
        onJump={jumped}
        onHighlight={painted}
      />
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

  return { container, jumped, painted };
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

  it('REPORTS what to paint, and moves it with the active match', async () => {
    // The find bar's half of the highlight. What the layers do with this is
    // `TextLayer.test.tsx`'s; what this pins is that the description carries
    // the query that was ANSWERED and the match the reader is on — a bar that
    // reported a highlight with no `active` would paint every match the same
    // and the *next* control would change a number and nothing else.
    const { container, painted } = await afterWalking();

    expect(painted).toHaveBeenLastCalledWith({
      query: 'hit',
      options: { caseSensitive: false, wholeWord: false, regex: false },
      active: { page: 0, line: 0, offset: 0 },
    });

    await press(container, 'data-find-next');

    // THE PAGE MOVED. Asserting the whole object again would pass for a bar
    // that re-sent the first match, since only one field differs.
    //
    expect(painted.mock.lastCall?.[0]?.active?.page).toBe(2);
  });

  it('reports NOTHING for a query that has been typed and not searched', async () => {
    // The control, and it is what separates painting a search from painting the
    // search box. Typing into the field is a query the document has not been
    // asked about; a bar that read `query` at the point of use rather than the
    // answered query would highlight it, beside a result list counting nothing.
    const { client } = clientAnswering();
    const painted: PaintSpy = vi.fn();
    const { container } = render(
      <Wrapped>
        <FindBar
          client={client}
          docId={DOC}
          version={V1}
          page={1}
          pageCount={PAGES}
          onJump={vi.fn()}
          onHighlight={painted}
        />
      </Wrapped>,
    );

    await act(async () => {
      fireEvent.change(only(container, '[data-find-input]', HTMLInputElement), {
        target: { value: 'hit' },
      });
      await Promise.resolve();
    });

    // `null` on mount and `null` still: a bar that reported the typed query
    // would have sent an object on the second call.
    expect(painted.mock.calls.every((call) => call[0] === null)).toBe(true);
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
        <FindBar
          client={client}
          docId={DOC}
          version={V1}
          page={0}
          pageCount={PAGES}
          onJump={jumped}
          onHighlight={vi.fn()}
        />
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
    // bar that rendered no results at all, which is the vacuous version. ONE MATCH, in the singular (item 13i).
    expect(container.textContent).toContain('1 match on this page');
    expect(container.querySelector('[data-find-next]')).toBeNull();
    expect(jumped).not.toHaveBeenCalled();
  });
});

/**
 * The replace half — the UI side of the wired pair for `replaceAllText`.
 *
 * Its kernel half is `proof:pdfiumcommand`, which drives the real library over
 * three pages and cannot see what a control sent; this sees the command and
 * cannot see a document.
 *
 * What only this side can assert is that the query and the three flags the
 * person set for the SEARCH are the ones the replacement runs with. That is the
 * whole argument for putting the control here rather than in the ribbon, and a
 * bar that sent its own defaults would look correct in every screenshot.
 */
describe('FindBar replace-all', () => {
  /** Renders a bar with a dispatcher, and records what it sends; `refusing` is the code its execute answers with. */
  function withCommands(refusing?: 'replace-moves-line'): {
    readonly container: HTMLElement;
    readonly sent: { id: string; params: unknown }[];
    readonly applied: ReturnType<typeof vi.fn>;
    readonly painted: PaintSpy;
  } {
    const sent: { id: string; params: unknown }[] = [];
    const applied = vi.fn();
    const painted: PaintSpy = vi.fn();
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'document.searchPage') {
        return Promise.resolve(
          ok({
            version: asDocVersion(1),
            matches: [{ line: 0, offset: 0, endLine: 0, endOffset: 3, text: 'hit on 0' }],
            truncated: false,
          }),
        );
      }
      if (refusing !== undefined) return Promise.resolve(err({ code: refusing }));
      return Promise.resolve(
        ok({ version: asDocVersion(2), byteLength: 10, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [] }),
      );
    });
    const { container } = render(
      <Wrapped>
        <FindBar
          client={client}
          docId={DOC}
          version={V1}
          page={0}
          pageCount={PAGES}
          onJump={vi.fn()}
          onHighlight={painted}
          commands={{
            client,
            onApplied: applied,
            ask: vi.fn(),
            stamp: () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' }),
            // NOT SIGNED (ADR-0149): a copy opened for this replace is a defect of the case.
            signatures: {
              warn: () => true,
              onOpened: () => {
                throw new Error('the case opened a copy for an edit without asking for one');
              },
            },
          }}
        />
      </Wrapped>,
    );
    return { container, sent, applied, painted };
  }

  it('SENDS THE SEARCH’S OWN QUERY AND FLAGS, not its own defaults', async () => {
    const { container, sent, applied } = withCommands();

    await act(async () => {
      fireEvent.change(only(container, '[data-find-input]', HTMLInputElement), {
        target: { value: 'WIDGET' },
      });
      fireEvent.change(only(container, '[data-find-replacement]', HTMLInputElement), {
        target: { value: 'GADGET' },
      });
      // THE FLAGS, SET BEFORE REPLACING. Every one of them differs from its
      // default, so a bar that sent `{}` or its own literals fails here — where
      // a fixture leaving them off would pass against both.
      for (const key of ['caseSensitive', 'wholeWord', 'regex']) {
        fireEvent.click(only(container, `[data-find-option="${key}"]`, HTMLInputElement));
      }
      await Promise.resolve();
    });
    await act(async () => {
      only(container, '[data-find-replace-all]', HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'replaceAllText',
            find: 'WIDGET',
            replace: 'GADGET',
            caseSensitive: true,
            wholeWord: true,
            regex: true,
          },
        },
      },
    ]);
    // AND THE SHELL WAS TOLD THE VERSION MOVED, which is what makes the rest of
    // the application redraw. A dispatch nothing reported would leave the reader
    // looking at the document as it was.
    expect(applied).toHaveBeenCalledWith({
      version: 2,
      byteLength: 10,
      historyDropped: 0,
      boxed: [],
      more: 0,
      unsealedCopies: [],
    });
  });

  it('a Replace REFUSED as moving its line keeps both typed fields, says nothing was replaced, and redraws nothing', async () => {
    const { container, applied } = withCommands('replace-moves-line');

    await act(async () => {
      fireEvent.change(only(container, '[data-find-input]', HTMLInputElement), { target: { value: 'narrow' } });
      fireEvent.change(only(container, '[data-find-replacement]', HTMLInputElement), { target: { value: 'much wider' } });
      await Promise.resolve();
    });
    await act(async () => {
      only(container, '[data-find-replace-all]', HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // THE TYPED WORDS STAY (the owner's answer of 2026-10-05): a person told why can change one word and send again.
    expect(only(container, '[data-find-input]', HTMLInputElement).value).toBe('narrow');
    expect(only(container, '[data-find-replacement]', HTMLInputElement).value).toBe('much wider');
    // NOTHING MOVED: no "replaced" note and no version reported, against the case above where both happen.
    expect(container.querySelector('.m-find-replaced')).toBeNull();
    expect(applied).not.toHaveBeenCalled();
    // AND THE CONTROL IS THE PERSON'S AGAIN.
    expect(only(container, '[data-find-replace-all]', HTMLButtonElement).disabled).toBe(false);
  });

  it('CLEARS THE MATCHES afterwards, because the document moved under them', async () => {
    const { container, painted } = withCommands();

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
    // THE SEARCH FOUND SOMETHING FIRST — without this the case passes on a bar
    // that never rendered a result, and *cleared* would mean nothing.
    expect(container.textContent).toContain('1 match on this page');

    await act(async () => {
      only(container, '[data-find-replace-all]', HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('1 match on this page');
    // AND THE HIGHLIGHTS WENT WITH THEM. A list cleared while the page kept its
    // boxes would put a rectangle around a word that is no longer there.
    expect(painted).toHaveBeenLastCalledWith(null);
  });

  it('renders NO replace control without a dispatcher, which is the find half as it shipped', async () => {
    // THE CONTROL FOR THE THREE ABOVE. `commands` is optional, and a bar that
    // rendered the button regardless would offer a control that dispatches
    // nothing — the display-only defect the wired-tools rule bans.
    const { client } = clientAnswering();
    const { container } = render(
      <Wrapped>
        <FindBar
          client={client}
          docId={DOC}
          version={V1}
          page={0}
          pageCount={PAGES}
          onJump={vi.fn()}
          onHighlight={vi.fn()}
        />
      </Wrapped>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-find-replace-all]')).toBeNull();
    expect(container.querySelector('[data-find-replacement]')).toBeNull();
    // AND THE FIND HALF IS STILL THERE, so this is not passing on a bar that
    // rendered nothing at all.
    expect(container.querySelector('[data-find-input]')).not.toBeNull();
  });
});

describe('a SEEDED search — the selected-text menu’s *Search for this*', () => {
  function seeded(client: ContractClient, seed: { text: string; nonce: number }, page = 1): ReactElement {
    return (
      <Wrapped>
        <FindBar
          client={client}
          docId={DOC}
          version={V1}
          page={page}
          pageCount={PAGES}
          onJump={vi.fn()}
          onHighlight={vi.fn()}
          seed={seed}
        />
      </Wrapped>
    );
  }

  it('fills the field with the seed and searches the page on show ONCE; moving page with the same seed searches nothing', async () => {
    const { client, asked } = clientAnswering();
    const seed = { text: 'hit', nonce: 1 };
    const { container, rerender } = render(seeded(client, seed));
    await act(async () => {
      await Promise.resolve();
    });
    expect(only(container, '[data-find-input]', HTMLInputElement).value).toBe('hit');
    expect(asked).toStrictEqual([1]);

    // THE SEED STAYS SET after it is acted on, and a new page gives `search` a new identity, which
    // re-runs the effect that searches. The seed was a request for one search, not a standing one.
    rerender(seeded(client, seed, 2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toStrictEqual([1]);
  });

  it('the SAME TEXT under a new nonce is a second request, and searches again', async () => {
    const { client, asked } = clientAnswering();
    const { rerender } = render(seeded(client, { text: 'hit', nonce: 1 }));
    await act(async () => {
      await Promise.resolve();
    });
    rerender(seeded(client, { text: 'hit', nonce: 2 }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(asked).toStrictEqual([1, 1]);
  });

  it('a seed LONGER THAN THE CHANNEL TAKES is searched by its start, not refused', async () => {
    const { client, asked } = clientAnswering();
    const long = 'h'.repeat(MAX_QUERY_LENGTH + 40);
    const { container } = render(seeded(client, { text: long, nonce: 1 }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(only(container, '[data-find-input]', HTMLInputElement).value).toHaveLength(MAX_QUERY_LENGTH);
    expect(asked).toStrictEqual([1]);
  });
});

/**
 * An answer belongs to the VERSION it was read from (CR-COR-09). Every match names a page, a line and an offset in that
 * version, and after an edit those name other text: Next went to the old pages and the count stayed.
 */
describe('Find answers and the version on screen', () => {
  function bar(client: ContractClient, version: DocVersion, painted: PaintSpy, jumped = vi.fn()): ReactElement {
    return (
      <Wrapped>
        <FindBar
          client={client}
          docId={DOC}
          version={version}
          page={1}
          pageCount={PAGES}
          onJump={jumped}
          onHighlight={painted}
        />
      </Wrapped>
    );
  }

  async function type(container: HTMLElement, text: string): Promise<void> {
    await act(async () => {
      fireEvent.change(only(container, '[data-find-input]', HTMLInputElement), { target: { value: text } });
      await Promise.resolve();
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn <= PAGES + 1; turn += 1) await Promise.resolve();
    });
  }

  it('an EDIT ends a document walk’s answer: the count, the list, Next and the marks go with the version', async () => {
    const { client } = clientAnswering();
    const painted: PaintSpy = vi.fn();
    const { container, rerender } = render(bar(client, V1, painted));
    await type(container, 'hit');
    await act(async () => {
      only(container, '[data-find-all]', HTMLButtonElement).click();
      await Promise.resolve();
    });
    await settle();
    expect(container.textContent).toContain('2 matches in this document');

    // CONTROL: the same version drawn again keeps the answer, so what follows is the version and not a re-render.
    rerender(bar(client, V1, painted));
    expect(container.textContent).toContain('2 matches in this document');
    expect(container.querySelector('[data-find-next]')).not.toBeNull();

    rerender(bar(client, asDocVersion(2), painted));
    await settle();
    expect(container.textContent).not.toContain('matches in this document');
    expect(container.querySelector('[data-find-next]')).toBeNull();
    expect(painted).toHaveBeenLastCalledWith(null);
  });

  it('a page answer READ FROM ANOTHER VERSION is not shown — CONTROL: one read from the version on screen is', async () => {
    const painted: PaintSpy = vi.fn();
    // ON SCREEN IS 2, and main read the page from 1: the edit had not reached it, or it answered before the edit.
    const stale = render(bar(clientAnswering(() => V1).client, asDocVersion(2), painted));
    await type(stale.container, 'hit');
    await act(async () => {
      fireEvent.submit(only(stale.container, '.m-find-bar', HTMLFormElement));
      await Promise.resolve();
    });
    await settle();
    expect(stale.container.textContent).not.toContain('on this page');
    expect(painted).toHaveBeenLastCalledWith(null);
    stale.unmount();

    const current = render(bar(clientAnswering(() => asDocVersion(2)).client, asDocVersion(2), painted));
    await type(current.container, 'hit');
    await act(async () => {
      fireEvent.submit(only(current.container, '.m-find-bar', HTMLFormElement));
      await Promise.resolve();
    });
    await settle();
    expect(current.container.textContent).toContain('on this page');
    expect(painted.mock.lastCall?.[0]?.query).toBe('hit');
  });

  it('a walk IN FLIGHT when the version moves asks for no more pages and shows no list', async () => {
    // EACH PAGE ANSWERS WHEN THE CASE SAYS, so the version can move between two of them.
    const asked: number[] = [];
    const answers: (() => void)[] = [];
    const client = createClient(channels, (id, params) => {
      if (id !== 'document.searchPage') throw new Error(`unexpected channel ${id}`);
      const page = (params as { page: number }).page;
      asked.push(page);
      return new Promise((answer) => {
        answers.push(() => {
          answer(ok({ version: V1, matches: [{ line: 0, offset: 0, endLine: 0, endOffset: 3, text: 'hit' }], truncated: false }));
        });
      });
    });
    const painted: PaintSpy = vi.fn();
    const jumped = vi.fn();
    const { container, rerender } = render(bar(client, V1, painted, jumped));
    await type(container, 'hit');
    await act(async () => {
      only(container, '[data-find-all]', HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(asked).toStrictEqual([0]);

    rerender(bar(client, asDocVersion(2), painted, jumped));
    await act(async () => {
      answers[0]?.();
      await Promise.resolve();
    });
    await settle();
    // STOPPED AT THE PAGE IN FLIGHT, and nothing of it is drawn: no list, no jump, no cancelled message for a cancel
    // nobody pressed.
    expect(asked).toStrictEqual([0]);
    expect(container.textContent).not.toContain('in this document');
    expect(container.textContent).not.toContain('cancel');
    expect(jumped).not.toHaveBeenCalled();
  });
});
