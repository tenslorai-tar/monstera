import { type Command, type ContractClient, type OcrLanguages, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, asFileHandle, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ENHANCE_OUTCOME_DIALOG_ID } from '../dialogs/enhanceOutcome.js';
import { HELP_DIALOG_ID } from '../dialogs/help.js';
import { OCR_DIALOG_ID } from '../dialogs/ocr.js';
import { OCR_OUTCOME_DIALOG_ID } from '../dialogs/ocrOutcome.js';
import { SCAN_OUTCOME_DIALOG_ID } from '../dialogs/scanOutcome.js';
import { TOAST_SEARCHABLE_SAVED, TOAST_SHOW_IN_FOLDER } from '../messages/en.js';
import type { ToastAction } from '../primitives/Toast.js';
import type { CommandContext } from '../registries/commands.js';
import { type TrackTask, UNTRACKED } from '../runningTask.js';
import {
  enhanceScansCommand,
  exportSearchableCommand,
  recogniseBeforeExport,
  recogniseTextCommand,
  straightenScansCommand,
} from './recogniseText.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000fe');
const STAMP = () => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' });

/**
 * The stored `OCR_LANGUAGE_SETTING` every case hands the command. NOT the dialog's answers below (`eng`, and `eng`
 * with `deu`), so a command dispatching the stored value where it should dispatch the answer could not pass.
 */
