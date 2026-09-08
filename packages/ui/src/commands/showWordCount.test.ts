import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { WORD_COUNT_DIALOG_ID } from '../dialogs/wordCount.js';
import type { CommandContext } from '../registries/commands.js';
import { showWordCountCommand } from './showWordCount.js';
import { type TrackTask, UNTRACKED } from '../runningTask.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000ff');

/** A context with a document focused, which is what `when` asks about. */
function contextWith(pageCount: number): CommandContext {
  return {
    docId: DOC,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page: 0,
    pageCount,
  } as CommandContext;
}

/**
 * A client answering `document.pageWordCount` per page, from a script.
 *
 * The script is per page rather than a single answer, because what these cases
 * are about is the WALK — that every page is asked, that the totals add up, and
 * that the walk stops when an answer says the count would be about two
 * documents. A client returning one answer for everything would pass a command
 * that asked one page and multiplied.
 */
function clientCounting(
  script: readonly (
    | { readonly kind: 'ok'; readonly version: number; readonly words: number }
    | { readonly kind: 'refused' }
  )[],
): { client: ContractClient; asked: number[] } {
  const asked: number[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.pageWordCount') throw new Error(`unexpected channel ${id}`);
    const page = (params as { page: number }).page;
    asked.push(page);
    const step = script[page];
    if (step === undefined || step.kind === 'refused') {
      return Promise.resolve(err({ code: 'document-busy' }));
    }
    return Promise.resolve(
      ok({
        version: asDocVersion(step.version),
        words: step.words,
        characters: step.words * 5,
        charactersNoSpaces: step.words * 4,
      }),
    );
  });
  return { client, asked };
}

/** Records what the command opened, so a case asserts the dialog's props. */
function recordingAsk(): { ask: (id: string, props: unknown) => Promise<unknown>; opened: unknown[] } {
  const opened: unknown[] = [];
  return {
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(undefined);
    },
    opened,
  };
}

