import { describe, expect, it } from 'vitest';

import type {
  CommandKind,
  NamesAFormField,
  NamesAnAnnotation,
  NamesASecondDocument,
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
  [K in CommandKind]: DeclaredCommands[K]['sources'] extends 'one' ? K : never;
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
 */
const _declarationsCoverTheTargets: NamesAnAnnotation | NamesAFormField extends DeclaredTargets
  ? true
  : never = true;
const _targetsCoverTheDeclarations: DeclaredTargets extends NamesAnAnnotation | NamesAFormField
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
    expect([...shapes].sort()).toStrictEqual(['byte-image', 'live-session']);
  });

  it('every BYTE-IMAGE command is non-invertible, which is what ADR-0039 priced', () => {
    // ## What this guards, and what it deliberately does NOT
    //
    // ADR-0039 argues that refreshing `main`'s canonical image costs nothing per
    // command. The measurement behind that is narrower than the sentence, and
    // this case is where the narrowness is kept honest.
    //
    // Read from the code: `CommandBus.#sessionFor` obtains a byte-image
    // writer's session by calling `ByteImageAccess.current()`, which is a FULL
    // SERIALISE of the live engine session — and it does so for every
    // byte-image command, whatever its invertibility. `pdfLibWriter.serialise`
    // is the identity, so a terminal entry's checkpoint is that same array and
    // costs nothing more.
    //
    // So for a NON-INVERTIBLE byte-image command the serialise doubles as the
    // checkpoint the bus was going to take anyway, and nothing extra is paid.
    // For an INVERTIBLE one there is no checkpoint, and the serialise is a cost
    // its live-session equivalent — `rotatePages`, say — does not pay.
    //
    // ## Why this is a case and NOT a type
    //
    // The type could carry it: the declaration union already discriminates
    // invertible from terminal, and `writer: 'pdf-lib'` could be made to sit
    // only on a non-invertible member. That would be **wrong**, because
    // `docs/ARCHITECTURE.md` §3's matrix assigns *"Form fields: create"* to
    // `@cantoo/pdf-lib` — the one concern MuPDF has no API for — and creating a
    // field is plausibly invertible: its prior state is *the field did not
    // exist*, which is small and serialisable. A compile error here would
    // forbid a Stage 4 command the architecture already anticipates.
    //
    // So the fact is true today and is not a rule. This case is the trigger:
    // the first byte-image command declared `invertible: true` turns it red,
    // and the failure message says what to do rather than what not to.
    //
    // DERIVED from `writerShapes` and the table, never listed — 4c's direction
    // test: the failure feared is a member ARRIVING, so a derived set tracks it
    // and a hand-kept list would not.
    const invertibleByteImage = KINDS.filter(
      (kind) =>
        writerShapes[declaredCommands[kind].writer] === 'byte-image' &&
        declaredCommands[kind].invertible,
    );

    expect(
      invertibleByteImage,
      `${invertibleByteImage.join(', ')} is routed to a byte-image writer and declared ` +
        `invertible. That is LEGITIMATE — ARCHITECTURE §3 assigns form-field creation to ` +
        `@cantoo/pdf-lib and creating a field is invertible — and it falls outside ADR-0039's ` +
        `cost argument, which covers only the non-invertible case. Such a command pays a full ` +
        `serialise of the live session (CommandBus.#sessionFor -> ByteImageAccess.current) that ` +
        `no checkpoint was going to pay for. Amend ADR-0039 to price it, then update this case.`,
    ).toStrictEqual([]);
  });

  it('CONTROL: the sources derivation names a kind, so the type equality is not two empty sets', () => {
    // `never extends X` holds for every X, so a mapped type that stopped
    // separating the literals would satisfy one half of the pair above and be
    // indistinguishable from a table carrying no cross-document command at all.
    // The compiler cannot tell those apart. This can: it reads the runtime
    // table and requires a member that is known to be there.
    const declared = KINDS.filter((kind) => declaredCommands[kind].sources === 'one');
    expect(declared).toContain('mergeDocument');
  });

  it('CONTROL: exactly five kinds declare a target, and the rest answer none', () => {
    // The targets axis's version of the control above, and it carries the
    // second half as well. `never extends X` would satisfy one type-level line
    // on its own; and a table where EVERY command declared a target would
    // satisfy the other, while making the bus compare a version for commands
    // that carry none — which is the registration-defect throw, on every
    // rotate.
    const named = KINDS.filter((kind) => declaredCommands[kind].targets !== 'none');
    expect(named).toStrictEqual([
      'removeAnnotation',
      'placeAnnotation',
      'styleAnnotation',
      'fillFormField',
      'deleteFormFields',
    ]);
    // AND THE TWO MEMBERS ARE BOTH PRESENT, which the count above cannot say: a
    // table where every target read `'annotation'` would satisfy it, and the
    // bus would then compare a version for a payload pointing into the wrong
    // walk — the failure the second member exists to prevent.
    expect(new Set(named.map((kind) => declaredCommands[kind].targets))).toStrictEqual(
      new Set(['annotation', 'field']),
    );
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
});
