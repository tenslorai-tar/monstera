import { describe, expect, it } from 'vitest';

import {
  type CommandKind,
  type NamesAFormField,
  type NamesAPage,
  type NamesATextObject,
  type NamesAnAnnotation,
  type NamesASecondDocument,
  commandSchema,
  credentialFields,
} from '@monstera/contract';

import { type DeclaredCommands, declaredCommands } from './commandDeclarations.js';
import { writerShapes } from './engineSeam.js';

/**
 * Properties of the declaration table itself, rather than of any command in it.
 *
 * The byte-image case exists because
 * [ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)
 * makes a **cost** argument, and a cost argument has a scope. Costs are not
 * type errors, so nothing in the compiler was keeping that scope true.
 *
 * **That case FIRED on 2026-09-09 and was replaced rather than edited.** It
 * asserted every byte-image command is non-invertible and its message said
 * such a declaration would be legitimate and that ADR-0039 was what needed
 * amending. `replaceTextObject` is the declaration; ADR-0039's addition of the
 * same day is the amendment. A trigger whose instruction has been carried out
 * must not stay as an assertion, because it is then red for a correct table —
 * so what stands in its place is the property the amendment established, that
 * the choice between invertible and terminal on one byte-image writer is a
 * choice about **retention** and nothing else.
 *
 * The sources case exists because `contract/commands.ts` said it did. See
 * {@link DeclaredSources}.
 */

/**
 * The kinds this table declares as naming a second document.
 *
 * `declarations` is written with `satisfies`, so each `sources` keeps its
 * literal type and this mapped type can separate `'one'` from `'none'`. An
 * annotation there would widen every field to its union and collapse this to
 * every kind.
 */
type DeclaredSources = {
  // ANY VALUE BUT `'none'` names another document: `'one'`, and `'several'` since ADR-0152.
  [K in CommandKind]: DeclaredCommands[K]['sources'] extends 'one' | 'several' ? K : never;
}[CommandKind];

/**
 * THE ANCHOR `contract/commands.ts` NAMED THIS FILE FOR, added 2026-09-06.
 *
 * The contract owns a hand-kept `if` listing which kinds carry a source
 * `DocId`, with a type beside it and a comment saying the load-bearing half —
 * tying that type to the kernel's `sources` axis — lived here. It did not: this
 * file had no mention of `sources` at all, so the list was anchored to nothing
 * and a third `sources: 'one'` command would have left `sourceIdsOf` answering
 * empty for it.
 *
 * That is not silent at runtime — `CommandBus` throws *"the declaration and the
 * contract's sourceIdsOf disagree"* — but only for a command actually dispatched
 * with a source, which is to say after the registration is written, shipped and
 * run. These two lines make it a compile error instead.
 *
 * **Both directions, and each catches a different mistake.** A kind gaining
 * `sources: 'one'` here without joining the contract's `if` breaks the second;
 * a kind losing it without leaving the `if` breaks the first. The first also
 * catches the derivation collapsing to `never`, since `never` is assignable to
 * everything and would satisfy the second on its own — the empty set agreeing
 * with any claim, which is why the runtime control below names a member.
 */
const _declarationsCoverTheContract: NamesASecondDocument extends DeclaredSources ? true : never =
  true;
const _contractCoversTheDeclarations: DeclaredSources extends NamesASecondDocument ? true : never =
  true;
void _declarationsCoverTheContract;
void _contractCoversTheDeclarations;

/**
 * The kinds this table declares as naming existing state.
 *
 * {@link DeclaredSources} on ADR-0041's axis, and it is written the same way for
 * the same reason — the literal types survive `satisfies`, so the mapped type
 * can separate the members.
 */
type DeclaredTargets = {
  [K in CommandKind]: DeclaredCommands[K]['targets'] extends 'none' ? never : K;
}[CommandKind];

