// @vitest-environment happy-dom
import { channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type SignedEditing, applyDocumentCommand } from './documentCommands.js';

/**
 * The write markers a walk waits on instead of a sleep (the stage audit's GGGGGGGG-3): `data-writes` in flight and
 * `data-writes-done` finished, on the root element, from the one dispatcher every command goes through.
 */

const DOC = asDocId('doc-writes');
const signatures: SignedEditing = {
  warn: () => true,
  onOpened: () => {
    throw new Error('a case opened a copy for an edit without asking for one');
  },
};

function marks(): { inFlight: string | undefined; done: number } {
  return { inFlight: document.documentElement.dataset['writes'], done: Number(document.documentElement.dataset['writesDone'] ?? '0') };
}

describe('the write markers', () => {
  it('count a write in flight from its send until it has applied, and the finished count only grows', async () => {
    let answer: (() => void) | undefined;
    const client = createClient(channels, () =>
      new Promise((resolve) => {
        answer = () => {
          resolve(ok({ version: asDocVersion(2), byteLength: 10, historyDropped: 0, boxed: [], more: 0, unsealedCopies: [], unsealedUndoCopies: 0 }));
        };
      }),
    );
    const before = marks().done;
    const running = applyDocumentCommand(
      { client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, signatures, stamp: () => ({ author: '', created: '2026-10-15T00:00:00.000Z' }) },
      DOC,
      { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    );
    // IN FLIGHT AT ONCE, before main has answered: a walk that noted the finished count sees it unchanged.
    expect(marks()).toStrictEqual({ inFlight: '1', done: before });
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer?.();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // LANDED: none in flight, and the finished count has passed the note, which a reading taken before the write began
    // could not show.
    expect(marks()).toStrictEqual({ inFlight: '0', done: before + 1 });
  });

  it('count a refused write as finished too, so a walk waiting on it is not left waiting', async () => {
    const client = createClient(channels, () => Promise.reject(new Error('the transport failed')));
    const before = marks().done;
    await applyDocumentCommand(
      { client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, signatures, stamp: () => ({ author: '', created: '2026-10-15T00:00:00.000Z' }) },
      DOC,
      { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(marks()).toStrictEqual({ inFlight: '0', done: before + 1 });
  });
});
