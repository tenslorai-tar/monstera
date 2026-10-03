import {
  type AnnotationStamp,
  type ContractClient,
  type DispatchableCommand,
  type LibraryEntry,
  channels,
  createClient,
} from '@monstera/contract';
import { type DocId, type DocVersion, type MessageKey, asDocId, asDocVersion, asFileHandle, err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  TOAST_ACTIVE_CONTENT_REMOVED,
  TOAST_FORM_FLATTENED,
  TOAST_FORM_DATA_IMPORTED,
  TOAST_PROTECTION_SET,
  TOAST_COPY_SAVED,
  TOAST_DOCUMENT_SIGNED,
  TOAST_EXCEL_SAVED,
  TOAST_FILES_SAVED,
  TOAST_FORM_DATA_SAVED,
  TOAST_IMAGES_SAVED,
  TOAST_PAGES_SAVED,
  TOAST_PDFA_SAVED,
  TOAST_POWERPOINT_SAVED,
  TOAST_SAVED,
  TOAST_SAVED_CLEARED,
  TOAST_SAVED_CLEARED_BACKUPS,
  TOAST_HELD_COPIES_DELETED,
  TOAST_NOTHING_MARKED,
  TOAST_SENT_TO_PRINTER,
  TOAST_SHOW_IN_FOLDER,
  TOAST_SIGNED_COPY_SAVED,
  TOAST_SMALLER_COPY_SAVED,
  TOAST_SNAPSHOT_SAVED,
  TOAST_TEXT_SAVED,
  TOAST_TRANSITION_SET,
  TOAST_WORD_SAVED,
} from '../messages/en.js';
import type { ToastAction } from '../primitives/Toast.js';
import type { CommandContext } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SettingsStore } from '../settingsStore.js';
import { outlinedMarkOf } from '../signatureFaces.js';
import type { ShowToast } from '../toasts.js';
import {
  type Applied,
  applyDocumentCommand,
  cropPagesCommand,
  watermarkPagesCommand,
  duplicatePageCommand,
  insertBlankPageCommand,
  headerFooterCommand,
  batesNumberCommand,
  exportFormDataFdfCommand,
  exportFormDataJsonCommand,
  exportFormDataXfdfCommand,
  detectFlatFieldsCommand,
  EDIT_TEXT_TOOL_ID,
  HAND_TOOL_ID,
  handToolCommand,
  selectTextCommand,
  type TextBlock,
  commitTextBlock,
  editTextCommand,
  promoteTextOnPage,
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
  importPageAsLayerCommand,
  splitDocumentCommand,
  exportPageImagesCommand,
  exportLayoutTextCommand,
  exportExcelCommand,
  exportPowerPointCommand,
  printCommand,
  emailCommand,
  exportPdfaCommand,
  optimizeCommand,
  closeOthersCommand,
  openSideBySideCommand,
  exportTextCommand,
  exportWordCommand,
  generateTocCommand,
  protectDocumentCommand,
  applyRedactionsCommand,
  redactMatchesCommand,
  sanitizeDocumentCommand,
  flattenFormCommand,
  signDocument,
  signDocumentCommand,
  signaturesCommand,
  docusignRetrieveCommand,
  docusignSendCommand,
  deletePagesCommand,
  findDuplicatePagesCommand,
  movePageCommand,
  redoCommand,
  rotatePageCommand,
  deletePageCommand,
  saveCommand,
  saveDocument,
  snapshotRegion,
  undoCommand,
  type SignedEditing,
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

/** The handle a faked write answers for what it wrote (the contract's `WRITTEN`). */
const WRITTEN = asFileHandle('Handle-written-by-the-fake');

/** Recognising first where the setting is off, which is every export case that is not about it (ADR-0118). */
const NOTHING_RECOGNISED = (): Promise<undefined> => Promise.resolve(undefined);

/**
 * The unapplied-marks question answering *go ahead*, which is a document carrying no marks: every case that is not
 * about the question (item N1). The cases that are build their own and assert what was asked.
 */
const NOTHING_MARKED = (): Promise<boolean> => Promise.resolve(true);

const CONTEXT: CommandContext = {
  selectedPages: [],
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
  selectedPages: [],
  docId: undefined,
  version: undefined,
  hasSelection: false,
  dirty: false,
  page: undefined,
  pageCount: undefined,
  openDocuments: [],
};

/** Who and when an annotation is attributed to — every deps object carries it. */
const stamp = (): AnnotationStamp => ({ author: 'A. Tester', created: '2026-09-24T09:38:00.000Z' });

/**
 * What an edit of a signed document needs (ADR-0149). No document a case here names is signed unless the case says so
 * with a bag of its own, so a copy opening through this one is a defect of the case and throws.
 */
const signatures: SignedEditing = {
  warn: () => true,
  onOpened: () => {
    throw new Error('a case opened a copy for an edit without asking for one');
  },
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

/**
 * Records what a file-writing command SAID and what it wrote down.
 *
 * Both lists start empty and stay empty on every path that wrote nothing, which is what makes
 * `toStrictEqual([])` an assertion rather than a shape check: a command that confirmed a save
 * it did not make fails the refusal cases, and one that confirmed nothing fails the success
 * case. Neither is separable from the other's absence by looking at the document.
 */
function saving(): {
  toast: ShowToast;
  onSaved: (docId: DocId, version: DocVersion) => void;
  warnSignatureBreak: () => boolean;
  said: { kind: string; message: string }[];
  wrote: { docId: DocId; version: DocVersion }[];
} {
  const said: { kind: string; message: string }[] = [];
  const wrote: { docId: DocId; version: DocVersion }[] = [];
  return {
    // THE SHIPPED DEFAULT: a save that would break a signature asks.
    warnSignatureBreak: () => true,
    toast: (kind, message) => {
      said.push({ kind, message });
    },
    onSaved: (docId, version) => {
      wrote.push({ docId, version });
    },
    said,
    wrote,
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

    await rotatePageCommand({ client, onApplied, ask, stamp, signatures }).run(CONTEXT);

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

    await rotatePageCommand({ client, onApplied, ask, stamp, signatures }).run(CONTEXT);

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

    await rotatePageCommand({ client: clientFailing('document-busy'), onApplied, ask, stamp, signatures }).run(
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

    await rotatePageCommand({ client: clientFailing('document-busy'), onApplied, ask, stamp, signatures }).run(
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

    await rotatePageCommand({ client, onApplied, ask, stamp, signatures }).run(CONTEXT);

    expect(shown).toStrictEqual([]);
  });

  it('is unavailable with no document focused', () => {
    // `when` is what keeps it off the start screen, and the registry applies it
    // before any projection — so a surface never has to ask, which is the
    // difference between a control that is absent and one that is present and
    // does nothing.
    const { onApplied, ask } = recorder();
    const command = rotatePageCommand({ client: clientFailing('document-busy'), onApplied, ask, stamp, signatures });

    expect(command.when?.(NO_DOCUMENT)).toBe(false);
    expect(command.when?.(CONTEXT)).toBe(true);
  });
});

describe('redo', () => {
  it('hands back both scalars when the log stepped forward', async () => {
    const { applied, onApplied, ask } = recorder();
    const client = clientAnswering('document.redo', { kind: 'redone', version: asDocVersion(4), byteLength: 777 });

    await redoCommand({ client, onApplied, ask, stamp, signatures }).run(CONTEXT);

    expect(applied).toStrictEqual([{ version: 4, byteLength: 777 }]);
  });

  it('nothing-to-redo changed nothing, so the view is not rebuilt — the call not made', async () => {
    const { applied, shown, onApplied, ask } = recorder();

    await redoCommand({ client: clientAnswering('document.redo', { kind: 'nothing-to-redo' }), onApplied, ask, stamp, signatures }).run(
      CONTEXT,
    );

    expect(applied).toStrictEqual([]);
    expect(shown).toStrictEqual([]);
  });

  it('a declared failure is REPORTED, with its code', async () => {
    const { applied, shown, onApplied, ask } = recorder();

    await redoCommand({ client: clientFailing('document-busy'), onApplied, ask, stamp, signatures }).run(CONTEXT);

    expect(applied).toStrictEqual([]);
    expect(shown).toStrictEqual([{ id: 'dialog.command-problem', props: { code: 'document-busy' } }]);
  });
});

describe('move page up / down — Organize › Arrange', () => {
  function recordingExecute(): { client: ContractClient; sent: { id: string; params: unknown }[] } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0 }));
    });
    return { client, sent };
  }

  it.each([
    ['earlier', 2],
    ['later', 4],
  ] as const)('moves the page on show one place %s, as the drag would', async (direction, to) => {
    // FROM THE CONTEXT'S PAGE, which is 3 and not 0 — a command sending a literal would move
    // another page and pass any case whose fixture sat at the start.
    const { client, sent } = recordingExecute();
    const { onApplied, ask } = recorder();

    await movePageCommand({ client, onApplied, ask, stamp, signatures }, direction).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.execute', params: { docId: DOC, command: { kind: 'movePage', from: 3, to } } },
    ]);
  });

  it('is hidden at the end it cannot move past, and shown everywhere else', () => {
    // Asserted on BOTH commands at BOTH ends: a `when` that tested the wrong bound for one
    // direction would hide *Move page up* on the last page, which no single-end case sees.
    const { onApplied, ask } = recorder();
    const client = clientFailing('document-busy');
    const up = movePageCommand({ client, onApplied, ask, stamp, signatures }, 'earlier');
    const down = movePageCommand({ client, onApplied, ask, stamp, signatures }, 'later');
    const first = { ...CONTEXT, page: 0 };
    const last = { ...CONTEXT, page: 9 };

    expect([up.when?.(first), up.when?.(last), up.when?.(CONTEXT)]).toStrictEqual([false, true, true]);
    expect([down.when?.(first), down.when?.(last), down.when?.(CONTEXT)]).toStrictEqual([true, false, true]);
    expect([up.when?.(NO_DOCUMENT), down.when?.(NO_DOCUMENT)]).toStrictEqual([false, false]);
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

    await undoCommand({ client, onApplied, ask, stamp, signatures }).run(CONTEXT);

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

    await undoCommand({ client, onApplied, ask, stamp, signatures }).run(CONTEXT);

    expect(applied).toStrictEqual([]);
  });

  it('declares the chord, because a chord is a property of the command', () => {
    // §7 makes the shortcut map a projection of the registry, so declaring it
    // here is the whole of registering it. A keymap listing it separately would
    // be the second wiring place.
    const { onApplied, ask } = recorder();
    expect(undoCommand({ client: clientFailing('document-busy'), onApplied, ask, stamp, signatures }).shortcut).toBe(
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
      return Promise.resolve(ok({ kind: 'saved', version: asDocVersion(2), cleared: null, held: [] }));
    });

    const shown: { id: string; props: unknown }[] = [];
    const { toast, onSaved, said, wrote } = saving();
    await saveCommand({
      client,
      ask: askRecording(shown),
      toast,
      onSaved,
      warnSignatureBreak: () => true,
      settleMarks: NOTHING_MARKED,
    }).run(CONTEXT);

    expect(asked).toBe('document.save');
    // ASSERT THE CALL THAT WAS NOT MADE. A dialog on the successful path is one
    // that appears every time the user presses Ctrl+S, and the tidy end state —
    // a saved document — is identical either way.
    expect(shown).toStrictEqual([]);
    // AND THE TWO CALLS THAT WERE. Until 2026-09-23 this case ended above, and the command
    // was correct by it while a person pressing Ctrl+S saw nothing change — the owner's
    // report. Nothing observable about the document separates a save that confirmed itself
    // from one that did not, so the confirmation has to be asserted as a call.
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_SAVED }]);
    // THE VERSION MAIN ANSWERED, not one derived here: `savedVersion` is compared against
    // `version` to draw the dot, so a recorder handed the wrong number leaves a saved
    // document showing as dirty for ever.
    expect(wrote).toStrictEqual([{ docId: CONTEXT.docId, version: asDocVersion(2) }]);
  });

  describe('a save that would BREAK SIGNATURES (saving.warn-signature-break)', () => {
    /** Main answers `breaks-signatures` to a save that has not agreed, and `saved` to one that has. */
    const signedClient = (): { client: ContractClient; sent: unknown[] } => {
      const sent: unknown[] = [];
      const client = createClient(channels, (_id, params) => {
        sent.push(params);
        const agreed = (params as { breakSignatures: boolean }).breakSignatures;
        return Promise.resolve(
          ok(agreed ? { kind: 'saved', version: asDocVersion(3), cleared: null, held: [] } : { kind: 'breaks-signatures', signatures: 2 }),
        );
      });
      return { client, sent };
    };
    const agreeing = (answer: unknown) => (id: string, props: unknown): Promise<unknown> => {
      shownHere.push({ id, props });
      return Promise.resolve(answer);
    };
    let shownHere: { id: string; props: unknown }[] = [];

    it('ASKS, and saves saying so once the person agrees', async () => {
      shownHere = [];
      const { client, sent } = signedClient();
      const { toast, onSaved, wrote } = saving();
      const saved = await saveDocument(
        { client, ask: agreeing({ save: true }), toast, onSaved, warnSignatureBreak: () => true },
        CONTEXT.docId ?? DOC,
        'attended',
      );
      expect(saved).toBe(true);
      expect(shownHere).toStrictEqual([{ id: 'dialog.signature-break', props: { signatures: 2 } }]);
      expect(sent).toStrictEqual([
        { docId: CONTEXT.docId, breakSignatures: false },
        { docId: CONTEXT.docId, breakSignatures: true },
      ]);
      expect(wrote).toStrictEqual([{ docId: CONTEXT.docId, version: asDocVersion(3) }]);
    });

    it('CONTROL: DISMISSED keeps the signatures — nothing saved, the document still unsaved', async () => {
      shownHere = [];
      const { client, sent } = signedClient();
      const { toast, onSaved, wrote } = saving();
      expect(
        await saveDocument({ client, ask: agreeing(undefined), toast, onSaved, warnSignatureBreak: () => true }, CONTEXT.docId ?? DOC, 'attended'),
      ).toBe(false);
      expect(sent).toStrictEqual([{ docId: CONTEXT.docId, breakSignatures: false }]);
      expect(wrote).toStrictEqual([]);
    });

    it('with the warning OFF it saves without asking', async () => {
      shownHere = [];
      const { client, sent } = signedClient();
      expect(
        await saveDocument({ client, ask: agreeing(undefined), ...saving(), warnSignatureBreak: () => false }, CONTEXT.docId ?? DOC, 'attended'),
      ).toBe(true);
      expect(shownHere).toStrictEqual([]);
      expect(sent).toHaveLength(2);
    });

    it('UNATTENDED — autosave — never breaks one and never asks, whatever the setting', async () => {
      shownHere = [];
      const { client, sent } = signedClient();
      expect(
        await saveDocument({ client, ask: agreeing({ save: true }), ...saving(), warnSignatureBreak: () => false }, CONTEXT.docId ?? DOC, 'unattended'),
      ).toBe(false);
      expect(shownHere).toStrictEqual([]);
      expect(sent).toStrictEqual([{ docId: CONTEXT.docId, breakSignatures: false }]);
    });
  });

  /**
   * ADR-0139, at the page: a removal's save deleted, unasked, the older copies Monstera made, and the confirmation
   * says so; a file named like a backup that Monstera did not make was kept, and only a person is told its name.
   */
  describe('a REMOVAL’S save — what it deleted, and what it kept', () => {
    interface Cleared {
      backups: number;
      undoCopies: number;
      kept: string[];
    }
    const removalClient = (cleared: Cleared | null): { client: ContractClient; sent: string[] } => {
      const sent: string[] = [];
      const client = createClient(channels, (id) => {
        sent.push(id);
        return Promise.resolve(ok({ kind: 'saved', version: asDocVersion(4), cleared, held: [] }));
      });
      return { client, sent };
    };
    const savedWith = async (cleared: Cleared | null, attendance: 'attended' | 'unattended') => {
      const { client, sent } = removalClient(cleared);
      const asked: { id: string; props: unknown }[] = [];
      const record = saving();
      const ask = (id: string, props: unknown): Promise<unknown> => {
        asked.push({ id, props });
        return Promise.resolve(undefined);
      };
      expect(await saveDocument({ client, ask, ...record }, DOC, attendance)).toBe(true);
      return { said: record.said.map((toast) => toast.message), asked, sent };
    };

    it('the confirmation SAYS the copies were deleted — and that undo stops here when undo copies went', async () => {
      expect((await savedWith({ backups: 2, undoCopies: 1, kept: [] }, 'attended')).said).toStrictEqual([TOAST_SAVED_CLEARED]);
      expect((await savedWith({ backups: 1, undoCopies: 0, kept: [] }, 'attended')).said).toStrictEqual([TOAST_SAVED_CLEARED_BACKUPS]);
      // CONTROL: nothing deleted, and an ordinary save, both say the plain word.
      expect((await savedWith({ backups: 0, undoCopies: 0, kept: [] }, 'attended')).said).toStrictEqual([TOAST_SAVED]);
      expect((await savedWith(null, 'attended')).said).toStrictEqual([TOAST_SAVED]);
    });

    it('a file Monstera did not make is NAMED to a person; nothing else is asked, and the page sends nothing more', async () => {
      const named = await savedWith({ backups: 1, undoCopies: 1, kept: ['report.pdf.bak2'] }, 'attended');
      expect(named.asked).toStrictEqual([{ id: 'dialog.kept-backups', props: { kept: ['report.pdf.bak2'] } }]);
      // THE DELETION IS MAIN'S, inside the save: the page asks for nothing after it.
      expect(named.sent).toStrictEqual(['document.save']);
      // CONTROL: a timer's save has nobody to tell, and a save that kept nothing names nothing.
      expect((await savedWith({ backups: 1, undoCopies: 1, kept: ['report.pdf.bak2'] }, 'unattended')).asked).toStrictEqual([]);
      expect((await savedWith({ backups: 1, undoCopies: 1, kept: [] }, 'attended')).asked).toStrictEqual([]);
    });
  });

  /** CR-DOC-10, at the page: a copy another program held is named, and *Delete now* asks main to try again. */
  describe('a save that left a copy HELD by another program', () => {
    /** Main's answers: the save names `held`, and each retry answers the next of `retries`. */
    const heldClient = (held: string[], retries: string[][]): { client: ContractClient; sent: string[] } => {
      const sent: string[] = [];
      let retry = 0;
      const client = createClient(channels, (id) => {
        sent.push(id);
        if (id === 'document.deleteHeldCopies') return Promise.resolve(ok({ held: retries[retry++] ?? [] }));
        return Promise.resolve(ok({ kind: 'saved', version: asDocVersion(4), cleared: null, held }));
      });
      return { client, sent };
    };

    it('names the copy, and DELETE NOW sends exactly `document.deleteHeldCopies` for this document; none left is said', async () => {
      const { client, sent } = heldClient(['report.pdf.bak'], [[]]);
      const asked: { id: string; props: unknown }[] = [];
      const record = saving();
      const ask = (id: string, props: unknown): Promise<unknown> => {
        asked.push({ id, props });
        return Promise.resolve({ delete: true });
      };
      expect(await saveDocument({ client, ask, ...record }, DOC, 'attended')).toBe(true);
      expect(asked).toStrictEqual([{ id: 'dialog.held-copies', props: { held: ['report.pdf.bak'], still: false } }]);
      expect(sent).toStrictEqual(['document.save', 'document.deleteHeldCopies']);
      expect(record.said.map((toast) => toast.message)).toStrictEqual([TOAST_SAVED, TOAST_HELD_COPIES_DELETED]);
    });

    it('a copy STILL held is named again, saying so; closing then keeps it and sends nothing more', async () => {
      const { client, sent } = heldClient(['report.pdf.bak'], [['report.pdf.bak']]);
      const asked: { id: string; props: unknown }[] = [];
      const answers: unknown[] = [{ delete: true }, undefined];
      const ask = (id: string, props: unknown): Promise<unknown> => {
        asked.push({ id, props });
        return Promise.resolve(answers.shift());
      };
      expect(await saveDocument({ client, ask, ...saving() }, DOC, 'attended')).toBe(true);
      expect(asked.map((one) => one.props)).toStrictEqual([
        { held: ['report.pdf.bak'], still: false },
        { held: ['report.pdf.bak'], still: true },
      ]);
      expect(sent).toStrictEqual(['document.save', 'document.deleteHeldCopies']);
    });

    it('CONTROL: an autosave asks nothing, and a save that owes nothing names nothing', async () => {
      const ask = (): Promise<unknown> => Promise.resolve({ delete: true });
      const autosaved = heldClient(['report.pdf.bak'], []);
      expect(await saveDocument({ client: autosaved.client, ask, ...saving() }, DOC, 'unattended')).toBe(true);
      expect(autosaved.sent).toStrictEqual(['document.save']);
      const clean = heldClient([], []);
      expect(await saveDocument({ client: clean.client, ask, ...saving() }, DOC, 'attended')).toBe(true);
      expect(clean.sent).toStrictEqual(['document.save']);
    });
  });

  it('a refused save CONFIRMS NOTHING and records no saved version', async () => {
    // THE CONTROL for the case above, and it is the load-bearing half. A `saveDocument` that
    // raised its toast before reading `kind` passes every assertion up there — the toast is
    // present, the version is recorded — and tells a person their work is on disk when the
    // file was never written. Only a refusal separates the two, and only by what was NOT
    // called: the document is unsaved either way, the dialog opens either way.
    const client = clientAnswering('document.save', { kind: 'refused', reason: 'contested' });
    const shown: { id: string; props: unknown }[] = [];
    const { toast, onSaved, said, wrote } = saving();

    await saveCommand({
      client,
      ask: askRecording(shown),
      toast,
      onSaved,
      warnSignatureBreak: () => true,
      settleMarks: NOTHING_MARKED,
    }).run(CONTEXT);

    expect(said).toStrictEqual([]);
    expect(wrote).toStrictEqual([]);
    // The dialog still opens, so this case cannot pass by the command doing nothing at all.
    expect(shown).toStrictEqual([{ id: 'dialog.save-problem', props: { outcome: 'contested' } }]);
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
      saveCommand({ client, ask: askRecording(shown), ...saving(), settleMarks: NOTHING_MARKED }).run(CONTEXT),
    ).resolves.toBeUndefined();

    expect(shown).toStrictEqual([
      { id: 'dialog.save-problem', props: { outcome: 'contested' } },
    ]);
  });

  it('a write failure reaches the same dialog, flattened into one enum, and EACH CAUSE to its own sentence (7b)', async () => {
    // The channel answers two shapes describing one thing — `{kind: 'refused',
    // reason}` and `{kind: 'write-failed', cause}` — and the dialog takes one enum,
    // so its body switches once. Without this case the flattening is exercised on
    // one side only, and the side with no `reason` field is the one that would
    // send `undefined`.
    const rows = [
      ['read-only', 'write-read-only'],
      ['held', 'write-held'],
      ['folder-read-only', 'write-folder-read-only'],
      ['disk-full', 'write-disk-full'],
      ['unknown', 'write-failed'],
    ] as const;
    for (const [cause, outcome] of rows) {
      const client = clientAnswering('document.save', { kind: 'write-failed', cause });
      const shown: { id: string; props: unknown }[] = [];

      await saveCommand({ client, ask: askRecording(shown), ...saving(), settleMarks: NOTHING_MARKED }).run(CONTEXT);

      expect([cause, shown]).toStrictEqual([cause, [{ id: 'dialog.save-problem', props: { outcome } }]]);
    }
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

    await saveCommand({ client, ask: askRecording(shown), ...saving(), settleMarks: NOTHING_MARKED }).run(CONTEXT);

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

    await saveCommand({ client, ask: askRecording(shown), ...saving(), settleMarks: NOTHING_MARKED }).run(CONTEXT);

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
      stamp,
      signatures,
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
      // AND THE PAGE ON SHOW, written into the field — nothing is ticked in this context (ADR-0104).
      { id: 'dialog.delete-pages', props: { pageCount: CONTEXT.pageCount, pages: [3] } },
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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

  it('SAVE A COPY dispatches with a DocId and nothing else, and CONFIRMS when it worked', async () => {
    // THE UI HALF. There is no dialog to gate here — the destination comes from
    // the platform's own save dialog, which main runs — so what this asserts is
    // the two things the renderer decides: that it sends a `DocId` alone, and
    // what it says about the outcome.
    //
    // **This case said `opened` was empty AND that a confirmation would be noise, until
    // 2026-09-23.** The reasoning was that the file landed where the user put it, so the
    // platform's own dialog closing was the feedback. The owner's report about Ctrl+S
    // retired that for the whole class: a write that changes nothing on screen reads as a
    // write that did not happen. What survives is the distinction the case was really
    // making — a DIALOG on the successful path is still wrong, because a dialog has to be
    // dismissed. A toast is not a dialog, and `opened` is still asserted empty below.
    const sent: { id: string; params: unknown }[] = [];
    const opened: { id: string; props: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ kind: 'copied', bytes: 2048, written: WRITTEN }));
    });
    const { toast, said } = saving();

    await saveCopyCommand({
      settleMarks: NOTHING_MARKED,
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.saveCopy', params: { docId: DOC } }]);
    expect(opened).toStrictEqual([]);
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_COPY_SAVED }]);
  });

  it('CONTROL: a CANCELLED copy is silent, and a REFUSED one is not', async () => {
    // The two outcomes that look alike from the outside — nothing was written
    // either way — and must not be reported alike. Cancelling is the user's own
    // decision; a refusal is another tab holding the file they chose, which
    // they can act on. Asserting both in one case is what stops a renderer
    // treating "nothing was written" as one state.
    const answers = ['cancelled', 'refused'] as const;
    const openedFor: Record<string, number> = {};
    const saidFor: Record<string, number> = {};

    for (const kind of answers) {
      const opened: unknown[] = [];
      const client = createClient(channels, () =>
        Promise.resolve(
          ok(kind === 'cancelled' ? { kind } : { kind, openElsewhere: 1 }),
        ),
      );
      const { toast, said } = saving();
      await saveCopyCommand({
      settleMarks: NOTHING_MARKED,
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        toast,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);
      openedFor[kind] = opened.length;
      saidFor[kind] = said.length;
    }

    expect(openedFor).toStrictEqual({ cancelled: 0, refused: 1 });
    // AND NEITHER IS CONFIRMED. The case above is the only path that may say *Copy saved*,
    // so a command raising the toast before it read `kind` — the cheapest wrong edit, and
    // one the success case cannot see — is caught here and only here.
    expect(saidFor).toStrictEqual({ cancelled: 0, refused: 0 });
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
      return Promise.resolve(ok({ kind: 'copied', bytes: 512, written: WRITTEN }));
    });
    const deps = { client, onApplied: () => undefined, ask: () => Promise.resolve(undefined), stamp, signatures, toast: () => undefined };

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
      toast: () => undefined,
      stamp,
      signatures,
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
    const deps = { client, onApplied: () => undefined, ask: () => Promise.resolve(undefined), stamp, signatures, toast: () => undefined };

    await importFormDataJsonCommand(deps).run(CONTEXT);
    await importFormDataXfdfCommand(deps).run(CONTEXT);
    await importFormDataFdfCommand(deps).run(CONTEXT);

    expect(sent).toStrictEqual([
      { id: 'document.importFormData', params: { docId: DOC, format: 'json' } },
      { id: 'document.importFormData', params: { docId: DOC, format: 'xfdf' } },
      { id: 'document.importFormData', params: { docId: DOC, format: 'fdf' } },
    ]);
  });

  it('SAYS the form data was imported, and only when it was: the values land in fields on any page (ADR-0141)', async () => {
    // THE CONTROL IS IN THE SAME CASE: a dismissal and a refused file must say nothing, so a confirmation fired on
    // any answer — or before the answer — fails here as surely as a missing one.
    const saidFor: Record<string, unknown[]> = {};
    const answers = {
      imported: ok({ kind: 'imported' as const, version: asDocVersion(2), byteLength: 99, historyDropped: 0 }),
      cancelled: ok({ kind: 'cancelled' as const }),
      unreadable: ok({ kind: 'unreadable' as const }),
    };
    for (const [name, answer] of Object.entries(answers)) {
      const { toast, said } = saving();
      const client = createClient(channels, () => Promise.resolve(answer));
      await importFormDataJsonCommand({ client, stamp, signatures, onApplied: () => undefined, ask: () => Promise.resolve(undefined), toast }).run(CONTEXT);
      saidFor[name] = said;
    }

    expect(saidFor).toStrictEqual({
      imported: [{ kind: 'done', message: TOAST_FORM_DATA_IMPORTED }],
      cancelled: [],
      unreadable: [],
    });
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
      stamp,
      signatures,
      onApplied: (value) => applied.push(value),
      ask: () => Promise.resolve(undefined),
      toast: () => undefined,
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
        stamp,
        signatures,
        onApplied: () => undefined,
        toast: () => undefined,
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
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: () => undefined,
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
      stamp,
      signatures,
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

  it('EDIT TEXT TURNS THE MODE ON, and off again — it opens no dialog and sends nothing', () => {
    // A MODE IN THE TOOL SLOT (ADR-0096). The owner rejected the dialog this
    // replaced; a command that still asked one, or read the page itself, would
    // be the old workflow wearing the new name.
    let active: string | undefined;
    const command = editTextCommand({
      activeTool: () => active,
      onSelect: (id) => {
        active = id;
      },
    });
    void command.run(CONTEXT);
    expect(active).toBe(EDIT_TEXT_TOOL_ID);
    void command.run(CONTEXT);
    expect(active).toBeUndefined();
    // CONTROL: from another tool it switches to Edit text rather than off.
    active = 'annotate.rectangle';
    void command.run(CONTEXT);
    expect(active).toBe(EDIT_TEXT_TOOL_ID);
  });

  it('the HAND turns its mode on and off, and from another tool switches to the hand (§10.3)', () => {
    let active: string | undefined;
    const command = handToolCommand({
      activeTool: () => active,
      onSelect: (id) => {
        active = id;
      },
    });
    void command.run(CONTEXT);
    expect(active).toBe(HAND_TOOL_ID);
    void command.run(CONTEXT);
    expect(active).toBeUndefined();
    active = 'annotate.rectangle';
    void command.run(CONTEXT);
    expect(active).toBe(HAND_TOOL_ID);
  });

  it('TEXT SELECTION turns whatever tool is on OFF, since selecting text is what no tool does', () => {
    let active: string | undefined = HAND_TOOL_ID;
    const command = selectTextCommand({
      onSelect: (id) => {
        active = id;
      },
      activeTool: () => active,
    });
    // PRESSED EXACTLY WHEN NO TOOL IS ON (WCAG 4.1.2's state), read when asked rather than when made.
    expect(command.checked?.(CONTEXT)).toBe(false);
    void command.run(CONTEXT);
    expect(active).toBeUndefined();
    expect(command.checked?.(CONTEXT)).toBe(true);
  });

  it('a TOOL reports itself pressed while it is the one on, and only then', () => {
    let active: string | undefined;
    const hand = handToolCommand({
      activeTool: () => active,
      onSelect: (id) => {
        active = id;
      },
    });
    expect(hand.checked?.(CONTEXT)).toBe(false);
    void hand.run(CONTEXT);
    expect(hand.checked?.(CONTEXT)).toBe(true);
    // CONTROL: another tool on is not this one.
    active = 'annotate.rectangle';
    expect(hand.checked?.(CONTEXT)).toBe(false);
  });

  /**
   * A block as `document.textBlocks` answers one. The indices are non-contiguous
   * and not from zero, so a write that sent a POSITION rather than the engine's
   * own number would edit whatever the page's first objects happen to be.
   */
  const PLAIN = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
  const BLOCK: TextBlock = {
    box: { x0: 72, y0: 660, x1: 300, y1: 711 },
    lines: [
      {
        runs: [
          { index: 4, text: 'The quick ', style: PLAIN },
          { index: 9, text: 'brown fox', style: PLAIN },
        ],
        box: { x0: 72, y0: 700, x1: 300, y1: 711 },
      },
      { runs: [{ index: 2, text: 'jumps over', style: PLAIN }], box: { x0: 72, y0: 686, x1: 190, y1: 697 } },
    ],
    style: PLAIN,
  };

  it('A BLOCK EDIT SENDS the block’s own indices, the words typed, and the version the BLOCKS were read at', async () => {
    // THE UI HALF OF THE WIRED PAIR for `editTextBlock`. Its kernel half is
    // `proof:pdfiumcommand`'s block cases, against the real library; this sees
    // the numbers a surface sends and cannot see a document. The version is the
    // read's (7) and not the tab's, because `#refuseIfStale` asks whether the
    // page is the one the outlines described.
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ version: asDocVersion(8), byteLength: 10, historyDropped: 0 }));
    });
    const applied: Applied[] = [];
    const outcome = await commitTextBlock(
      { client, onApplied: (next) => applied.push(next), ask: () => Promise.resolve(undefined), stamp, signatures },
      DOC,
      3,
      BLOCK,
      'The quick brown dog\njumps over',
      asDocVersion(7),
    );
    expect(outcome).toBe('written');
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: {
            kind: 'editTextBlock',
            page: 3,
            // THE WIRE FORM WRITTEN OUT, not built by the encoder under test (ADR-0142): two lines, of runs 4 and 9
            // and of run 2, one block, its words.
            runs: [4, 9, 2],
            lineStarts: [0, 2],
            blockStarts: [0],
            text: 'The quick brown dog\njumps over',
            textStarts: [0],
            fit: 'reflow',
            version: 7,
          },
        },
      },
    ]);
    expect(applied).toHaveLength(1);
  });

  it('CONTROL: a block whose words did not change SENDS NOTHING', async () => {
    // The words are compared by `lineText`, the rule the kernel diffs with. A
    // commit that sent anyway would regenerate the page for no change — which
    // the kernel refuses, so the person would meet a problem for clicking away.
    const sent: string[] = [];
    const client = createClient(channels, (id) => {
      sent.push(id);
      return Promise.resolve(ok({ version: asDocVersion(8), byteLength: 10, historyDropped: 0 }));
    });
    const outcome = await commitTextBlock(
      { client, onApplied: () => undefined, ask: () => Promise.resolve(undefined), stamp, signatures },
      DOC,
      3,
      BLOCK,
      'The quick brown fox\njumps over',
      asDocVersion(7),
    );
    expect(outcome).toBe('unchanged');
    expect(sent).toStrictEqual([]);
  });

  it('A FONT THAT CANNOT CARRY THE WORDS is the editor’s to say — no dialog opens for it', async () => {
    const asked: string[] = [];
    const client = createClient(channels, () => Promise.resolve(err({ code: 'text-not-writable' as const })));
    const outcome = await commitTextBlock(
      {
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id) => {
          asked.push(id);
          return Promise.resolve(undefined);
        },
      },
      DOC,
      3,
      BLOCK,
      'The quick brown 中',
      asDocVersion(7),
    );
    expect(outcome).toBe('not-writable');
    expect(asked).toStrictEqual([]);
  });

  it('UNPACK sends the promotion for the PAGE the note is on, with no version', async () => {
    // THE UI HALF OF NORMALIZE-THEN-EDIT's pair, on the page now rather than in a
    // dialog. Its kernel half is `proof:pdfiumcommand`'s promotion cases. The page
    // is 3 and zero-based, and no conversion happens here.
    const sent: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok({ version: asDocVersion(8), byteLength: 10, historyDropped: 0 }));
    });
    await promoteTextOnPage({ client, onApplied: () => undefined, ask: () => Promise.resolve(undefined), stamp, signatures }, DOC, 3);
    expect(sent).toStrictEqual([
      { id: 'document.execute', params: { docId: DOC, command: { kind: 'promoteFormObjects', page: 3 } } },
    ]);
  });

  it('CONTROL: any OTHER refusal goes where every refusal goes', async () => {
    // Without this the case above passes on a commit that swallowed every
    // refusal — which is the silent control this project calls a defect.
    const asked: string[] = [];
    const client = createClient(channels, () => Promise.resolve(err({ code: 'stale-target' as const })));
    const outcome = await commitTextBlock(
      {
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id) => {
          asked.push(id);
          return Promise.resolve(undefined);
        },
      },
      DOC,
      3,
      BLOCK,
      'The quick brown dog',
      asDocVersion(7),
    );
    expect(outcome).toBe('refused');
    expect(asked).toStrictEqual(['dialog.command-problem']);
  });

  it('A SIGNED DOCUMENT LEFT AS IT WAS keeps the words: Cancel on the signatures question is `held` (ADR-0149)', async () => {
    const asked: string[] = [];
    const client = createClient(channels, () => Promise.resolve(err({ code: 'breaks-signatures' as const })));
    const outcome = await commitTextBlock(
      {
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        // CANCEL: the signatures question dismissed.
        ask: (id) => {
          asked.push(id);
          return Promise.resolve(undefined);
        },
      },
      DOC,
      3,
      BLOCK,
      'The quick brown dog',
      asDocVersion(7),
    );
    // NOT `refused`, which closes the editor over what was typed; and nothing is reported, since the person chose it.
    expect(outcome).toBe('held');
    expect(asked).toStrictEqual(['dialog.signed-edit']);
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
              next: null,
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
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(answer),
      }).run(CONTEXT);

      expect(sent, `answer ${String(at)}`).toStrictEqual([
        { id: 'document.pageObjects', params: { docId: DOC, page: 3, from: 0 } },
        { id: 'document.execute', params: { docId: DOC, command: expected[at] } },
      ]);
    }
  });

  it('EDIT OBJECT reads EVERY PART of a dense page before it offers the chooser (AAAAAAA-1)', async () => {
    // TWO PARTS, the second starting at 512: a command that asked once would offer the first part as the page.
    const object = (index: number) => ({ index, kind: 'text' as const, left: 0, bottom: 0, right: 1, top: 1, fill: null });
    const asked: number[] = [];
    let offered: unknown;
    await editPageObjectCommand({
      client: createClient(channels, (id, params) => {
        const from = (params as { from: number }).from;
        asked.push(from);
        return Promise.resolve(
          ok(
            from === 0
              ? { version: asDocVersion(4), objects: Array.from({ length: 512 }, (_, at) => object(at)), next: 512, truncated: false }
              : { version: asDocVersion(4), objects: [object(512), object(513)], next: null, truncated: false },
          ),
        );
      }),
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (_id, props) => {
        offered = props;
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(asked).toStrictEqual([0, 512]);
    expect((offered as { objects: unknown[] }).objects).toHaveLength(514);
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
          ok({ version: asDocVersion(1), objects: [], next: null, truncated: false }),
        );
      }),
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
    const said: unknown[] = [];

    await pageTransitionCommand({
      client,
      toast: (_kind, message) => said.push(message),
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ pages: 'all', style: 'replace', durationSeconds: 0 }),
    }).run(CONTEXT);

    // OUT OF SIGHT, so said: a transition plays only when the document is presented.
    expect(said).toStrictEqual([TOAST_TRANSITION_SET]);
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
      stamp,
      signatures,
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
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ pages: [3], widthPoints: 595, heightPoints: 842 });
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([{ id: 'dialog.resize-pages', props: { pages: [3] } }]);
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
    // `applyDocumentCommand` takes `DispatchableCommand` and the union omits
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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

  it('REPORTS a picture past the PIXEL bound, carrying main’s limit', async () => {
    const { client } = recording({
      'document.insertImage': { kind: 'too-many-pixels', limitPixels: 100_000_000 },
    });
    const opened: unknown[] = [];

    await insertImageCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      {
        id: 'dialog.insert-image-problem',
        props: { reason: 'too-many-pixels', limitPixels: 100_000_000 },
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
    // ONE RUN, never a list of every index: a list met the 4,096 cap (JOURNAL, *No document-size refusals*).
    expect(imagePagesFor('all', 3, 5)).toStrictEqual([[0, 4]]);
    expect(imagePagesFor('all', 0, 1)).toStrictEqual([0]);
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
    // params schema has four fields and none of them is a `Uint8Array`.
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
      { client, onApplied: (a) => applied.push(a), ask: () => Promise.resolve(undefined), stamp },
      DOC,
      [3],
      { x0: 10, y0: 20, x1: 110, y1: 70 },
      undefined,
    );

    expect(sent).toStrictEqual([
      {
        id: 'document.placeImage',
        // AND WHO PLACED IT AND WHEN, which main writes into the command it builds (ADR-0103).
        params: { docId: DOC, pages: [3], rect: { x0: 10, y0: 20, x1: 110, y1: 70 }, stamp: stamp() },
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
        stamp,
        onApplied: (a) => applied.push(a),
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      },
      DOC,
      [3],
      { x0: 10, y0: 20, x1: 110, y1: 70 },
      undefined,
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
        stamp,
        onApplied: () => undefined,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve(undefined);
        },
      },
      DOC,
      [3],
      { x0: 10, y0: 20, x1: 110, y1: 70 },
      undefined,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
        params: { docId: DOC, command: { kind: 'replacePage', source: 'doc-2', at: 3, version: 1 } },
      },
    ]);
  });

  it('CONTROL: a DISMISSED replace dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await replacePageCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it("import-as-layer sends importPageAsLayer for the page on screen, named as the CHOSEN tab", async () => {
    const { client, sent } = recording();
    const opened: unknown[] = [];

    await importPageAsLayerCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ source: 'doc-2' });
      },
    }).run(CONTEXT);

    expect(opened).toStrictEqual([
      {
        id: 'dialog.import-page-as-layer',
        props: {
          choices: [
            { docId: 'doc-0', name: 'Before' },
            { docId: 'doc-2', name: 'After' },
          ],
          page: 3,
        },
      },
    ]);
    // THE NAME IS THE CHOSEN TAB'S, looked up by the id the dialog answered. The fixture
    // offers two names and the answer is NOT the first, so a command that took
    // `choices[0].name` would send 'Before' here. `at: 3` is `CONTEXT.page`, unconverted.
    expect(sent).toStrictEqual([
      {
        id: 'document.execute',
        params: {
          docId: DOC,
          command: { kind: 'importPageAsLayer', source: 'doc-2', name: 'After', at: 3, version: 1 },
        },
      },
    ]);
  });

  it('CONTROL: a DISMISSED import-as-layer dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await importPageAsLayerCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('an answer naming a document that was NOT offered dispatches nothing', async () => {
    // The dialog's schema accepts any non-empty string, so this is the command's own
    // decision to make: a source it never listed has no tab name to send, and sending one
    // would be a layer named after nothing the reader chose.
    const { client, sent } = recording();

    await importPageAsLayerCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ source: DOC }),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('extract sends the parsed range to the destination channel', async () => {
    const { client, sent } = recording({
      'document.extract': { kind: 'copied', bytes: 8192, written: WRITTEN },
    });
    const opened: unknown[] = [];

    await extractPagesCommand({
      settleMarks: NOTHING_MARKED,
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: () => undefined,
      ask: (id, props) => {
        opened.push({ id, props });
        return Promise.resolve({ pages: [0, 4, 5] });
      },
    }).run(CONTEXT);

    // THE BOUND GOES IN, so the dialog can refuse a page this document lacks.
    expect(opened).toStrictEqual([{ id: 'dialog.extract-pages', props: { pageCount: 10, pages: [3] } }]);
    // AND THE PAGES COME OUT UNCHANGED — no arithmetic in the command, because
    // `parsePageRanges` already converted from what the reader typed.
    expect(sent).toStrictEqual([
      // AS RUNS: the consecutive 4 and 5 are one entry.
      { id: 'document.extract', params: { docId: DOC, pages: [0, [4, 5]] } },
    ]);
  });

  it('extract reports a contested destination, and CONFIRMS when it worked', async () => {
    // TWO CASES IN ONE, because the pair is the point: a `copied` that opened a
    // dialog would be a success reported as a problem, and a `refused` that
    // opened none would be the display-only failure.
    //
    // The success half also asserts the toast, and the refusal half asserts its absence —
    // `saveCopyCommand`'s pair above, for the same write and the same reason.
    const quiet = recording({ 'document.extract': { kind: 'copied', bytes: 1, written: WRITTEN } });
    const quietDialogs: unknown[] = [];
    const worked = saving();
    await extractPagesCommand({
      settleMarks: NOTHING_MARKED,
      client: quiet.client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: worked.toast,
      ask: (id, props) => {
        quietDialogs.push({ id, props });
        return Promise.resolve({ pages: [0] });
      },
    }).run(CONTEXT);
    expect(quietDialogs.map((entry) => (entry as { id: string }).id)).toStrictEqual([
      'dialog.extract-pages',
    ]);
    expect(worked.said).toStrictEqual([{ kind: 'done', message: TOAST_PAGES_SAVED }]);

    const refused = recording({
      'document.extract': { kind: 'refused', openElsewhere: 2 },
    });
    const spoken: unknown[] = [];
    const failed = saving();
    await extractPagesCommand({
      settleMarks: NOTHING_MARKED,
      client: refused.client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: failed.toast,
      ask: (id, props) => {
        spoken.push({ id, props });
        return Promise.resolve({ pages: [0] });
      },
    }).run(CONTEXT);
    expect(spoken).toStrictEqual([
      { id: 'dialog.extract-pages', props: { pageCount: 10, pages: [3] } },
      { id: 'dialog.save-problem', props: { outcome: 'contested' } },
    ]);
    expect(failed.said).toStrictEqual([]);
  });

  it('split sends the GROUPS the dialog built, not a mode', async () => {
    const { client, sent } = recording({
      'document.split': { kind: 'split', files: 2, written: WRITTEN },
    });

    await splitDocumentCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ groups: [[0, 1], [2]] }),
    }).run(CONTEXT);

    // NO DIALOG MODE ON THE WIRE: the groups the dialog built, each written as runs. `each` below is not a mode either;
    // it is the contract's own spelling of *one file per page*, which `main` turns back into one-page groups.
    expect(sent).toStrictEqual([
      { id: 'document.split', params: { docId: DOC, split: { groups: [[[0, 1]], [2]] } } },
    ]);
  });

  it('split sends ONE FILE PER PAGE as `each`, one run at any length (a document past 4,096 pages)', async () => {
    const { client, sent } = recording({
      'document.split': { kind: 'split', files: 5000, written: WRITTEN },
    });
    // 5,000 ONE-PAGE GROUPS, which as groups is past the contract's 4,096 files.
    const groups = Array.from({ length: 5000 }, (_unused, page) => [page]);

    await splitDocumentCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve({ groups }),
    }).run({ ...CONTEXT, pageCount: 5000 });

    expect(sent).toStrictEqual([{ id: 'document.split', params: { docId: DOC, split: { each: [[0, 4999]] } } }]);
  });

  it('CONTROL: a DISMISSED split dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await splitDocumentCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('export pages as images sends exactly the pages and encoding the dialog chose', async () => {
    const { client, sent } = recording({
      'document.exportPageImages': { kind: 'split', files: 2, written: WRITTEN },
    });
    const asked: unknown[] = [];

    await exportPageImagesCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        asked.push({ id, props });
        return Promise.resolve({ pages: [0, 4], format: 'jpeg', dpi: 150, quality: 70 });
      },
    }).run(CONTEXT);

    // THE PAGE COUNT GOES IN, and every field comes back out unchanged — a
    // command that dropped `quality` or defaulted `format` fails here.
    expect(asked).toStrictEqual([{ id: 'dialog.export-page-images', props: { pageCount: 10 } }]);
    expect(sent).toStrictEqual([
      {
        id: 'document.exportPageImages',
        params: { docId: DOC, pages: [0, 4], format: 'jpeg', dpi: 150, quality: 70 },
      },
    ]);
  });

  it('export pages as images reports a contested folder through the save problem dialog', async () => {
    const { client } = recording({
      'document.exportPageImages': { kind: 'refused', openElsewhere: 1 },
    });
    const spoken: unknown[] = [];

    await exportPageImagesCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        spoken.push({ id, props });
        return Promise.resolve({ pages: [0], format: 'png', dpi: 72, quality: 90 });
      },
    }).run(CONTEXT);

    expect(spoken).toStrictEqual([
      { id: 'dialog.export-page-images', props: { pageCount: 10 } },
      { id: 'dialog.save-problem', props: { outcome: 'contested' } },
    ]);
  });

  it('export text dispatches the document and opens no dialog of its own', async () => {
    const { client, sent } = recording({ 'document.exportText': { kind: 'copied', bytes: 12, written: WRITTEN } });
    const asked: unknown[] = [];

    await exportTextCommand({
      settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        asked.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.exportText', params: { docId: DOC, mode: 'plain' } }]);
    // NOTHING WAS ASKED: the save dialog is main's, and a success is a toast, never a dialog.
    expect(asked).toStrictEqual([]);
  });

  it('export to Word asks the mode, then dispatches EXACTLY that mode', async () => {
    // The UI half of the Word export's pair. Each mode is asked for in turn, so a
    // command that sent a fixed mode passes for one of them at most.
    for (const mode of ['text', 'layout', 'rich'] as const) {
      const { client, sent } = recording({ 'document.exportWord': { kind: 'copied', bytes: 9, written: WRITTEN } });
      const asked: unknown[] = [];

      await exportWordCommand({
      settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
        client,
        toast: () => undefined,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve({ mode });
        },
      }).run(CONTEXT);

      expect(asked).toStrictEqual([{ id: 'dialog.export-word', props: {} }]);
      expect(sent).toStrictEqual([{ id: 'document.exportWord', params: { docId: DOC, mode } }]);
    }
  });

  it('export to PowerPoint dispatches the document and opens no dialog of its own', async () => {
    const { client, sent } = recording({ 'document.exportPowerPoint': { kind: 'copied', bytes: 9, written: WRITTEN } });
    const asked: unknown[] = [];

    await exportPowerPointCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        asked.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.exportPowerPoint', params: { docId: DOC } }]);
    expect(asked).toStrictEqual([]);
  });

  describe('export as PDF/A (ADR-0075)', () => {
    it('dispatches the document, and shows what was left out only when something was — lines or tags', async () => {
      for (const [removed, tagsDropped, notices] of [
        [['not permitted in PDF/A, annotation will not be present in output file'], false, 1],
        [[], true, 1],
        [[], false, 0],
      ] as const) {
        const { client, sent } = recording({ 'document.exportPdfa': { kind: 'copied', bytes: 9, removed, tagsDropped, written: WRITTEN } });
        const asked: unknown[] = [];

        await exportPdfaCommand({
          settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
          client,
          toast: () => undefined,
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: (id, props) => {
            asked.push({ id, props });
            return Promise.resolve(undefined);
          },
        }).run(CONTEXT);

        expect(sent).toStrictEqual([{ id: 'document.exportPdfa', params: { docId: DOC } }]);
        expect(asked).toStrictEqual(notices === 1 ? [{ id: 'dialog.pdfa-removals', props: { removed, tagsDropped } }] : []);
      }
    });

    it('says so for no converter, no PDF/A, a refused and an unwritable destination, and nothing for a dismissed dialog', async () => {
      for (const [answered, spoken] of [
        [{ kind: 'unavailable' }, [{ id: 'dialog.save-problem', props: { outcome: 'pdfa-unavailable' } }]],
        [{ kind: 'failed' }, [{ id: 'dialog.save-problem', props: { outcome: 'pdfa-failed' } }]],
        [{ kind: 'write-failed' }, [{ id: 'dialog.save-problem', props: { outcome: 'write-failed' } }]],
        [{ kind: 'refused', openElsewhere: 1 }, [{ id: 'dialog.save-problem', props: { outcome: 'contested' } }]],
        [{ kind: 'cancelled' }, []],
      ] as const) {
        const { client } = recording({ 'document.exportPdfa': answered });
        const asked: unknown[] = [];

        await exportPdfaCommand({
          settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
          client,
          toast: () => undefined,
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: (id, props) => {
            asked.push({ id, props });
            return Promise.resolve(undefined);
          },
        }).run(CONTEXT);

        expect(asked).toStrictEqual(spoken);
      }
    });
  });

  describe('close other tabs (§7, the tab menu)', () => {
    const OTHER = asDocId('doc-2');
    const THIRD = asDocId('doc-3');
    const tab = (docId: DocId, name: string) => ({ docId, name, version: asDocVersion(1), byteLength: 1 });
    const TABS = [tab(DOC, 'a.pdf'), tab(OTHER, 'b.pdf'), tab(THIRD, 'c.pdf')];

    it('closes every open document BUT the one it was opened on, through the one close path, in one call', async () => {
      const closed: (readonly string[])[] = [];
      await closeOthersCommand({
        close: (docIds) => {
          closed.push(docIds);
          return Promise.resolve(true);
        },
      }).run({ ...CONTEXT, docId: OTHER, openDocuments: TABS });

      // THE RIGHT-CLICKED TAB IS KEPT, not the one on show: `CONTEXT.docId` is DOC, and a command
      // that kept the focused document would close OTHER here.
      expect(closed).toStrictEqual([[DOC, THIRD]]);
    });

    it('CONTROL: is hidden where nothing else is open, and shown where something is', () => {
      const command = closeOthersCommand({ close: () => Promise.resolve(true) });
      expect(command.when?.({ ...CONTEXT, openDocuments: [tab(DOC, 'a.pdf')] })).toBe(false);
      expect(command.when?.({ ...CONTEXT, openDocuments: TABS })).toBe(true);
    });

    /** The command with what it asked Side by Side to show recorded. */
    function sideBySide(focused: DocId | undefined) {
      const shown: (readonly [DocId, DocId])[] = [];
      return {
        shown,
        command: openSideBySideCommand({
          focused: () => focused,
          show: (left, right) => shown.push([left, right]),
        }),
      };
    }

    it('open side by side shows the document on show on the LEFT and the RIGHT-CLICKED one on the right', async () => {
      const { command, shown } = sideBySide(DOC);
      await command.run({ ...CONTEXT, docId: OTHER, openDocuments: TABS });
      // `CONTEXT.docId` is rewritten to OTHER by the tab menu while DOC stays focused, so a
      // command reading the focused document from the context would put OTHER on both sides.
      expect(shown).toStrictEqual([[DOC, OTHER]]);
    });

    it('CONTROL: it is hidden on the tab already on show, and shows nothing if run there', async () => {
      // Both halves, for the reason every `when` case here carries: a predicate that hid the item
      // while `run` still acted would be caught by nothing else — and the effect it would have is
      // the focused document on both sides, which looks like the command working.
      const { command, shown } = sideBySide(DOC);
      expect(command.when?.({ ...CONTEXT, docId: DOC, openDocuments: TABS })).toBe(false);
      expect(command.when?.({ ...CONTEXT, docId: OTHER, openDocuments: TABS })).toBe(true);
      await command.run({ ...CONTEXT, docId: DOC, openDocuments: TABS });
      expect(shown).toStrictEqual([]);
    });

    it('sits THIRD in the tab menu, after close and close others', () => {
      expect(sideBySide(DOC).command.placements).toStrictEqual([
        { surface: 'context-menu', context: 'tab', order: 30 },
      ]);
    });
  });

  describe('save a smaller copy (ADR-0087)', () => {
    const MEASURED = { kind: 'measured', version: asDocVersion(7), before: 200_000, after: 120_000 } as const;

    /**
     * Runs the command answering the dialog from `answers` in turn, recording every ask and every
     * tracked task — `cancelled` aborts each task's signal as it starts, the reader's cancel.
     */
    async function running(
      answered: Record<string, unknown>,
      answers: unknown[],
      cancelled = false,
    ): Promise<{
      sent: { id: string; params: unknown }[];
      asked: { id: string; props: unknown }[];
      tasks: string[];
    }> {
      const { client, sent } = recording(answered);
      const asked: { id: string; props: unknown }[] = [];
      const tasks: string[] = [];
      await optimizeCommand({
        settleMarks: NOTHING_MARKED,
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        toast: () => undefined,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve(id === 'dialog.optimize' ? answers.shift() : undefined);
        },
        track: (label, total) => {
          tasks.push(`start:${label}:${String(total)}`);
          const controller = new AbortController();
          if (cancelled) controller.abort();
          return {
            signal: controller.signal,
            step: (done) => tasks.push(`step:${String(done)}`),
            end: () => tasks.push('end'),
          };
        },
      }).run(CONTEXT);
      return { sent, asked, tasks };
    }

    it('SHOWS the check as a running task, and ends it', async () => {
      const { tasks } = await running({ 'document.optimizeMeasure': MEASURED }, [{ kind: 'measure', setting: 'high' }, undefined]);
      expect(tasks).toStrictEqual(['start:task.optimize-checking:1', 'step:1', 'end']);
    });

    it('a CANCELLED check opens the dialog again for nothing, and saves nothing', async () => {
      const { asked, sent } = await running({ 'document.optimizeMeasure': MEASURED }, [{ kind: 'measure', setting: 'high' }], true);
      expect(asked).toHaveLength(1);
      expect(sent.map((each) => each.id)).toStrictEqual(['document.optimizeMeasure']);
    });

    it('measures the setting chosen, shows the sizes, and saves at THE VERSION MEASURED', async () => {
      const { sent, asked } = await running(
        { 'document.optimizeMeasure': MEASURED, 'document.optimize': { kind: 'copied', bytes: 120_000, before: 200_000, written: WRITTEN } },
        [
          { kind: 'measure', setting: 'medium' },
          { kind: 'save', setting: 'medium' },
        ],
      );

      expect(asked).toStrictEqual([
        { id: 'dialog.optimize', props: { setting: 'high', measured: null } },
        { id: 'dialog.optimize', props: { setting: 'medium', measured: { before: 200_000, after: 120_000 } } },
      ]);
      // THE VERSION IS THE MEASUREMENT'S, 7, and not the context's 1: it is what makes a save of
      // an edited document answer `changed` rather than write sizes nobody was shown.
      expect(sent).toStrictEqual([
        { id: 'document.optimizeMeasure', params: { docId: DOC, setting: 'medium' } },
        { id: 'document.optimize', params: { docId: DOC, setting: 'medium', version: asDocVersion(7) } },
      ]);
    });

    it('CONTROL: a dismissed dialog sends nothing at all', async () => {
      const { sent } = await running({}, [undefined]);
      expect(sent).toStrictEqual([]);
    });

    it('says so for no library, an unreadable document, a document that moved, and a refused destination', async () => {
      for (const [answered, outcome] of [
        [{ 'document.optimizeMeasure': { kind: 'unavailable' } }, 'optimize-unavailable'],
        [{ 'document.optimizeMeasure': { kind: 'unreadable' } }, 'optimize-unreadable'],
        [{ 'document.optimizeMeasure': MEASURED, 'document.optimize': { kind: 'changed' } }, 'optimize-changed'],
        [{ 'document.optimizeMeasure': MEASURED, 'document.optimize': { kind: 'refused', openElsewhere: 1 } }, 'contested'],
      ] as const) {
        const { asked } = await running(answered, [
          { kind: 'measure', setting: 'high' },
          { kind: 'save', setting: 'high' },
        ]);
        expect(asked.at(-1), outcome).toStrictEqual({ id: 'dialog.save-problem', props: { outcome } });
      }
    });

    it('shows main’s own sizes again when it answers not-smaller, and writes nothing', async () => {
      const { asked } = await running(
        { 'document.optimizeMeasure': MEASURED, 'document.optimize': { kind: 'not-smaller', before: 200_000, after: 210_000 } },
        [{ kind: 'measure', setting: 'low' }, { kind: 'save', setting: 'low' }, undefined],
      );
      expect(asked.at(-1)).toStrictEqual({
        id: 'dialog.optimize',
        props: { setting: 'low', measured: { before: 200_000, after: 210_000 } },
      });
    });
  });

  describe('email (ADR-0080)', () => {
    it('dispatches the document and asks nothing when the sheet opened', async () => {
      const { client, sent } = recording({ 'document.email': { kind: 'offered' } });
      const asked: unknown[] = [];

      await emailCommand({
        settleMarks: NOTHING_MARKED,
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);

      expect(sent).toStrictEqual([{ id: 'document.email', params: { docId: DOC } }]);
      expect(asked).toStrictEqual([]);
    });

    it('says so for a platform with no sheet and for a step that refused', async () => {
      for (const [answered, spoken] of [
        [{ kind: 'unavailable' }, 'email-unavailable'],
        [{ kind: 'failed' }, 'email-failed'],
      ] as const) {
        const { client } = recording({ 'document.email': answered });
        const asked: unknown[] = [];

        await emailCommand({
        settleMarks: NOTHING_MARKED,
          client,
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: (id, props) => {
            asked.push({ id, props });
            return Promise.resolve(undefined);
          },
        }).run(CONTEXT);

        expect(asked).toStrictEqual([{ id: 'dialog.save-problem', props: { outcome: spoken } }]);
      }
    });
  });

  describe('print (ADR-0074)', () => {
    /** The shipped settings, so the print quality is read through the registry as the application reads it. */
    const printSettings = (): SettingsStore => new SettingsStore(new SettingsRegistry(ALL_SETTINGS));

    it('asks the resolution and dispatches exactly the one chosen, for each of the three', async () => {
      for (const dpi of [150, 300, 600] as const) {
        const { client, sent } = recording({ 'document.print': { kind: 'printed', pages: 2 } });
        const asked: unknown[] = [];

        await printCommand({
          settleMarks: NOTHING_MARKED,
          client,
          toast: () => undefined,
          stamp,
          signatures,
          settings: printSettings(),
          onApplied: () => undefined,
          ask: (id, props) => {
            asked.push({ id, props });
            return Promise.resolve({ dpi });
          },
        }).run(CONTEXT);

        // THE DIALOG STARTS ON STANDARD, the setting's default.
        expect(asked).toStrictEqual([{ id: 'dialog.print', props: { dpi: 300 } }]);
        expect(sent).toStrictEqual([{ id: 'document.print', params: { docId: DOC, dpi } }]);
      }
    });

    it('the dialog STARTS ON the quality Settings › Rendering chose', async () => {
      for (const [quality, dpi] of [
        ['draft', 150],
        ['high', 600],
      ] as const) {
        const settings = printSettings();
        settings.set('rendering.print-quality', quality);
        const asked: unknown[] = [];
        await printCommand({
          settleMarks: NOTHING_MARKED,
          client: recording().client,
          toast: () => undefined,
          stamp,
          signatures,
          settings,
          onApplied: () => undefined,
          ask: (id, props) => {
            asked.push({ id, props });
            return Promise.resolve(undefined);
          },
        }).run(CONTEXT);
        expect(asked).toStrictEqual([{ id: 'dialog.print', props: { dpi } }]);
      }
    });

    it('CONTROL: a DISMISSED resolution dialog prints nothing', async () => {
      const { client, sent } = recording();

      await printCommand({
          settleMarks: NOTHING_MARKED,
        client,
        toast: () => undefined,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
        stamp,
        signatures,
        settings: printSettings(),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });

    it('says so for a platform with no print dialog and for a printer that refused, and nothing for a dismissed one', async () => {
      for (const [answered, spokenLast] of [
        [{ kind: 'unavailable' }, { id: 'dialog.save-problem', props: { outcome: 'print-unavailable' } }],
        [{ kind: 'failed' }, { id: 'dialog.save-problem', props: { outcome: 'print-failed' } }],
        [{ kind: 'cancelled' }, { id: 'dialog.print', props: { dpi: 300 } }],
      ] as const) {
        const { client } = recording({ 'document.print': answered });
        const spoken: unknown[] = [];

        await printCommand({
          settleMarks: NOTHING_MARKED,
          client,
          toast: () => undefined,
          stamp,
          signatures,
          settings: printSettings(),
          onApplied: () => undefined,
          ask: (id, props) => {
            spoken.push({ id, props });
            return Promise.resolve(id === 'dialog.print' ? { dpi: 300 } : undefined);
          },
        }).run(CONTEXT);

        expect(spoken.at(-1)).toStrictEqual(spokenLast);
      }
    });

    it('a PRINTED job is confirmed, and a dismissed system dialog confirms nothing', async () => {
      for (const [answered, expected] of [
        [{ kind: 'printed', pages: 2 }, [TOAST_SENT_TO_PRINTER]],
        [{ kind: 'cancelled' }, []],
      ] as const) {
        const said: unknown[] = [];
        await printCommand({
          settleMarks: NOTHING_MARKED,
          client: recording({ 'document.print': answered }).client,
          toast: (_kind, message) => said.push(message),
          stamp,
          signatures,
          settings: printSettings(),
          onApplied: () => undefined,
          ask: () => Promise.resolve({ dpi: 300 }),
        }).run(CONTEXT);
        expect(said).toStrictEqual(expected);
      }
    });
  });

  describe('export tables to Excel — the review grid, a page at a time', () => {
    /** One cell per page, whose text names the page, so a grid opened on the wrong page is visible. */
    const tablesOf = (page: number): unknown => [{ rows: [[{ text: `on ${String(page)}`, clipped: false }]] }];

    /** A client answering each page's tables at the version `versionAt` gives it, and the export with `exported`. */
    function reviewing(
      exported: unknown,
      versionAt: (page: number) => number = () => 5,
    ): { readonly client: ContractClient; readonly sent: { id: string; params: unknown }[] } {
      const sent: { id: string; params: unknown }[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'document.pageTables') {
          const { page } = params as { page: number };
          return Promise.resolve(
            ok({ version: asDocVersion(versionAt(page)), pageCount: 10, tables: tablesOf(page), truncated: false }),
          );
        }
        return Promise.resolve(ok(exported));
      });
      return { client, sent };
    }

    it('opens on the page ON SHOW, moves when asked, and sends every page’s edits with the version read', async () => {
      const { client, sent } = reviewing({ kind: 'copied', bytes: 9, written: WRITTEN });
      const asked: { id: string; props: unknown }[] = [];
      const answers = [
        { kind: 'page', to: 4, layout: 'one-sheet', engine: 'automatic', edits: [{ table: 0, row: 0, column: 0, text: 'A' }] },
        { kind: 'export', layout: 'one-sheet', engine: 'automatic', edits: [{ table: 0, row: 0, column: 0, text: 'B' }] },
      ];

      await exportExcelCommand({
        settleMarks: NOTHING_MARKED,
        client,
        toast: () => undefined,
        tableEngines: () => ['automatic'],
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve(answers.shift());
        },
      }).run(CONTEXT);

      expect(asked).toStrictEqual([
        {
          id: 'dialog.export-excel',
          props: {
            index: 3,
            page: 4,
            pageCount: 10,
            tables: tablesOf(3),
            truncated: false,
            layout: 'sheet-per-page',
            engines: ['automatic'],
            engine: 'automatic',
            edits: [],
          },
        },
        {
          id: 'dialog.export-excel',
          props: {
            index: 4,
            page: 5,
            pageCount: 10,
            tables: tablesOf(4),
            truncated: false,
            layout: 'one-sheet',
            engines: ['automatic'],
            engine: 'automatic',
            edits: [],
          },
        },
      ]);
      expect(sent).toStrictEqual([
        { id: 'document.pageTables', params: { docId: DOC, page: 3 } },
        { id: 'document.pageTables', params: { docId: DOC, page: 4 } },
        {
          id: 'document.exportExcel',
          params: {
            docId: DOC,
            layout: 'one-sheet',
            engine: 'automatic',
            version: asDocVersion(5),
            edits: [
              { page: 3, table: 0, row: 0, column: 0, text: 'A' },
              { page: 4, table: 0, row: 0, column: 0, text: 'B' },
            ],
          },
        },
      ]);
    });

    it('opens a page AGAIN with the edits typed on it before', async () => {
      const { client } = reviewing({ kind: 'copied', bytes: 9, written: WRITTEN });
      const opened: unknown[] = [];
      const typed = [{ table: 0, row: 0, column: 0, text: 'A' }];
      const answers = [
        { kind: 'page', to: 4, layout: 'sheet-per-page', engine: 'automatic', edits: typed },
        { kind: 'page', to: 3, layout: 'sheet-per-page', engine: 'automatic', edits: [] },
        { kind: 'export', layout: 'sheet-per-page', engine: 'automatic', edits: typed },
      ];

      await exportExcelCommand({
        settleMarks: NOTHING_MARKED,
        client,
        toast: () => undefined,
        tableEngines: () => ['automatic'],
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (_id, props) => {
          opened.push((props as { edits: unknown }).edits);
          return Promise.resolve(answers.shift());
        },
      }).run(CONTEXT);

      expect(opened).toStrictEqual([[], [], typed]);
    });

    it('stops with REVIEW-CHANGED, exporting nothing, when a page is read at another version', async () => {
      const { client, sent } = reviewing({ kind: 'copied', bytes: 9, written: WRITTEN }, (page) => (page === 3 ? 5 : 6));
      const spoken: unknown[] = [];

      await exportExcelCommand({
        settleMarks: NOTHING_MARKED,
        client,
        toast: () => undefined,
        tableEngines: () => ['automatic'],
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          spoken.push({ id, props });
          return Promise.resolve(
            id === 'dialog.export-excel'
              ? { kind: 'page', to: 4, layout: 'sheet-per-page', engine: 'automatic', edits: [] }
              : undefined,
          );
        },
      }).run(CONTEXT);

      expect(sent.map((each) => each.id)).toStrictEqual(['document.pageTables', 'document.pageTables']);
      expect(spoken.at(-1)).toStrictEqual({ id: 'dialog.save-problem', props: { outcome: 'review-changed' } });
    });

    it('CONTROL: a DISMISSED grid exports nothing', async () => {
      const { client, sent } = reviewing({ kind: 'copied', bytes: 9, written: WRITTEN });

      await exportExcelCommand({
        settleMarks: NOTHING_MARKED,
        client,
        toast: () => undefined,
        tableEngines: () => ['automatic'],
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent.map((each) => each.id)).toStrictEqual(['document.pageTables']);
    });

    it('says what went wrong for no table, pictures with no text, and a document that changed', async () => {
      for (const [exported, outcome] of [
        [{ kind: 'no-tables', picturePages: 0 }, 'no-tables'],
        [{ kind: 'no-tables', picturePages: 2 }, 'no-tables-no-text'],
        [{ kind: 'changed' }, 'review-changed'],
      ] as const) {
        const { client } = reviewing(exported);
        const spoken: unknown[] = [];

        await exportExcelCommand({
        settleMarks: NOTHING_MARKED,
          client,
          toast: () => undefined,
          tableEngines: () => ['automatic'],
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: (id, props) => {
            spoken.push({ id, props });
            return Promise.resolve(
              id === 'dialog.export-excel'
                ? { kind: 'export', layout: 'one-sheet', engine: 'automatic', edits: [] }
                : undefined,
            );
          },
        }).run(CONTEXT);

        expect(spoken.at(-1)).toStrictEqual({ id: 'dialog.save-problem', props: { outcome } });
      }
    });

    it('sends the SERVICE the person chose and no edits, and shows a page the service refused', async () => {
      // THE UI HALF of ADR-0086's wired pair: the dialog offers what `tableEngines` answers, the
      // choice crosses as `engine`, and the grid's edits — MuPDF's tables' — do not cross with it.
      const { client, sent } = reviewing({
        kind: 'service-refused',
        engine: 'claude',
        page: 6,
        reason: 'rejected',
        detail: 'Claude said no.',
      });
      const spoken: { id: string; props: unknown }[] = [];

      await exportExcelCommand({
        settleMarks: NOTHING_MARKED,
        client,
        toast: () => undefined,
        tableEngines: () => ['automatic', 'claude'],
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          spoken.push({ id, props });
          return Promise.resolve(
            id === 'dialog.export-excel'
              ? { kind: 'export', layout: 'sheet-per-page', engine: 'claude', edits: [{ table: 0, row: 0, column: 0, text: 'Z' }] }
              : undefined,
          );
        },
      }).run(CONTEXT);

      expect((spoken[0]?.props as { engines: unknown }).engines).toStrictEqual(['automatic', 'claude']);
      expect(sent.at(-1)).toStrictEqual({
        id: 'document.exportExcel',
        params: { docId: DOC, layout: 'sheet-per-page', engine: 'claude', version: asDocVersion(5), edits: [] },
      });
      // PAGE 6 ZERO-BASED IS THE SEVENTH a person reads.
      expect(spoken.at(-1)).toStrictEqual({
        id: 'dialog.service-refused',
        props: { page: 7, reason: 'rejected', detail: 'Claude said no.' },
      });
    });
  });

  it('CONTROL: a DISMISSED Word export dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await exportWordCommand({
      settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('export text WITH LAYOUT dispatches the same channel with the layout mode', async () => {
    // The UI half of the layout export's wired pair. The two commands differ in
    // exactly this field, so a layout command that sent `plain` — or omitted the
    // mode — would pass every other case in this file and read MuPDF's text.
    const { client, sent } = recording({ 'document.exportText': { kind: 'copied', bytes: 12, written: WRITTEN } });

    await exportLayoutTextCommand({
      settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.exportText', params: { docId: DOC, mode: 'layout' } }]);
  });

  it('a layout export with NO CONVERTER, and one that FAILED, each say so through the save problem dialog', async () => {
    for (const [kind, outcome] of [
      ['unavailable', 'layout-unavailable'],
      ['failed', 'layout-failed'],
    ] as const) {
      const { client } = recording({ 'document.exportText': { kind } });
      const spoken: unknown[] = [];

      await exportLayoutTextCommand({
      settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
        client,
        toast: () => undefined,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          spoken.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);

      expect(spoken).toStrictEqual([{ id: 'dialog.save-problem', props: { outcome } }]);
    }
  });

  it('export text reports a contested destination through the save problem dialog', async () => {
    const { client } = recording({ 'document.exportText': { kind: 'refused', openElsewhere: 1 } });
    const spoken: unknown[] = [];

    await exportTextCommand({
      settleMarks: NOTHING_MARKED,
      recogniseFirst: NOTHING_RECOGNISED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: (id, props) => {
        spoken.push({ id, props });
        return Promise.resolve(undefined);
      },
    }).run(CONTEXT);

    expect(spoken).toStrictEqual([{ id: 'dialog.save-problem', props: { outcome: 'contested' } }]);
  });

  describe('recognising the scanned pages first, where the person turned it on (ADR-0118)', () => {
    /** One timeline for the walk, the channels and the dialogs, so a case can assert their ORDER. */
    function timeline(walked: { recognised: number; skipped: number; stopped: boolean } | undefined): {
      readonly deps: Parameters<typeof exportTextCommand>[0];
      readonly events: string[];
      readonly walks: unknown[];
    } {
      const events: string[] = [];
      const walks: unknown[] = [];
      const client = createClient(channels, (id) => {
        events.push(`channel ${id}`);
        return Promise.resolve(ok({ kind: 'copied', bytes: 12, removed: [], tagsDropped: false, written: WRITTEN }));
      });
      return {
        deps: {
          client,
          toast: () => undefined,
          stamp,
          signatures,
          onApplied: () => undefined,
          settleMarks: NOTHING_MARKED,
          ask: (id) => {
            events.push(`dialog ${id}`);
            return Promise.resolve(id === 'dialog.export-word' ? { mode: 'rich' } : undefined);
          },
          recogniseFirst: (docId, pageCount) => {
            walks.push({ docId, pageCount });
            events.push('walk');
            return Promise.resolve(walked);
          },
        },
        events,
        walks,
      };
    }

    it.each([
      ['text', exportTextCommand, 'document.exportText'],
      ['layout text', exportLayoutTextCommand, 'document.exportText'],
      ['PDF/A', exportPdfaCommand, 'document.exportPdfa'],
    ] as const)('%s: the walk runs FIRST, over the whole document, and what it recognised is said before the export’s own report', async (_name, build, channel) => {
      const { deps, events, walks } = timeline({ recognised: 2, skipped: 1, stopped: false });

      await build(deps).run(CONTEXT);

      // THE DOCUMENT AND ITS PAGE COUNT, not the page on show: the setting recognises the document the export writes.
      expect(walks).toStrictEqual([{ docId: DOC, pageCount: 10 }]);
      expect(events).toStrictEqual(['walk', `channel ${channel}`, 'dialog dialog.ocr-outcome']);
    });

    it('Word: AFTER the mode is chosen, so a dismissed mode dialog recognises nothing', async () => {
      const { deps, events } = timeline({ recognised: 1, skipped: 0, stopped: false });
      await exportWordCommand(deps).run(CONTEXT);
      expect(events).toStrictEqual([
        'dialog dialog.export-word',
        'walk',
        'channel document.exportWord',
        'dialog dialog.ocr-outcome',
      ]);

      const dismissed = timeline({ recognised: 1, skipped: 0, stopped: false });
      await exportWordCommand({ ...dismissed.deps, ask: () => Promise.resolve(undefined) }).run(CONTEXT);
      expect(dismissed.walks).toStrictEqual([]);
    });

    it('a walk the person STOPPED writes no file, and says what it did', async () => {
      const { deps, events } = timeline({ recognised: 1, skipped: 0, stopped: true });
      await exportTextCommand(deps).run(CONTEXT);
      expect(events).toStrictEqual(['walk', 'dialog dialog.ocr-outcome']);
    });

    it('CONTROL: a walk that recognised nothing says nothing, and where none ran the export is as before', async () => {
      const nothing = timeline({ recognised: 0, skipped: 3, stopped: false });
      await exportTextCommand(nothing.deps).run(CONTEXT);
      expect(nothing.events).toStrictEqual(['walk', 'channel document.exportText']);

      const off = timeline(undefined);
      await exportTextCommand(off.deps).run(CONTEXT);
      expect(off.events).toStrictEqual(['walk', 'channel document.exportText']);
    });
  });

  it('CONTROL: a DISMISSED export-pages-as-images dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await exportPageImagesCommand({
      settleMarks: NOTHING_MARKED,
      client,
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED extract dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await extractPagesCommand({
      settleMarks: NOTHING_MARKED,
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED merge dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await mergeDocumentCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED resize dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await resizePagesCommand({
      client,
      stamp,
      signatures,
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
      toast: () => undefined,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED Bates dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await batesNumberCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
  });

  it('CONTROL: a DISMISSED header-and-footer dialog dispatches nothing', async () => {
    const { client, sent } = recording();

    await headerFooterCommand({
      client,
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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
        return Promise.resolve(ok({ version: asDocVersion(1), destinations, next: null, truncated: false }));
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
      stamp,
      signatures,
      onApplied: record.onApplied,
      ask: record.ask,
    }).run(CONTEXT);

    // BOTH CALLS AND THEIR ORDER. The read has to precede the dispatch, because
    // its whole job is to decide whether there is one — and `at: 0` rather than
    // `CONTEXT.page + 1`, which is what every other insert here sends and would
    // put a table of contents in the middle of the document.
    expect(sent).toStrictEqual([
      { id: 'document.destinations', params: { docId: DOC, from: 0 } },
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
      stamp,
      signatures,
      onApplied: record.onApplied,
      ask: record.ask,
    }).run(CONTEXT);

    expect(sent).toStrictEqual([{ id: 'document.destinations', params: { docId: DOC, from: 0 } }]);
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
      stamp,
      signatures,
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
      stamp,
      signatures,
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

  it('dispatches EXACTLY what the dialog answered, permissions included — and SAYS it was set (ADR-0141)', async () => {
    const { client, sent } = recordingClient();
    const { toast, said } = saving();

    await protectDocumentCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast,
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
    // NOTHING ON THE PAGE SHOWS A PASSWORD, so the command says it was set, and when it applies.
    expect(said).toStrictEqual([{ kind: 'done', message: TOAST_PROTECTION_SET }]);
  });

  it('sends a REMOVAL with no passwords on it', async () => {
    // `encrypt=none` with a password beside it is a value MuPDF ignores and a
    // diff reads as a removal that kept the password. The dialog's schema
    // refuses the shape; this asserts the command does not reintroduce it.
    const { client, sent } = recordingClient();

    await protectDocumentCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: () => undefined,
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

  it('CONTROL: a DISMISSED dialog dispatches nothing, and says nothing', async () => {
    const { client, sent } = recordingClient();
    const { toast, said } = saving();

    await protectDocumentCommand({
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast,
      ask: () => Promise.resolve(undefined),
    }).run(CONTEXT);

    expect(sent).toStrictEqual([]);
    expect(said).toStrictEqual([]);
  });

  /**
   * The RENDERER half of the redaction row's pair. The kernel half is
   * `pageRedact.test.ts`, which reads the removed words back out of real bytes.
   */
  describe('applyRedactionsCommand', () => {
    /** A document carrying `marks` Redact marks beside one square, recording every call and answering a burn-in. */
    function marked(marks: number): { client: ContractClient; sent: { id: string; params: unknown }[] } {
      const sent: { id: string; params: unknown }[] = [];
      const listed = (kind: 'redact' | 'square', index: number): unknown => ({
        page: 0,
        index,
        rect: { x0: 10, y0: 10, x1: 50, y1: 30 },
        inReplyTo: null,
        kind,
        style: { colour: [0, 0, 0], opacity: 1, borderWidth: null },
        contents: '',
        authored: true,
        author: '',
        created: null,
        blend: 'normal',
      });
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'document.annotations') {
          return Promise.resolve(
            ok({
              version: asDocVersion(1),
              // THE SQUARE IS THE CONTROL in the fixture: a count of every annotation would say 1 with no marks.
              annotations: [listed('square', 0), ...Array.from({ length: marks }, (_unused, at) => listed('redact', at + 1))],
              next: null,
              truncated: false,
            }),
          );
        }
        return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0 }));
      });
      return { client, sent };
    }

    it('NOTHING MARKED: says so, opens no Apply dialog and burns in nothing (F-P1)', async () => {
      const { client, sent } = marked(0);
      const { toast, said } = saving();
      const opened: string[] = [];

      for (const confirm of [true, false]) {
        await applyRedactionsCommand({
          client,
          stamp,
          signatures,
          toast,
          onApplied: () => undefined,
          ask: (id) => {
            opened.push(id);
            return Promise.resolve({ pages: 'all', cover: 'solid', images: 'pixels', keepTitle: false });
          },
          confirm: () => confirm,
        }).run(CONTEXT);
      }

      // THE CALL NOT MADE, with the confirmation on and off: neither the dialog nor the burn-in.
      expect(opened).toStrictEqual([]);
      expect(sent.map((call) => call.id)).toStrictEqual(['document.annotations', 'document.annotations']);
      expect(said).toStrictEqual([
        { kind: 'problem', message: TOAST_NOTHING_MARKED },
        { kind: 'problem', message: TOAST_NOTHING_MARKED },
      ]);
    });

    it('CONTROL: one mark is enough for Apply to be offered, and nothing is said', async () => {
      const { client } = marked(1);
      const { toast, said } = saving();
      const opened: string[] = [];

      await applyRedactionsCommand({
        client,
        stamp,
        signatures,
        toast,
        onApplied: () => undefined,
        ask: (id) => {
          opened.push(id);
          return Promise.resolve(undefined);
        },
        confirm: () => true,
      }).run(CONTEXT);

      expect(opened).toStrictEqual(['dialog.apply-redactions']);
      expect(said).toStrictEqual([]);
    });

    it('dispatches the scope and both choices, with `all` unexpanded', async () => {
      const { client, sent: calls } = marked(2);
      const opened: { id: string; props: unknown }[] = [];

      await applyRedactionsCommand({
        client,
        stamp,
        signatures,
        toast: () => undefined,
        onApplied: () => undefined,
        ask: (id, props) => {
          opened.push({ id, props });
          return Promise.resolve({ pages: 'all', cover: 'none', images: 'remove', keepTitle: true });
        },
        confirm: () => true,
      }).run(CONTEXT);

      // THE PAGE WENT IN, so the dialog can offer *this page* by number.
      expect(opened).toStrictEqual([
        { id: 'dialog.apply-redactions', props: { page: CONTEXT.page } },
      ]);
      // THE MARKS ARE COUNTED FIRST, then the burn-in is the one command sent.
      expect(calls[0]?.id).toBe('document.annotations');
      const sent = calls.filter((call) => call.id !== 'document.annotations');
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
              // NOR IS THIS, and it is the one where the default is the SAFE
              // side: a command that dropped the dialog's answer and sent
              // `false` would look right on every screen and quietly remove a
              // title the person asked to keep. `true` here is what makes the
              // assertion able to fail.
              keepTitle: true,
            },
          },
        },
      ]);
    });

    it('CONTROL: a DISMISSED confirm dispatches nothing', async () => {
      // The gate, and it matters more here than anywhere else in this file: the
      // undo is a checkpoint, and a checkpoint goes when the document closes.
      const { client, sent } = marked(2);

      await applyRedactionsCommand({
        client,
        stamp,
        signatures,
        toast: () => undefined,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
        confirm: () => true,
      }).run(CONTEXT);

      // THE MARKS WERE COUNTED, ONCE, AND NOTHING FOLLOWED: the whole sequence, so a dispatch or a second read fails it.
      expect(sent.map((call) => call.id)).toStrictEqual(['document.annotations']);
    });

    it('with *Confirm before redacting* OFF, asks nothing and burns in THIS PAGE with the dialog’s own defaults', async () => {
      // The decision is whether the dialog opens, so the call not made is asserted, not only the dispatch — and the
      // dispatch is the dialog's starting choices, from the one definition both read (`applyRedactionsDefaults`).
      const { client, sent: calls } = marked(2);
      const opened: string[] = [];

      await applyRedactionsCommand({
        client,
        stamp,
        signatures,
        toast: () => undefined,
        onApplied: () => undefined,
        ask: (id) => {
          opened.push(id);
          return Promise.resolve(undefined);
        },
        confirm: () => false,
      }).run(CONTEXT);

      expect(opened).toStrictEqual([]);
      // THE COUNT ONCE AND FIRST, then the one dispatch: the sequence whole, as the dismissed case reads it.
      expect(calls.map((call) => call.id)).toStrictEqual(['document.annotations', 'document.execute']);
      const sent = calls.filter((call) => call.id !== 'document.annotations');
      expect(sent).toStrictEqual([
        {
          id: 'document.execute',
          params: {
            docId: DOC,
            // THIS PAGE, never the whole document: an unasked burn-in never reaches further than the dialog would
            // have offered first.
            command: { kind: 'applyRedactions', pages: [CONTEXT.page], cover: 'solid', images: 'pixels', keepTitle: false },
          },
        },
      ]);
    });
  });

  describe('signDocumentCommand', () => {
    /** A client answering `document.sign` and recording what it was sent. */
    function signingClient(
      answer: unknown,
      kept: readonly LibraryEntry[] = [],
    ): {
      readonly client: ContractClient;
      readonly sent: { id: string; params: unknown }[];
      /** What the signature library was asked, kept apart so the signing cases read only the signing channel. */
      readonly library: { id: string; params: unknown }[];
    } {
      const sent: { id: string; params: unknown }[] = [];
      const library: { id: string; params: unknown }[] = [];
      const client = createClient(channels, (id, params) => {
        if (id.startsWith('library.')) {
          library.push({ id, params });
          if (id === 'library.list') return Promise.resolve(ok({ entries: kept }));
          if (id === 'library.picture') {
            return Promise.resolve(ok({ kind: 'found', mediaType: 'image/png', bytes: Uint8Array.of(0x89, 0x50) }));
          }
          if (id === 'library.addPicture') return Promise.resolve(ok({ kind: 'cancelled' }));
          if (id === 'library.keepSignature') {
            return Promise.resolve(ok({ kind: 'added', entry: { id: '00000000-0000-4000-8000-0000000000b9', kind: 'signature', look: (params as { mark: unknown }).mark } }));
          }
          return Promise.resolve(ok({ removed: true }));
        }
        sent.push({ id, params });
        return Promise.resolve(ok(answer));
      });
      return { client, sent, library };
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
      const said: unknown[] = [];

      await signDocumentCommand({
        client,
        toast: (_kind, message) => said.push(message),
        stamp,
        signatures,
        onApplied: (value) => applied.push(value),
        ask: () =>
          Promise.resolve({ passphrase: 'secret', name: 'Grace Hopper', reason: 'Approved' }),
      }).run(CONTEXT);

      // AN UNSEEN SIGNATURE IS SAID, since the page shows nothing new.
      expect(said).toStrictEqual([TOAST_DOCUMENT_SIGNED]);
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

    it('forwards the chosen timestamp authority by id, and CONTROL: the case above sends none', async () => {
      // THE CASE ABOVE IS THIS ONE'S CONTROL: its answer names no authority and
      // its params carry no `timestamp`, so a command that always sent one — or
      // never did — fails one of the two.
      const { client, sent } = signingClient({
        kind: 'signed',
        version: asDocVersion(2),
        byteLength: 4096,
        historyDropped: 0,
      });

      await signDocumentCommand({
        client,
        toast: () => undefined,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve({ passphrase: 'secret', timestamp: 'digicert' }),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([
        { id: 'document.sign', params: { docId: DOC, passphrase: 'secret', timestamp: 'digicert' } },
      ]);
    });

    it('a timestamp refusal reaches the problem dialog by its OWN name', async () => {
      // THE KIND IS FORWARDED UNTRANSLATED, and the dialog's reasons are the
      // contract's list — so a refusal the channel gained reaches a person with
      // its own sentence rather than failing the dialog's props parse.
      const { client } = signingClient({ kind: 'timestamp-unverifiable' });
      const shown: { id: string; props: unknown }[] = [];

      await signDocumentCommand({
        client,
        toast: () => undefined,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          shown.push({ id, props });
          return Promise.resolve(id === 'dialog.sign-document' ? { passphrase: '' } : undefined);
        },
      }).run(CONTEXT);

      expect(shown.at(-1)).toStrictEqual({
        id: 'dialog.sign-problem',
        props: { reason: 'timestamp-unverifiable' },
      });
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
        toast: () => undefined,
        stamp,
        signatures,
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
        toast: () => undefined,
        stamp,
        signatures,
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
        toast: () => undefined,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });

    const PLACEMENT = { page: 2, rect: { x0: 10, y0: 20, x1: 110, y1: 70 } };
    const TYPED = { kind: 'typed', text: 'Grace Hopper', font: 'courier-prime' } as const;

    it('CONTROL: a PLACED signature that signed says nothing, because the page shows it', async () => {
      const { client } = signingClient({ kind: 'signed', version: asDocVersion(2), byteLength: 4096, historyDropped: 0 });
      const said: unknown[] = [];
      const applied: unknown[] = [];
      await signDocument(
        {
          client,
          toast: (_kind, message) => said.push(message),
          onApplied: (value) => applied.push(value),
          ask: (id) => Promise.resolve(id === 'dialog.sign-document' ? { passphrase: '', mark: TYPED } : undefined),
        },
        DOC,
        PLACEMENT,
      );
      // SIGNED, so the silence is the decision and not a refusal arriving at the same nothing.
      expect(applied).toStrictEqual([{ version: asDocVersion(2), byteLength: 4096 }]);
      expect(said).toStrictEqual([]);
    });

    it('a PLACEMENT opens the dialog placed and sends its look as the appearance', async () => {
      // BOTH HALVES OF THE PAIR: the props the dialog was opened with (which is
      // what makes it ask for a look at all) and the appearance that crossed.
      const { client, sent } = signingClient({ kind: 'cancelled' });
      const asked: { id: string; props: unknown }[] = [];

      await signDocument(
        {
          client,
          toast: () => undefined,
          onApplied: () => undefined,
          ask: (id, props) => {
            asked.push({ id, props });
            return Promise.resolve({ passphrase: '', mark: TYPED });
          },
        },
        DOC,
        PLACEMENT,
      );

      expect(asked).toStrictEqual([{ id: 'dialog.sign-document', props: { placed: true, kept: [] } }]);
      // THE TYPED LOOK CROSSES AS ITS OUTLINE, made by the one module that sets names (ADR-0150).
      const outlined = await outlinedMarkOf(TYPED);
      if (outlined.kind !== 'ready') throw new Error(outlined.kind);
      expect(sent).toStrictEqual([
        {
          id: 'document.sign',
          params: { docId: DOC, passphrase: '', appearance: { ...PLACEMENT, mark: outlined.mark } },
        },
      ]);
    });

    it('a typed name its face CANNOT WRITE asks for no certificate, and says which characters', async () => {
      const { client, sent } = signingClient({ kind: 'cancelled' });
      const shown: { id: string; props: unknown }[] = [];
      await signDocument(
        {
          client,
          toast: () => undefined,
          onApplied: () => undefined,
          ask: (id, props) => {
            shown.push({ id, props });
            return Promise.resolve(
              id === 'dialog.sign-document' ? { passphrase: '', mark: { kind: 'typed', text: 'Grace 王', font: 'allura' } } : undefined,
            );
          },
        },
        DOC,
        PLACEMENT,
      );
      expect(sent).toStrictEqual([]);
      expect(shown[1]).toStrictEqual({ id: 'dialog.signature-problem', props: { reason: 'cannot-write', characters: '王' } });
    });

    it('CONTROL: the ribbon opens it UNPLACED and sends no appearance, even if a look came back', async () => {
      // A dialog answer carrying a mark is the input the defect would need: an
      // invisible signing that forwarded one would have no rectangle to put it
      // in, and the kernel would refuse a command a person never asked for.
      const { client, sent } = signingClient({ kind: 'cancelled' });
      const asked: unknown[] = [];

      await signDocumentCommand({
        client,
        toast: () => undefined,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          asked.push({ id, props });
          return Promise.resolve({ passphrase: '', mark: TYPED });
        },
      }).run(CONTEXT);

      expect(asked).toStrictEqual([{ id: 'dialog.sign-document', props: { placed: false, kept: [] } }]);
      expect(sent).toStrictEqual([{ id: 'document.sign', params: { docId: DOC, passphrase: '' } }]);
    });

    it('a placement answered with NO look signs nothing, rather than signing invisibly', async () => {
      const { client, sent } = signingClient({ kind: 'cancelled' });

      await signDocument(
        { client, toast: () => undefined, onApplied: () => undefined, ask: () => Promise.resolve({ passphrase: '' }) },
        DOC,
        PLACEMENT,
      );

      expect(sent).toStrictEqual([]);
    });

    describe('the signature library', () => {
      const KEPT_TYPED: LibraryEntry = { id: '00000000-0000-4000-8000-0000000000c1', kind: 'signature', look: TYPED };
      const KEPT_PICTURE: LibraryEntry = {
        id: '00000000-0000-4000-8000-0000000000c2',
        kind: 'signature',
        look: { kind: 'picture', name: 'ink' },
      };
      /** `blob:` addresses counted, so a case can see each one let go. */
      const counting = (): { readonly urls: { make: () => string; revoke: (url: string) => void }; readonly revoked: string[] } => {
        const revoked: string[] = [];
        let made = 0;
        return {
          revoked,
          urls: {
            make: () => {
              made += 1;
              return `blob:kept-${String(made)}`;
            },
            revoke: (url) => revoked.push(url),
          },
        };
      };

      it('offers the kept signatures — a typed one as itself, a picture by a blob: address — and lets go after', async () => {
        const { client } = signingClient({ kind: 'cancelled' }, [KEPT_TYPED, KEPT_PICTURE]);
        const asked: unknown[] = [];
        const { urls, revoked } = counting();
        await signDocument(
          {
            client,
            toast: () => undefined,
            onApplied: () => undefined,
            ask: (_id, props) => {
              asked.push(props);
              return Promise.resolve(undefined);
            },
          },
          DOC,
          PLACEMENT,
          urls,
        );
        expect(asked).toStrictEqual([
          {
            placed: true,
            kept: [
              { id: KEPT_TYPED.id, look: TYPED },
              { id: KEPT_PICTURE.id, look: { kind: 'picture', name: 'ink', src: 'blob:kept-1' } },
            ],
          },
        ]);
        expect(revoked).toStrictEqual(['blob:kept-1']);
      });

      it('signs with a kept TYPED signature by its OUTLINE, made here, and CONTROL: a kept picture by its id', async () => {
        const signingWith = async (id: string): Promise<unknown> => {
          const { client, sent } = signingClient({ kind: 'cancelled' }, [KEPT_TYPED, KEPT_PICTURE]);
          await signDocument(
            {
              client,
              toast: () => undefined,
              onApplied: () => undefined,
              ask: (asked) => Promise.resolve(asked === 'dialog.sign-document' ? { passphrase: '', mark: { kind: 'saved', id } } : undefined),
            },
            DOC,
            PLACEMENT,
            counting().urls,
          );
          return (sent[0]?.params as { appearance?: { mark?: unknown } } | undefined)?.appearance?.mark;
        };
        expect(await signingWith(KEPT_TYPED.id)).toMatchObject({ kind: 'outlined', text: 'Grace Hopper', font: 'courier-prime' });
        expect(await signingWith(KEPT_PICTURE.id)).toStrictEqual({ kind: 'saved', id: KEPT_PICTURE.id });
      });

      it('ADD and REMOVE change the library and ASK AGAIN before anything is signed', async () => {
        const { client, sent, library } = signingClient({ kind: 'cancelled' }, [KEPT_TYPED]);
        const answers = [{ library: 'add' }, { library: 'remove', id: KEPT_TYPED.id }, undefined];
        let asked = 0;
        await signDocument(
          {
            client,
            toast: () => undefined,
            onApplied: () => undefined,
            ask: () => {
              asked += 1;
              return Promise.resolve(answers[asked - 1]);
            },
          },
          DOC,
          PLACEMENT,
          counting().urls,
        );
        expect(asked).toBe(3);
        expect(library.map((call) => call.id)).toStrictEqual([
          'library.list',
          'library.addPicture',
          'library.list',
          'library.remove',
          'library.list',
        ]);
        expect(sent).toStrictEqual([]);
      });

      it('KEEPS a typed look once it has SIGNED — CONTROL: a refused signing keeps nothing', async () => {
        const keeping = async (outcome: unknown): Promise<unknown[]> => {
          const { client, library } = signingClient(outcome);
          await signDocument(
            {
              client,
              toast: () => undefined,
              onApplied: () => undefined,
              ask: (id) => Promise.resolve(id === 'dialog.sign-document' ? { passphrase: '', mark: TYPED, keep: true } : undefined),
            },
            DOC,
            PLACEMENT,
            counting().urls,
          );
          return library.filter((call) => call.id === 'library.keepSignature').map((call) => call.params);
        };
        expect(await keeping({ kind: 'signed', version: asDocVersion(2), byteLength: 10, historyDropped: 0 })).toStrictEqual([
          { mark: TYPED },
        ]);
        expect(await keeping({ kind: 'wrong-passphrase' })).toStrictEqual([]);
      });
    });

    it.each(['image-unreadable', 'image-too-large'] as const)(
      'SHOWS %s rather than returning quietly',
      async (reason) => {
        const { client } = signingClient({ kind: reason });
        const shown: { id: string; props: unknown }[] = [];

        await signDocument(
          {
            client,
            toast: () => undefined,
            onApplied: () => undefined,
            ask: (id, props) => {
              shown.push({ id, props });
              return Promise.resolve(
                id === 'dialog.sign-document' ? { passphrase: '', mark: TYPED } : undefined,
              );
            },
          },
          DOC,
          PLACEMENT,
        );

        expect(shown[1]).toStrictEqual({ id: 'dialog.sign-problem', props: { reason } });
      },
    );
  });

  describe('DocuSign commands', () => {
    /** A client answering every channel with `answer`, recording what it was sent. */
    function docusignClient(answer: unknown): {
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

    it('are hidden with no integration key, and CONTROL: shown with one', () => {
      // BOTH HALVES OF THE PREDICATE, each with its own control: a key and no
      // document hides them, and a document with a key shows them.
      const { client } = docusignClient({ kind: 'nothing-sent' });
      for (const factory of [docusignSendCommand, docusignRetrieveCommand]) {
        const without = factory({
          client,
          toast: () => undefined,
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: () => Promise.resolve(undefined),
          settleMarks: NOTHING_MARKED,
          docusignReady: () => false,
        });
        const withKey = factory({
          client,
          toast: () => undefined,
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: () => Promise.resolve(undefined),
          settleMarks: NOTHING_MARKED,
          docusignReady: () => true,
        });
        expect(without.when?.(CONTEXT)).toBe(false);
        expect(withKey.when?.(NO_DOCUMENT)).toBe(false);
        expect(withKey.when?.(CONTEXT)).toBe(true);
      }
    });

    it('send calls docusign.send with the dialog’s answer and TELLS the person it was sent', async () => {
      const { client, sent } = docusignClient({ kind: 'sent', envelopeId: 'env-1' });
      const shown: { id: string; props: unknown }[] = [];
      const signers = [{ name: 'Grace Hopper', email: 'grace@example.com' }];

      await docusignSendCommand({
        settleMarks: NOTHING_MARKED,
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          shown.push({ id, props });
          return Promise.resolve(
            id === 'dialog.docusign-send' ? { emailSubject: 'Please sign', signers } : undefined,
          );
        },
        docusignReady: () => true,
      }).run(CONTEXT);

      expect(sent).toStrictEqual([
        { id: 'docusign.send', params: { docId: DOC, emailSubject: 'Please sign', signers } },
      ]);
      expect(shown.map((entry) => entry.id)).toStrictEqual([
        'dialog.docusign-send',
        'dialog.docusign-notice',
      ]);
      expect(shown[1]?.props).toStrictEqual({ reason: 'sent' });
    });

    it('a dismissed send dialog calls no channel — CONTROL for the case above', async () => {
      const { client, sent } = docusignClient({ kind: 'sent', envelopeId: 'env-1' });

      await docusignSendCommand({
        settleMarks: NOTHING_MARKED,
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
        docusignReady: () => true,
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });

    it('a send refusal reaches the notice by its OWN name', async () => {
      const { client } = docusignClient({ kind: 'sign-in-denied' });
      const shown: { id: string; props: unknown }[] = [];

      await docusignSendCommand({
        settleMarks: NOTHING_MARKED,
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          shown.push({ id, props });
          return Promise.resolve(
            id === 'dialog.docusign-send'
              ? { emailSubject: 'Please sign', signers: [{ name: 'A', email: 'a@example.com' }] }
              : undefined,
          );
        },
        docusignReady: () => true,
      }).run(CONTEXT);

      expect(shown.at(-1)).toStrictEqual({
        id: 'dialog.docusign-notice',
        props: { reason: 'sign-in-denied' },
      });
    });

    it('retrieve routes each outcome: status told, write failure to the save dialog, a copy to no dialog', async () => {
      // THREE OUTCOMES, THREE DESTINATIONS — a command that sent everything to
      // one dialog passes none of the rows below but its own.
      const rows: readonly { answer: unknown; shown: unknown[] }[] = [
        {
          answer: { kind: 'not-completed', status: 'sent' },
          shown: [{ id: 'dialog.docusign-notice', props: { reason: 'not-completed', status: 'sent' } }],
        },
        {
          answer: { kind: 'write-failed' },
          shown: [{ id: 'dialog.save-problem', props: { outcome: 'write-failed' } }],
        },
        {
          answer: { kind: 'refused', openElsewhere: 1 },
          shown: [{ id: 'dialog.save-problem', props: { outcome: 'contested' } }],
        },
        {
          answer: { kind: 'nothing-sent' },
          shown: [{ id: 'dialog.docusign-notice', props: { reason: 'nothing-sent' } }],
        },
        { answer: { kind: 'copied', bytes: 4096, written: WRITTEN }, shown: [] },
      ];
      for (const row of rows) {
        const { client, sent } = docusignClient(row.answer);
        const shown: unknown[] = [];
        await docusignRetrieveCommand({
          client,
          toast: () => undefined,
          stamp,
          signatures,
          onApplied: () => undefined,
          ask: (id, props) => {
            shown.push({ id, props });
            return Promise.resolve(undefined);
          },
          docusignReady: () => true,
        }).run(CONTEXT);
        expect(sent).toStrictEqual([{ id: 'docusign.retrieve', params: { docId: DOC } }]);
        expect(shown).toStrictEqual(row.shown);
      }
    });
  });

  describe('signaturesCommand', () => {
    it('SHOWS what the read answered, including a signature that no longer covers', async () => {
      // THE PANEL'S OWN CONTENT is the assertion. A command that opened the
      // dialog with an empty list would look identical from the outside and
      // would tell a person their tampered document is unsigned.
      const answer = {
        signatures: [
          {
            signer: 'Grace Hopper',
            organisation: 'Tenslor Inc.',
            reason: '',
            location: '',
            notBefore: '2026-01-01T00:00:00.000Z',
            notAfter: '2027-01-01T00:00:00.000Z',
            coversDocument: false,
            coversWholeFile: true,
          },
        ],
        unreadable: false,
      };
      const client = createClient(channels, () => Promise.resolve(ok(answer)));
      const shown: { id: string; props: unknown }[] = [];

      await signaturesCommand({
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          shown.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);

      expect(shown).toStrictEqual([{ id: 'dialog.signatures', props: answer }]);
    });

    it('CONTROL: an unsigned document still opens the panel, with an empty list', async () => {
      // *This document is not signed* is the answer a person asked for. A
      // command that opened nothing would be one that appears not to have run,
      // and this is the case that stops the one above from being *show a
      // dialog only when there is something in it*.
      const client = createClient(channels, () =>
        Promise.resolve(ok({ signatures: [], unreadable: false })),
      );
      const shown: { id: string; props: unknown }[] = [];

      await signaturesCommand({
        client,
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id, props) => {
          shown.push({ id, props });
          return Promise.resolve(undefined);
        },
      }).run(CONTEXT);

      expect(shown).toStrictEqual([
        { id: 'dialog.signatures', props: { signatures: [], unreadable: false } },
      ]);
    });
  });

  describe('sanitizeDocumentCommand', () => {
    it('dispatches EXACTLY the parts the dialog answered', async () => {
      // THE LIST IS THE PAYLOAD'S WHOLE CONTENT, and a command that sent all
      // four whatever the dialog said would dispatch exactly as correctly and
      // flatten a form somebody meant to keep fillable.
      const { client, sent } = recordingClient();

      const said: unknown[] = [];
      await sanitizeDocumentCommand({
        client,
        toast: (_kind, message) => said.push(message),
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve({ parts: ['javascript', 'embedded-files'] }),
      }).run(CONTEXT);
      expect(said).toStrictEqual([TOAST_ACTIVE_CONTENT_REMOVED]);

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

      const said: unknown[] = [];
      await sanitizeDocumentCommand({
        client,
        toast: (_kind, message) => said.push(message),
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect([sent, said]).toStrictEqual([[], []]);
    });
  });

  describe('flattenFormCommand (F-F1)', () => {
    it('ASKS FIRST, then flattens, then SAYS it did', async () => {
      const { client, sent } = recordingClient();
      const said: unknown[] = [];
      const asked: string[] = [];
      await flattenFormCommand({
        client,
        toast: (_kind, message) => said.push(message),
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id) => {
          // NOTHING SENT YET when the question opens: a dialog asked after the command would be a notice, not a question.
          asked.push(`${id} after ${String(sent.length)} sent`);
          return Promise.resolve({ flatten: true });
        },
      }).run(CONTEXT);

      expect(asked).toStrictEqual(['dialog.flatten-form after 0 sent']);
      expect(sent).toStrictEqual([
        { id: 'document.execute', params: { docId: DOC, command: { kind: 'flattenFormFields' } } },
      ]);
      expect(said).toStrictEqual([TOAST_FORM_FLATTENED]);
    });

    it('CONTROL: a DISMISSED question dispatches nothing and says nothing', async () => {
      const { client, sent } = recordingClient();
      const said: unknown[] = [];
      await flattenFormCommand({
        client,
        toast: (_kind, message) => said.push(message),
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect([sent, said]).toStrictEqual([[], []]);
    });

    it('CONTROL: a REFUSED flatten says its problem, never that the form was flattened', async () => {
      const said: unknown[] = [];
      const asked: string[] = [];
      const client = createClient(channels, () => Promise.resolve(err({ code: 'document-busy' as const })));
      await flattenFormCommand({
        client,
        toast: (_kind, message) => said.push(message),
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: (id) => {
          asked.push(id);
          return Promise.resolve(id === 'dialog.flatten-form' ? { flatten: true } : undefined);
        },
      }).run(CONTEXT);

      expect(said).toStrictEqual([]);
      expect(asked).toStrictEqual(['dialog.flatten-form', 'dialog.command-problem']);
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
        stamp,
        signatures,
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
        stamp,
        signatures,
        onApplied: () => undefined,
        ask: () => Promise.resolve(undefined),
      }).run(CONTEXT);

      expect(sent).toStrictEqual([]);
    });
  });
});

describe('applyDocumentCommand stamps a creation command at the moment it is sent (ADR-0103)', () => {
  function sending(): { readonly client: ContractClient; readonly sent: unknown[] } {
    const sent: unknown[] = [];
    const client = createClient(channels, (_id, params) => {
      sent.push((params as { command: unknown }).command);
      return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0 }));
    });
    return { client, sent };
  }

  it('a new mark goes out with the stamp deps.stamp answers WHEN it is sent', async () => {
    const { client, sent } = sending();
    let asked = 0;
    const deps = {
      client,
      ask: () => Promise.resolve(undefined),
      onApplied: () => undefined,
      signatures,
      // COUNTED, so the case shows the stamp is asked for at the send and not taken from a value
      // captured earlier — the time must be the send's.
      stamp: (): AnnotationStamp => {
        asked += 1;
        return { author: 'Priya Raman', created: '2026-09-24T09:38:00.000Z' };
      },
    };
    await applyDocumentCommand(deps, DOC, {
      kind: 'addAnnotation',
      page: 0,
      annotation: {
        type: 'square',
        rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
        colour: [1, 0, 0],
        opacity: 1,
        borderWidth: 2,
      },
    });
    expect(asked).toBe(1);
    expect(sent).toStrictEqual([
      {
        kind: 'addAnnotation',
        page: 0,
        annotation: {
          type: 'square',
          rect: { x0: 10, y0: 20, x1: 110, y1: 70 },
          colour: [1, 0, 0],
          opacity: 1,
          borderWidth: 2,
        },
        stamp: { author: 'Priya Raman', created: '2026-09-24T09:38:00.000Z' },
      },
    ]);
  });

  it('two sends through ONE set of deps carry two stamps — the stamp is asked per send, never kept', async () => {
    // One send cannot tell *asked at the send* from *asked once and cached per deps*: both ask once. A clock
    // that answers differently each time can.
    const { client, sent } = sending();
    const times = ['2026-09-24T09:38:00.000Z', '2026-09-24T09:41:00.000Z'];
    const deps = {
      client,
      ask: () => Promise.resolve(undefined),
      signatures,
      onApplied: () => undefined,
      stamp: (): AnnotationStamp => ({ author: 'Priya Raman', created: times.shift() ?? 'exhausted' }),
    };
    const mark: Parameters<typeof applyDocumentCommand>[2] = {
      kind: 'addAnnotation',
      page: 0,
      annotation: { type: 'square', rect: { x0: 10, y0: 20, x1: 110, y1: 70 }, colour: [1, 0, 0], opacity: 1, borderWidth: 2 },
    };
    await applyDocumentCommand(deps, DOC, mark);
    await applyDocumentCommand(deps, DOC, mark);
    expect(sent.map((command) => (command as { stamp?: AnnotationStamp }).stamp?.created ?? null)).toStrictEqual([
      '2026-09-24T09:38:00.000Z',
      '2026-09-24T09:41:00.000Z',
    ]);
  });

  it('ROTATE and DELETE act on the pages ticked in the Organize grid, and on the page on show without any', async () => {
    // ADR-0104's `targetPages`, as the two commands read it. The ticked pages exclude the page on show (2), so
    // a command still reading `page` sends [2] here and reads differently.
    for (const [factory, kind] of [
      [rotatePageCommand, 'rotatePages'],
      [deletePageCommand, 'deletePages'],
    ] as const) {
      const ticked = sending();
      await factory({ client: ticked.client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, stamp, signatures }).run({
        ...CONTEXT,
        page: 2,
        selectedPages: [0, 3],
      });
      expect(ticked.sent.map((command) => (command as { pages?: unknown }).pages), kind).toStrictEqual([[0, 3]]);

      const none = sending();
      await factory({ client: none.client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, stamp, signatures }).run({
        ...CONTEXT,
        page: 2,
        selectedPages: [],
      });
      expect(none.sent.map((command) => (command as { pages?: unknown }).pages), kind).toStrictEqual([[2]]);
    }
  });

  /**
   * DECISION D, at the one place every command leaves the renderer: a ticked stretch crosses as a RUN. The fixture has
   * a stretch and a lone page, so a dispatcher that sent the list as it came — the build before D — sends five numbers
   * where this asserts two entries.
   */
  it('a ticked stretch of pages crosses as one run, and a lone page as its number', async () => {
    for (const [factory, kind] of [
      [rotatePageCommand, 'rotatePages'],
      [deletePageCommand, 'deletePages'],
    ] as const) {
      const ticked = sending();
      await factory({ client: ticked.client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, stamp, signatures }).run({
        ...CONTEXT,
        page: 2,
        selectedPages: [4, 5, 6, 7, 9],
      });
      expect(ticked.sent.map((command) => (command as { pages?: unknown }).pages), kind).toStrictEqual([[[4, 7], 9]]);
    }
  });

  it('THE REST OF ORGANIZE reads `targetPages` too: duplicate and insert act, and the dialogs open on the ticked pages', async () => {
    // Work list 2026-09-26, item 4. Same fixture shape as the case above: page 2 on show, pages 0 and 3 ticked, so a
    // command still reading `page` gives 2 — or 3 for an insert — where these give the ticked pages.
    const ticked: CommandContext = { ...CONTEXT, page: 2, selectedPages: [0, 3] };
    const shown: CommandContext = { ...CONTEXT, page: 2, selectedPages: [] };

    for (const [context, pages, at] of [
      [ticked, [0, 3], 4],
      [shown, [2], 3],
    ] as const) {
      const duplicated = sending();
      await duplicatePageCommand({ client: duplicated.client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, stamp, signatures }).run(context);
      expect(duplicated.sent).toStrictEqual([{ kind: 'duplicatePage', pages }]);

      // AFTER THE LAST TARGET PAGE, which is the page on show when nothing is ticked.
      const inserted = sending();
      await insertBlankPageCommand({ client: inserted.client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, stamp, signatures }).run(context);
      expect(inserted.sent).toStrictEqual([{ kind: 'insertBlankPage', at }]);

      // EVERY PAGE DIALOG is opened with the same pages; a dismissal sends nothing, so only the props are read.
      for (const factory of [
        cropPagesCommand,
        resizePagesCommand,
        headerFooterCommand,
        batesNumberCommand,
        watermarkPagesCommand,
        pageTransitionCommand,
      ]) {
        const opened: unknown[] = [];
        const quiet = sending();
        await factory({
          client: quiet.client,
          toast: () => undefined,
          ask: (_id, props) => {
            opened.push(props);
            return Promise.resolve(undefined);
          },
          onApplied: () => undefined,
          stamp,
          signatures,
        }).run(context);
        expect(opened).toStrictEqual([{ pages }]);
        expect(quiet.sent).toStrictEqual([]);
      }

      // THE RANGE DIALOGS start with the same pages, and keep the bound beside them.
      for (const factory of [deletePagesCommand, extractPagesCommand]) {
        const opened: unknown[] = [];
        const quiet = sending();
        await factory({
          client: quiet.client,
          ask: (_id, props) => {
            opened.push(props);
            return Promise.resolve(undefined);
          },
          onApplied: () => undefined,
          toast: () => undefined,
          stamp,
          signatures,
          settleMarks: NOTHING_MARKED,
        }).run(context);
        expect(opened).toStrictEqual([{ pageCount: CONTEXT.pageCount, pages }]);
      }
    }
  });

  it('CONTROL: a command that creates nothing goes out with no stamp', async () => {
    const { client, sent } = sending();
    await applyDocumentCommand(
      { client, ask: () => Promise.resolve(undefined), onApplied: () => undefined, stamp, signatures },
      DOC,
      { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    );
    expect(sent).toStrictEqual([{ kind: 'rotatePages', pages: [0], quarterTurns: 1 }]);
  });
});

