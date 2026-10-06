import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { SIGNATURE_TOOL_ID } from '../annotations/signatureTool.js';
import { SIGNATURE_DIALOG_ID } from '../dialogs/signature.js';
import { SIGNATURE_PROBLEM_DIALOG_ID } from '../dialogs/signatureProblem.js';
import { TOAST_SIGNATURE_LIBRARY_FULL, TOAST_SIGNATURE_NOT_KEEPABLE } from '../messages/en.js';
import type { CommandContext } from '../registries/commands.js';
import { outlinedMarkOf } from '../signatureFaces.js';
import { chooseSignature, placePlainSignature, signatureCommand } from './signatureCommands.js';

/**
 * The plain Signature's renderer half (ADR-0133): the UI half of the wired pair. A placement must reach
 * `document.placeSignature` with EXACTLY the look, keep, page and rectangle it was given — the kernel half
 * (`placedSignature.test.ts`) proves that command puts the mark on the page and keeps it through a save.
 */

const DOC = asDocId('00000000-0000-4000-8000-0000000000c1');
const RECT = { x0: 100, y0: 100, x1: 250, y1: 150 } as const;
const STAMP = { author: 'A. Tester', created: '2026-10-02T12:00:00Z' } as const;
const TYPED = { mark: { kind: 'typed', text: 'Ada Lovelace', font: 'great-vibes' }, keep: true } as const;

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
    // A TYPED NAME CROSSES AS ITS OUTLINE, made from its face by the one module that sets names (ADR-0150): the same
    // outline that module answers, so what the dialog showed is what the page is sent.
    const outlined = await outlinedMarkOf(TYPED.mark);
    if (outlined.kind !== 'ready') throw new Error(outlined.kind);
    expect(calls).toStrictEqual([
      ['document.placeSignature', { docId: DOC, page: 2, rect: RECT, mark: outlined.mark, keep: true, stamp: STAMP }],
    ]);
    expect(outlined.mark).toMatchObject({ kind: 'outlined', text: 'Ada Lovelace', font: 'great-vibes' });
    expect(onApplied).toHaveBeenCalledWith({ version: asDocVersion(5), byteLength: 1000 });
    expect(version).toBe(asDocVersion(5));
  });

  it('a typed name its face CANNOT WRITE sends nothing, and says which characters', async () => {
    const { client, calls } = answering(PLACED);
    const ask = vi.fn(() => Promise.resolve(undefined));
    const version = await placePlainSignature({ client, ask, onApplied: vi.fn(), stamp: () => STAMP, toast: vi.fn() }, DOC, 0, RECT, {
      mark: { kind: 'typed', text: 'Ада', font: 'sacramento' },
      keep: true,
    });
    // SACRAMENTO'S FILES ARE LATIN ONLY, so each Cyrillic letter is named, once, in the order typed.
    expect(ask).toHaveBeenCalledWith(SIGNATURE_PROBLEM_DIALOG_ID, { reason: 'cannot-write', characters: 'А д а' });
    expect(calls).toStrictEqual([]);
    expect(version).toBeUndefined();
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
      [{ kind: 'scan-blank' }, { reason: 'scan-blank' }],
      [{ kind: 'scan-locked' }, { reason: 'scan-locked' }],
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

  it('UPLOAD’S PICK asks main to hold a picture, then asks AGAIN with it shown — its blob let go once the dialog is done', async () => {
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
    const calls: string[] = [];
    const client = createClient(channels, (id) => {
      calls.push(id);
      if (id === 'library.list') return Promise.resolve(ok({ entries: [] }));
      return Promise.resolve(
        ok({ kind: 'picked', handle: 'held-7', name: 'Mine.png', mediaType: 'image/png', bytes }),
      );
    });
    const made: [Uint8Array, string][] = [];
    const revoked: string[] = [];
    const urls = {
      make: (from: Uint8Array, type: string) => {
        made.push([from, type]);
        return `blob:made-${String(made.length)}`;
      },
      revoke: (url: string) => {
        revoked.push(url);
      },
    };
    const look = { mark: { kind: 'image', picked: 'held-7' }, keep: false } as const;
    const ask = vi.fn().mockResolvedValueOnce({ upload: 'pick', keep: false }).mockResolvedValueOnce(look);
    expect(await chooseSignature({ client, ask }, urls)).toStrictEqual(look);
    expect(calls).toStrictEqual(['library.list', 'signature.pickPicture', 'library.list']);
    // THE SECOND ASKING SHOWS THE PICTURE main answered, by a blob of exactly its bytes, with keep as it was left.
    expect(made).toStrictEqual([[bytes, 'image/png']]);
    expect(ask).toHaveBeenNthCalledWith(2, SIGNATURE_DIALOG_ID, {
      kept: [],
      picked: { handle: 'held-7', name: 'Mine.png', src: 'blob:made-1' },
      keep: false,
    });
    expect(revoked).toStrictEqual(['blob:made-1']);
  });

  it('CONTROL: a CANCELLED pick asks again with no picture — and a refused one says why first', async () => {
    let answer: unknown = { kind: 'cancelled' };
    const client = createClient(channels, (id) =>
      Promise.resolve(ok(id === 'library.list' ? { entries: [] } : answer)),
    );
    const ask = vi.fn().mockResolvedValueOnce({ upload: 'pick', keep: true }).mockResolvedValueOnce(undefined);
    await chooseSignature({ client, ask }, { make: () => 'blob:never', revoke: () => undefined });
    expect(ask).toHaveBeenNthCalledWith(2, SIGNATURE_DIALOG_ID, { kept: [], keep: true });

    answer = { kind: 'unreadable' };
    const refusedAsk = vi
      .fn()
      .mockResolvedValueOnce({ upload: 'pick', keep: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await chooseSignature({ client, ask: refusedAsk }, { make: () => 'blob:never', revoke: () => undefined });
    expect(refusedAsk).toHaveBeenNthCalledWith(2, SIGNATURE_PROBLEM_DIALOG_ID, { reason: 'unreadable' });
    expect(refusedAsk).toHaveBeenNthCalledWith(3, SIGNATURE_DIALOG_ID, { kept: [], keep: true });
  });

  it('a scanned PDF Upload could not use says WHY — no ink, or a password — and asks again (G3d)', async () => {
    for (const kind of ['scan-blank', 'scan-locked'] as const) {
      const client = createClient(channels, (id) => Promise.resolve(ok(id === 'library.list' ? { entries: [] } : { kind })));
      const ask = vi
        .fn()
        .mockResolvedValueOnce({ upload: 'pick', keep: true })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      await chooseSignature({ client, ask }, { make: () => 'blob:never', revoke: () => undefined });
      // ITS OWN REASON, never `unreadable`: the file was read, and what it lacked is what the person can change.
      expect(ask).toHaveBeenNthCalledWith(2, SIGNATURE_PROBLEM_DIALOG_ID, { reason: kind });
      expect(ask).toHaveBeenNthCalledWith(3, SIGNATURE_DIALOG_ID, { kept: [], keep: true });
    }
  });

  it('a KEPT TYPED signature chosen by its id answers its name and face, and CONTROL: a kept drawing stays its id', async () => {
    const TYPED_ID = '00000000-0000-4000-8000-0000000000b1';
    const DRAWN_ID = '00000000-0000-4000-8000-0000000000b2';
    const client = createClient(channels, (id) =>
      Promise.resolve(
        ok(
          id === 'library.list'
            ? {
                entries: [
                  // KEPT BEFORE ADR-0150, in a retired face: read as its nearest.
                  { id: TYPED_ID, kind: 'signature', look: { kind: 'typed', text: 'Ada', font: 'times-italic' } },
                  { id: DRAWN_ID, kind: 'signature', look: { kind: 'drawn', strokes: [[[0, 0], [1, 1]]] } },
                ],
              }
            : { removed: true },
        ),
      ),
    );
    const typed = await chooseSignature({ client, ask: vi.fn().mockResolvedValue({ mark: { kind: 'saved', id: TYPED_ID }, keep: false }) });
    expect(typed).toStrictEqual({ mark: { kind: 'typed', text: 'Ada', font: 'garamond-italic' }, keep: false });
    const drawn = await chooseSignature({ client, ask: vi.fn().mockResolvedValue({ mark: { kind: 'saved', id: DRAWN_ID }, keep: false }) });
    expect(drawn).toStrictEqual({ mark: { kind: 'saved', id: DRAWN_ID }, keep: false });
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