/**
 * The `targets` axis tied to the contract's `targetVersionOf`, in both
 * directions — written WITH the axis rather than a range after it.
 *
 * The sibling above spent a range asserting nothing, because its comment named
 * a file that did not carry it. This one exists in the commit that built the
 * axis, which is the whole of the lesson: the tie is not a follow-up, it is the
 * half that makes the hand-kept `if` in `commands.ts` safe to keep.
 *
 * A kind gaining `targets: 'annotation'` here without joining that `if` breaks
 * the second line, and the bus would otherwise refuse it at dispatch with
 * *"the declaration and the contract's targetVersionOf disagree"* — after the
 * registration is written, shipped and run. A kind losing the axis without
 * leaving the `if` breaks the first.
 *
 * Note the derivation excludes `'none'` rather than including a named member,
 * so a SECOND member joins this set by existing, and its author meets these two
 * lines rather than a green build.
 *
 * **It did, on 2026-09-07.** `fillFormField` declared `targets: 'field'` and
 * these two lines were the first thing that failed — which is the sentence
 * above cashed rather than repeated. The union on the right is a union rather
 * than a widened `NamesAnAnnotation` because the two name different walks, and
 * a single type covering both would say an annotation index and a widget index
 * are the same kind of thing.
 *
 * **And AGAIN on 2026-09-09**, `replaceTextObject` declaring
 * `targets: 'text-object'`. Twice now the second line has been the first thing
 * a new member met, which is the only evidence that matters about whether a
 * type-level anchor is load-bearing. The union gains a third member for the
 * reason it had two: a page-object index is PDFium's numbering of a page, and
 * folding it into either MuPDF name would say three index spaces are one.
 */
const _declarationsCoverTheTargets: NamesAnAnnotation | NamesAFormField | NamesATextObject | NamesAPage extends
  DeclaredTargets
  ? true
  : never = true;
const _targetsCoverTheDeclarations: DeclaredTargets extends
  | NamesAnAnnotation
  | NamesAFormField
  | NamesATextObject
  | NamesAPage
  ? true
  : never = true;
void _declarationsCoverTheTargets;
void _targetsCoverTheDeclarations;

/** Every declared kind, as the table itself lists them. */
const KINDS = Object.keys(declaredCommands) as readonly CommandKind[];