const STORED: OcrLanguages = ['fra'];

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
  // NO CAST. This was `as CommandContext` and left `selectedPages` out, so the command read `undefined.length` the
  // first time it went through `targetPages` (ADR-0104). Typed, a missing field is a compile error here instead.
  return {
    docId: DOC,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page,
    pageCount,
    openDocuments: [],
    // Nothing ticked, so `targetPages` is the page on show.
    selectedPages: [],
  };
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
): { client: ContractClient; dispatched: Command[]; read: number[]; copies: () => number; revealed: unknown[] } {
  const dispatched: Command[] = [];
  const read: number[] = [];
  const revealed: unknown[] = [];
  let copies = 0;
  const client = createClient(channels, (id, params) => {
    if (id === 'file.reveal') {
      revealed.push(params);
      return Promise.resolve(ok({ revealed: true }));
    }
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
    if (id === 'document.saveCopy') {
      copies += 1;
      return Promise.resolve(ok({ kind: 'copied' as const, bytes: 2048, written: asFileHandle('Handle-searchable-copy') }));
    }
    throw new Error(`unexpected channel ${id}`);
  });
  return { client, dispatched, read, copies: () => copies, revealed };
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
  it('dispatches ocrPage for the scanned pages only, in the languages chosen — two of them here, read together', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'text', 'image-only']);
    const { ask } = recordingAsk({ pages: 'all', languages: ['eng', 'deu'] });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(3));

    // EVERY PAGE IS READ and two are recognised: the read is how the command knows
    // which, and a version that recognised all three would write a worse copy of
    // page 1's words underneath the real ones.
    expect(read).toStrictEqual([0, 1, 2]);
    expect(dispatched).toStrictEqual([
      // `engine: 'tesseract'` on every one of these, and it is not noise: the
      // network engines are offered on a region only, so a page walk that
      // acquired a choice would upload whole pages nobody asked to send.
      { kind: 'ocrPage', page: 0, languages: ['eng', 'deu'], engine: 'tesseract' },
      { kind: 'ocrPage', page: 2, languages: ['eng', 'deu'], engine: 'tesseract' },
    ]);
  });

  it('recognises ONE page for the this-page scope', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'image-only', 'image-only']);
    const { ask } = recordingAsk({ pages: [1], languages: ['eng'] });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(3, 1));

    // THE SCOPE THE DIALOG ANSWERED, not the page the context held: they agree
    // here and a command reading the context instead would agree on every
    // single-page case while ignoring the choice.
    expect(read).toStrictEqual([1]);
    expect(dispatched).toStrictEqual([
      { kind: 'ocrPage', page: 1, languages: ['eng'], engine: 'tesseract' },
    ]);
  });

  it('dispatches nothing when the dialog is dismissed', async () => {
    const { client, dispatched, read } = clientOver(['image-only']);
    const { ask } = recordingAsk(undefined);

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(1));

    // THE MUTATION-DIALOG GATE (ADR-0038): a dismissal produces no value, so
    // there is nothing to apply — and no page is even read, because the scope is
    // what says which.
    expect(dispatched).toStrictEqual([]);
    expect(read).toStrictEqual([]);
  });

  it('HOW TO GET A KEY opens the Help centre on that article and recognises nothing', async () => {
    const { client, dispatched, read } = clientOver(['image-only']);
    const { ask, opened } = recordingAsk({ help: 'ai-keys-and-pricing' });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(1));

    expect(opened.map((each) => each.id)).toStrictEqual([OCR_DIALOG_ID, HELP_DIALOG_ID]);
    expect(opened[1]?.props).toStrictEqual({ article: 'ai-keys-and-pricing', context: null, showable: [] });
    // CONTROL on the other half: the answer that asked for help is not read as a scope.
    expect(dispatched).toStrictEqual([]);
    expect(read).toStrictEqual([]);
  });

  it('hands the dialog the languages this machine has, and asks at run time', async () => {
    const { client } = clientOver(['text'], { languages: [] });
    const { ask, opened } = recordingAsk(undefined);

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(1));

    // AN EMPTY LIST REACHES THE DIALOG, which is what makes the no-models state
    // the dialog's to design rather than this command's to hide. A command that
    // returned early would leave the control doing nothing at all.
    expect(opened).toStrictEqual([
      { id: OCR_DIALOG_ID, props: { pages: [0], languages: [], chosen: STORED, servicesReady: false } },
    ]);
  });

  it('opens the dialog on the STORED languages, read when the command runs rather than when it was built', async () => {
    // Two runs of ONE command with the store changed between them. A command that captured the setting when the
    // registry was built would open both runs on the first value.
    const { client } = clientOver(['text'], { languages: ['eng', 'deu', 'fra'] });
    const { ask, opened } = recordingAsk(undefined);
    let stored: OcrLanguages = ['fra'];
    const command = recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => stored,
    });

    await command.run(contextWith(1));
    stored = ['deu', 'eng'];
    await command.run(contextWith(1));

    expect(opened.map((each) => (each.props as { chosen: unknown }).chosen)).toStrictEqual([['fra'], ['deu', 'eng']]);
  });

  it('reports what it did, including when there was nothing to do', async () => {
    const { client, dispatched } = clientOver(['text', 'empty', 'text']);
    const { ask, opened } = recordingAsk({ pages: 'all', languages: ['eng'] });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
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
    const { ask } = recordingAsk({ pages: 'all', languages: ['eng'] });
    const { track, steps, totals, ended } = recordingTrack();

    await recogniseTextCommand({ client, onApplied: () => undefined, stamp: STAMP, ask, track, servicesReady: () => false, ocrLanguages: () => STORED }).run(
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
    const { ask, opened } = recordingAsk({ pages: 'all', languages: ['eng'] });
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

    await recogniseTextCommand({ client, onApplied: () => undefined, stamp: STAMP, ask, track, servicesReady: () => false, ocrLanguages: () => STORED }).run(
      contextWith(3),
    );

    expect(dispatched).toStrictEqual([
      { kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' },
    ]);
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
    const { ask } = recordingAsk({ pages: 'all', languages: ['eng'] });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(3));

    // ONE DISPATCH AND ONE READ. The refusals this channel declares are about the
    // document — closed, busy, poisoned — so carrying on would ask every remaining
    // page a question that has just been answered, and report it each time.
    expect(dispatched).toHaveLength(1);
    expect(read).toStrictEqual([0]);
  });

  it('EXPORT: recognises every scanned page, then writes a copy and CONFIRMS it', async () => {
    const { client, dispatched, read, copies, revealed } = clientOver(['image-only', 'text', 'image-only']);
    const { ask } = recordingAsk({ pages: [0], languages: ['eng'] });
    const said: { kind: string; message: string; action: ToastAction | undefined }[] = [];

    await exportSearchableCommand({
      client,
      toast: (kind, message, action) => {
        said.push({ kind, message, action });
      },
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(3));

    // THE WHOLE DOCUMENT, whatever scope the dialog answered — an export is every
    // page by definition, and the dialog is reused for its language rather than
    // its scope. The answer above says page 0 only, and all three are read.
    expect(read).toStrictEqual([0, 1, 2]);
    expect(dispatched).toStrictEqual([
      { kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' },
      { kind: 'ocrPage', page: 2, languages: ['eng'], engine: 'tesseract' },
    ]);
    expect(copies()).toBe(1);
    // THE WRITTEN COPY IS CONFIRMED, and its Show in folder reveals the handle the write answered — only when run.
    expect(said.map(({ kind, message }) => [kind, message])).toStrictEqual([['done', TOAST_SEARCHABLE_SAVED]]);
    expect(said[0]?.action?.label).toBe(TOAST_SHOW_IN_FOLDER);
    expect(revealed).toStrictEqual([]);
    said[0]?.action?.run();
    expect(revealed).toStrictEqual([{ handle: asFileHandle('Handle-searchable-copy') }]);
  });

  it('EXPORT: writes NO copy when the reader cancels', async () => {
    const { client, copies } = clientOver(['image-only', 'image-only']);
    const { ask, opened } = recordingAsk({ pages: 'all', languages: ['eng'] });
    const controller = new AbortController();
    const track: TrackTask = () => ({
      signal: controller.signal,
      step: () => {
        controller.abort();
      },
      end: () => undefined,
    });

    await exportSearchableCommand({ client, onApplied: () => undefined, stamp: STAMP, ask, toast: () => undefined, track, servicesReady: () => false, ocrLanguages: () => STORED }).run(
      contextWith(2),
    );

    // HALF A DOCUMENT'S PAGES RECOGNISED AND A FILE CALLED SEARCHABLE is the pair
    // this must not produce. The outcome is still reported, because the pages
    // already recognised are in the open document.
    expect(copies()).toBe(0);
    expect(opened[1]).toStrictEqual({
      id: OCR_OUTCOME_DIALOG_ID,
      props: { recognised: 1, skipped: 0, stopped: true },
    });
  });

  it('ENHANCE: sends ONE command naming the scanned pages', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'text', 'image-only', 'empty']);
    const { ask, opened } = recordingAsk(undefined);

    await enhanceScansCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
    }).run(contextWith(4));

    // ONE COMMAND, not one per page: a reader who cleans up a four-page scan expects
    // one undo, and the checkpoint behind it is one document image rather than four.
    expect(read).toStrictEqual([0, 1, 2, 3]);
    expect(dispatched).toStrictEqual([{ kind: 'enhancePages', pages: [0, 2] }]);
    // NO DIALOG BEFORE IT — the levels come from each image's own histogram, so
    // there is nothing to ask. The only dialog is the outcome.
    expect(opened).toStrictEqual([
      { id: ENHANCE_OUTCOME_DIALOG_ID, props: { pages: 2 } },
    ]);
  });

  it('ENHANCE: says so when there is nothing to clean up, and dispatches nothing', async () => {
    const { client, dispatched } = clientOver(['text', 'empty']);
    const { ask, opened } = recordingAsk(undefined);

    await enhanceScansCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
    }).run(contextWith(2));

    // THE OUTCOME A READER CANNOT SEE. A command that closed silently here is
    // indistinguishable from one that is broken, and `pages: 0` is what the dialog
    // turns into a sentence rather than a count.
    expect(dispatched).toStrictEqual([]);
    expect(opened).toStrictEqual([{ id: ENHANCE_OUTCOME_DIALOG_ID, props: { pages: 0 } }]);
  });

  it('STRAIGHTEN: sends ONE command naming the scanned pages, then its own outcome', async () => {
    // THE SAME WALK AS ENHANCE, and asserted separately: a straighten command that sent
    // `enhancePages`, or opened enhance's outcome, would read correctly everywhere else.
    const { client, dispatched, read } = clientOver(['text', 'image-only', 'empty', 'image-only']);
    const { ask, opened } = recordingAsk(undefined);

    await straightenScansCommand({ client, onApplied: () => undefined, stamp: STAMP, ask, track: UNTRACKED }).run(
      contextWith(4),
    );

    expect(read).toStrictEqual([0, 1, 2, 3]);
    expect(dispatched).toStrictEqual([{ kind: 'straightenScans', pages: [1, 3] }]);
    expect(opened).toStrictEqual([{ id: SCAN_OUTCOME_DIALOG_ID, props: { pages: 2 } }]);
  });

  it('STRAIGHTEN: says so when there is nothing to straighten, and a cancelled walk sends and says nothing', async () => {
    const empty = clientOver(['text']);
    const told = recordingAsk(undefined);
    await straightenScansCommand({ client: empty.client, onApplied: () => undefined, stamp: STAMP, ask: told.ask, track: UNTRACKED }).run(
      contextWith(1),
    );
    expect(empty.dispatched).toStrictEqual([]);
    expect(told.opened).toStrictEqual([{ id: SCAN_OUTCOME_DIALOG_ID, props: { pages: 0 } }]);

    // CANCELLED AFTER THE FIRST PAGE: the walk's `null`, not an empty list, so no outcome
    // dialog claims there were no scans in a document the person stopped reading.
    const cancelled = clientOver(['image-only', 'image-only']);
    const quiet = recordingAsk(undefined);
    const controller = new AbortController();
    const track: TrackTask = () => ({
      signal: controller.signal,
      step: () => {
        controller.abort();
      },
      end: () => undefined,
    });
    await straightenScansCommand({ client: cancelled.client, onApplied: () => undefined, stamp: STAMP, ask: quiet.ask, track }).run(
      contextWith(2),
    );
    expect(cancelled.dispatched).toStrictEqual([]);
    expect(quiet.opened).toStrictEqual([]);
  });

  it('stops when a page’s kind cannot be read', async () => {
    const { client, dispatched, read } = clientOver(['image-only', 'refused', 'image-only']);
    const { ask } = recordingAsk({ pages: 'all', languages: ['eng'] });

    await recogniseTextCommand({
      client,
      onApplied: () => undefined,
      stamp: STAMP,
      ask,
      track: UNTRACKED,
      servicesReady: () => false,
      ocrLanguages: () => STORED,
    }).run(contextWith(3));

    expect(read).toStrictEqual([0, 1]);
    expect(dispatched).toStrictEqual([
      { kind: 'ocrPage', page: 0, languages: ['eng'], engine: 'tesseract' },
    ]);
  });
});