/**
 * Every file writer in this module, through `confirmWritten`.
 *
 * ## One table, because a writer that stops confirming is otherwise green
 *
 * The cases above each assert what their writer SENDS, and nearly all of them hand it `toast: () => undefined` — so a
 * writer that wrote the file and said nothing passed every one of them. Here each writer runs to a successful write
 * with a recording toast, and the row asserts three things only the confirming path produces: the writer's own
 * message, a *Show in folder* action, and that the action — and nothing before it — asks main to reveal the handle the
 * write answered. A writer that confirmed with a neighbour's message, or confirmed through `confirmDone` with no
 * action, fails its row.
 */
describe('every file write confirms, and its Show in folder reveals the file the write answered', () => {
  interface Said {
    readonly kind: string;
    readonly message: string;
    readonly action: ToastAction | undefined;
  }

  /** A client answering each channel from `answers` and refusing any other, with a toast and dialogs that record. */
  function writing(answers: Readonly<Record<string, unknown>>, dialogAnswers: readonly unknown[]) {
    const sent: { id: string; params: unknown }[] = [];
    const said: Said[] = [];
    const asked: string[] = [];
    const queued = [...dialogAnswers];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'file.reveal') return Promise.resolve(ok({ revealed: true }));
      const answer = answers[id];
      if (answer === undefined) throw new Error(`this writer's fixture answers no ${id}`);
      return Promise.resolve(ok(answer));
    });
    const deps = {
      client,
      stamp,
      signatures,
      onApplied: () => undefined,
      toast: (kind: string, message: MessageKey, action?: ToastAction) => {
        said.push({ kind, message, action });
      },
      ask: (id: string) => {
        asked.push(id);
        return Promise.resolve(queued.shift());
      },
      recogniseFirst: NOTHING_RECOGNISED,
      settleMarks: NOTHING_MARKED,
      tableEngines: () => ['automatic' as const],
      track: () => ({ signal: new AbortController().signal, step: () => undefined, end: () => undefined }),
      docusignReady: () => true,
    };
    return { deps, sent, said, asked };
  }

  type Deps = ReturnType<typeof writing>['deps'];
  const COPIED = { kind: 'copied', bytes: 9, written: WRITTEN } as const;
  const SPLIT = { kind: 'split', files: 2, written: WRITTEN } as const;

  const rows: readonly {
    readonly name: string;
    readonly message: MessageKey;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly dialogs: readonly unknown[];
    readonly run: (deps: Deps) => void | Promise<void>;
  }[] = [
    {
      name: 'a snapshot',
      message: TOAST_SNAPSHOT_SAVED,
      answers: { 'document.snapshotRegion': COPIED },
      dialogs: [],
      run: (deps) => snapshotRegion(deps, DOC, 3, { x0: 0, y0: 0, x1: 10, y1: 10 }, 2),
    },
    {
      name: 'extracted pages',
      message: TOAST_PAGES_SAVED,
      answers: { 'document.extract': COPIED },
      dialogs: [{ pages: [0] }],
      run: (deps) => extractPagesCommand(deps).run(CONTEXT),
    },
    {
      name: 'a split',
      message: TOAST_FILES_SAVED,
      answers: { 'document.split': SPLIT },
      dialogs: [{ groups: [[0], [1]] }],
      run: (deps) => splitDocumentCommand(deps).run(CONTEXT),
    },
    {
      name: 'page images',
      message: TOAST_IMAGES_SAVED,
      answers: { 'document.exportPageImages': SPLIT },
      dialogs: [{ pages: [0], format: 'png', dpi: 72, quality: 90 }],
      run: (deps) => exportPageImagesCommand(deps).run(CONTEXT),
    },
    {
      name: 'text',
      message: TOAST_TEXT_SAVED,
      answers: { 'document.exportText': COPIED },
      dialogs: [],
      run: (deps) => exportTextCommand(deps).run(CONTEXT),
    },
    {
      name: 'text with layout',
      message: TOAST_TEXT_SAVED,
      answers: { 'document.exportText': COPIED },
      dialogs: [],
      run: (deps) => exportLayoutTextCommand(deps).run(CONTEXT),
    },
    {
      name: 'Word',
      message: TOAST_WORD_SAVED,
      answers: { 'document.exportWord': COPIED },
      dialogs: [{ mode: 'text' }],
      run: (deps) => exportWordCommand(deps).run(CONTEXT),
    },
    {
      name: 'PowerPoint',
      message: TOAST_POWERPOINT_SAVED,
      answers: { 'document.exportPowerPoint': COPIED },
      dialogs: [],
      run: (deps) => exportPowerPointCommand(deps).run(CONTEXT),
    },
    {
      name: 'Excel',
      message: TOAST_EXCEL_SAVED,
      answers: {
        'document.pageTables': { version: asDocVersion(5), pageCount: 10, tables: [], truncated: false },
        'document.exportExcel': COPIED,
      },
      dialogs: [{ kind: 'export', layout: 'one-sheet', engine: 'automatic', edits: [] }],
      run: (deps) => exportExcelCommand(deps).run(CONTEXT),
    },
    {
      name: 'PDF/A',
      message: TOAST_PDFA_SAVED,
      answers: { 'document.exportPdfa': { ...COPIED, removed: [], tagsDropped: false } },
      dialogs: [],
      run: (deps) => exportPdfaCommand(deps).run(CONTEXT),
    },
    {
      name: 'a smaller copy',
      message: TOAST_SMALLER_COPY_SAVED,
      answers: {
        'document.optimizeMeasure': { kind: 'measured', version: asDocVersion(7), before: 200, after: 100 },
        'document.optimize': { ...COPIED, before: 200 },
      },
      dialogs: [
        { kind: 'measure', setting: 'high' },
        { kind: 'save', setting: 'high' },
      ],
      run: (deps) => optimizeCommand(deps).run(CONTEXT),
    },
    ...([
      ['JSON', exportFormDataJsonCommand],
      ['XFDF', exportFormDataXfdfCommand],
      ['FDF', exportFormDataFdfCommand],
    ] as const).map(([format, build]) => ({
      name: `form data as ${format}`,
      message: TOAST_FORM_DATA_SAVED,
      answers: { 'document.exportFormData': COPIED },
      dialogs: [],
      run: (deps: Deps) => build(deps).run(CONTEXT),
    })),
    {
      name: 'a copy',
      message: TOAST_COPY_SAVED,
      answers: { 'document.saveCopy': COPIED },
      dialogs: [],
      run: (deps) => saveCopyCommand(deps).run(CONTEXT),
    },
    {
      name: "DocuSign's signed copy",
      message: TOAST_SIGNED_COPY_SAVED,
      answers: { 'docusign.retrieve': COPIED },
      dialogs: [],
      run: (deps) => docusignRetrieveCommand(deps).run(CONTEXT),
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))('%s', async (_name, row) => {
    const { deps, sent, said, asked } = writing(row.answers, row.dialogs);

    await row.run(deps);

    // NO PROBLEM WAS RAISED: every dialog opened is the writer's own question, answered from the row.
    expect(asked).toHaveLength(row.dialogs.length);
    expect(said.map(({ kind, message }) => [kind, message])).toStrictEqual([['done', row.message]]);
    expect(said[0]?.action?.label).toBe(TOAST_SHOW_IN_FOLDER);
    // NOTHING IS REVEALED UNTIL THE ACTION RUNS, and then exactly the handle the write answered.
    expect(sent.some((call) => call.id === 'file.reveal')).toBe(false);
    said[0]?.action?.run();
    expect(sent.at(-1)).toStrictEqual({ id: 'file.reveal', params: { handle: WRITTEN } });
  });
});

