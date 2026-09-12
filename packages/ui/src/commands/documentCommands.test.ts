import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '../registries/commands.js';
import {
  type Applied,
  cropPagesCommand,
  watermarkPagesCommand,
  headerFooterCommand,
  batesNumberCommand,
  exportFormDataFdfCommand,
  exportFormDataJsonCommand,
  exportFormDataXfdfCommand,
  detectFlatFieldsCommand,
  replaceTextObjectCommand,
  editPageObjectCommand,
  importFormDataFdfCommand,
  importFormDataJsonCommand,
  importFormDataXfdfCommand,
  saveCopyCommand,
  pageTransitionCommand,
  pageBackgroundCommand,
  resizePagesCommand,
  deskewPagesCommand,
  extractPagesCommand,
  insertFromPdfCommand,
  imagePagesFor,
  insertImageCommand,
  placeImage,
  mergeDocumentCommand,
  replacePageCommand,
  splitDocumentCommand,
  generateTocCommand,
  protectDocumentCommand,
  applyRedactionsCommand,
  redactMatchesCommand,
  sanitizeDocumentCommand,
  signDocumentCommand,
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
  // THREE DOCUMENTS AND THE TARGET IS NOT FIRST, both deliberate. A list of two
  // would let a command that took `openDocuments[0]` pass, and a list whose
  // first entry is the target would let one that took `[1]` pass — so the
  // fixture separates *filtered the target out* from *skipped the first entry*.
  openDocuments: [
    { docId: asDocId('doc-0'), version: asDocVersion(1), byteLength: 10, name: 'Before' },
    { docId: DOC, version: asDocVersion(1), byteLength: 20, name: 'This one' },
    { docId: asDocId('doc-2'), version: asDocVersion(1), byteLength: 30, name: 'After' },
  ],
};

