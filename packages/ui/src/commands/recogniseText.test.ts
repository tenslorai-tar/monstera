import { type Command, type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { OCR_DIALOG_ID } from '../dialogs/ocr.js';
import { OCR_OUTCOME_DIALOG_ID } from '../dialogs/ocrOutcome.js';
import type { CommandContext } from '../registries/commands.js';
import { type TrackTask, UNTRACKED } from '../runningTask.js';
import { recogniseTextCommand } from './recogniseText.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000fe');

/**
 * The UI half of the wired pair for D6 rows 2 and 3.
 *
 * The kernel half is `ocrTextLayer.test.ts` and `commandBus.test.ts`: that the
 * command writes a readable layer, and that the bus resolves its pre-read with
 * the page the command named. This file asserts the other half — **that the
 * control dispatches exactly that command, for exactly the pages that need it** —
 * and neither alone counts, because a green kernel with no caller is a feature
 * nobody can reach and a green control could be dispatching into the void.
 *
 * ## The pages are asserted, never the number of dispatches
 *
 * `CLAUDE.md`'s rotate finding: the two halves of a pair live either side of a
 * boundary, and what changes across this one is *which page*. A command that
 * recognised page 0 three times produces the same count as one that walked three
 * pages, and it writes the wrong document.
 */

/** A context with a document focused, which is what `when` asks about. */
function contextWith(pageCount: number, page = 0): CommandContext {
  return {
    docId: DOC,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page,
    pageCount,
  } as CommandContext;
}

/**
 * A client answering the two channels this command reads, from a script of page
 * kinds.
 *
 * The kinds are the script because they are what the command BRANCHES on: an
 * `'image-only'` page is recognised, a `'text'` page is left alone and counted as
 * skipped, and an `'empty'` one is neither. A client answering one kind for every
 * page would pass a command that never looked.
 */
/**
 * The kinds spelt out rather than imported.
 *
 * `pageKindOf` is the kernel's and `packages/ui` may never import the kernel, so
 * the three the channel's schema declares are written here — `PageList.test.tsx`
 * does the same thing for the same reason, and the schema is what holds them in
 * step: a fourth kind makes the channel's answer stop parsing against this.
 */
type ScriptedKind = 'text' | 'image-only' | 'empty';

function clientOver(
  kinds: readonly (ScriptedKind | 'refused')[],
  options: { readonly languages?: readonly string[]; readonly refuseExecute?: boolean } = {},
): { client: ContractClient; dispatched: Command[]; read: number[] } {
  const dispatched: Command[] = [];
  const read: number[] = [];
  const client = createClient(channels, (id, params) => {
    if (id === 'app.ocrLanguages') {
      return Promise.resolve(ok({ languages: options.languages ?? ['eng'] }));
    }
    if (id === 'document.pageTextLayer') {
      const page = (params as { page: number }).page;
      read.push(page);
      const kind = kinds[page];
      if (kind === undefined || kind === 'refused') {
        return Promise.resolve(err({ code: 'document-busy' }));
      }
      return Promise.resolve(
        ok({ version: asDocVersion(1), lines: [], truncated: false, kind }),
      );
    }
    if (id === 'document.execute') {
      const command = (params as { command: Command }).command;
      dispatched.push(command);
      if (options.refuseExecute === true) {
        return Promise.resolve(err({ code: 'document-busy' }));
      }
      return Promise.resolve(
        ok({ version: asDocVersion(2), byteLength: 1024, historyDropped: 0 }),
      );
    }
    throw new Error(`unexpected channel ${id}`);
  });
  return { client, dispatched, read };
}

/** Records what the command opened, and answers the setup dialog from a script. */
function recordingAsk(answer: unknown): {
  ask: (id: string, props: unknown) => Promise<unknown>;
  opened: { id: string; props: unknown }[];
} {
  const opened: { id: string; props: unknown }[] = [];
  return {
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(id === OCR_DIALOG_ID ? answer : undefined);
    },
    opened,
  };
}

/** A tracker that records every step, so a case can assert the progress. */
function recordingTrack(): { track: TrackTask; steps: number[]; totals: number[]; ended: () => number } {
  const steps: number[] = [];
  const totals: number[] = [];
  let ended = 0;
  return {
    track: (_label, total) => {
      totals.push(total);
      return {
        signal: new AbortController().signal,
        step: (done) => {
          steps.push(done);
        },
        end: () => {
          ended += 1;
        },
      };
    },
    steps,
    totals,
    ended: () => ended,
  };
}

