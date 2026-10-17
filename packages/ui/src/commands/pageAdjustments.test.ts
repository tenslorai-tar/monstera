import { type Command, type PageAdjustmentOutcome, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { STRAIGHTEN_OUTCOME_DIALOG_ID } from '../dialogs/straightenOutcome.js';
import type { CommandContext } from '../registries/commands.js';
import { type TrackTask, UNTRACKED } from '../runningTask.js';
import { deskewPagesCommand } from './pageAdjustments.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000d5');
const STAMP = () => ({ author: 'A. Tester', created: '2026-10-13T09:00:00.000Z' });
const signatures = {
  warn: () => true,
  onOpened: () => {
    throw new Error('a case opened a copy for an edit without asking for one');
  },
};

function contextWith(pageCount: number): CommandContext {
  return {
    docId: DOC,
    version: asDocVersion(1),
    hasSelection: false,
    dirty: false,
    page: 0,
    pageCount,
    openDocuments: [],
    selectedPages: [],
  };
}

/** A client answering the level read per page — `changes` where a page is not named — and recording what was sent. */
function clientOver(answers: Readonly<Record<number, PageAdjustmentOutcome | 'busy' | 'gone'>>) {
  const read: { page: number; adjustment: string }[] = [];
  const dispatched: Command[] = [];
  const client = createClient(channels, (id, params) => {
    if (id === 'document.pageAdjustment') {
      const { page, adjustment } = params as { page: number; adjustment: string };
      read.push({ page, adjustment });
      const answer = answers[page] ?? 'changes';
      if (answer === 'busy') return Promise.resolve(err({ code: 'document-busy' }));
      if (answer === 'gone') return Promise.resolve(err({ code: 'page-out-of-range' }));
      return Promise.resolve(ok({ version: asDocVersion(1), outcome: answer }));
    }
    if (id === 'document.execute') {
      dispatched.push((params as { command: Command }).command);
      return Promise.resolve(
        ok({ version: asDocVersion(2), byteLength: 1024, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [], unsealedUndoCopies: 0 }),
      );
    }
    throw new Error(`unexpected channel ${id}`);
  });
  return { client, read, dispatched };
}

function recordingAsk(): { ask: (id: string, props: unknown) => Promise<unknown>; opened: { id: string; props: unknown }[] } {
  const opened: { id: string; props: unknown }[] = [];
  return {
    ask: (id, props) => {
      opened.push({ id, props });
      return Promise.resolve(undefined);
    },
    opened,
  };
}

describe('Straighten — read each page, then write and say what happened (the owner’s N3)', () => {
  it('reads every page’s tilt, sends ONE deskew with no angle, and counts the pages now straight', async () => {
    // THE UI HALF of the wired pair: no angle appears on the wire (the kernel measures each page's tilt from its ink),
    // and the pages are `'all'`, which the apply resolves by the same decision the read took.
    const { client, read, dispatched } = clientOver({ 0: 'already-level', 2: 'already-level' });
    const { ask, opened } = recordingAsk();

    await deskewPagesCommand({ client, onApplied: () => undefined, stamp: STAMP, signatures, ask, track: UNTRACKED }).run(
      contextWith(3),
    );

    expect(read).toStrictEqual([
      { page: 0, adjustment: 'level' },
      { page: 1, adjustment: 'level' },
      { page: 2, adjustment: 'level' },
    ]);
    expect(dispatched).toStrictEqual([{ kind: 'deskewPages', pages: 'all' }]);
    expect(opened).toStrictEqual([{ id: STRAIGHTEN_OUTCOME_DIALOG_ID, props: { pages: 3, straightened: 1 } }]);
  });

  it('a level document sends NOTHING and says it is already straight (control: one tilted page is sent)', async () => {
    // THE DECISION IS THE COMMAND NOT SENT. Before N3 this dispatched `'all'` whatever the pages were, which the kernel
    // then left alone: the document was the same either way, and so was the screen, which is the owner's report.
    const level = clientOver({ 0: 'already-level' });
    const told = recordingAsk();
    await deskewPagesCommand({ client: level.client, onApplied: () => undefined, stamp: STAMP, signatures, ask: told.ask, track: UNTRACKED }).run(
      contextWith(1),
    );
    expect(level.dispatched).toStrictEqual([]);
    expect(told.opened).toStrictEqual([{ id: STRAIGHTEN_OUTCOME_DIALOG_ID, props: { pages: 1, straightened: 0 } }]);

    const tilted = clientOver({});
    const second = recordingAsk();
    await deskewPagesCommand({ client: tilted.client, onApplied: () => undefined, stamp: STAMP, signatures, ask: second.ask, track: UNTRACKED }).run(
      contextWith(1),
    );
    expect(tilted.dispatched).toStrictEqual([{ kind: 'deskewPages', pages: 'all' }]);
    expect(second.opened).toStrictEqual([{ id: STRAIGHTEN_OUTCOME_DIALOG_ID, props: { pages: 1, straightened: 1 } }]);
  });

  it('a refused read is SAID and nothing is sent; a page gone past the end stops quietly', async () => {
    const busy = clientOver({ 1: 'busy' });
    const told = recordingAsk();
    await deskewPagesCommand({ client: busy.client, onApplied: () => undefined, stamp: STAMP, signatures, ask: told.ask, track: UNTRACKED }).run(
      contextWith(3),
    );
    // THE WALK STOPS at the refusal rather than claiming an outcome for pages it never read.
    expect(busy.read.map((entry) => entry.page)).toStrictEqual([0, 1]);
    expect(busy.dispatched).toStrictEqual([]);
    expect(told.opened).toStrictEqual([{ id: COMMAND_PROBLEM_DIALOG_ID, props: { code: 'document-busy' } }]);

    // PAGES REMOVED WHILE THE WALK RAN: nothing a person can act on, so no problem dialog, and nothing written.
    const gone = clientOver({ 2: 'gone' });
    const quiet = recordingAsk();
    await deskewPagesCommand({ client: gone.client, onApplied: () => undefined, stamp: STAMP, signatures, ask: quiet.ask, track: UNTRACKED }).run(
      contextWith(3),
    );
    expect(gone.dispatched).toStrictEqual([]);
    expect(quiet.opened).toStrictEqual([]);
  });

  it('a cancelled walk sends and says nothing', async () => {
    const { client, dispatched, read } = clientOver({});
    const { ask, opened } = recordingAsk();
    const controller = new AbortController();
    const track: TrackTask = () => ({
      signal: controller.signal,
      step: () => {
        controller.abort();
      },
      end: () => undefined,
    });

    await deskewPagesCommand({ client, onApplied: () => undefined, stamp: STAMP, signatures, ask, track }).run(contextWith(3));

    expect(read).toHaveLength(1);
    expect(dispatched).toStrictEqual([]);
    expect(opened).toStrictEqual([]);
  });
});
