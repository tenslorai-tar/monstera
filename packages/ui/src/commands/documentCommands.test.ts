import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import { type Applied, rotatePageCommand, saveCommand, undoCommand } from './documentCommands.js';

/**
 * What each document command hands back, and — more often — what it does not.
 *
 * ## Every case here asserts a DECISION, not a state
 *
 * These commands own one decision each: *did the document move, and to what*.
 * The state a correct decision produces is routinely the state an absent
 * decision produces too — a refused save and a successful one both leave the
 * renderer showing the same pixels — so what is asserted is the call that was or
 * was not made, with the arguments it carried.
 *
 * ## Why this is not covered by `App.test.tsx`
 *
 * That file asserts the control dispatches the command, which is the wired-tools
 * pair's UI half. It cannot see this: happy-dom implements no canvas and no
 * worker, so PDF.js never starts, the transport is never driven, and there is no
 * DOM observable for *the view was rebuilt against a new byte length*. A case
 * written against the range requests found zero of them.
 */

const DOC = asDocId('doc-1');
const CONTEXT: CommandContext = {
  docId: DOC,
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
};

/** The context with no document, for the `when` cases. */
const NO_DOCUMENT: CommandContext = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
};

/**
 * A client answering one channel, through the real schemas.
 *
 * `createClient` parses what comes back, so an answer these cases invent that
 * the contract would refuse fails here rather than teaching a command a shape
 * nothing ships.
 */
function clientAnswering(id: string, answer: unknown): ContractClient {
  return createClient(channels, (asked) => {
    if (asked !== id) throw new Error(`this fixture answers ${id}, not ${asked}`);
    return Promise.resolve(ok(answer));
  });
}

/** A client whose one channel reports a declared failure. */
function clientFailing(code: string): ContractClient {
  return createClient(channels, () => Promise.resolve(err({ code })));
}

/** Records what `onApplied` was called with, and how often. */
function recorder(): { readonly applied: Applied[]; readonly onApplied: (a: Applied) => void } {
  const applied: Applied[] = [];
  return { applied, onApplied: (a) => applied.push(a) };
}

describe('rotate page', () => {
  it('hands back BOTH scalars, exactly as the channel answered them', async () => {
    const { applied, onApplied } = recorder();
    const client = clientAnswering('document.execute', {
      version: asDocVersion(2),
      byteLength: 2048,
    });

    await rotatePageCommand({ client, onApplied }).run(CONTEXT);

    // The byte length is the half that is easy to drop, and dropping it is not
    // visible in any state: the version alone rebinds the renderer's transport
    // to the previous image's length, which is a RangeError past the end of the
    // new document or a parse of a truncated one.
    expect(applied).toStrictEqual([{ version: 2, byteLength: 2048 }]);
  });

  it('a declared failure changes nothing, so the view is not rebuilt', async () => {
    // `document-busy` leaves the document exactly as it was. Telling the caller
    // it moved would make the renderer reopen for nothing — a visible reparse
    // for an operation that did not happen. Asserting the absent call is the
    // only thing that separates this from a command that always reports.
    const { applied, onApplied } = recorder();

    await rotatePageCommand({ client: clientFailing('document-busy'), onApplied }).run(CONTEXT);

    expect(applied).toStrictEqual([]);
  });

  it('is unavailable with no document focused', () => {
    // `when` is what keeps it off the start screen, and the registry applies it
    // before any projection — so a surface never has to ask, which is the
    // difference between a control that is absent and one that is present and
    // does nothing.
    const { onApplied } = recorder();
    const command = rotatePageCommand({ client: clientFailing('document-busy'), onApplied });

    expect(command.when?.(NO_DOCUMENT)).toBe(false);
    expect(command.when?.(CONTEXT)).toBe(true);
  });
});