describe('the declaration table', () => {
  it('CONTROL: it declares both writer shapes, so the case below is not vacuous', () => {
    // Without this, a table that happened to route everything to MuPDF would
    // satisfy the case below by having nothing to check — the reassuring answer
    // arriving through an empty set.
    const shapes = new Set(KINDS.map((kind) => writerShapes[declaredCommands[kind].writer]));
    // THREE since ADR-0121 Decision 3: pdf-lib's commands are `hosted-image`, run in the MuPDF host.
    expect([...shapes].sort()).toStrictEqual(['byte-image', 'hosted-image', 'live-session']);
  });

  it('an INVERTIBLE byte-image command retains no document-scaled bytes, which is what ADR-0039 now prices', () => {
    // ## This case replaced a TRIGGER whose instruction was carried out
    //
    // It read *every byte-image command is non-invertible*, with a message
    // saying such a declaration would be legitimate, that it fell outside
    // ADR-0039's cost argument, and that the ADR was what needed amending.
    // `replaceTextObject` is the declaration it was waiting for, and ADR-0039's
    // addition of 2026-09-09 is the amendment it asked for — so keeping the old
    // case would have made it red for a correct table, which is the shape a
    // trigger must not decay into.
    //
    // ## What the amendment actually established, restated as the assertion
    //
    // The old case's arithmetic compared an invertible byte-image command to
    // its LIVE-SESSION equivalent. That is true and is not the axis a
    // declaration turns on: §3's matrix settles the writer first, so the choice
    // is invertible against terminal with the writer held fixed. Read from the
    // code, `CommandBus.#sessionFor` calls `ByteImageAccess.current()` for
    // every byte-image command before `capture` runs, so the serialise is
    // common to both and neither pays for it.
    //
    // What differs is RETENTION, and `CommandLog.trimTo` states it: *an
    // invertible entry retains no document-scaled bytes*, against one whole
    // document image per terminal entry. So the property worth holding is that
    // an invertible byte-image command's prior is bounded — a page, an index
    // and a string the contract caps — rather than something document-scaled.
    //
    // ## Asserted through the LOG's own retention rule, not by inspecting a type
    //
    // A type-level check that `CommandPrior[K]` is "small" is not expressible.
    // What is expressible is the consequence: an invertible entry is one
    // `trimTo` cannot shed, so declaring a byte-image command invertible is a
    // statement that its prior may live in the log for ever. This case names
    // the set that statement now applies to, so a second such command arrives
    // at this list rather than at a green build.
    const invertibleByteImage = KINDS.filter(
      (kind) =>
        writerShapes[declaredCommands[kind].writer] === 'byte-image' &&
        declaredCommands[kind].invertible,
    );

    expect(
      invertibleByteImage,
      `${invertibleByteImage.join(', ')} is routed to a byte-image writer and declared ` +
        `invertible. That is legitimate and ADR-0039's addition of 2026-09-09 prices it: the ` +
        `serialise is common to both declarations, and the difference is retention — an ` +
        `invertible entry keeps its prior for ever and a terminal one keeps a whole document ` +
        `image. Before adding a kind here, check its prior is BOUNDED by the contract; if it ` +
        `is document-scaled, the declaration is wrong rather than this list.`,
      // THE CHECK THE MESSAGE ABOVE ASKS FOR, carried out on 2026-09-10 for the
      // two that joined:
      //
      // - `placePageObject`'s prior is a page, an index and SIX FLOATS — an
      //   object's own matrix. Bounded by the shape, not by a constant.
      // - `recolorPageObjects`' is four small integers per object, and the list
      //   is capped at `MAX_EDITED_OBJECTS`, which is a page's worth. Bounded
      //   by the contract.
      //
      // Neither grows with the document, so both belong here. `deletePageObjects`
      // is deliberately absent: PDFium cannot rebuild a removed object, so it is
      // declared terminal and appears in the control below instead.
      //
      // - `replaceTextAt`'s (2026-10-04, ADR-0156) is `replaceTextObject`'s shape with ONE object: a page, an index and
      //   the string it held, capped by `PDFIUM_PRIOR_TEXT_MAX` on the wire. Bounded by the contract.
    ).toStrictEqual(['replaceTextObject', 'placePageObject', 'recolorPageObjects', 'replaceTextAt']);
  });

  it('CONTROL: some byte-image command is TERMINAL, so the case above is a property and not a description', () => {
    // Without this, a table that had made every byte-image command invertible
    // would satisfy the case above by listing them all — and the retention
    // rule it states would be about a distinction the table no longer draws.
    // The pdf-lib content commands kept both sides populated until ADR-0121
    // Decision 3 hosted them; PDFium's `deletePageObjects` and the signer keep
    // the terminal side now.
    const terminalByteImage = KINDS.filter(
      (kind) =>
        writerShapes[declaredCommands[kind].writer] === 'byte-image' &&
        !declaredCommands[kind].invertible,
    );
    expect(terminalByteImage).toContain('deletePageObjects');
  });

  it('CONTROL: the sources derivation names a kind, so the type equality is not two empty sets', () => {
    // `never extends X` holds for every X, so a mapped type that stopped
    // separating the literals would satisfy one half of the pair above and be
    // indistinguishable from a table carrying no cross-document command at all.
    // The compiler cannot tell those apart. This can: it reads the runtime
    // table and requires a member that is known to be there.
    const declared = KINDS.filter((kind) => declaredCommands[kind].sources !== 'none');
    expect(declared).toContain('mergeDocument');
    expect(declared).toContain('replacePage');
  });

  it('CONTROL: exactly eighteen kinds declare a target, and the rest answer none', () => {
    // The targets axis's version of the control above, and it carries the
    // second half as well. `never extends X` would satisfy one type-level line
    // on its own; and a table where EVERY command declared a target would
    // satisfy the other, while making the bus compare a version for commands
    // that carry none — which is the registration-defect throw, on every
    // rotate.
    const named = KINDS.filter((kind) => declaredCommands[kind].targets !== 'none');
    expect(named).toStrictEqual([
      'replacePage',
      'importPageAsLayer',
      'removeAnnotation',
      'placeAnnotation',
      'styleAnnotation',
      'editAnnotationText',
      // THE AUTHOR, `editAnnotationText`'s shape with `/T` (ADR-0103).
      'setAnnotationAuthor',
      // THE ONE WHOSE INDEX IS NOT THE MARK IT CHANGES. A reply names the
      // annotation it ANSWERS, and it belongs here for the same reason as its
      // four neighbours: the handle is a position in this walk and goes stale
      // when the document moves, whatever the command then does with it.
      'replyToAnnotation',
      'fillFormField',
      'deleteFormFields',
      // THE TWO THAT CHANGE OR COPY A FIELD THAT EXISTS (ADR-0193): their handles are positions in the widget walk.
      'editFormFields',
      'duplicateFormField',
      'replaceTextObject',
      'placePageObject',
      'recolorPageObjects',
      'deletePageObjects',
      // A BLOCK EDIT names the runs a read answered, at that read's version (ADR-0096).
      'editTextBlock',
      // AND THE SAME BLOCKS on a Type 3 page, the same read's names and version (ADR-0176).
      'editTextOperators',
    ]);
    // `'page'` IS THE FOURTH MEMBER (ADR-0062's correction, 2026-09-14): a page
    // index is a position in the page tree, which is none of the three walks below.
    //
    // AND ALL FOUR MEMBERS ARE PRESENT, which the count above cannot say: a
    // table where every target read `'annotation'` would satisfy it, and the
    // bus would then compare a version for a payload pointing into the wrong
    // walk — the failure the second member exists to prevent, and the third
    // makes worse rather than merely repeating. The first two walks belong to
    // one parser; `'text-object'` belongs to PDFium, so a payload landing in
    // the wrong one would be an index read against a different ENGINE's
    // numbering of the same page.
    expect(new Set(named.map((kind) => declaredCommands[kind].targets))).toStrictEqual(
      new Set(['page', 'annotation', 'field', 'text-object']),
    );
  });
});