/**
 * ADR-0149 Decision 4, the renderer's half: main refused an edit of a signed document without changing it, and the
 * one dispatcher asks the person. Main's half — that nothing changed, and that agreed it applies — is
 * `apps/desktop/src/documentCommands.test.ts`' *an edit that would break a signature*.
 */
describe('an edit main answers breaks-signatures for (ADR-0149)', () => {
  const SANITIZE: DispatchableCommand = { kind: 'sanitizeDocument', parts: ['javascript'] };
  const COPY = asDocId('doc-copy');
  const APPLIED = { version: asDocVersion(5), byteLength: 4096, historyDropped: 0 };

  /** Main as ADR-0149 has it: `breaks-signatures` until the edit is sent agreed, and `editCopy` answering `copy`. */
  function signedMain(copy: unknown = { kind: 'cancelled' }): {
    client: ContractClient;
    sent: { id: string; params: unknown }[];
  } {
    const sent: { id: string; params: unknown }[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      if (id === 'document.editCopy') return Promise.resolve(ok(copy as never));
      if (id !== 'document.execute') throw new Error(`this fixture has no answer for ${id}`);
      const agreed = (params as { breakSignatures?: boolean }).breakSignatures === true;
      return Promise.resolve(agreed ? ok(APPLIED) : err({ code: 'breaks-signatures' as const }));
    });
    return { client, sent };
  }

  /** Answers the signatures question with `answer`, and records every dialog opened. */
  function answering(answer: unknown): { ask: (id: string, props: unknown) => Promise<unknown>; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      ask: (id) => {
        asked.push(id);
        return Promise.resolve(id === 'dialog.signed-edit' ? answer : undefined);
      },
    };
  }

  /** The copy's opener, recording what it was handed. */
  function opening(warn = true): { signatures: SignedEditing; opened: unknown[] } {
    const opened: unknown[] = [];
    return { opened, signatures: { warn: () => warn, onOpened: (document) => opened.push(document) } };
  }

  it('CHANGE THIS DOCUMENT sends the SAME command again, agreed, and the document moves', async () => {
    const { client, sent } = signedMain();
    const { ask, asked } = answering('this');
    const applied: Applied[] = [];
    const { signatures: signed, opened } = opening();

    const moved = await applyDocumentCommand(
      { client, ask, stamp, signatures: signed, onApplied: (next) => applied.push(next) },
      DOC,
      SANITIZE,
    );

    expect(moved).toBe(true);
    expect(asked).toStrictEqual(['dialog.signed-edit']);
    expect(sent).toStrictEqual([
      { id: 'document.execute', params: { docId: DOC, command: SANITIZE } },
      { id: 'document.execute', params: { docId: DOC, command: SANITIZE, breakSignatures: true } },
    ]);
    expect(applied).toStrictEqual([APPLIED]);
    expect(opened).toStrictEqual([]);
  });

  it('WORK ON A COPY sends the command to a copy, opens it as a tab, and never sends it to the original again', async () => {
    const copy = { kind: 'edited', docId: COPY, version: 2, byteLength: 2048, name: 'signed copy.pdf', historyDropped: 0 };
    const { client, sent } = signedMain(copy);
    const { ask, asked } = answering('copy');
    const applied: Applied[] = [];
    const { signatures: signed, opened } = opening();

    const moved = await applyDocumentCommand(
      { client, ask, stamp, signatures: signed, onApplied: (next) => applied.push(next) },
      DOC,
      SANITIZE,
    );

    // THE ORIGINAL DID NOT MOVE, so its caller is told so and its view is not reopened.
    expect(moved).toBe(false);
    expect(applied).toStrictEqual([]);
    expect(sent).toStrictEqual([
      { id: 'document.execute', params: { docId: DOC, command: SANITIZE } },
      { id: 'document.editCopy', params: { docId: DOC, command: SANITIZE } },
    ]);
    expect(opened).toStrictEqual([{ docId: COPY, version: 2, byteLength: 2048, name: 'signed copy.pdf' }]);
    expect(asked).toStrictEqual(['dialog.signed-edit']);
  });

  it('a copy whose edit was refused is still OPENED, and the refusal is said over it', async () => {
    const copy = { kind: 'edit-refused', docId: COPY, version: 1, byteLength: 1024, name: 'signed copy.pdf', problem: 'text-not-writable' };
    const { client } = signedMain(copy);
    const { ask, asked } = answering('copy');
    const { signatures: signed, opened } = opening();

    await applyDocumentCommand({ client, ask, stamp, signatures: signed, onApplied: () => undefined }, DOC, SANITIZE);

    expect(opened).toHaveLength(1);
    expect(asked).toStrictEqual(['dialog.signed-edit', 'dialog.command-problem']);
  });

  it('CANCEL sends nothing more and reports nothing — the caller is told, so it can keep what was typed', async () => {
    const { client, sent } = signedMain();
    const { ask, asked } = answering(undefined);
    const kept: string[] = [];

    const moved = await applyDocumentCommand(
      { client, ask, stamp, signatures, onApplied: () => undefined },
      DOC,
      SANITIZE,
      {
        keep: (error) => {
          kept.push(error.code);
          return true;
        },
      },
    );

    expect(moved).toBe(false);
    expect(sent).toHaveLength(1);
    expect(asked).toStrictEqual(['dialog.signed-edit']);
    expect(kept).toStrictEqual(['breaks-signatures']);
  });

  it('a DISMISSED copy picker is a Cancel too: nothing opened, nothing reported, the caller told', async () => {
    const { client, sent } = signedMain({ kind: 'cancelled' });
    const { ask, asked } = answering('copy');
    const kept: string[] = [];
    const { signatures: signed, opened } = opening();

    await applyDocumentCommand({ client, ask, stamp, signatures: signed, onApplied: () => undefined }, DOC, SANITIZE, {
      keep: (error) => {
        kept.push(error.code);
        return true;
      },
    });

    expect(sent.map((call) => call.id)).toStrictEqual(['document.execute', 'document.editCopy']);
    expect(opened).toStrictEqual([]);
    expect(asked).toStrictEqual(['dialog.signed-edit']);
    expect(kept).toStrictEqual(['breaks-signatures']);
  });

  it('WITH THE WARNING TURNED OFF nobody is asked: the command is sent again agreed', async () => {
    const { client, sent } = signedMain();
    const { ask, asked } = answering('copy');
    const { signatures: unwarned } = opening(false);

    const moved = await applyDocumentCommand(
      { client, ask, stamp, signatures: unwarned, onApplied: () => undefined },
      DOC,
      SANITIZE,
    );

    expect(moved).toBe(true);
    expect(asked).toStrictEqual([]);
    expect(sent.at(-1)).toStrictEqual({
      id: 'document.execute',
      params: { docId: DOC, command: SANITIZE, breakSignatures: true },
    });
  });

  it('CONTROL: an edit main applies at once is never asked about, and is sent exactly once', async () => {
    const sent: unknown[] = [];
    const client = createClient(channels, (id, params) => {
      sent.push({ id, params });
      return Promise.resolve(ok(APPLIED));
    });
    const { ask, asked } = answering('this');

    expect(await applyDocumentCommand({ client, ask, stamp, signatures, onApplied: () => undefined }, DOC, SANITIZE)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(asked).toStrictEqual([]);
  });
});
