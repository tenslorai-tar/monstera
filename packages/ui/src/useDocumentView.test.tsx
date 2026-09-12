// @vitest-environment happy-dom
import {
  type ChannelResult,
  type ContractClient,
  channels,
  createClient,
} from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDocumentView } from './useDocumentView.js';

/**
 * The RENDERER half of the encrypted-document row's wired pair
 * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
 *
 * The kernel half is `mupdfWriter.test.ts`, which proves the engine unlocks and
 * that `needsPassword()` breaks a session. Neither half alone is the feature:
 * an engine that unlocks with nobody asking is a capability nothing reaches,
 * and a prompt that dispatches into the void is the display-only defect this
 * repository names by name.
 *
 * ## What this file asserts is a CALL, not an end state
 *
 * *The view opened* is what a correct flow produces and it is also what a flow
 * that never asked main would produce, because the stub parser below would
 * accept any password. So every case here asserts **which call was made with
 * what** — the checklist's own rule for a decision whose job is to avoid doing
 * something.
 */
vi.mock('./documentView.js', () => ({
  // THE STUB IS DRIVEN BY THE PASSWORD IT IS GIVEN, which is what lets the
  // cases below distinguish *asked and was told yes* from *asked nobody*.
  openDocumentView: (options: { readonly docId: string; readonly password?: string }) =>
    options.docId !== UNENCRYPTED && options.password === undefined
      ? Promise.reject(new StubPasswordError())
      : Promise.resolve({ document: { numPages: 1 }, close: () => Promise.resolve() }),
  needsPasswordToParse: (cause: unknown) => cause instanceof StubPasswordError,
}));

/**
 * Stands in for PDF.js's `PasswordException`.
 *
 * A class of our own rather than the real one, because importing PDF.js to
 * construct an error would load a parser this file has just mocked away. What
 * matters is that the mocked `needsPasswordToParse` recognises exactly this and
 * nothing else, which is the same discrimination the real one makes.
 */
class StubPasswordError extends Error {
  constructor() {
    super('this stub parser will not proceed without a password');
  }
}

/** The one id the stub parser opens with no password — the control's fixture. */
const UNENCRYPTED = 'doc-with-no-encrypt-dictionary';

const DOC = {
  docId: asDocId('doc-under-test'),
  version: asDocVersion(1),
  byteLength: 1024,
};

const ignoreVersion = (): void => undefined;

/** What one `document.unlock` answers. */
type UnlockAnswer = ChannelResult<'document.unlock'>;

/**
 * A client that answers `document.unlock` from a queue and records the params.
 *
 * **Built here rather than taken from `@monstera/testing`'s browser shim**, and
 * the reason is the boundary rather than a preference: `packages/ui` may not
 * import that package, because the shim is a Node-side fixture corpus. Every
 * other renderer test builds its client the same way, through the real
 * `createClient` — so answers these cases invent that the contract would refuse
 * fail here rather than teaching a component a shape nothing ships.
 *
 * Exhausted, it answers `not-locked`, which is what an unencrypted document
 * gets. A default of `wrong-password` would make a case that never set up a
 * queue loop for a reason it never stated.
 */
function unlockingClient(answers: readonly UnlockAnswer[]): {
  readonly client: ContractClient;
  readonly unlocks: { readonly docId: DocId; readonly password: string }[];
} {
  const queued = [...answers];
  const unlocks: { docId: DocId; password: string }[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.unlock') {
      return Promise.reject(new Error(`this fixture answers document.unlock only, not ${id}`));
    }
    unlocks.push(params as { docId: DocId; password: string });
    return Promise.resolve(ok(queued.shift() ?? ({ kind: 'not-locked' } as const)));
  });
  return { client, unlocks };
}

describe('useDocumentView — an encrypted document', () => {
  it('asks MAIN before it hands the password to the parser, and opens on unlocked', async () => {
    const { client, unlocks } = unlockingClient([{ kind: 'unlocked', access: 2 }]);

    // HOISTED, and every case here does the same. The hook's effect depends on
    // this callback's identity, so an arrow written inline in the render
    // function is a NEW dependency on every render — which cancels the open in
    // flight and starts another, for ever. That is the hook behaving correctly
    // about a caller that is not: `App.tsx` binds this through `useCallback`.
    const prompt = (): Promise<string> => Promise.resolve('reader-secret');
    const { result } = renderHook(() =>
      useDocumentView(client, DOC, ignoreVersion, prompt),
    );

    await waitFor(() => {
      expect(result.current.ready).toBeDefined();
    });
    // THE CALL, AND ITS ARGUMENT. A renderer that gave the password only to
    // PDF.js would produce the same `ready` and leave main with no engine
    // session for this document — a view that renders and refuses every
    // command.
    expect(unlocks).toStrictEqual([{ docId: DOC.docId, password: 'reader-secret' }]);
  });

  it('asks AGAIN on wrong-password, and the second prompt is told it is a retry', async () => {
    const { client } = unlockingClient([
      { kind: 'wrong-password' },
      { kind: 'unlocked', access: 2 },
    ]);
    const retries: boolean[] = [];

    const prompt = (retry: boolean): Promise<string> => {
      retries.push(retry);
      return Promise.resolve(retry ? 'reader-secret' : 'wrong');
    };
    const { result } = renderHook(() => useDocumentView(client, DOC, ignoreVersion, prompt));

    await waitFor(() => {
      expect(result.current.ready).toBeDefined();
    });
    // FALSE THEN TRUE, and the second value is the one that matters: a loop
    // that passed `false` every time would still open the document and would
    // show a person the first-time sentence after a refusal, with nothing
    // anywhere saying their password was wrong.
    expect(retries).toStrictEqual([false, true]);
  });

  it('DOES NOT open the parser when main refuses and the person gives up', async () => {
    const { client, unlocks } = unlockingClient([{ kind: 'wrong-password' }]);

    const prompt = (retry: boolean): Promise<string | undefined> =>
      Promise.resolve(retry ? undefined : 'wrong');
    const { result } = renderHook(() => useDocumentView(client, DOC, ignoreVersion, prompt));

    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.ready).toBeUndefined();
    // ONCE, which is the assertion a `failed` flag cannot make: a loop that
    // kept trying after the dismissal would end in the same state and would
    // have gone on asking the engine. The queue below it holds `not-locked`,
    // which a second attempt would have taken and opened on.
    expect(unlocks).toHaveLength(1);
  });

  it('CONTROL: an unencrypted document never asks, for a password or for main', async () => {
    // Without this every case above is satisfied by a hook that prompts
    // unconditionally — which would put a password dialog in front of every
    // document this application opens, and would ask main to unlock documents
    // that were never locked.
    //
    // The stub above opens `UNENCRYPTED` with no password, which is the one
    // input the three cases above do not use: they distinguish nothing about
    // the parser's first attempt, and this distinguishes only that.
    const { client, unlocks } = unlockingClient([]);
    const prompt = vi.fn(() => Promise.resolve('never-needed'));

    const { result } = renderHook(() =>
      useDocumentView(client, { ...DOC, docId: asDocId(UNENCRYPTED) }, ignoreVersion, prompt),
    );

    await waitFor(() => {
      expect(result.current.ready).toBeDefined();
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(unlocks).toStrictEqual([]);
  });
});