describe('the recognise-text command', () => {
  it('dispatches ocrPage for the scanned pages only, in the language chosen', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'text', 'image-only']);
    const { ask } = recordingAsk({ pages: 'all', language: 'deu' });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(3));

    // EVERY PAGE IS READ and two are recognised: the read is how the command knows
    // which, and a version that recognised all three would write a worse copy of
    // page 1's words underneath the real ones.
    expect(read).toStrictEqual([0, 1, 2]);
    expect(dispatched).toStrictEqual([
      { kind: 'ocrPage', page: 0, language: 'deu' },
      { kind: 'ocrPage', page: 2, language: 'deu' },
    ]);
  });

  it('recognises ONE page for the this-page scope', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'image-only', 'image-only']);
    const { ask } = recordingAsk({ pages: [1], language: 'eng' });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(3, 1));

    // THE SCOPE THE DIALOG ANSWERED, not the page the context held: they agree
    // here and a command reading the context instead would agree on every
    // single-page case while ignoring the choice.
    expect(read).toStrictEqual([1]);
    expect(dispatched).toStrictEqual([{ kind: 'ocrPage', page: 1, language: 'eng' }]);
  });

  it('dispatches nothing when the dialog is dismissed', async () => {
    const { client, dispatched, read } = clientOver(['image-only']);
    const { ask } = recordingAsk(undefined);

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(1));

    // THE MUTATION-DIALOG GATE (ADR-0038): a dismissal produces no value, so
    // there is nothing to apply — and no page is even read, because the scope is
    // what says which.
    expect(dispatched).toStrictEqual([]);
    expect(read).toStrictEqual([]);
  });

  it('hands the dialog the languages this machine has, and asks at run time', async () => {
    const { client } = clientOver(['text'], { languages: [] });
    const { ask, opened } = recordingAsk(undefined);

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(1));

    // AN EMPTY LIST REACHES THE DIALOG, which is what makes the no-models state
    // the dialog's to design rather than this command's to hide. A command that
    // returned early would leave the control doing nothing at all.
    expect(opened).toStrictEqual([{ id: OCR_DIALOG_ID, props: { page: 0, languages: [] } }]);
  });

  it('reports what it did, including when there was nothing to do', async () => {
    const { client, dispatched } = clientOver(['text', 'empty', 'text']);
    const { ask, opened } = recordingAsk({ pages: 'all', language: 'eng' });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(3));

    expect(dispatched).toStrictEqual([]);
    // THE BLANK PAGE IS NOT COUNTED AS ONE THAT ALREADY HAD TEXT. `'empty'` is no
    // raster and no text, so there is nothing on it to read — and telling a reader
    // a blank sheet already carried words is the kind of wrong a count hides.
    expect(opened[1]).toStrictEqual({
      id: OCR_OUTCOME_DIALOG_ID,
      props: { recognised: 0, skipped: 2, stopped: false },
    });
  });

  it('steps the progress once per page and ends the task', async () => {
    const { client } = clientOver(['image-only', 'text', 'image-only']);
    const { ask } = recordingAsk({ pages: 'all', language: 'eng' });
    const { track, steps, totals, ended } = recordingTrack();

    await recogniseTextCommand({ client, onApplied: () => undefined, ask, track }).run(
      contextWith(3),
    );

    // THE TOTAL IS THE SCOPE and the steps count every page looked at, recognised
    // or not: a bar that advanced only on a recognition would stall on a document
    // whose middle pages already carry text, which is the common one.
    expect(totals).toStrictEqual([3]);
    expect(steps).toStrictEqual([1, 2, 3]);
    // ENDED EXACTLY ONCE, in a `finally`: a task that is never ended leaves a
    // progress bar on screen for the rest of the document's life.
    expect(ended()).toBe(1);
  });

  it('stops when the reader cancels, and says the finished pages keep their text', async () => {
    const { client, dispatched } = clientOver(['image-only', 'image-only', 'image-only']);
    const { ask, opened } = recordingAsk({ pages: 'all', language: 'eng' });
    const controller = new AbortController();
    // ABORTED AFTER THE FIRST STEP, which is the only interleaving that separates
    // *stops* from *never started*: a command checking the signal once, before the
    // loop, passes a case that aborts up front.
    const track: TrackTask = (_label, _total) => ({
      signal: controller.signal,
      step: () => {
        controller.abort();
      },
      end: () => undefined,
    });

    await recogniseTextCommand({ client, onApplied: () => undefined, ask, track }).run(
      contextWith(3),
    );

    expect(dispatched).toStrictEqual([{ kind: 'ocrPage', page: 0, language: 'eng' }]);
    // A CANCELLED RUN IS REPORTED, which is this command's own rule rather than
    // the spell check's: the page already recognised carries real text, so saying
    // nothing would leave a reader unsure whether any of it happened.
    expect(opened[1]).toStrictEqual({
      id: OCR_OUTCOME_DIALOG_ID,
      props: { recognised: 1, skipped: 0, stopped: true },
    });
  });

  it('stops at a refused page rather than stacking one dialog per page', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'image-only', 'image-only'], {
      refuseExecute: true,
    });
    const { ask } = recordingAsk({ pages: 'all', language: 'eng' });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(3));

    // ONE DISPATCH AND ONE READ. The refusals this channel declares are about the
    // document — closed, busy, poisoned — so carrying on would ask every remaining
    // page a question that has just been answered, and report it each time.
    expect(dispatched).toHaveLength(1);
    expect(read).toStrictEqual([0]);
  });

  it('stops when a page’s kind cannot be read', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'refused', 'image-only']);
    const { ask } = recordingAsk({ pages: 'all', language: 'eng' });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      ask,
      track: UNTRACKED,
    }).run(contextWith(3));

    expect(read).toStrictEqual([0, 1]);
    expect(dispatched).toStrictEqual([{ kind: 'ocrPage', page: 0, language: 'eng' }]);
  });
});
