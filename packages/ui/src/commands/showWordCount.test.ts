import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { WORD_COUNT_DIALOG_ID } from '../dialogs/wordCount.js';
import type { CommandContext } from '../registries/commands.js';
import { showWordCountCommand } from './showWordCount.js';

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

    await showWordCountCommand({ client, ask }).run(contextWith(3));

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

    await showWordCountCommand({ client, ask }).run(contextWith(3));

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

    await showWordCountCommand({ client, ask }).run(contextWith(3));

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

    await showWordCountCommand({ client, ask }).run(contextWith(3));

    expect(asked).toStrictEqual([0, 1, 2]);
    expect((opened[0] as { props: { pagesCounted: number } }).props.pagesCounted).toBe(3);
  });

  it('asks nothing at all with no document focused', async () => {
    const { client, asked } = clientCounting([]);
    const { ask, opened } = recordingAsk();

    await showWordCountCommand({ client, ask }).run({
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

  it('is hidden where there is no document', () => {
    const { client } = clientCounting([]);
    const { ask } = recordingAsk();
    const command = showWordCountCommand({ client, ask });

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