describe('recognising before an export (ADR-0118)', () => {
  const run = (
    on: boolean,
    stored: OcrLanguages,
    clientParts: ReturnType<typeof clientOver>,
  ): ReturnType<typeof recogniseBeforeExport> =>
    recogniseBeforeExport(
      {
        client: clientParts.client,
        onApplied: () => undefined,
        stamp: STAMP,
        ask: () => Promise.resolve(undefined),
        track: UNTRACKED,
        recogniseOnExport: () => on,
        ocrLanguages: () => stored,
      },
      DOC,
      3,
    );

  it('with the setting ON, walks every page and reads with the languages the OCR dialog would open on', async () => {
    // `fra` is stored and not provisioned, `deu` is both: the walk must read in `deu` alone — the dialog's rule, not
    // the stored set as it stands and not the machine's first model.
    const parts = clientOver(['image-only', 'text', 'image-only'], { languages: ['eng', 'deu'] });
    const walked = await run(true, ['fra', 'deu'], parts);

    expect(parts.read).toStrictEqual([0, 1, 2]);
    expect(parts.dispatched).toStrictEqual([
      { kind: 'ocrPage', page: 0, languages: ['deu'], engine: 'tesseract' },
      { kind: 'ocrPage', page: 2, languages: ['deu'], engine: 'tesseract' },
    ]);
    expect(walked).toStrictEqual({ recognised: 2, skipped: 1, stopped: false });
  });

  it('CONTROL: with it OFF nothing is read, nothing recognised, and nothing answered', async () => {
    const parts = clientOver(['image-only', 'image-only', 'image-only'], { languages: ['eng'] });
    expect(await run(false, ['eng'], parts)).toBeUndefined();
    expect(parts.read).toStrictEqual([]);
    expect(parts.dispatched).toStrictEqual([]);
  });

  it('with no model on this machine the export goes ahead unrecognised, rather than refused (Decision 5)', async () => {
    const parts = clientOver(['image-only', 'image-only', 'image-only'], { languages: [] });
    expect(await run(true, ['eng'], parts)).toBeUndefined();
    expect(parts.dispatched).toStrictEqual([]);
  });
});