describe('undo', () => {
  it('hands back both scalars when something moved', async () => {
    const { applied, onApplied } = recorder();
    const client = clientAnswering('document.undo', {
      kind: 'undone',
      version: asDocVersion(2),
      byteLength: 900,
    });

    await undoCommand({ client, onApplied }).run(CONTEXT);

    expect(applied).toStrictEqual([{ version: 2, byteLength: 900 }]);
  });

  it('an exhausted log is a SUCCESS that changed nothing', async () => {
    // `nothing-to-undo` is `ok`, and a command that reported it as a move would
    // reopen the document because a user pressed a key one time too many. The
    // outcome shape is what separates them — the envelope is `ok` either way.
    const { applied, onApplied } = recorder();
    const client = clientAnswering('document.undo', { kind: 'nothing-to-undo' });

    await undoCommand({ client, onApplied }).run(CONTEXT);

    expect(applied).toStrictEqual([]);
  });

  it('declares the chord, because a chord is a property of the command', () => {
    // §7 makes the shortcut map a projection of the registry, so declaring it
    // here is the whole of registering it. A keymap listing it separately would
    // be the second wiring place.
    const { onApplied } = recorder();
    expect(undoCommand({ client: clientFailing('document-busy'), onApplied }).shortcut).toBe(
      'Ctrl+Z',
    );
  });
});

describe('save', () => {
  it('dispatches, and takes no callback at all', async () => {
    // THE TYPE IS THE ASSERTION, and it is why this reads as a shorter case than
    // its siblings. A save changes the file, not the document: the canonical
    // image main holds is the same bytes the renderer is already showing, so
    // rebuilding the view would reparse a document that has not changed.
    //
    // `saveCommand` therefore takes no `onApplied` — there is no shape in which
    // it can report a move, rather than a rule about not calling one (B5).
    let asked: string | undefined;
    const client = createClient(channels, (id) => {
      asked = id;
      return Promise.resolve(ok({ kind: 'saved', version: asDocVersion(2) }));
    });

    const shown: { id: string; props: unknown }[] = [];
    await saveCommand({ client, show: (id, props) => shown.push({ id, props }) }).run(CONTEXT);

    expect(asked).toBe('document.save');
    // ASSERT THE CALL THAT WAS NOT MADE. A dialog on the successful path is one
    // that appears every time the user presses Ctrl+S, and the tidy end state —
    // a saved document — is identical either way.
    expect(shown).toStrictEqual([]);
  });

  it('a refused save TELLS the user, and says which refusal it was', async () => {
    // Invariant 18: a failed save never loses work, and `refused` leaves the
    // document intact, still dirty, with its log untouched. It is not a failure
    // code and must not become an exception here.
    //
    // IT WAS SILENT UNTIL 2026-08-30, which is worse than an error: the command
    // received the answer and returned, so pressing Save produced exactly what
    // success produces. The previous version of this case pinned that silence as
    // current behaviour; this one pins the answer.
    //
    // `reason` is required by the schema, which is the boundary insisting a
    // refusal says which of the four it was — the difference between "somebody
    // else has the file" and "the target is gone" is the whole of what a user
    // can act on, so it is asserted rather than the dialog id alone.
    const client = clientAnswering('document.save', { kind: 'refused', reason: 'contested' });
    const shown: { id: string; props: unknown }[] = [];

    await expect(
      saveCommand({ client, show: (id, props) => shown.push({ id, props }) }).run(CONTEXT),
    ).resolves.toBeUndefined();

    expect(shown).toStrictEqual([
      { id: 'dialog.save-problem', props: { outcome: 'contested' } },
    ]);
  });

  it('a write failure reaches the same dialog, flattened into one enum', async () => {
    // The channel answers two shapes describing one thing — `{kind: 'refused',
    // reason}` and `{kind: 'write-failed'}` — and the dialog takes one enum, so
    // its body switches once. Without this case the flattening is exercised on
    // one side only, and the side with no `reason` field is the one that would
    // send `undefined`.
    const client = clientAnswering('document.save', { kind: 'write-failed' });
    const shown: { id: string; props: unknown }[] = [];

    await saveCommand({ client, show: (id, props) => shown.push({ id, props }) }).run(CONTEXT);

    expect(shown).toStrictEqual([
      { id: 'dialog.save-problem', props: { outcome: 'write-failed' } },
    ]);
  });

  it('a DECLARED FAILURE opens nothing, because it is a different kind of refusal', async () => {
    // `document-busy` is transient and `document-poisoned` is an inconsistency a
    // user cannot act on. Putting "your changes are still here" in front of
    // either is true and useless, and the dialog's whole job is the sentence it
    // leads with. Asserted as the call that was not made, since the end state —
    // an unsaved document — is the same as a refusal's.
    const client = createClient(channels, () =>
      Promise.resolve(err({ code: 'document-busy' as const })),
    );
    const shown: { id: string; props: unknown }[] = [];

    await saveCommand({ client, show: (id, props) => shown.push({ id, props }) }).run(CONTEXT);

    expect(shown).toStrictEqual([]);
  });
});
