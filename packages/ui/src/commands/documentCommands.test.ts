import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import {
  type Applied,
  cropPagesCommand,
  watermarkPagesCommand,
  headerFooterCommand,
  deletePagesCommand,
  findDuplicatePagesCommand,
  rotatePageCommand,
  saveCommand,
  undoCommand,
} from './documentCommands.js';

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
  // NOT THE FIRST PAGE. A fixture at page 0 would make a command that ignored
  // the context and sent a literal zero pass every case below, which is the
  // exact defect the rotate shipped with in the other direction.
  page: 3,
  // AND NOT A COUNT THAT MAKES `page` THE LAST ONE, for the same reason one
  // step on: a document of exactly four pages would let a command that clamped
  // to the end look identical to one that used the page it was given.
  pageCount: 10,
};

/** The context with no document, for the `when` cases. */
const NO_DOCUMENT: CommandContext = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
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

/**
 * Records what `onApplied` was called with, and what dialogs were opened.
 *
 * Both in one recorder because both are **calls a command makes or does not
 * make**, and every case here is about one of the two. A case that asserted only
 * the applied list would be satisfied by a command that reports nothing, which
 * is what all three of these did until 2026-08-30.
 */
function recorder(): {
  readonly applied: Applied[];
  readonly onApplied: (a: Applied) => void;
  readonly shown: { id: string; props: unknown }[];
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
} {
  const applied: Applied[] = [];
  const shown: { id: string; props: unknown }[] = [];
  return {
    applied,
    onApplied: (a) => applied.push(a),
    shown,
    ask: askRecording(shown),
  };
}

/**
 * An `ask` that records the open and answers `undefined`.
 *
 * **Answers as a DISMISSAL**, which is what every dialog these cases open can
 * do: none of them declares a result. A stub resolving some value would let a
 * command that read an answer from an informational dialog pass — and the whole
 * point of ADR-0038's `never` default is that such a dialog cannot answer.
 */
function askRecording(
  shown: { id: string; props: unknown }[],
): (id: string, props: unknown) => Promise<unknown> {
  return (id, props) => {
    shown.push({ id, props });
    return Promise.resolve(undefined);
  };
}

describe('rotate page', () => {
  it('hands back BOTH scalars, exactly as the channel answered them', async () => {
    const { applied, onApplied, ask } = recorder();
    const client = clientAnswering('document.execute', {
      version: asDocVersion(2),
      byteLength: 2048,
      historyDropped: 0,
    });

    await rotatePageCommand({ client, onApplied, ask }).run(CONTEXT);

    // The byte length is the half that is easy to drop, and dropping it is not
    // visible in any state: the version alone rebinds the renderer's transport
    // to the previous image's length, which is a RangeError past the end of the
    // new document or a parse of a truncated one.
    expect(applied).toStrictEqual([{ version: 2, byteLength: 2048, historyDropped: 0 }]);
  });

  /**
   * Invariant 18's obligation, as a pair. This half asserts the command TELLS
   * the user; the kernel half (`commandBus.test.ts`) asserts the trim really
   * happened and by how much.
   */
  it('tells the user when the command cost undo steps, and says how many', async () => {
    const { applied, shown, onApplied, ask } = recorder();
    const client = clientAnswering('document.execute', {
      version: asDocVersion(2),
      byteLength: 2048,
      historyDropped: 3,
    });

    await rotatePageCommand({ client, onApplied, ask }).run(CONTEXT);

    expect(shown).toStrictEqual([
      { id: 'dialog.history-trimmed', props: { dropped: 3 } },
    ]);
    // AND THE VIEW STILL MOVED. The command succeeded; a version reported to
    // nobody would leave the renderer showing the page as it was while a dialog
    // explains what the rotation cost.
    expect(applied).toStrictEqual([{ version: 2, byteLength: 2048, historyDropped: 3 }]);
  });

  it('a declared failure changes nothing, so the view is not rebuilt', async () => {
    // `document-busy` leaves the document exactly as it was. Telling the caller
    // it moved would make the renderer reopen for nothing — a visible reparse
    // for an operation that did not happen. Asserting the absent call is the
    // only thing that separates this from a command that always reports.
    const { applied, onApplied, ask } = recorder();

    await rotatePageCommand({ client: clientFailing('document-busy'), onApplied, ask }).run(
      CONTEXT,
    );

    expect(applied).toStrictEqual([]);
  });

  it('...and it is REPORTED, because a refusal nobody renders is a dead control', async () => {
    // ADR-0009 §9 hands the renderer a code and never a diagnostic. That is half
    // a mechanism: until 2026-08-30 every code here met a bare `if (!ok) return`,
    // so a busy document and a working one produced the same nothing on screen.
    //
    // The code is asserted, not the dialog id alone: three commands share one
    // dialog, and which sentence the user reads is decided entirely by the code
    // that is passed through.
    const { shown, onApplied, ask } = recorder();

    await rotatePageCommand({ client: clientFailing('document-busy'), onApplied, ask }).run(
      CONTEXT,
    );

    expect(shown).toStrictEqual([
      { id: 'dialog.command-problem', props: { code: 'document-busy' } },
    ]);
  });

  it('CONTROL: a command that SUCCEEDED reports nothing', async () => {
    // Without this, the case above is satisfied by a command that opens the
    // dialog every time — which would put "that could not be done" in front of
    // a user whose rotation worked, and no other case here would notice.
    const { shown, onApplied, ask } = recorder();
    const client = clientAnswering('document.execute', {
      version: asDocVersion(2),
      byteLength: 2048,
      historyDropped: 0,
    });

    await rotatePageCommand({ client, onApplied, ask }).run(CONTEXT);

    expect(shown).toStrictEqual([]);
  });

  it('is unavailable with no document focused', () => {
    // `when` is what keeps it off the start screen, and the registry applies it
    // before any projection — so a surface never has to ask, which is the
    // difference between a control that is absent and one that is present and
    // does nothing.
    const { onApplied, ask } = recorder();
    const command = rotatePageCommand({ client: clientFailing('document-busy'), onApplied, ask });

    expect(command.when?.(NO_DOCUMENT)).toBe(false);
    expect(command.when?.(CONTEXT)).toBe(true);
  });
});