/**
 * Every credential field of every command, keyed by the command's kind.
 *
 * Through the contract's one walk, which matches by NAME: a credential named as something else is out of its reach,
 * and that is stated here so the case is not read as wider than it is.
 */
function credentialsByKind(): ReadonlyMap<CommandKind, readonly string[]> {
  const found = new Map<CommandKind, readonly string[]>();
  for (const option of commandSchema.options) {
    const kind = option.shape.kind.value;
    const fields = credentialFields(option, kind);
    if (fields.length > 0) found.set(kind, fields);
  }
  return found;
}

/**
 * The replay modes that keep no credential in the log: the intent held beside the entry (ADR-0171 Decision 3), or the
 * result alone with the command's kind (ADR-0162).
 */
const KEEPS_NO_CREDENTIAL: ReadonlySet<string> = new Set(['reapply-held-intent', 'stored-result']);

/** The kinds whose credential would be recorded in the log, by the replay they declare. */
function recordingACredential(
  credentials: ReadonlyMap<CommandKind, readonly string[]>,
  replayOf: (kind: CommandKind) => string,
): CommandKind[] {
  return [...credentials.keys()].filter((kind) => !KEEPS_NO_CREDENTIAL.has(replayOf(kind)));
}

describe('a credential in a command never reaches the undo log', () => {
  it('POSITIVE CONTROL: the walk finds the three credential fields known to exist', () => {
    // EVERY RUN, inside the case that depends on it: a walk that could not see into a schema reports nothing, which
    // is the answer the case below hopes for.
    const found = credentialsByKind();
    expect(found.get('setDocumentProtection')).toStrictEqual([
      'setDocumentProtection.userPassword',
      'setDocumentProtection.ownerPassword',
    ]);
    expect(found.get('signDocument')).toStrictEqual(['signDocument.passphrase']);
  });

  it('every command carrying one declares a replay that keeps it out of the log', () => {
    expect(recordingACredential(credentialsByKind(), (kind) => declaredCommands[kind].replay)).toStrictEqual([]);
  });

  it('CONTROL: the same rule reports the protect declared reapply-intent, which keeps its command whole', () => {
    const replayOf = (kind: CommandKind): string =>
      kind === 'setDocumentProtection' ? 'reapply-intent' : declaredCommands[kind].replay;
    expect(recordingACredential(credentialsByKind(), replayOf)).toStrictEqual(['setDocumentProtection']);
  });
});

