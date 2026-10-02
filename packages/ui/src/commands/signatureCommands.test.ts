import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { SIGNATURE_TOOL_ID } from '../annotations/signatureTool.js';
import { SIGNATURE_DIALOG_ID } from '../dialogs/signature.js';
import { SIGNATURE_PROBLEM_DIALOG_ID } from '../dialogs/signatureProblem.js';
import { TOAST_SIGNATURE_LIBRARY_FULL, TOAST_SIGNATURE_NOT_KEEPABLE } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { chooseSignature, placePlainSignature, signatureCommand } from './signatureCommands.js';

/**
 * The plain Signature's renderer half (ADR-0133): the UI half of the wired pair. A placement must reach
 * `document.placeSignature` with EXACTLY the look, keep, page and rectangle it was given — the kernel half
 * (`placedSignature.test.ts`) proves that command puts the mark on the page and keeps it through a save.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c1');
const RECT = { x0: 100, y0: 100, x1: 250, y1: 150 } as const;
const STAMP = { author: 'A. Tester', created: '2026-10-02T12:00:00Z' } as const;
const TYPED = { mark: { kind: 'typed', text: 'Ada Lovelace', font: 'times-italic' }, keep: true } as const;

/** A client answering `document.placeSignature` with `answer`, recording every call and its params. */
function answering(answer: unknown): { readonly client: ContractClient; readonly calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  const client = createClient(channels, (id, params) => {
    calls.push([id, params]);
    if (id === 'document.placeSignature') return Promise.resolve(ok(answer));
    if (id === 'library.list') return Promise.resolve(ok({ entries: [] }));
    return Promise.resolve(ok({ removed: true }));
  });
  return { client, calls };
}

const CONTEXT: CommandContext = {
  docId: DOC,
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
  selectedPages: [],
};

const PLACED = { kind: 'placed', version: asDocVersion(5), byteLength: 1000, historyDropped: 0, kept: 'kept' } as const;

describe('placePlainSignature', () => {
  it('sends EXACTLY the look, keep, page, rectangle and stamp — and moves the document on the answer', async () => {
    const { client, calls } = answering(PLACED);
    const onApplied = vi.fn();
    const version = await placePlainSignature(
      { client, ask: vi.fn(), onApplied, stamp: () => STAMP, toast: vi.fn() },
      DOC,
      2,
      RECT,
      TYPED,
    );
    expect(calls).toStrictEqual([
      ['document.placeSignature', { docId: DOC, page: 2, rect: RECT, mark: TYPED.mark, keep: true, stamp: STAMP }],
    ]);
    expect(onApplied).toHaveBeenCalledWith({ version: asDocVersion(5), byteLength: 1000 });
    expect(version).toBe(asDocVersion(5));
  });

  it('a placement whose KEEP was refused for a full library is placed AND says so', async () => {
    const { client } = answering({ ...PLACED, kept: 'library-full' });
    const toast = vi.fn();
    await placePlainSignature({ client, ask: vi.fn(), onApplied: vi.fn(), stamp: () => STAMP, toast }, DOC, 0, RECT, TYPED);
    expect(toast).toHaveBeenCalledWith('done', TOAST_SIGNATURE_LIBRARY_FULL);
  });

  it('a picture too large to keep is placed AND says it was not kept', async () => {
    const { client } = answering({ ...PLACED, kept: 'not-keepable' });
    const toast = vi.fn();
    await placePlainSignature({ client, ask: vi.fn(), onApplied: vi.fn(), stamp: () => STAMP, toast }, DOC, 0, RECT, {
      mark: { kind: 'image' },
      keep: true,
    });
    expect(toast).toHaveBeenCalledWith('done', TOAST_SIGNATURE_NOT_KEEPABLE);
  });

  it('CONTROL: a placement that was kept says nothing — the page shows the mark', async () => {
    const { client } = answering(PLACED);
    const toast = vi.fn();
    await placePlainSignature({ client, ask: vi.fn(), onApplied: vi.fn(), stamp: () => STAMP, toast }, DOC, 0, RECT, TYPED);
    expect(toast).not.toHaveBeenCalled();
  });

  it('each refusal opens the signature problem with its reason, and moves nothing', async () => {
    for (const [answer, props] of [
      [{ kind: 'unreadable' }, { reason: 'unreadable' }],
      [{ kind: 'too-large', limitBytes: 67_108_864 }, { reason: 'too-large', limitBytes: 67_108_864 }],
      [{ kind: 'absent' }, { reason: 'absent' }],
      [{ kind: 'unencodable-text' }, { reason: 'unencodable-text' }],
    ] as const) {
      const { client } = answering(answer);
      const ask = vi.fn(() => Promise.resolve(undefined));
      const onApplied = vi.fn();
      const version = await placePlainSignature({ client, ask, onApplied, stamp: () => STAMP, toast: vi.fn() }, DOC, 0, RECT, TYPED);
      expect(ask).toHaveBeenCalledWith(SIGNATURE_PROBLEM_DIALOG_ID, props);
      expect(onApplied).not.toHaveBeenCalled();
      expect(version).toBeUndefined();
    }
  });

  it('a closed picker places nothing and says nothing', async () => {
    const { client } = answering({ kind: 'cancelled' });
    const ask = vi.fn();
    expect(
      await placePlainSignature({ client, ask, onApplied: vi.fn(), stamp: () => STAMP, toast: vi.fn() }, DOC, 0, RECT, TYPED),
    ).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('chooseSignature', () => {
  it('answers the look the dialog answered, after REMOVING a kept one and asking again', async () => {
    const { client, calls } = answering(PLACED);
    const ask = vi
      .fn()
      .mockResolvedValueOnce({ library: 'remove', id: '00000000-0000-4000-8000-0000000000a1' })
      .mockResolvedValueOnce(TYPED);
    expect(await chooseSignature({ client, ask }, { make: () => 'blob:x', revoke: () => undefined })).toStrictEqual(TYPED);
    expect(ask).toHaveBeenNthCalledWith(1, SIGNATURE_DIALOG_ID, { kept: [] });
    expect(calls.map(([id]) => id)).toStrictEqual(['library.list', 'library.remove', 'library.list']);
  });

  it('a dismissed dialog answers nothing', async () => {
    const { client } = answering(PLACED);
    expect(await chooseSignature({ client, ask: vi.fn().mockResolvedValue(undefined) })).toBeUndefined();
  });
});

describe('signatureCommand', () => {
  it('sits on Home › Quick tools and Comment › Stamps, and pressing it STARTS (the dialog) — or stops when armed', async () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const activeTool = vi.fn<() => string | undefined>(() => undefined);
    const command = signatureCommand({ activeTool, onStart, onStop });
    expect(command.placements.map((placement) => (placement.surface === 'ribbon' ? placement.section : placement.surface))).toStrictEqual([
      'home',
      'comment',
    ]);
    await command.run(CONTEXT);
    expect([onStart.mock.calls.length, onStop.mock.calls.length]).toStrictEqual([1, 0]);
    activeTool.mockReturnValue(SIGNATURE_TOOL_ID);
    await command.run(CONTEXT);
    expect([onStart.mock.calls.length, onStop.mock.calls.length]).toStrictEqual([1, 1]);
  });
});