describe('undo', () => {
  it('hands back both scalars when something moved', async () => {
    const { applied, onApplied, ask } = recorder();
    const client = clientAnswering('document.undo', {
      kind: 'undone',
      version: asDocVersion(2),
      byteLength: 900,
    });

    await undoCommand({ client, onApplied, ask }).run(CONTEXT);

    // NO `historyDropped`, and that is the channel rather than an omission:
    // `document.undo` does not carry one, because undo cannot grow the log and
    // therefore never sheds. A field here would be this command inventing a
    // number the kernel did not report.
    expect(applied).toStrictEqual([{ version: 2, byteLength: 900 }]);
  });

  it('an exhausted log is a SUCCESS that changed nothing', async () => {
    // `nothing-to-undo` is `ok`, and a command that reported it as a move would
    // reopen the document because a user pressed a key one time too many. The
    // outcome shape is what separates them — the envelope is `ok` either way.
    const { applied, onApplied, ask } = recorder();
    const client = clientAnswering('document.undo', { kind: 'nothing-to-undo' });

    await undoCommand({ client, onApplied, ask }).run(CONTEXT);

    expect(applied).toStrictEqual([]);
  });

  it('declares the chord, because a chord is a property of the command', () => {
    // §7 makes the shortcut map a projection of the registry, so declaring it
    // here is the whole of registering it. A keymap listing it separately would
    // be the second wiring place.
    const { onApplied, ask } = recorder();
    expect(undoCommand({ client: clientFailing('document-busy'), onApplied, ask }).shortcut).toBe(
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
    await saveCommand({ client, ask: askRecording(shown) }).run(CONTEXT);

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
      saveCommand({ client, ask: askRecording(shown) }).run(CONTEXT),
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

    await saveCommand({ client, ask: askRecording(shown) }).run(CONTEXT);

    expect(shown).toStrictEqual([
      { id: 'dialog.save-problem', props: { outcome: 'write-failed' } },
    ]);
  });

  it('a DECLARED FAILURE goes to the OTHER dialog, because it is a different kind of refusal', async () => {
    // `document-busy` is transient; `document-poisoned` is the supervisor's
    // decision. Putting "the file was not written — your changes are still
    // here" in front of either is wrong twice over: nothing was written and
    // nothing was attempted.
    //
    // The assertion is which DIALOG, and that is the case. Both are dialogs and
    // both leave the document unsaved, so the end state cannot separate them —
    // only the id can.
    const client = createClient(channels, () =>
      Promise.resolve(err({ code: 'document-busy' as const })),
    );
    const shown: { id: string; props: unknown }[] = [];

    await saveCommand({ client, ask: askRecording(shown) }).run(CONTEXT);

    expect(shown).toStrictEqual([
      { id: 'dialog.command-problem', props: { code: 'document-busy' } },
    ]);
  });

  it('an INTERNAL failure carries its incident id through to the dialog', async () => {
    // The one part of a diagnostic that exists on this side (ADR-0009 §9), and
    // the only case where the props are more than a code. A command that passed
    // the code alone would render a dialog with nothing to quote, and every
    // other case here would still pass — the sentence is the same.
    const client = createClient(channels, () =>
      Promise.resolve(err({ code: 'internal' as const, incident: 'inc-42' })),
    );
    const shown: { id: string; props: unknown }[] = [];

    await saveCommand({ client, ask: askRecording(shown) }).run(CONTEXT);

    expect(shown).toStrictEqual([
      { id: 'dialog.command-problem', props: { code: 'internal', incident: 'inc-42' } },
    ]);
  });
});

/**
 * The mutation-dialog gate, as a pair of cases that must BOTH exist.
 *
 * A gate proven only by its refusal is satisfied by a dialog that can never
 * answer, which reads exactly like one that works. So the confirming case and
 * the dismissing case sit together, on the same fixture, differing only in what
 * the dialog settled with.
 *
 * Both assert **the call that was or was not made**, because the document is
 * unchanged either way from this side — `document.execute` going out is the
 * only observable difference between a gate that gates and no gate at all.
 */
describe('delete pages — the mutation-dialog gate', () => {
  /**
   * A client that records every channel call and answers `document.execute`.
   *
   * The recorder is the point: `shown` says the dialog opened and `sent` says
   * whether a command followed it, and only the second separates the two cases.
   */
  function recording(): {
    readonly client: ContractClient;
    readonly sent: { id: string; params: unknown }[];
  } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(
        ok({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0 }),
      );
    });
    return { client, sent };
  }

  it('dispatches deletePages with EXACTLY the pages the dialog answered', async () => {
    const { client, sent } = recording();
    const opened: { id: string; props: unknown }[] = [];

    await deletePagesCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        // ZERO-BASED, as `parsePageRanges` produces them. A command that
        // converted again would send [1, 3] and delete two other pages.
        return Promise.resolve({ pages: [0, 2] });
      },
    }).run(CONTEXT);

    // THE BOUND WENT IN. Without `pageCount` the dialog cannot refuse a page
    // the document does not have, and the props schema requires it — so a
    // command that omitted it would throw at the open call rather than here.
    expect(opened).toStrictEqual([
      { id: 'dialog.delete-pages', props: { pageCount: CONTEXT.pageCount } },
    ]);
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: { docId: DOC, command: { kind: 'deletePages', pages: [0, 2] } },
      },
    ]);
  });

  it('CONTROL: a DISMISSED dialog dispatches nothing', async () => {
    // The gate. `ask` settling `undefined` is what a dismissal is, and the
    // command has no value to build a command from — asserted as the call that
    // was not made, because the document is untouched either way and an
    // end-state assertion would pass with the whole mechanism deleted.
    const { client, sent } = recording();

    await deletePagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CROP PASSES THE SCOPE THROUGH, rather than expanding it to a list', async () => {
    // Invariant L11. A command that expanded `'all'` into one integer per page
    // would produce the same document and a payload that scales with it — and
    // it would give the kernel a second opinion about what *all* means, which
    // is the shape that agrees until one of the two learns about a page range.
    const { client, sent } = recording();

    await cropPagesCommand({
      client,
      onApplied: () => undefined,
      ask: () =>
        Promise.resolve({ pages: 'all', margins: { top: 1, right: 2, bottom: 3, left: 4 } }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'cropPages',
            pages: 'all',
            margins: { top: 1, right: 2, bottom: 3, left: 4 },
          },
        },
      },
    ]);
  });

  it('WATERMARK DISPATCHES EXACTLY WHAT THE DIALOG ANSWERED, including the opacity fraction', async () => {
    // THE UI HALF OF THE WIRED PAIR, and the number to watch is the opacity.
    // The dialog collects a PERCENTAGE and the command carries a FRACTION, so
    // this is the boundary where a unit changes — the wired pair's stated blind
    // spot. `pageWatermark.test.ts` proves the kernel draws at the opacity it
    // is given, and this proves the control sends the one the person chose; the
    // conversion lives in one named function in the body so the two halves
    // cannot hold different numbers without that function changing.
    const { client, sent } = recording();

    await watermarkPagesCommand({
      client,
      onApplied: () => undefined,
      ask: () =>
        Promise.resolve({
          pages: 'all',
          text: 'DRAFT',
          opacity: 0.3,
          rotationDegrees: 45,
          fontSize: 48,
        }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'watermarkPages',
            pages: 'all',
            text: 'DRAFT',
            opacity: 0.3,
            rotationDegrees: 45,
            fontSize: 48,
          },
        },
      },
    ]);
  });

  it('HEADERS AND FOOTERS DISPATCH ALL SIX SLOTS, with the template text untouched', async () => {
    // THE UI HALF OF THE PAIR. `pageStamp.test.ts` proves the kernel resolves
    // `{n}` per page; this proves the control sends the TEMPLATE rather than
    // something already resolved. A dialog that substituted the page number
    // itself would send "Page 1 of 3" and every page would say 1 — and the
    // kernel proof would stay green, because it would be given exactly what it
    // was asked to draw.
    const { client, sent } = recording();

    await headerFooterCommand({
      client,
      onApplied: () => undefined,
      ask: () =>
        Promise.resolve({
          pages: 'all',
          header: { left: 'Monstera', centre: '', right: '' },
          footer: { left: '', centre: 'Page {n} of {N}', right: '' },
          fontSize: 10,
          marginPoints: 36,
        }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'headerFooterPages',
            pages: 'all',
            header: { left: 'Monstera', centre: '', right: '' },
            footer: { left: '', centre: 'Page {n} of {N}', right: '' },
            fontSize: 10,
            marginPoints: 36,
          },
        },
      },
    ]);
  });

  it('CONTROL: a DISMISSED header-and-footer dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await headerFooterCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED watermark dialog dispatches nothing', async () => {
    // The gate again, and it is asserted per command rather than once: the
    // guard is a line in each `run`, so a command written without it passes
    // every case that only exercises its neighbour.
    const { client, sent } = recording();

    await watermarkPagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('THE DUPLICATE FINDER READS FIRST, then deletes the pages the dialog chose', async () => {
    // Two round trips, and the ORDER is the assertion: a command that deleted
    // before reading would delete whatever the dialog last answered with,
    // which on a second run is a plausible list of real pages.
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(
        ok(
          id === 'document.duplicatePages'
            ? { version: asDocVersion(1), groups: [{ pages: [0, 4] }], truncated: false }
            : { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
        ),
      );
    });
    const opened: { id: string; props: unknown }[] = [];

    await findDuplicatePagesCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        // THE EXTRA COPY, which is what the body computes. The command must not
        // recompute it: two readings of *which copy survives* is the shape that
        // agrees until one of them changes its mind about the first page.
        return Promise.resolve({ pages: [4] });
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      {
        id: 'dialog.duplicate-pages',
        props: { groups: [{ pages: [0, 4] }], truncated: false },
      },
    ]);
    expect(sent).toStrictEqual([
      { id: 'document.duplicatePages', params: { docId: DOC } },
      {
        id: 'document.execute',
        params: { docId: DOC, command: { kind: 'deletePages', pages: [4] } },
      },
    ]);
  });

  it('CONTROL: a failed READ reports the problem and opens no dialog', async () => {
    // A dialog headed *duplicate pages* over a document that could not be
    // walked is a list of none that means *could not look* — the reassuring
    // answer wearing the shape of an answer.
    const shown: { id: string; props: unknown }[] = [];
    const opened: unknown[] = [];

    await findDuplicatePagesCommand({
      client: clientFailing('document-poisoned'),
      onApplied: () => undefined,
      ask: (id, props) => {
        if (id === 'dialog.duplicate-pages') opened.push(props);
        shown.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([]);
    expect(shown).toStrictEqual([
      { id: 'dialog.command-problem', props: { code: 'document-poisoned' } },
    ]);
  });

  it('CONTROL: a dismissed crop dispatches nothing', async () => {
    const { client, sent } = recording();

    await cropPagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: with no page count there is no bound, so nothing is asked', async () => {
    // `pageCount` is `undefined` before the parser has opened the document, and
    // opening the dialog then would either throw at the props schema or hand a
    // person a field that cannot refuse anything.
    const { client, sent } = recording();
    const opened: { id: string; props: unknown }[] = [];

    await deletePagesCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(NO_DOCUMENT);

    expect(opened).toStrictEqual([]);
    expect(sent).toStrictEqual([]);
  });
});