describe('the writer-shape table', () => {
  it('EXACTLY ONE writer of record is live-session, which is what keeps a B4 unaskable', () => {
    // ## A prose note in two files, given a caller
    //
    // `savePipeline.ts` and `apps/desktop/src/documentCommands.ts` both record
    // the same open question: *two live-session writers each return the whole
    // document from `serialise`, and nothing in the law says which bytes win.
    // That is a B4.* Neither can fire. A note is read by whoever happens to
    // open the file, and the person about to declare the second live-session
    // writer is not obviously that person.
    //
    // That is not hypothetical. `writerShapes` declared `pdfium:
    // 'live-session'` from Stage 0, and building Stage 5's host on it would
    // have answered the question by accident — under a feature, which is the
    // one thing B4 exists to stop. It was caught by reading ADR-0039 rather
    // than by any mechanism, and ADR-0047 changed the declaration to
    // `'byte-image'` on the first evidence. This case is the mechanism that
    // reading was standing in for.
    //
    // ## Derived, and 4c says which direction
    //
    // The failure feared is a member ARRIVING, which makes this set bigger, so
    // a derived count tracks it exactly. A hand-kept list would agree with any
    // shrink — and, worse here, would have to be edited by the very author this
    // case exists to interrupt.
    //
    // It also cannot pass vacuously: an empty or unreadable table answers zero
    // and fails, rather than reporting the reassuring answer through a set with
    // nothing in it.
    const liveSession = Object.entries(writerShapes)
      .filter(([, shape]) => shape === 'live-session')
      .map(([writer]) => writer);

    expect(
      liveSession,
      `${liveSession.join(', ')} are declared live-session. Two live-session writers each ` +
        `answer \`serialise\` with the WHOLE document, and nothing in the law says which bytes ` +
        `win — savePipeline.ts and apps/desktop/src/documentCommands.ts both record that as an ` +
        `open B4, and it is answered where the flush thunk is composed. Answer it there before ` +
        `declaring a second one. Do not widen this case to make a build green.`,
    ).toStrictEqual(['mupdf']);
  });

  it('every command is drawn from bytes unless it is one of the NAMED exceptions (ADR-0084)', () => {
    // THE EXCEPTIONS ARE A LITERAL, not derived from the table: derived, a command that declared
    // `'view-model'` by mistake would join the list that excuses it. Written here, adding one is
    // a visible edit to this line — and the next command anyone registers defaults to being SEEN.
    // A merge and a delete were right on disk and invisible until reopen before this existed.
    const exceptions: Readonly<Record<string, 'view-model' | 'nothing-drawn'>> = {
      rotatePages: 'view-model',
      // A PROTECT DRAWS since ADR-0171 Decision 8: main's image is the document as protected, so it holds no readable copy.
      setPageTransition: 'nothing-drawn',
    };
    const declared = Object.fromEntries(
      Object.entries(declaredCommands).map(([kind, declaration]) => [kind, declaration.display]),
    );
    // NOT VACUOUS: the table holds every kind, and an unreadable one answers nothing.
    expect(Object.keys(declared).length).toBeGreaterThan(Object.keys(exceptions).length);
    for (const [kind, display] of Object.entries(declared)) {
      expect(display, kind).toBe(exceptions[kind] ?? 'image');
    }
    // AND EVERY EXCEPTION NAMES A COMMAND THAT EXISTS, so a renamed kind cannot leave an excuse
    // behind that nothing uses.
    for (const kind of Object.keys(exceptions)) expect(declared, kind).toHaveProperty(kind);
  });
});