describe('the word count command', () => {
  it('asks EVERY page and adds the answers up', async () => {
    const { client, asked } = clientCounting([
      { kind: 'ok', version: 1, words: 10 },
      { kind: 'ok', version: 1, words: 4 },
      { kind: 'ok', version: 1, words: 6 },
    ]);
    const { ask, opened } = recordingAsk();

    await showWordCountCommand({ client, ask, track: UNTRACKED }).run(contextWith(3));

    // THE PAGES, not a count of calls: a command that asked page 0 three times
    // would produce the same length and the wrong total on any real document.
    expect(asked).toStrictEqual([0, 1, 2]);
    expect(opened).toStrictEqual([
      {
        id: WORD_COUNT_DIALOG_ID,
        props: {
          words: 20,
          characters: 100,
          charactersNoSpaces: 80,
          pagesCounted: 3,
          pageCount: 3,
        },
      },
    ]);
  });

  it('STOPS at a refusal and reports how many pages it counted', async () => {
    const { client, asked } = clientCounting([
      { kind: 'ok', version: 1, words: 10 },
      { kind: 'refused' },
      { kind: 'ok', version: 1, words: 6 },
    ]);
    const { ask, opened } = recordingAsk();

    await showWordCountCommand({ client, ask, track: UNTRACKED }).run(contextWith(3));

    // It does not go on to page 2: the refusals this channel declares are about
    // the document, so a skip would ask every remaining page a question that has
    // just been answered.
    expect(asked).toStrictEqual([0, 1]);
    const props = (opened[0] as { props: { words: number; pagesCounted: number } }).props;
    // THE PARTIAL TOTAL IS REPORTED AS PARTIAL. Without `pagesCounted` this is
    // 10 words, which is indistinguishable from a correct count of a one-page
    // document — and it is the figure somebody would quote.
    expect({ words: props.words, pagesCounted: props.pagesCounted }).toStrictEqual({
      words: 10,
      pagesCounted: 1,
    });
  });

  it('STOPS when a page answers at a different version', async () => {
    const { client, asked } = clientCounting([
      { kind: 'ok', version: 1, words: 10 },
      { kind: 'ok', version: 2, words: 99 },
      { kind: 'ok', version: 2, words: 99 },
    ]);
    const { ask, opened } = recordingAsk();

    await showWordCountCommand({ client, ask, track: UNTRACKED }).run(contextWith(3));

    // A command applied mid-walk moves the version, and pages counted either
    // side of it describe two documents. Adding them would give a total that is
    // about neither.
    expect(asked).toStrictEqual([0, 1]);
    const props = (opened[0] as { props: { words: number; pagesCounted: number } }).props;
    expect({ words: props.words, pagesCounted: props.pagesCounted }).toStrictEqual({
      words: 10,
      pagesCounted: 1,
    });
  });

  it('CONTROL: a walk where every version agrees counts all of them', async () => {
    // Without this, the two stopping cases pass for a command that stops after
    // the first page whatever the answers say — which is the same observation
    // with a different cause.
    const { client, asked } = clientCounting([
      { kind: 'ok', version: 7, words: 1 },
      { kind: 'ok', version: 7, words: 1 },
      { kind: 'ok', version: 7, words: 1 },
    ]);
    const { ask, opened } = recordingAsk();

    await showWordCountCommand({ client, ask, track: UNTRACKED }).run(contextWith(3));

    expect(asked).toStrictEqual([0, 1, 2]);
    expect((opened[0] as { props: { pagesCounted: number } }).props.pagesCounted).toBe(3);
  });

  it('asks nothing at all with no document focused', async () => {
    const { client, asked } = clientCounting([]);
    const { ask, opened } = recordingAsk();

    await showWordCountCommand({ client, ask, track: UNTRACKED }).run({
      docId: undefined,
      version: undefined,
      hasSelection: false,
      dirty: false,
      page: undefined,
      pageCount: undefined,
    } as CommandContext);

    // `when` keeps it off surfaces, and `run` checks again: a `when` is a
    // predicate about what to SHOW rather than a guarantee about what a palette
    // can dispatch.
    expect({ asked, opened }).toStrictEqual({ asked: [], opened: [] });
  });

  it('REPORTS ITS PROGRESS PER PAGE, after the answer rather than before the call', async () => {
    const { client } = clientCounting([
      { kind: 'ok', version: 1, words: 10 },
      { kind: 'ok', version: 1, words: 4 },
      { kind: 'ok', version: 1, words: 6 },
    ]);
    const { ask } = recordingAsk();
    const steps: number[] = [];
    const track: TrackTask = () => ({
      signal: new AbortController().signal,
      step: (done) => steps.push(done),
      end: () => steps.push(-1),
    });

    await showWordCountCommand({ client, ask, track }).run(contextWith(3));

    // AFTER THE ANSWER. A walk reporting `page + 1` before the call says three
    // of three while the third page is still in flight, which is a bar that
    // finishes early and then waits — and `-1` last is the end, which must
    // arrive whatever happened.
    expect(steps).toStrictEqual([1, 2, 3, -1]);
  });

  it('A CANCELLED WALK OPENS NO DIALOG, however many pages it had counted', async () => {
    const { client, asked } = clientCounting([
      { kind: 'ok', version: 1, words: 10 },
      { kind: 'ok', version: 1, words: 4 },
      { kind: 'ok', version: 1, words: 6 },
    ]);
    const { ask, opened } = recordingAsk();
    const controller = new AbortController();
    const track: TrackTask = () => ({
      signal: controller.signal,
      // CANCELLED AFTER THE FIRST PAGE, from outside, which is what a reader
      // pressing the button does. A case that aborted before the walk started
      // would separate nothing: a walk that never ran opens no dialog either.
      step: () => {
        controller.abort();
      },
      end: () => undefined,
    });

    await showWordCountCommand({ client, ask, track }).run(contextWith(3));

    // THE DIALOG, asserted as absent. A partial count on screen says *your
    // document has 10 words* about one with 20, and a reader who cancelled has
    // no way to tell — `documentSearch.ts`'s rule, and its reason.
    expect(opened).toStrictEqual([]);
    // AND THE WALK STOPPED. Without this the case passes for a build that read
    // all three pages and then threw the answer away, which is the same screen
    // and four hundred round trips.
    expect(asked).toStrictEqual([0]);
  });

  it('does NOT report the page that was IN FLIGHT when the cancel landed', async () => {
    // The post-call check's own case, and it took a mutation to find that
    // nothing separated it: the next iteration's check stops the walk either
    // way, so the dialog is absent and `asked` is [0] whether or not the check
    // exists. What differs is one `step` — the bar ticking once MORE after the
    // reader pressed cancel — so that is what this asserts.
    //
    // The abort lands INSIDE the call, which is the interleaving a reader
    // produces and the only one that reaches this branch.
    const controller = new AbortController();
    const asked: number[] = [];
    const client = createClient(channels, (id, params) => {
      if (id !== 'document.pageWordCount') throw new Error(`unexpected channel ${id}`);
      asked.push((params as { page: number }).page);
      controller.abort();
      return Promise.resolve(
        ok({ version: asDocVersion(1), words: 10, characters: 50, charactersNoSpaces: 40 }),
      );
    });
    const { ask, opened } = recordingAsk();
    const steps: number[] = [];
    const track: TrackTask = () => ({
      signal: controller.signal,
      step: (done) => steps.push(done),
      end: () => undefined,
    });

    await showWordCountCommand({ client, ask, track }).run(contextWith(3));

    expect(steps).toStrictEqual([]);
    expect(asked).toStrictEqual([0]);
    expect(opened).toStrictEqual([]);
  });

  it('ENDS THE TASK even when a refusal stops the walk', async () => {
    // The `finally`'s own case. A status bar still counting after a walk
    // stopped is worse than none: it is the one piece of chrome a reader
    // trusts to be current.
    const { client } = clientCounting([{ kind: 'refused' }]);
    const { ask } = recordingAsk();
    let ended = false;
    const track: TrackTask = () => ({
      signal: new AbortController().signal,
      step: () => undefined,
      end: () => {
        ended = true;
      },
    });

    await showWordCountCommand({ client, ask, track }).run(contextWith(1));

    expect(ended).toBe(true);
  });

  it('is hidden where there is no document', () => {
    const { client } = clientCounting([]);
    const { ask } = recordingAsk();
    const command = showWordCountCommand({ client, ask, track: UNTRACKED });

    expect(command.when?.(contextWith(3))).toBe(true);
    expect(
      command.when?.({
        docId: undefined,
        version: undefined,
        hasSelection: false,
        dirty: false,
        page: undefined,
        pageCount: undefined,
      } as CommandContext),
    ).toBe(false);
  });
});