/** The context with no document, for the `when` cases. */
const NO_DOCUMENT: CommandContext = {
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
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
  /**
   * A client that records what was sent and answers.
   *
   * `answers` overrides the reply for named channels; everything else gets the
   * `document.execute` shape, which is what almost every case here dispatches.
   * **Per channel and not a single override**, because a command that sent the
   * wrong channel would otherwise receive the right answer and pass — the
   * default has to be wrong for a channel it was not written for.
   */
  function recording(answers: Readonly<Record<string, unknown>> = {}): {
    readonly client: ContractClient;
    readonly sent: { id: string; params: unknown }[];
  } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      const answer = answers[id];
      if (answer !== undefined) return Promise.resolve(ok(answer));
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

  it('SAVE A COPY dispatches with a DocId and nothing else, and says nothing when it worked', async () => {
    // THE UI HALF. There is no dialog to gate here — the destination comes from
    // the platform's own save dialog, which main runs — so what this asserts is
    // the two things the renderer decides: that it sends a `DocId` alone, and
    // that a successful copy opens nothing.
    const sent: { id: string; params: unknown }[] = [];
    const opened: { id: string; props: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ kind: 'copied', bytes: 2048 }));
    });

    await saveCopyCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.saveCopy', params: { docId: DOC } }]);
    // NOTHING OPENED. A toast for a file that landed where the user put it is
    // noise, and this is the assertion that a later "helpful" dialog would have
    // to change deliberately.
    expect(opened).toStrictEqual([]);
  });

  it('CONTROL: a CANCELLED copy is silent, and a REFUSED one is not', async () => {
    // The two outcomes that look alike from the outside — nothing was written
    // either way — and must not be reported alike. Cancelling is the user's own
    // decision; a refusal is another tab holding the file they chose, which
    // they can act on. Asserting both in one case is what stops a renderer
    // treating "nothing was written" as one state.
    const answers = ['cancelled', 'refused'] as const;
    const openedFor: Record<string, number> = {};

    for (const kind of answers) {
      const opened: unknown[] = [];
      const client = createClient(channels, () =>
        Promise.resolve(
          ok(kind === 'cancelled' ? { kind } : { kind, openElsewhere: 1 }),
        ),
      );
      await saveCopyCommand({
        client,
        onApplied: () => undefined,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);
      openedFor[kind] = opened.length;
    }

    expect(openedFor).toStrictEqual({ cancelled: 0, refused: 1 });
  });

  it('EACH EXPORT DISPATCHES ITS OWN FORMAT, which is the only thing separating them', async () => {
    // THE UI HALF, and the pair's blind spot is exactly here: three commands
    // built from one factory differ in a single argument, so a factory that
    // captured the wrong variable — or three call sites passing the same
    // literal — produces three controls that all write JSON and three green
    // tests if each is asserted alone. Driving all three in one case and
    // comparing the SET is what separates them.
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ kind: 'copied', bytes: 512 }));
    });
    const deps = { client, onApplied: () => undefined, ask: () => Promise.resolve(undefined) };

    await exportFormDataJsonCommand(deps).run(CONTEXT);
    await exportFormDataXfdfCommand(deps).run(CONTEXT);
    await exportFormDataFdfCommand(deps).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.exportFormData', params: { docId: DOC, format: 'json' } },
      { id: 'document.exportFormData', params: { docId: DOC, format: 'xfdf' } },
      { id: 'document.exportFormData', params: { docId: DOC, format: 'fdf' } },
    ]);
    // AND THREE DISTINCT IDS, because a factory that also shared its `id` would
    // register one command three times and the registry would keep the last.
    expect(
      new Set([
        exportFormDataJsonCommand(deps).id,
        exportFormDataXfdfCommand(deps).id,
        exportFormDataFdfCommand(deps).id,
      ]).size,
    ).toBe(3);
  });

  it('SAYS SO when the format cannot carry a value, rather than treating it as a write failure', async () => {
    // The outcome with an action attached: XFDF has no escape for a control
    // character and the other two formats carry it, so the user's next move is
    // a different entry in this same menu. A renderer that folded this into
    // `contested` would tell them another tab holds the file.
    const opened: { id: string; props: unknown }[] = [];
    const client = createClient(channels, () =>
      Promise.resolve(ok({ kind: 'unrepresentable' as const })),
    );

    await exportFormDataXfdfCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      { id: 'dialog.save-problem', props: { outcome: 'unrepresentable' } },
    ]);
  });

  it('EACH IMPORT DISPATCHES ITS OWN FORMAT, three of them against the export’s three', async () => {
    // The export's case one row along, and the same blind spot: commands built
    // from one factory differ in a single captured argument, so driving all
    // three and comparing the SET is what separates them from three controls
    // that all read JSON.
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(
        ok({ kind: 'imported', version: asDocVersion(2), byteLength: 99, historyDropped: 0 }),
      );
    });
    const deps = { client, onApplied: () => undefined, ask: () => Promise.resolve(undefined) };

    await importFormDataJsonCommand(deps).run(CONTEXT);
    await importFormDataXfdfCommand(deps).run(CONTEXT);
    await importFormDataFdfCommand(deps).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.importFormData', params: { docId: DOC, format: 'json' } },
      { id: 'document.importFormData', params: { docId: DOC, format: 'xfdf' } },
      { id: 'document.importFormData', params: { docId: DOC, format: 'fdf' } },
    ]);
  });

  it('REPORTS the document moved after an import, which is what makes it a mutation', async () => {
    // The import answers a version and a byte length exactly as a mutation
    // does, because it is one — main mints the command. A renderer that treated
    // it as a file operation and said nothing would leave the view showing the
    // form before it was filled, which is the display-only failure with the
    // work already done.
    const applied: unknown[] = [];
    const client = createClient(channels, () =>
      Promise.resolve(
        ok({ kind: 'imported', version: asDocVersion(7), byteLength: 4096, historyDropped: 0 }),
      ),
    );

    await importFormDataJsonCommand({
      client,
      onApplied: (value) => applied.push(value),
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(applied).toStrictEqual([{ version: asDocVersion(7), byteLength: 4096 }]);
  });

  it('OPENS THE FILE PROBLEM DIALOG for a file that did not import, and not for a dismissal', async () => {
    // The two outcomes that look alike from outside — nothing changed either
    // way — and must not be reported alike. Asserting both in one case is what
    // stops a renderer treating *nothing happened* as one state.
    const openedFor: Record<string, number> = {};

    for (const kind of ['cancelled', 'unreadable'] as const) {
      const opened: unknown[] = [];
      const client = createClient(channels, () => Promise.resolve(ok({ kind })));
      await importFormDataFdfCommand({
        client,
        onApplied: () => undefined,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);
      openedFor[kind] = opened.length;
    }

    expect(openedFor).toStrictEqual({ cancelled: 0, unreadable: 1 });
  });

  it('CARRIES THE LIMIT for a file that is too large, because a number is the actionable part', async () => {
    const opened: { id: string; props: unknown }[] = [];
    const client = createClient(channels, () =>
      Promise.resolve(ok({ kind: 'too-large' as const, limitBytes: 8 * 1024 * 1024 })),
    );

    await importFormDataJsonCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      {
        id: 'dialog.import-form-data-problem',
        props: { reason: 'too-large', limitBytes: 8 * 1024 * 1024 },
      },
    ]);
  });

  it('DETECTION ASKS, REVIEWS, AND SENDS ONE COMMAND CARRYING WHAT WAS TICKED', async () => {
    // THE UI HALF, and the join no other case can make: the channel answers
    // candidates, the dialog answers NAMES, and this rejoins them with the
    // rectangles the channel returned. A command that sent the rectangles back
    // out of the dialog would have two sources for one geometry, and the one
    // that came through a form control is the one that can be wrong.
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'document.flatFieldCandidates') {
        return Promise.resolve(
          ok({
            version: asDocVersion(1),
            candidates: [
              { rect: { x0: 10, y0: 20, x1: 110, y1: 40 }, label: 'Name:', name: 'Name' },
              { rect: { x0: 10, y0: 60, x1: 110, y1: 80 }, label: 'Date:', name: 'Date' },
            ],
            truncated: false,
          }),
        );
      }
      return Promise.resolve(
        ok({ version: asDocVersion(2), byteLength: 10, historyDropped: 0 }),
      );
    });

    await detectFlatFieldsCommand({
      client,
      onApplied: () => undefined,
      // ONE OF THE TWO REJECTED, which is what makes this a review rather than
      // a confirmation: a command that sent everything it was offered would
      // pass a case where the reader accepted both.
      ask: () => Promise.resolve({ accepted: ['Date'] }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.flatFieldCandidates', params: { docId: DOC, page: 3 } },
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'createFormField',
            page: 3,
            // ONE COMMAND, one entry, and the rectangle is the CHANNEL'S.
            fields: [
              {
                rect: { x0: 10, y0: 60, x1: 110, y1: 80 },
                name: 'Date',
                field: { type: 'text' },
              },
            ],
          },
        },
      },
    ]);
  });

  it('REPLACE TEXT SENDS THE ENGINE’S OWN INDICES, and the version the LINES were read at', async () => {
    // THE UI HALF OF THE WIRED PAIR for `replaceTextObject`. Its kernel half is
    // `proof:pdfiumcommand`, which drives the real library and cannot see which
    // numbers a control sends; this sees the numbers and cannot see a document.
    //
    // THREE of them are the point:
    //
    // - the INDICES are the ones `document.textLines` answered, unchanged. They
    //   are PDFium's numbering of the page's objects, and the page's structured
    //   text numbers runs differently — so a command that sent a POSITION (0 for
    //   the first run of the first line) would agree with a page whose objects
    //   happen to start at zero and be contiguous, and replace the wrong run on
    //   every other page. The fixture's are `[4, 9]` and `[2]` for that reason.
    // - the SECOND line is the one edited, and only the run its edit touched is
    //   named. A command that sent every run of the chosen line, or every run on
    //   the page, would pass an assertion about the text alone.
    // - the VERSION is the read's, not the context's. They differ here (7
    //   against the context's 1) because `#refuseIfStale` asks *is this the
    //   document the list described*, and a command carrying the shell's current
    //   version would answer that question with itself.
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'document.textLines') {
        return Promise.resolve(
          ok({
            version: asDocVersion(7),
            lines: [
              {
                runs: [
                  { index: 4, text: 'The quick ' },
                  { index: 9, text: 'brown fox' },
                ],
              },
              { runs: [{ index: 2, text: 'jumps over' }] },
            ],
            truncated: false,
            unaddressable: 0,
          }),
        );
      }
      return Promise.resolve(ok({ version: asDocVersion(8), byteLength: 10, historyDropped: 0 }));
    });

    await replaceTextObjectCommand({
      client,
      onApplied: () => undefined,
      // THE DIALOG'S OWN ANSWER, forwarded. The dialog is what holds the line's
      // runs and the person's text, so the payload is built there; this asserts
      // the command COPIES it, which a command that rebuilt the list from the
      // read would not.
      ask: () =>
        Promise.resolve({ action: 'replace', replacements: [{ index: 9, text: 'brown dog' }] }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.textLines', params: { docId: DOC, page: 3 } },
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'replaceTextObject',
            // ZERO-BASED AND UNCONVERTED. `pageNumbering.ts` is the only place
            // that turns a PDF.js page into a kernel one, and `context.page` is
            // already the kernel's — a command applying `kernelPageOf` here
            // would send 2 and edit the page above the one on screen.
            page: 3,
            replacements: [{ index: 9, text: 'brown dog' }],
            version: 7,
          },
        },
      },
    ]);
  });

  it('REPLACE TEXT OFFERS THE LINES IT WAS ANSWERED, runs and all', async () => {
    // WHAT THE DIALOG IS HANDED, which the case above cannot see: it asserts the
    // dispatch and would pass on a command that offered the chooser an empty
    // list, since the answer is stubbed either way. A person choosing from
    // nothing is the display-only defect one step in from the button.
    //
    // The runs travel because the command names OBJECTS: a dialog handed only
    // the joined words could show them and could not say which object an edit
    // touched.
    let offered: unknown = null;
    const client = createClient(channels, (id) => {
      if (id === 'document.textLines') {
        return Promise.resolve(
          ok({
            version: asDocVersion(7),
            lines: [{ runs: [{ index: 4, text: 'ONE ' }, { index: 9, text: 'TWO' }] }],
            truncated: true,
            // NON-ZERO, so the boolean the dialog is offered is `true` here and
            // a command that hard-coded `false` fails. A zero would let the two
            // be told apart by nothing.
            unaddressable: 12,
          }),
        );
      }
      return Promise.resolve(ok({ version: asDocVersion(8), byteLength: 10, historyDropped: 0 }));
    });

    await replaceTextObjectCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        expect(id).toBe('dialog.replace-text-object');
        offered = props;
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(offered).toStrictEqual({
      lines: [{ runs: [{ index: 4, text: 'ONE ' }, { index: 9, text: 'TWO' }] }],
      // THE CHARACTER COUNT BECAME A BOOLEAN, which is the conversion this
      // command owns: a person needs *some of what you can see is not here*,
      // and twelve characters answers a question nobody asked.
      unaddressable: true,
      // FORWARDED, not dropped. A reader choosing from a clipped list would pick
      // from part of the page believing they had seen it.
      truncated: true,
    });
  });

  it('PROMOTE dispatches the promotion and READS THE PAGE AGAIN, so the edit can follow', async () => {
    // THE UI HALF OF NORMALIZE-THEN-EDIT's pair. Its kernel half is
    // `proof:pdfiumcommand`'s six promotion cases, which drive the real library
    // and cannot see which command a control sends.
    //
    // The loop is the property under test, not the dispatch: a person presses
    // *unpack* in order to edit the text that appears, and a `run` that
    // promoted and returned would leave them to open the dialog again. So the
    // second read is asserted, and the second dialog is answered with a
    // replacement whose object index only EXISTS after the promotion.
    let asked = 0;
    /** @type {unknown[]} */
    const sent: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'document.textLines') {
        // THE PAGE CHANGES BETWEEN THE READS, which is what a promotion does.
        // Before it, one line and text nothing can name; after it, two lines
        // and nothing unaddressable.
        return Promise.resolve(
          asked++ === 0
            ? ok({
                version: asDocVersion(7),
                lines: [{ runs: [{ index: 0, text: 'ON THE PAGE' }] }],
                truncated: false,
                unaddressable: 36,
              })
            : ok({
                version: asDocVersion(8),
                lines: [
                  { runs: [{ index: 0, text: 'ON THE PAGE' }] },
                  { runs: [{ index: 1, text: 'WAS IN A BLOCK' }] },
                ],
                truncated: false,
                unaddressable: 0,
              }),
        );
      }
      return Promise.resolve(ok({ version: asDocVersion(9), byteLength: 10, historyDropped: 0 }));
    });

    let answered = 0;
    await replaceTextObjectCommand({
      client,
      onApplied: () => undefined,
      ask: () =>
        Promise.resolve(
          answered++ === 0
            ? { action: 'promote' }
            : { action: 'replace', replacements: [{ index: 1, text: 'NOW EDITABLE' }] },
        ),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.textLines', params: { docId: DOC, page: 3 } },
      {
        id: 'document.execute',
        // NO VERSION ON THE PROMOTION, which is the command's declaration and
        // not an omission: it names a page and every form on it, so there is no
        // index a stale version could point at. A payload carrying one would be
        // refused by the schema.
        params: { docId: DOC, command: { kind: 'promoteFormObjects', page: 3 } },
      },
      { id: 'document.textLines', params: { docId: DOC, page: 3 } },
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'replaceTextObject',
            page: 3,
            replacements: [{ index: 1, text: 'NOW EDITABLE' }],
            // THE SECOND READ'S VERSION. A command carrying 7 here would name
            // objects from the list the promotion has already moved past —
            // which is exactly why the promotion is its own command rather than
            // a step inside this one.
            version: 8,
          },
        },
      },
    ]);
  });

  it('EDIT OBJECT DISPATCHES ONE OF THREE COMMANDS, by what the dialog answered', async () => {
    // THE UI HALF OF THE WIRED PAIR for the three object commands. Its kernel
    // half is `proof:pdfiumobject`, which drives the real library and cannot see
    // which command a control sends; this sees the command and cannot see a
    // document.
    //
    // ALL THREE IN ONE CASE, and that is the point rather than economy: one
    // registered control dispatches one of three kinds, and a `run` that
    // ignored `action` and always sent the same one would pass any case that
    // exercised a single branch. The dialog's answer is varied and the command
    // is asserted whole.
    const answers = [
      { action: 'place' as const, index: 9, moveBy: { x: 3, y: -4 }, scaleBy: { x: 2, y: 1 } },
      {
        action: 'recolor' as const,
        index: 9,
        colour: { red: 255, green: 0, blue: 0, alpha: 200 },
      },
      { action: 'delete' as const, index: 9 },
    ];
    const expected = [
      {
        kind: 'placePageObject',
        // ZERO-BASED AND UNCONVERTED, `replaceTextObject`'s reason: `context.page`
        // is already the kernel's, and applying `kernelPageOf` here would edit
        // the page above the one on screen.
        page: 3,
        index: 9,
        moveBy: { x: 3, y: -4 },
        scaleBy: { x: 2, y: 1 },
        // THE READ'S VERSION, not the context's. They differ here (7 against
        // the context's 1) because `#refuseIfStale` asks *is this the document
        // the list described*.
        version: 7,
      },
      {
        kind: 'recolorPageObjects',
        page: 3,
        // A LIST OF ONE. The command carries several so a person recolouring a
        // group is one regeneration and one undo; a chooser naming one sends a
        // list of one rather than a different command.
        indices: [9],
        colour: { red: 255, green: 0, blue: 0, alpha: 200 },
        version: 7,
      },
      { kind: 'deletePageObjects', page: 3, indices: [9], version: 7 },
    ];

    for (const [at, answer] of answers.entries()) {
      const sent: { id: string; params: unknown }[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'document.pageObjects') {
          return Promise.resolve(
            ok({
              version: asDocVersion(7),
              // NON-CONTIGUOUS INDICES NOT STARTING AT ZERO, and the chosen one
              // is the SECOND: a command that sent a position in its own list
              // would agree with the engine only for a page whose objects
              // happen to be numbered that way.
              objects: [
                {
                  index: 4,
                  kind: 'image' as const,
                  left: 0,
                  bottom: 0,
                  right: 10,
                  top: 10,
                  fill: null,
                },
                {
                  index: 9,
                  kind: 'path' as const,
                  left: 20,
                  bottom: 20,
                  right: 140,
                  top: 60,
                  fill: { red: 0, green: 0, blue: 0, alpha: 255 },
                },
              ],
              truncated: false,
            }),
          );
        }
        return Promise.resolve(
          ok({ version: asDocVersion(8), byteLength: 10, historyDropped: 0 }),
        );
      });

      // SEQUENTIALLY, so each iteration's `sent` is only its own. The three
      // answers are three separate dispatches and interleaving them would make
      // the assertion about whichever finished first.
      await editPageObjectCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve(answer),
      }).run(CONTEXT);

      expect(sent, `answer ${String(at)}`).toStrictEqual([
        { id: 'document.pageObjects', params: { docId: DOC, page: 3 } },
        { id: 'document.execute', params: { docId: DOC, command: expected[at] } },
      ]);
    }
  });

  it('EDIT OBJECT SENDS NOTHING when the chooser is dismissed, or the engine is absent', async () => {
    // The mutation-dialog gate and the engine-absent branch together, because
    // the two share an observable — nothing dispatched — and differ in whether
    // a problem was reported. Asserting only the first would pass on a build
    // that dispatched nothing because it crashed.
    const dismissed: string[] = [];
    await editPageObjectCommand({
      client: createClient(channels, (id) => {
        dismissed.push(id);
        return Promise.resolve(
          ok({ version: asDocVersion(1), objects: [], truncated: false }),
        );
      }),
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);
    expect(dismissed).toStrictEqual(['document.pageObjects']);

    let asked = 0;
    const absent: string[] = [];
    await editPageObjectCommand({
      client: createClient(channels, (id) => {
        absent.push(id);
        return Promise.resolve(err({ code: 'engine-unavailable' as const }));
      }),
      onApplied: () => undefined,
      ask: (id) => {
        asked += 1;
        // THE PROBLEM DIALOG AND NOT THE CHOOSER, asserted by id: `reportProblem`
        // opening is the difference between a refusal a person meets and a
        // control that did nothing.
        expect(id).toBe('dialog.command-problem');
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);
    expect(absent).toStrictEqual(['document.pageObjects']);
    expect(asked).toBe(1);
  });

  it('REPLACE TEXT SENDS NOTHING when the chooser is dismissed', async () => {
    // The mutation-dialog gate on a DESTRUCTIVE command, which is where it
    // matters most: this one overwrites text rather than adding something the
    // reader can see and remove.
    const sent: string[] = [];
    const client = createClient(channels, (id) => {
      sent.push(id);
      return Promise.resolve(
        ok({
          version: asDocVersion(1),
          lines: [{ runs: [{ index: 2, text: 'SOMETHING' }] }],
          truncated: false,
          unaddressable: 0,
        }),
      );
    });

    await replaceTextObjectCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual(['document.textLines']);
  });

  it('REPLACE TEXT SENDS NOTHING when the machine has no editing engine', async () => {
    // THE STATE MOST MACHINES ARE IN, and the one that separates *reported* from
    // *silent*: `document.textLines` answers `engine-unavailable` where PDFium
    // was never provisioned, and the command must stop there — asking the dialog
    // for a choice among no lines, or dispatching anyway, are both worse than
    // the sentence.
    let asked = 0;
    const sent: string[] = [];
    const client = createClient(channels, (id) => {
      sent.push(id);
      return Promise.resolve(err({ code: 'engine-unavailable' as const }));
    });

    await replaceTextObjectCommand({
      client,
      onApplied: () => undefined,
      ask: (id) => {
        asked += 1;
        // THE PROBLEM DIALOG AND NOT THE CHOOSER, asserted by id rather than by
        // a count alone: `reportProblem` opening is the difference between a
        // refusal a person meets and a control that did nothing.
        expect(id).toBe('dialog.command-problem');
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(sent).toStrictEqual(['document.textLines']);
    expect(asked).toBe(1);
  });

  it('SENDS NOTHING when the review is dismissed, which is the mutation-dialog gate', async () => {
    // A dismissal must dispatch nothing, and the absence of a value is the
    // guard rather than a flag beside it.
    const sent: string[] = [];
    const client = createClient(channels, (id) => {
      sent.push(id);
      return Promise.resolve(
        ok({ version: asDocVersion(1), candidates: [], truncated: false }),
      );
    });

    await detectFlatFieldsCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual(['document.flatFieldCandidates']);
  });

  it('BATES DISPATCHES THE PARTS, not a formatted identifier', async () => {
    // THE UI HALF, and the number to watch is that `prefix`, `start` and
    // `digits` cross SEPARATELY. The dialog shows a preview built by
    // concatenating them, and a command that sent the preview string instead
    // would stamp "ABC-0431" on every page — the sequence would stop being a
    // sequence, and `pageStamp.test.ts` would stay green because it would be
    // given exactly what it was asked to draw.
    const { client, sent } = recording();

    await batesNumberCommand({
      client,
      onApplied: () => undefined,
      ask: () =>
        Promise.resolve({
          pages: 'all',
          prefix: 'ABC-',
          suffix: '',
          start: 431,
          digits: 4,
          edge: 'footer',
          slot: 'right',
          fontSize: 9,
          marginPoints: 36,
        }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'batesNumberPages',
            pages: 'all',
            prefix: 'ABC-',
            suffix: '',
            start: 431,
            digits: 4,
            edge: 'footer',
            slot: 'right',
            fontSize: 9,
            marginPoints: 36,
          },
        },
      },
    ]);
  });

  it('A TRANSITION DISPATCHES THE STYLE THE DIALOG ANSWERED, including "none"', async () => {
    // THE UI HALF, and `replace` is the value to watch. It reads as *do
    // nothing* and is in fact a change — it writes a transition meaning no
    // visible effect — so a control that treated it as a dismissal, or that
    // sent nothing for it, would leave a user unable to turn an existing
    // transition off. `pageTransition.test.ts` proves the kernel writes /S /R
    // for it; this proves the control sends it rather than swallowing it.
    const { client, sent } = recording();

    await pageTransitionCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ pages: 'all', style: 'replace', durationSeconds: 0 }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'setPageTransition',
            pages: 'all',
            style: 'replace',
            durationSeconds: 0,
          },
        },
      },
    ]);
  });

  it('THE BACKGROUND DISPATCHES WITHOUT A DIALOG, and carries a named colour', async () => {
    // It opens nothing, so the gate does not apply — and the case says so by
    // asserting that no dialog was opened, rather than leaving the absence to
    // be inferred from a command list nobody compares.
    const { client, sent } = recording();
    const opened: unknown[] = [];

    await pageBackgroundCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([]);
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'setPageBackground',
            pages: 'all',
            red: 0.98,
            green: 0.97,
            blue: 0.94,
          },
        },
      },
    ]);
  });

  it('A RESIZE CARRIES THE CONTEXT’S PAGE INTO BOTH the dialog and the scope', async () => {
    // THE UI HALF, and the number is what it exists to watch. The wired-tools
    // rule's blind spot is a boundary where a unit changes, and this command
    // crosses one twice: the dialog is told which page is being read, and the
    // answer's *this page* scope comes back as an index the kernel resolves.
    // `CONTEXT.page` is 3 deliberately, so a command sending a literal 0 — the
    // defect the rotate shipped with — fails here rather than reading as green.
    const { client, sent } = recording();
    const opened: unknown[] = [];

    await resizePagesCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ pages: [3], widthPoints: 595, heightPoints: 842 });
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([{ id: 'dialog.resize-pages', props: { page: 3 } }]);
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'resizePages',
            pages: [3],
            widthPoints: 595,
            heightPoints: 842,
          },
        },
      },
    ]);
  });

  it('A DESKEW DISPATCHES A PAGE LIST AND NOTHING ELSE, and asks nothing', async () => {
    // THE UI HALF of the wired pair. What it watches is that no angle appears
    // on the wire: the kernel measures each page's tilt from its ink, and a
    // renderer that sent a number would be answering a question it cannot see
    // the raster for — and the conversion between the raster's y-down frame and
    // the content stream's y-up one would then live here.
    //
    // `ask` throwing is deliberate rather than a stub: this command opens no
    // dialog, and a version that grew one would fail here instead of quietly
    // collecting an answer nobody watches.
    const { client, sent } = recording();

    await deskewPagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => {
        throw new Error('a deskew asks nothing');
      },
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: { docId: DOC, command: { kind: 'deskewPages', pages: 'all' } },
      },
    ]);
  });

  it('a resize dispatches the ALL scope as the literal, not as a list of every page', async () => {
    // The two scopes are different values on the wire, and `'all'` is resolved
    // by the kernel because it holds the count. A command that expanded it here
    // would need a page count the renderer does not have, and would send a
    // payload that scales with the document against invariant L11.
    const { client, sent } = recording();

    await resizePagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ pages: 'all', widthPoints: 612, heightPoints: 792 }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'resizePages',
            pages: 'all',
            widthPoints: 612,
            heightPoints: 792,
          },
        },
      },
    ]);
  });

  it('AN IMAGE INSERT SENDS TWO NUMBERS AND NO BYTES, at the page AFTER the one being read', async () => {
    // THE UI HALF, and what it watches is the payload's shape as much as its
    // values: this command physically cannot send an image, because
    // `applyDocumentCommand` takes `RenderableCommand` and the union omits
    // `insertImagePage`. What it CAN get wrong is the index, and `CONTEXT.page`
    // is 3 so a literal 0 fails here rather than reading as green.
    //
    // `at: 4` and not 3: a person on page 3 inserting a picture means *after
    // this one*, and inserting at 3 pushes the page they are looking at down.
    const { client, sent } = recording({
      'document.insertImage': {
        kind: 'inserted',
        version: asDocVersion(2),
        byteLength: 4096,
        historyDropped: 0,
      },
    });
    const applied: unknown[] = [];

    await insertImageCommand({
      client,
      onApplied: (a) => applied.push(a),
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.insertImage', params: { docId: DOC, at: 4 } }]);
    // AND THE VIEW WAS REBUILT, with both scalars. A version reported without a
    // byte length rebinds the transport to the previous image's length, which is
    // a range past the end of the new document.
    expect(applied).toStrictEqual([{ version: 2, byteLength: 4096 }]);
  });

  it('CONTROL: a DISMISSED image picker reports nothing and rebuilds nothing', async () => {
    // The user closed the dialog, so there is nothing to tell them. This is the
    // one of the three non-success outcomes that must stay silent, and the two
    // cases below are the ones that must not.
    const { client } = recording({ 'document.insertImage': { kind: 'cancelled' } });
    const applied: unknown[] = [];
    const opened: unknown[] = [];

    await insertImageCommand({
      client,
      onApplied: (a) => applied.push(a),
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(applied).toStrictEqual([]);
    expect(opened).toStrictEqual([]);
  });

  it('REPORTS an unreadable file, because a control that ran and did nothing is the display-only sin', async () => {
    const { client } = recording({ 'document.insertImage': { kind: 'unreadable' } });
    const opened: unknown[] = [];

    await insertImageCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      { id: 'dialog.insert-image-problem', props: { reason: 'unreadable' } },
    ]);
  });

  it('REPORTS a file past the bound, and carries the limit so the sentence can say a number', async () => {
    // The limit travels from main rather than being restated here: *too large*
    // with no number is something a person cannot act on, and a constant copied
    // into the renderer is a second declaration of a bound main owns.
    const { client } = recording({
      'document.insertImage': { kind: 'too-large', limitBytes: 67_108_864 },
    });
    const opened: unknown[] = [];

    await insertImageCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      {
        id: 'dialog.insert-image-problem',
        props: { reason: 'too-large', limitBytes: 67_108_864 },
      },
    ]);
  });

  it('PLACES ON THE ONE PAGE by default, which is the safe half of an asymmetry', () => {
    // Placing on one page when you meant all is one more drag. Placing on all
    // when you meant one is a mark on every page of a long document, removed
    // one at a time.
    expect(imagePagesFor('this', 3, 40)).toStrictEqual([3]);
  });

  it('PLACES ON EVERY PAGE when the setting says so — the stamps row', () => {
    // Zero-based and the whole document, so `all` means the pages the document
    // has now rather than the pages it had when the tool was chosen.
    expect(imagePagesFor('all', 3, 5)).toStrictEqual([0, 1, 2, 3, 4]);
  });

  it('FALLS BACK TO THE ONE PAGE when the count is unknown, not to none', () => {
    // The drag happened and something must be placed. `all` with no count is
    // not *no pages*, and it is certainly not a guess at how many there are.
    expect(imagePagesFor('all', 3, undefined)).toStrictEqual([3]);
  });

  it('A PLACEMENT SENDS THE PAGE AND THE BOX AND NO BYTES, and rebuilds the view', async () => {
    // THE SECOND HALF of place-image's pair; the first is
    // `placeImageTool.test.ts`, which asserts the tool calls this with the
    // converted rectangle, and the kernel's is `applyPlaceImage`'s block.
    //
    // The page comes from the TOOL rather than from the context — a stamp goes
    // on the page it was drawn on — so this passes 3 explicitly. The list is
    // the CALLER's: `App.tsx` reads the image-pages setting and turns *every
    // page* into the whole range, so this function never has to know how many
    // pages there are. `document.placeImage` physically cannot carry bytes: the
    // params schema has three fields and none of them is a `Uint8Array`.
    const { client, sent } = recording({
      'document.placeImage': {
        kind: 'placed',
        version: asDocVersion(2),
        byteLength: 8192,
        historyDropped: 0,
      },
    });
    const applied: unknown[] = [];

    await placeImage(
      { client, onApplied: (a) => applied.push(a), ask: () => Promise.resolve(undefined) },
      DOC,
      [3],
      { x0: 10, y0: 20, x1: 110, y1: 70 },
    );

    expect(sent).toStrictEqual([
      {
        id: 'document.placeImage',
        params: { docId: DOC, pages: [3], rect: { x0: 10, y0: 20, x1: 110, y1: 70 } },
      },
    ]);
    // AND THE VIEW WAS REBUILT, with both scalars — `insertImage`'s reason: a
    // version without a byte length rebinds the transport to the previous
    // image's length, which is a range past the end of the new document.
    expect(applied).toStrictEqual([{ version: 2, byteLength: 8192 }]);
  });

  it('CONTROL: a DISMISSED picker reports nothing and rebuilds nothing', async () => {
    // The user closed the dialog. This is the one non-success outcome that must
    // stay silent, and without it the reporting case below reads as *something
    // is always shown*.
    const { client } = recording({ 'document.placeImage': { kind: 'cancelled' } });
    const applied: unknown[] = [];
    const opened: unknown[] = [];

    await placeImage(
      {
        client,
        onApplied: (a) => applied.push(a),
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      },
      DOC,
      [3],
      { x0: 10, y0: 20, x1: 110, y1: 70 },
    );

    expect(applied).toStrictEqual([]);
    expect(opened).toStrictEqual([]);
  });

  it('REPORTS a file past the bound, through the dialog the insert already owns', async () => {
    // THE SAME DIALOG, deliberately: the two outcomes are the same two, and a
    // second wording for them would be a second answer to *what happened to my
    // picture*. The limit travels from main rather than being restated here.
    const { client } = recording({
      'document.placeImage': { kind: 'too-large', limitBytes: 67_108_864 },
    });
    const opened: unknown[] = [];

    await placeImage(
      {
        client,
        onApplied: () => undefined,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      },
      DOC,
      [3],
      { x0: 10, y0: 20, x1: 110, y1: 70 },
    );

    expect(opened).toStrictEqual([
      { id: 'dialog.insert-image-problem', props: { reason: 'too-large', limitBytes: 67_108_864 } },
    ]);
  });

  /**
   * Merge's UI half of the wired-tools pair.
   *
   * The kernel half is `pageMerge.test.ts`, which asserts the target really
   * contains the source's pages and that every merged page's `/Parent` is the
   * node listing it. This half asserts the control dispatches `mergeDocument`
   * with **the id the reader chose** — neither test can see the other's value,
   * which is the blind spot CLAUDE.md names, so the id is what both sides hold.
   */
  it('dispatches mergeDocument with the CHOSEN id, appended at the target’s length', async () => {
    const { client, sent } = recording();
    const opened: unknown[] = [];

    await mergeDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ source: 'doc-2' });
      },
    }).run(CONTEXT);

    // THE TARGET IS FILTERED OUT AND THE OTHERS KEEP THEIR ORDER. `CONTEXT`
    // puts the target SECOND of three, so a command that sliced rather than
    // filtered would produce a different list here.
    expect(opened).toStrictEqual([
      {
        id: 'dialog.merge-document',
        props: {
          choices: [
            { docId: 'doc-0', name: 'Before' },
            { docId: 'doc-2', name: 'After' },
          ],
        },
      },
    ]);
    // `at: 10` is `CONTEXT.pageCount`, which is what *append* means — and it is
    // not `page + 1`, the shape every other insert command uses. A merge that
    // reused that arithmetic would land the source's pages in the middle.
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: { docId: DOC, command: { kind: 'mergeDocument', source: 'doc-2', at: 10 } },
      },
    ]);
  });

  it('opens the nothing-to-merge dialog when no other document is open', async () => {
    const { client, sent } = recording();
    const opened: unknown[] = [];

    await mergeDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
      // ONLY THE TARGET IS OPEN, which is the state a reader is in when they
      // first reach for merge. The command exists — `when` is `hasDocument` —
      // so this is what teaches them ADR-0040 Decision 2's flow.
      // ONLY THE TARGET IS OPEN, filtered from the fixture rather than
      // rebuilt, so this list cannot drift from the one above.
    }).run({
      ...CONTEXT,
      openDocuments: CONTEXT.openDocuments.filter((document) => document.docId === DOC),
    });

    expect(opened).toStrictEqual([{ id: 'dialog.merge-document-none', props: {} }]);
    // AND NOTHING WAS DISPATCHED. Without this the case passes for a command
    // that opens the message and merges anyway.
    expect(sent).toStrictEqual([]);
  });

  it('insert-from-PDF sends the SAME command with the chosen position', async () => {
    // THE SECOND SURFACE, and this case is what says it is one. It asserts the
    // dispatched kind is `mergeDocument` — so a future author who splits this
    // into its own kind has to change this line and meet the reason.
    const { client, sent } = recording();

    await insertFromPdfCommand({
      client,
      onApplied: () => undefined,
      // `at: 0` is the FRONT, and it is not the default the body offers — a
      // dialog stub answering the default would let a command that ignored the
      // answer and used `pageCount` pass.
      ask: () => Promise.resolve({ source: 'doc-0', at: 0 }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: { docId: DOC, command: { kind: 'mergeDocument', source: 'doc-0', at: 0 } },
      },
    ]);
  });

  it('insert-from-PDF hands the dialog the TARGET’s page count, not the source’s', async () => {
    const { client } = recording();
    const opened: unknown[] = [];

    await insertFromPdfCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      {
        id: 'dialog.insert-from-pdf',
        props: {
          choices: [
            { docId: 'doc-0', name: 'Before' },
            { docId: 'doc-2', name: 'After' },
          ],
          // `CONTEXT.pageCount`, which is the document being inserted INTO.
          pageCount: 10,
        },
      },
    ]);
  });

  it('replace-page sends replacePage for the page on screen', async () => {
    const { client, sent } = recording();
    const opened: unknown[] = [];

    await replacePageCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ source: 'doc-2' });
      },
    }).run(CONTEXT);

    // THE DIALOG IS TOLD WHICH PAGE, because it destroys one and the reader has
    // to be able to check it before pressing.
    expect(opened).toStrictEqual([
      {
        id: 'dialog.replace-page',
        props: {
          choices: [
            { docId: 'doc-0', name: 'Before' },
            { docId: 'doc-2', name: 'After' },
          ],
          page: 3,
        },
      },
    ]);
    // `at: 3` is `CONTEXT.page` — the page on screen, zero-based, unconverted.
    // A command that sent `page + 1` would replace the page after the one the
    // dialog just named, which the dialog's own sentence would not reveal.
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: { docId: DOC, command: { kind: 'replacePage', source: 'doc-2', at: 3 } },
      },
    ]);
  });

  it('CONTROL: a DISMISSED replace dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await replacePageCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('extract sends the parsed range to the destination channel', async () => {
    const { client, sent } = recording({
      'document.extract': { kind: 'copied', bytes: 8192 },
    });
    const opened: unknown[] = [];

    await extractPagesCommand({
      client,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ pages: [0, 4, 5] });
      },
    }).run(CONTEXT);

    // THE BOUND GOES IN, so the dialog can refuse a page this document lacks.
    expect(opened).toStrictEqual([{ id: 'dialog.extract-pages', props: { pageCount: 10 } }]);
    // AND THE PAGES COME OUT UNCHANGED — no arithmetic in the command, because
    // `parsePageRanges` already converted from what the reader typed.
    expect(sent).toStrictEqual([
      { id: 'document.extract', params: { docId: DOC, pages: [0, 4, 5] } },
    ]);
  });

  it('extract reports a contested destination, and says nothing when it worked', async () => {
    // TWO CASES IN ONE, because the pair is the point: a `copied` that opened a
    // dialog would be a success reported as a problem, and a `refused` that
    // opened none would be the display-only failure.
    const quiet = recording({ 'document.extract': { kind: 'copied', bytes: 1 } });
    const quietDialogs: unknown[] = [];
    await extractPagesCommand({
      client: quiet.client,
      onApplied: () => undefined,
      ask: (id, props) => {
        quietDialogs.push({ id, props });
        return Promise.resolve({ pages: [0] });
      },
    }).run(CONTEXT);
    expect(quietDialogs.map((entry) => (entry as { id: string }).id)).toStrictEqual([
      'dialog.extract-pages',
    ]);

    const refused = recording({
      'document.extract': { kind: 'refused', openElsewhere: 2 },
    });
    const spoken: unknown[] = [];
    await extractPagesCommand({
      client: refused.client,
      onApplied: () => undefined,
      ask: (id, props) => {
        spoken.push({ id, props });
        return Promise.resolve({ pages: [0] });
      },
    }).run(CONTEXT);
    expect(spoken).toStrictEqual([
      { id: 'dialog.extract-pages', props: { pageCount: 10 } },
      { id: 'dialog.save-problem', props: { outcome: 'contested' } },
    ]);
  });

  it('split sends the GROUPS the dialog built, not a mode', async () => {
    const { client, sent } = recording({
      'document.split': { kind: 'split', files: 2 },
    });

    await splitDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ groups: [[0, 1], [2]] }),
    }).run(CONTEXT);

    // NO MODE ON THE WIRE. One-per-page and ranges are the same request with
    // different groups, so a command that sent a discriminant would be a second
    // way to say what these already say — and the kernel would then have to
    // agree with the dialog about what each mode means.
    expect(sent).toStrictEqual([
      { id: 'document.split', params: { docId: DOC, groups: [[0, 1], [2]] } },
    ]);
  });

  it('CONTROL: a DISMISSED split dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await splitDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED extract dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await extractPagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED merge dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await mergeDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED resize dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await resizePagesCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED transition dialog dispatches nothing', async () => {
    // The gate, asserted per command: the guard is a line in each `run`, so a
    // command written without it passes every case that exercises a neighbour.
    const { client, sent } = recording();

    await pageTransitionCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED Bates dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await batesNumberCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
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

describe('generate table of contents', () => {
  /**
   * A client answering both channels this command uses, recording every ask.
   *
   * Two channels rather than one, and that is what makes the cases below
   * separable: the command's whole decision is *read the outline, then dispatch
   * or refuse*, so a fixture that answered only `document.execute` could not
   * tell the two paths apart.
   */
  function recording(destinations: readonly unknown[]): {
    readonly client: ContractClient;
    readonly sent: { id: string; params: unknown }[];
  } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'document.destinations') {
        return Promise.resolve(ok({ version: asDocVersion(1), destinations }));
      }
      return Promise.resolve(
        ok({ version: asDocVersion(2), byteLength: 8192, historyDropped: 0 }),
      );
    });
    return { client, sent };
  }

  const ONE_ENTRY = [{ title: 'Chapter one', page: 2, depth: 0 }];

  it('reads the outline, then dispatches generateToc at the FRONT', async () => {
    const { client, sent } = recording(ONE_ENTRY);
    const record = recorder();

    await generateTocCommand({
      client,
      onApplied: record.onApplied,
      ask: record.ask,
    }).run(CONTEXT);

    // BOTH CALLS AND THEIR ORDER. The read has to precede the dispatch, because
    // its whole job is to decide whether there is one — and `at: 0` rather than
    // `CONTEXT.page + 1`, which is what every other insert here sends and would
    // put a table of contents in the middle of the document.
    expect(sent).toStrictEqual([
      { id: 'document.destinations', params: { docId: DOC } },
      { id: 'document.execute', params: { docId: DOC, command: { kind: 'generateToc', at: 0 } } },
    ]);
    expect(record.applied).toStrictEqual([
      { version: 2, byteLength: 8192, historyDropped: 0 },
    ]);
    expect(record.shown).toStrictEqual([]);
  });

  it('CONTROL: an EMPTY outline is refused in the renderer, and nothing is sent', async () => {
    // The separating case. A command that dispatched regardless would produce a
    // blank page and pass every assertion in the case above, so what is asserted
    // here is the call that was NOT made.
    const { client, sent } = recording([]);
    const record = recorder();

    await generateTocCommand({
      client,
      onApplied: record.onApplied,
      ask: record.ask,
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.destinations', params: { docId: DOC } }]);
    // AND THE USER WAS TOLD. Returning quietly is the display-only failure —
    // a control that ran and appeared to do nothing.
    expect(record.shown).toStrictEqual([
      { id: 'dialog.generate-toc-problem', props: { reason: 'no-outline' } },
    ]);
    expect(record.applied).toStrictEqual([]);
  });

  it('reports a refused outline read rather than swallowing it', async () => {
    const record = recorder();

    await generateTocCommand({
      client: clientFailing('document-busy'),
      onApplied: record.onApplied,
      ask: record.ask,
    }).run(CONTEXT);

    // THE COMMAND-PROBLEM DIALOG, not this command's own: the channel refused,
    // which is a failure code, where an empty outline is a fact about the
    // document. `generateTocProblem.ts` states that distinction.
    expect(record.shown).toStrictEqual([
      { id: 'dialog.command-problem', props: { code: 'document-busy' } },
    ]);
    expect(record.applied).toStrictEqual([]);
  });

  it('CONTROL: with no document nothing is read and nothing is sent', async () => {
    const { client, sent } = recording(ONE_ENTRY);
    const record = recorder();

    await generateTocCommand({
      client,
      onApplied: record.onApplied,
      ask: record.ask,
    }).run(NO_DOCUMENT);

    expect(sent).toStrictEqual([]);
    expect(record.shown).toStrictEqual([]);
  });
});

/**
 * The RENDERER half of Stage 7's protection rows' wired pair.
 *
 * The kernel half is `documentProtection.test.ts`, which round-trips real bytes
 * through the writer. This asserts which command the control dispatched and
 * with what — a `run` that opened the dialog and then sent `encryption: 'none'`
 * would protect nothing and report success.
 */
describe('protectDocumentCommand', () => {
  function recordingClient(): {
    readonly client: ContractClient;
    readonly sent: { id: string; params: unknown }[];
  } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0 }));
    });
    return { client, sent };
  }

  it('dispatches EXACTLY what the dialog answered, permissions included', async () => {
    const { client, sent } = recordingClient();

    await protectDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: () =>
        Promise.resolve({
          encryption: 'aes-256',
          userPassword: 'open-me',
          ownerPassword: 'own-me',
          permissions: ['print', 'copy'],
        }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'setDocumentProtection',
            encryption: 'aes-256',
            userPassword: 'open-me',
            ownerPassword: 'own-me',
            // TWO OF SEVEN, and the list is what the assertion is for: a
            // command that sent the whole set, or omitted the field, would
            // produce a document that grants everything and would dispatch
            // exactly as correctly.
            permissions: ['print', 'copy'],
          },
        },
      },
    ]);
  });

  it('sends a REMOVAL with no passwords on it', async () => {
    // `encrypt=none` with a password beside it is a value MuPDF ignores and a
    // diff reads as a removal that kept the password. The dialog's schema
    // refuses the shape; this asserts the command does not reintroduce it.
    const { client, sent } = recordingClient();

    await protectDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ encryption: 'none', permissions: [] }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: { kind: 'setDocumentProtection', encryption: 'none', permissions: [] },
        },
      },
    ]);
  });

  it('CONTROL: a DISMISSED dialog dispatches nothing', async () => {
    const { client, sent } = recordingClient();

    await protectDocumentCommand({
      client,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  /**
   * The RENDERER half of the redaction row's pair. The kernel half is
   * `pageRedact.test.ts`, which reads the removed words back out of real bytes.
   */
  describe('applyRedactionsCommand', () => {
    it('dispatches the scope and both choices, with `all` unexpanded', async () => {
      const { client, sent } = recordingClient();
      const opened: { id: string; props: unknown }[] = [];

      await applyRedactionsCommand({
        client,
        onApplied: () => undefined,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve({ pages: 'all', cover: 'none', images: 'remove' });
        },
      }).run(CONTEXT);

      // THE PAGE WENT IN, so the dialog can offer *this page* by number.
      expect(opened).toStrictEqual([
        { id: 'dialog.apply-redactions', props: { page: CONTEXT.page } },
      ]);
      expect(sent).toStrictEqual([
        {
          id: 'document.execute',
          params: {
            docId: DOC,
            command: {
              kind: 'applyRedactions',
              // `'all'`, not a list. Expanding it would put one integer per
              // page on the wire (invariant L11).
              pages: 'all',
              // NEITHER IS THE DEFAULT. A command that ignored the dialog and
              // sent `solid`/`pixels` would dispatch exactly as correctly.
              cover: 'none',
              images: 'remove',
            },
          },
        },
      ]);
    });

    it('CONTROL: a DISMISSED confirm dispatches nothing', async () => {
      // The gate, and it matters more here than anywhere else in this file: the
      // undo is a checkpoint, and a checkpoint goes when the document closes.
      const { client, sent } = recordingClient();

      await applyRedactionsCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });
  });

  describe('signDocumentCommand', () => {
    /** A client answering `document.sign` and recording what it was sent. */
    function signingClient(answer: unknown): {
      readonly client: ContractClient;
      readonly sent: { id: string; params: unknown }[];
    } {
      const sent: { id: string; params: unknown }[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        return Promise.resolve(ok(answer));
      });
      return { client, sent };
    }

    it('calls document.sign — never document.execute — with the dialog’s fields', async () => {
      // THE CHANNEL IS THE ASSERTION. A command that reached for
      // `document.execute` would need a `signDocument` payload, which carries a
      // private key — and `renderableCommandSchema` has that kind removed, so
      // this side cannot express one. The case says that is what happens rather
      // than leaving it to the type.
      const { client, sent } = signingClient({
        kind: 'signed',
        version: asDocVersion(2),
        byteLength: 4096,
        historyDropped: 0,
      });
      const applied: unknown[] = [];

      await signDocumentCommand({
        client,
        onApplied: (value) => applied.push(value),
        ask: () =>
          Promise.resolve({ passphrase: 'secret', name: 'Grace Hopper', reason: 'Approved' }),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([
        {
          id: 'document.sign',
          params: {
            docId: DOC,
            passphrase: 'secret',
            name: 'Grace Hopper',
            reason: 'Approved',
          },
        },
      ]);
      expect(applied).toStrictEqual([{ version: asDocVersion(2), byteLength: 4096 }]);
    });

    it('SHOWS a wrong passphrase rather than returning quietly', async () => {
      // A person chose a certificate and got no signature. Returning quietly is
      // the display-only failure — a control that ran and appeared to do
      // nothing — and it is indistinguishable from success in every assertion
      // about the document.
      const { client } = signingClient({ kind: 'wrong-passphrase' });
      const shown: { id: string; props: unknown }[] = [];

      await signDocumentCommand({
        client,
        onApplied: () => undefined,
        ask: (id, props) => {
          shown.push({ id, props });
          return Promise.resolve(
            id === 'dialog.sign-document' ? { passphrase: 'wrong' } : undefined,
          );
        },
      }).run(CONTEXT);

      expect(shown[1]).toStrictEqual({
        id: 'dialog.sign-problem',
        props: { reason: 'wrong-passphrase' },
      });
    });

    it('CONTROL: a CANCELLED picker shows nothing, because the user did that on purpose', async () => {
      // The other side of the case above, and the one that stops it from being
      // *show a dialog whatever happens*.
      const { client } = signingClient({ kind: 'cancelled' });
      const shown: string[] = [];

      await signDocumentCommand({
        client,
        onApplied: () => undefined,
        ask: (id) => {
          shown.push(id);
          return Promise.resolve(id === 'dialog.sign-document' ? { passphrase: '' } : undefined);
        },
      }).run(CONTEXT);

      expect(shown).toStrictEqual(['dialog.sign-document']);
    });

    it('CONTROL: a DISMISSED dialog dispatches nothing', async () => {
      const { client, sent } = signingClient({ kind: 'cancelled' });

      await signDocumentCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });
  });

  describe('sanitizeDocumentCommand', () => {
    it('dispatches EXACTLY the parts the dialog answered', async () => {
      // THE LIST IS THE PAYLOAD'S WHOLE CONTENT, and a command that sent all
      // four whatever the dialog said would dispatch exactly as correctly and
      // flatten a form somebody meant to keep fillable.
      const { client, sent } = recordingClient();

      await sanitizeDocumentCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve({ parts: ['javascript', 'embedded-files'] }),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([
        {
          id: 'document.execute',
          params: {
            docId: DOC,
            command: { kind: 'sanitizeDocument', parts: ['javascript', 'embedded-files'] },
          },
        },
      ]);
    });

    it('CONTROL: a DISMISSED dialog dispatches nothing', async () => {
      const { client, sent } = recordingClient();

      await sanitizeDocumentCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });
  });

  describe('redactMatchesCommand', () => {
    it('dispatches the MARKING command, never the burn-in', async () => {
      // THE WHOLE DESIGN OF THE ROW, asserted as the command that was sent: a
      // find-and-redact that removed on the spot would leave the document
      // looking the same to any assertion about the dispatch count.
      const { client, sent } = recordingClient();

      await redactMatchesCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve({ query: 'Salary', pages: 'all' }),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([
        {
          id: 'document.execute',
          params: {
            docId: DOC,
            command: { kind: 'markMatchesForRedaction', query: 'Salary', pages: 'all' },
          },
        },
      ]);
    });

    it('CONTROL: a DISMISSED dialog dispatches nothing', async () => {
      const { client, sent } = recordingClient();

      await redactMatchesCommand({
        client,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });
  });
});
