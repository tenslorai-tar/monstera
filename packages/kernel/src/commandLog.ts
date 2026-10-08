import type { CommandKind, CommandOfKind } from '@monstera/contract';
import type { Brand } from '@monstera/shared';

// `import type`, NOT `import { type … }`. The second form keeps the specifier
// in the emitted JavaScript as `import {} from './rotatePages.js'`, which RUNS —
// and `rotatePages.js` imports `withDocument` from `mupdfWriter.js` as a value,
// which loads the native MuPDF binding.
//
// Measured: importing `documentService.js` cost **38.1 MB of RSS** before this
// line was corrected, for a module that must never parse a document. `main`
// holds bytes and hands work to a host (ARCHITECTURE §2); pulling the parser
// into it is the creep §9.17's base term exists to catch, and it arrived
// through a type-only import of a type.
//
// Same mechanism as the Electron download one file over, with a different bill.
import type { DeclaredCommands } from './commandDeclarations.js';
import type { PriorProtection } from './documentProtection.js';
import type { PreReadValue } from './engineSeam.js';
import type { PriorFieldValue } from './formFields.js';
import type { PriorAnnotationAuthor, PriorAnnotationText } from './pageAnnotations.js';
// TYPE-ONLY, and here that is load-bearing rather than habitual: this module is
// reached from `main` and `pdfiumTextEdit.js` reaches koffi and `pdfium.dll`.
// The import is erased, so the edge the header above warns about is not
// created — the same care the `engineSeam.js` line records, on a second engine.
import type { PriorFills, PriorPlacement } from './pdfiumObjectEdit.js';
import type { PriorTextObjects } from './pdfiumTextEdit.js';
import type { PriorLayerVisibility } from './layers.js';
import type {
  PriorPageCopy,
  PriorPageInsert,
  PriorPageOrder,
  PriorPageSwap,
} from './pageOrder.js';
import type { PriorPageCrop } from './pageCrop.js';
import type { PriorPageDeskew } from './pageDeskew.js';
import type { PriorPageResize } from './pageResize.js';
import type { PriorPageTransition } from './pageTransition.js';
import type { PriorPageRotation } from './rotatePages.js';

/**
 * The command log: a cursor over entries, not a stack (ADR-0009 §4).
 *
 * ## Why a cursor, and why now
 *
 * Neither the founding record nor `ARCHITECTURE` mentioned redo. Converting a
 * stack into a cursor-plus-log is a structural change *beneath already-built
 * features*, so §4 added it before any command existed. Undo moves the cursor
 * back and never pops; redo moves it forward; a new command truncates whatever
 * the cursor is no longer pointing past.
 *
 * ## The two shapes, and what makes the wrong one unrepresentable
 *
 * An entry is `{ kind: 'invertible', command, inverse }` or
 * `{ kind: 'terminal', command, checkpoint }` — never both, never neither. A
 * non-invertible command without a checkpoint cannot be constructed, which is
 * §4's sentence as a type rather than as a rule someone follows.
 *
 * ## Applying an inverse is NOT here
 *
 * This structure records what happened and where the cursor is. Reversing an
 * entry — restoring a leaf to *inheriting* rather than to declaring the value it
 * used to inherit — is §3's assertion and lands with the first command that
 * exercises it. A log that both stored and applied would make that assertion
 * untestable without driving the whole pipeline.
 */

/**
 * A byte snapshot taken before a command that cannot be inverted.
 *
 * **Branded, with the only mint inside `commandBus.ts`.** §4 says the
 * checkpoint is taken by the bus, in one code path, never by a handler — and
 * that has to be structural rather than documented. Unbranded this is
 * `Uint8Array`, so any handler could produce one and the rule would survive
 * exactly as long as everyone remembered it.
 *
 * The brand is what a handler cannot forge. It is reinforced by the seam: a
 * live-session `apply` returns `Promise<void>` and has nowhere to put one, and
 * `capture` returns a {@link CaptureResult} that cannot carry one either. Three
 * doors, all shut, and the compile-fail proof holds each of them.
 *
 * **A FILE, since 2026-09-29, and never bytes in memory**
 * ([ADR-0121](../../../docs/DECISIONS/0121-main-never-holds-two-images.md)). It was the whole image, held for as long
 * as its entry lived, and one of them took `main` to 2.00× the file against §9.17's 1.5×. It is now where
 * `DocumentService` stored the image — in a per-document directory of `main`'s own — and how long it is; a restore
 * copies the file. The brand is unchanged, and so is its one mint.
 */
export type Checkpoint = Brand<CheckpointFile, 'Checkpoint'>;

/** Where a checkpoint's bytes are, and how many. What `DocumentService` answers when it stores one. */
export interface CheckpointFile {
  readonly path: string;
  readonly byteLength: number;
}

/**
 * The prior state each command's inverse needs, per kind.
 *
 * Exhaustiveness is free rather than asserted: `CommandSpecs` is a mapped type
 * over `CommandKind` and each spec's `capture` is typed `CommandPrior[K]`, so a
 * command kind with no entry here cannot be indexed and does not compile at its
 * own spec.
 *
 * §3's shape lives on the values, not here — `PriorPageRotation` carries
 * `{ present: false }` for a page that inherited, which is what makes its
 * inverse a delete.
 */
export interface CommandPrior {
  readonly rotatePages: readonly PriorPageRotation[];
  /**
   * A layer's own visibility, read before it was changed.
   *
   * §3's shape again, on a different axis: `PriorPageRotation` carries absence
   * because a rotation may be inherited, and this carries the boolean the
   * document held because a toggle may have changed nothing. Both exist so an
   * inverse RESTORES rather than derives — an inverse computed as
   * `!command.visible` flips a layer the command left alone.
   */
  readonly setLayerVisibility: PriorLayerVisibility;
  /**
   * Where a page was, and where it went.
   *
   * The odd one of the three: the other two carry state read OFF the document
   * before it changed, and this carries the move itself. That is not a
   * shortcut — a single move has no prior structure to hold, because the tree
   * it produces is a function of the tree it started from and the two indices.
   *
   * What the capture adds over the command is **validation against the
   * document**: an inverse cannot be built from a `to` this document never had,
   * which is the state `captureMovePage` refuses rather than records.
   */
  readonly movePage: PriorPageOrder;
  /**
   * **`never`, and that is the declaration rather than a placeholder.**
   *
   * A deleted page's prior state is its object and everything that object
   * reaches — content streams, resources, annotations — which is
   * document-scaled and has no serialisable form. Recording it would put
   * unbudgeted document-scaled bytes in the log, where `retainedBytes` counts
   * **checkpoints only** — files, since ADR-0121 — and `main`'s memory figure
   * counts images only, so nothing would count them at all. §4's retention
   * would then trim against a number that is wrong in the direction nobody
   * notices.
   *
   * So a delete is a checkpoint command, and `never` is what makes that
   * structural rather than a rule: `CaptureResult<never>`'s `{ captured: true }`
   * member requires a `prior: never` and cannot be constructed, and
   * `LogEntryFor<'deletePages'>`'s `invertible` member cannot either. **An
   * invertible delete is unrepresentable** (B5) — there is no runtime check
   * anywhere for it, and none is needed.
   */
  readonly deletePages: never;
  /**
   * Where the copy landed.
   *
   * `movePage`'s shape rather than `rotatePages`': there is no prior state on
   * the document to read, because the page the inverse removes did not exist
   * before the command. What the capture adds over the command is
   * **validation** — an index this document actually has — and the destination
   * the kernel chose, so an inverse cannot be built from a placement rule a
   * later version changed.
   */
  readonly duplicatePage: PriorPageCopy;
  /**
   * The pair, as validated against the document.
   *
   * The only prior state in this table whose inverse is the command itself,
   * because a transposition is an involution. It is still **captured** rather
   * than read back off the command at undo time: `movePage` next door records
   * the same two numbers for the same reason, and a log entry that reached for
   * `entry.command` to invert would be the one shape §3 forbids.
   */
  readonly swapPages: PriorPageSwap;
  /**
   * Where the blank page landed.
   *
   * {@link PriorPageCopy}'s shape and its reason: the page the inverse removes
   * did not exist before the command, so there is no prior state on the
   * document to read — what the capture adds is validation, and an index the
   * command's own bound accepts *one past the end* where every other command in
   * this table refuses it.
   */
  readonly insertBlankPage: PriorPageInsert;
  /**
   * Each cropped page's own `/CropBox`, read before the command ran.
   *
   * `PriorPageRotation`'s shape on a second key, and for §3's same reason:
   * **absence is a value**. A page that displayed its media box because it
   * declared no crop box must come back declaring none — writing the box in
   * renders identically and is a different document, and the next crop would
   * inset from a box the page never had.
   */
  readonly cropPages: readonly PriorPageCrop[];
  /**
   * Each page's own `/Trans`, read before the command ran.
   *
   * {@link cropPages}' shape on a third key and for §3's same reason: **absence
   * is a value**. A page that declared no transition must come back declaring
   * none — and here the distinction is sharper than it is for a crop box,
   * because `/S /R` (*replace*, meaning no visible transition) and no `/Trans`
   * at all render identically. Restoring the first where the second was leaves
   * a document that says the producer chose *no transition* when the producer
   * never considered it, and the next reader of that dictionary cannot tell.
   */
  readonly setPageTransition: readonly PriorPageTransition[];
  /**
   * **`never`, for `deletePages`' reason arriving from the opposite side.**
   *
   * A delete's prior state is unrecordable because it is the page and
   * everything the page reaches. A watermark's is unrecordable because it is
   * the page's **whole content stream** — drawing appends to it, and restoring
   * the page means restoring the stream it had, which is document-scaled and
   * has the same effect on `retainedBytes` that entry describes: a log that
   * reports a figure smaller than what the process holds, trimmed against a
   * number wrong in the direction nobody notices.
   *
   * So every command routed to a byte-image writer is a checkpoint command, and
   * `never` is what makes it structural: `CaptureResult<never>` has no
   * constructible `{ captured: true }` member, so `captureWatermarkPages`
   * cannot report success even by mistake, and `LogEntryFor<'watermarkPages'>`
   * has no `invertible` member to build.
   *
   * **The checkpoint costs nothing beyond what this command already does**
   * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)):
   * the bytes the bus serialises for the checkpoint are the same bytes the
   * `apply` consumes as its input image.
   */
  readonly watermarkPages: never;
  /**
   * **`never`, for {@link watermarkPages}' reason exactly.**
   *
   * The second command routed to a byte-image writer, and the entry above
   * states the whole argument: drawing appends to a page's content stream, so
   * restoring the page means restoring the stream, which is document-scaled and
   * counted by nothing.
   *
   * Repeated as its own member rather than shared, because `CommandPrior` is
   * the table where each command says what its inverse is made of, and a
   * comment pointing elsewhere is how a later command acquires a prior state by
   * inheritance rather than by decision.
   */
  readonly headerFooterPages: never;
  /** **`never`**, for {@link watermarkPages}' reason — this draws onto pages too. */
  readonly batesNumberPages: never;
  /**
   * **`never`**, and this one changes the content stream at its *front* rather
   * than its end — which makes no difference to the argument: the prior state
   * is still the whole stream.
   */
  readonly setPageBackground: never;
  /**
   * Each page's own boxes and the **shape** of its `/Contents`, read before the
   * command ran.
   *
   * **One of the two members on this table that touch a content stream and are
   * not `never`**, which is worth stating here because every neighbour above
   * says the opposite and a reader takes a table's pattern as its rule. The
   * pattern is not the rule; the rule is `watermarkPages`' premise — *drawing
   * appends to the stream, so the prior state is the stream* — and
   * `resizePages` appends to no stream. It leaves the page's own streams in
   * place and referenced, and rewrites `/Contents` around them, so what its
   * inverse needs is where they sit in the array rather than what they contain.
   *
   * Recorded positionally and never by object number: MuPDF renumbers when it
   * garbage-collects on write, so a prior naming object 8 names something else
   * after a save, while *the middle of the array* does not move.
   */
  readonly resizePages: readonly PriorPageResize[];
  /**
   * The **shape** of each page's `/Contents`, read before the command ran.
   *
   * The second member here that touches a content stream and is not `never`,
   * and it earns it the same way `resizePages` does — the two share one
   * implementation of the wrap (`pageContentWrap.ts`), so they share the
   * argument as well as the shape.
   *
   * **NO BOX IS RECORDED**, unlike its neighbour, because none is written. A
   * deskew turns the content and leaves the sheet the size it was.
   */
  readonly deskewPages: readonly PriorPageDeskew[];
  /**
   * **`never`**, and this one earns it from the other direction than its
   * neighbours.
   *
   * Every other `never` here is a command that DRAWS, whose prior state is the
   * page's whole content stream. This one adds a page, and its prior state is
   * *the document without that page* — which is `deletePages`' entry read
   * backwards: undoing an insert is a delete, and a delete's prior state is the
   * page and everything it reaches.
   *
   * Written out rather than pointed at a neighbour, because this table is where
   * each command says what its inverse is made of, and a comment saying *see
   * above* is how a later command acquires a prior state by inheritance instead
   * of by decision.
   */
  readonly insertImagePage: never;
  /**
   * **`never`**, for {@link insertImagePage}' reason on a variable number of
   * pages.
   *
   * The count is what makes it worth its own entry rather than a pointer: a
   * table of contents may take one page or six, so *the document without the
   * pages this command added* is not a fixed shape the way an insert's is. That
   * changes nothing about the conclusion — a delete's prior state is the pages
   * and everything they reach either way — and it is written out because this
   * table is where each command says what its inverse is made of.
   */
  readonly generateToc: never;
  /**
   * **`never`**, and the reason is the one §4 reserved a checkpoint for.
   *
   * The prior state is *this page without the content stream and the font
   * resource the command appended*, and a byte-image writer has no way to name
   * that: the apply consumes an image and answers one, so there is no handle to
   * the objects it added and nothing pdf-lib could hand back that would restore
   * them by description. §4's list is redaction, flatten, encryption and **OCR**,
   * and this is the fourth.
   *
   * **It is also the first `never` here whose command keeps something OTHER than
   * a prior.** A stored-effect replay needs what the apply was handed, which is
   * the entry's `read` — a different axis, and one that says nothing about
   * invertibility (ADR-0051 Decision 2).
   */
  readonly ocrPage: never;
  /**
   * **`never`**, and the prior state is the clearest case of document-scaled on
   * this type: the image streams themselves.
   *
   * A levelled scan could only be put back by restoring every image XObject the
   * command rewrote, which is most of a scanned document's bytes. §4 reserves a
   * checkpoint for exactly this.
   */
  readonly enhancePages: never;
  /**
   * **`never`**, for `enhancePages`' reason: the prior state includes the image stream
   * the command replaced, which is document-scaled — and the boxes and content besides.
   */
  readonly straightenScans: never;
  /**
   * **`never`**, and this is the first entry whose reason involves a second
   * document — which changes nothing, and saying why is the point.
   *
   * The prior state is *the target without the source's pages*, which is
   * `deletePages`' entry read backwards exactly as `insertImagePage`'s is. The
   * source document is **not** part of it: a merge does not modify the source,
   * so there is nothing about it to restore and no second log entry anywhere.
   * ADR-0040's *what this does not do* says the same, and it is repeated here
   * because a reader meeting a cross-document command for the first time will
   * reasonably wonder whether undo has to reach two documents. It does not.
   */
  readonly mergeDocument: never;
  /**
   * **`never`**, and this is the first entry to earn it from BOTH directions at
   * once.
   *
   * Every other `never` here is a command that draws, one that adds pages, or
   * one that removes them. This does two of those: the prior state is the
   * replaced page's object graph — `deletePages`' argument — **and** the
   * absence of the pages that arrived, which is `insertImagePage`'s. Either
   * alone would be enough; naming both is what stops a later reader concluding
   * that half of it could be recorded.
   */
  readonly replacePage: never;
  /**
   * **`never`**, for `mergeDocument`'s reason: the prior state is the absence of five
   * structures — a group in `/OCGs` and `/D/Order`, a Form XObject, its `/XObject` entry
   * and a drawing stream — none of which has a serialisable form. The bus checkpoints the
   * target (ADR-0064).
   */
  readonly importPageAsLayer: never;
  /**
   * **`never`**, and this one is a genuine *not yet* rather than a structural
   * impossibility — which is why it says so here instead of reading like its
   * neighbours.
   *
   * The prior state of a page that gained an annotation is the page without it,
   * and the operation that removes one is well defined: MuPDF's
   * `deleteAnnotation` takes the annotation. What is missing is the **handle** —
   * an inverse has to name *which* annotation to remove, and this command's
   * effect is an object MuPDF mints, whose identity is not in the payload and
   * whose object number a save may renumber (`movePage`'s entry says the same
   * about recording positions by object number).
   *
   * *The last annotation on the page* would work today, because undo is
   * last-in-first-out and nothing else has touched the page in between. It is
   * still the wrong shape: it is an inverse that depends on the log's ordering
   * rather than on state it captured, so it stops being correct the moment
   * anything can add an annotation other than through this command — which the
   * eraser and the select tool both will.
   *
   * **THE HANDLE NOW EXISTS and this is still `never`, which is a different
   * statement from the one this entry made until 2026-09-06.** It said the
   * identity was the eraser's to supply. It came from
   * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
   * instead, ahead of any tool, and `removeAnnotation` below takes one.
   *
   * What has not been done is capturing it. `apply` would have to report where
   * the annotation it just wrote landed in the walk, and that is a change to
   * what a capture returns rather than a fact anyone is missing. Worth taking,
   * and worth knowing one thing first: an inverse is applied through the undo
   * path and never through `execute`, so the version refusal that guards a
   * renderer's stale handle does not reach it — which is correct, since an
   * inverse minted in the lane cannot be stale, and would have read as a bug the
   * first time undo was refused.
   */
  readonly addAnnotation: never;

  /**
   * **`never`**, and unlike its neighbour above this one is structural.
   *
   * The prior state of a removed annotation is its whole object graph: a
   * dictionary that may reference an appearance stream, which references fonts
   * and images. `deletePages`' argument on a smaller noun — recording it means
   * inventing a serialisation for arbitrary PDF objects, and the bytes would
   * land in a log whose `retainedBytes` counts checkpoints only, so §4's
   * retention could not see them.
   *
   * A handle is not prior state. Knowing *which* annotation was removed says
   * nothing about what it contained, so the identity that made this command
   * possible does nothing for its inverse.
   */
  readonly removeAnnotation: never;
  /**
   * **`never`**, and this is the third annotation command to say so for the
   * third reason.
   *
   * The prior state of a moved annotation IS expressible — the geometry it
   * carried — which is what separates this from the two above. What is not
   * expressible is the obvious version of it: for `Ink`, `Line`, `Polygon` and
   * `PolyLine` the box is derived from the points, so restoring by rectangle
   * maps them through a second affine, and the box the reader reports carries a
   * border outset that does not scale with it. The round trip is close and not
   * equal, and an undo that restores something *nearly* right is worse than a
   * checkpoint, because nothing downstream can tell the two apart.
   *
   * The trigger is a prior that carries the geometry itself — vertices, ink
   * strokes or a line, all bounded by the draft schemas that already exist.
   */
  readonly placeAnnotation: never;
  /**
   * **`never`**, and this is `addAnnotation`'s *not yet* on a weaker footing.
   *
   * That one waited for a handle naming which annotation, and ADR-0041 built
   * it. This waits for a handle naming which LINK, and nothing has proposed
   * one: `document.pageLinks` answers with bounds and a target and no identity,
   * which is exactly where the annotations read started.
   */
  readonly addLink: never;
  /**
   * **`never`**, and the fourth annotation command to say so for a fourth
   * reason — the narrowest of them.
   *
   * The prior state is three numbers per annotation and nothing about the format
   * stands in the way. What does is this type's own shape: it carries ONE value
   * per command, and a restyle names several annotations, so the prior would be
   * a list whose length must match the payload's. Nothing in the log has ever
   * held a per-target prior, and inventing one for the first command that wants
   * it is the retrofit §3a exists to prevent.
   *
   * The trigger is the second command that needs one.
   */
  readonly styleAnnotation: never;
  /**
   * **`never`**, for {@link addAnnotation}' reason and not for its own bytes'.
   *
   * The tempting reading is that the image makes this expensive to record, and
   * that is wrong in both directions: the image is in the **command**, not in
   * the prior state, and the prior state of a placement is the absence of what
   * it placed. What blocks it is the same missing sentence that blocks
   * `addAnnotation` — an inverse spelt *the stamps this command added* would
   * depend on the log's ordering rather than on captured state, and a stamp on
   * forty pages makes that forty guesses instead of one.
   *
   * ADR-0041's handle is what unblocks both, and it unblocks them together.
   */
  readonly placeImage: never;
  /** A placed signature, typed or drawn (ADR-0133): `placeImage`'s reason, unchanged. */
  readonly placeSignatureMark: never;
  /** A placed signature that is a picture: `placeImage`'s reason, unchanged. */
  readonly placeSignaturePicture: never;
  /**
   * The value a field held, and **which widget puts it back**.
   *
   * The first entry on either walk that is not `never`, and it is not because
   * fields are easier — it is because a fill names ONE widget. The four
   * annotation commands each refused for a different reason and one of them was
   * this type's own shape: a restyle names several annotations, so its prior
   * would be a list whose length must match the payload's. A fill's prior is one
   * value, which is what this table has always been able to hold.
   *
   * ## The index is part of the prior, and a radio group is why
   *
   * Measured 2026-09-07: toggling the second radio of a group moves the FIELD to
   * that widget and turns the first off. So the inverse of *select the second*
   * is *select the first* — a different widget from the one the command named —
   * and an inverse computed as *unset what was set* would leave the group
   * deselected, which is a document the user never had. That is
   * `setLayerVisibility`'s lesson on a third axis: an inverse RESTORES rather
   * than derives.
   *
   * `PriorFieldValue` therefore carries the whole restoring instruction —
   * page, widget, value — rather than a value the invert has to place.
   */
  readonly fillFormField: PriorFieldValue;
  /**
   * What an annotation said before it was rewritten.
   *
   * **The first entry on the ANNOTATION walk that is not `never`**, and it is
   * {@link fillFormField}'s reason arriving one walk over rather than a new
   * one: what stopped `removeAnnotation`, `placeAnnotation` and
   * `styleAnnotation` was that each names a LIST, and this table carries one
   * value per command. An edit names one index, because there is one box to
   * type in and one string to put somewhere.
   *
   * It carries the page and index as well as the string, for
   * {@link PriorFieldValue}'s reason: an inverse RESTORES rather than derives,
   * so the whole instruction travels rather than half of it being rebuilt from
   * the command being undone.
   *
   * An empty string is a value here, not an absence — a mark that carried no
   * text is restored to carrying none.
   */
  readonly editAnnotationText: PriorAnnotationText;
  /** Who a mark named, and which mark — `editAnnotationText`'s prior with `/T` in place of the text. */
  readonly setAnnotationAuthor: PriorAnnotationAuthor;
  /**
   * **`never`**, and it is {@link addAnnotation}'s statement rather than a new
   * one: a reply mints an annotation whose walk index is not in the payload, so
   * an inverse would have to name the mark this command created.
   *
   * **The index it carries is no help, and that is worth stating because it
   * looks like one.** Every other entry here that names an index names the mark
   * the command changes; this one names the mark being ANSWERED, which is left
   * exactly as it was. An inverse built from it would delete the comment
   * somebody replied to and leave the reply behind.
   *
   * It clears the day `addAnnotation`'s does, by the same change — a capture
   * that reports where the minted annotation landed in the walk.
   */
  readonly replyToAnnotation: never;
  /**
   * **`never`**, and it is {@link removeAnnotation}'s reason with a second
   * structure attached rather than a new one.
   *
   * The prior state is the widget's whole object graph — a dictionary that may
   * reference an appearance stream, which references fonts and images — plus
   * the field dictionary that held it and every ancestor the deletion emptied.
   * Unbounded and unserialisable here, and the bytes would sit in a log whose
   * `retainedBytes` counts checkpoints only.
   *
   * Written out rather than pointed at its neighbour, because this table is
   * where each command says what its inverse is made of. **ADR-0041's handle
   * does not unblock it**, which is worth saying because the handle is what
   * unblocked `fillFormField` two entries up: naming the field was never the
   * difficulty here.
   */
  readonly deleteFormFields: never;

  /**
   * A flatten has no prior state either, and for a **strictly larger** reason
   * than the entry above.
   *
   * Deleting fields loses the widgets a payload named. This loses every widget
   * in the document and rewrites the content stream of every page one sat on,
   * so the prior state is most of the file. Written out rather than pointed at
   * its neighbour, for this table's standing reason.
   */
  readonly flattenFormFields: never;

  /**
   * The protection the session stood with before the change
   * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8).
   *
   * Its terms can carry a password, so it never reaches this log: the entry keeps {@link HeldInverse} and the bus keeps
   * this beside it, in memory, as it keeps the command ({@link RecordedInverse}).
   */
  readonly setDocumentProtection: PriorProtection;

  /**
   * A burned-in redaction has no prior state, and recording one would be the
   * defect rather than a cost.
   *
   * The prior state is the content somebody asked to have removed. A capture is
   * serialised into this log, so recording it would put the redacted text back
   * in main's memory under a command whose whole purpose was taking it out —
   * the second entry here that is `never` for a rule rather than a size, and
   * the sharper of the two.
   */
  readonly applyRedactions: never;

  /**
   * Marking by search has no prior state worth recording.
   *
   * `addAnnotation` inverts because it adds exactly one and knows where. This
   * adds one per match, and an inverse would have to name every one of them in
   * a walk its own creation moved — `deleteFormFields`' shape without its
   * bound.
   */
  readonly markMatchesForRedaction: never;

  /**
   * A sanitise has no prior state, for `flattenFormFields`' reason one step
   * wider: the removals are catalogue subtrees whose size is the document's,
   * and flattening rewrites the content stream of every page an annotation sat
   * on.
   */
  readonly sanitizeDocument: never;

  /**
   * A signature has no prior state to record: the prior state is the unsigned
   * document, which is the whole file — and a checkpoint holds exactly that.
   */
  readonly signDocument: never;

  /**
   * A create has no prior state, and this is the one entry here where that is
   * **not** because the prior state is too large.
   *
   * It is four words: *the field called N did not exist*. What rules an inverse
   * out is measured rather than argued — a create on a document with no
   * `/AcroForm` mints one (2026-09-08), so *remove the field* restores the
   * fields and not the form, and undo is the one place a person expects
   * exactness. The checkpoint restores the bytes.
   *
   * Written out rather than pointed at its neighbours, for this table's standing
   * reason, and because the difference is the interesting part: a reader who
   * takes this for the watermark's reason would conclude that a bounded inverse
   * is impossible here, and it is merely wrong.
   */
  readonly createFormField: never;

  /**
   * The three commands that change a field that exists (ADR-0193) record no prior state, `createFormField`'s reason: an
   * edit's prior is whole dictionaries, a rename moves a field's identity, and a duplicate adds widgets to pages. The
   * checkpoint restores the bytes, which an inverse would have to carry a second copy of.
   */
  readonly editFormFields: never;
  readonly duplicateFormField: never;
  readonly setTabOrder: never;

  /**
   * An import has no prior state, for the flatten's reason at a smaller scale
   * and with one difference worth naming.
   *
   * The prior is every value of every field the imported file happens to name —
   * which the command cannot know until it has parsed the file, and which is
   * spread across the whole document rather than confined to a page. So unlike
   * the create above it really is a size argument, and unlike the flatten it is
   * a size the *file* decides rather than the document.
   */
  readonly importFormData: never;

  /** An annotation import has no prior state, for `importFormData`'s reason (ADR-0077). */
  readonly importAnnotations: never;

  /**
   * The string a text object held, and **which object puts it back**.
   *
   * {@link fillFormField}'s shape on PDFium's page-object walk, and the first
   * entry here belonging to a second engine. The reason it can be an inverse at
   * all is the same one: a replacement names ONE object, so its prior is one
   * value.
   *
   * ## The page and index travel with it, for the fill's reason and not its
   * mechanism
   *
   * A radio group made the fill's index load-bearing because the inverse acts
   * on a *different* widget. Nothing like that happens here — `FPDFText_SetText`
   * replaces the object it is given — so the honest reason is the plainer one
   * ADR-0009 §3 gives: an inverse that reached for `entry.command` to find out
   * where to write would be an inverse derived from the intent, which is the
   * one shape §3 forbids. `PriorTextObjects` therefore carries the whole
   * restoring instruction.
   *
   * ## It is STRINGS and that is why this command is not a checkpoint one
   *
   * `deletePages`, `watermarkPages` and the four `never`s above are `never`
   * because their prior is document-scaled or unserialisable. Text runs are
   * neither: each is bounded by `MAX_REPLACED_TEXT` on the way in and the list
   * by `MAX_TEXT_REPLACEMENTS`, so the entry is bounded by a **page** and not by
   * the document — which is what ADR-0039's addition of 2026-09-09 prices, and
   * it is the same bound whether the command names one run or a line's worth.
   */
  readonly replaceTextObject: PriorTextObjects;
  /**
   * The object's own matrix, put back.
   *
   * Six floats, so the entry retains nothing document-scaled. And a RESTORE
   * rather than the opposite transform, which matters past ADR-0009 §3's rule:
   * measured 2026-09-10, `FPDFPageObj_SetMatrix` of the matrix read before a
   * transform returns the bounds exactly, where an opposite transform composed
   * across repeated undo and redo accumulates floating-point drift.
   */
  readonly placePageObject: PriorPlacement;
  /**
   * One fill per object the recolour named.
   *
   * Four small integers each, bounded by the page through `MAX_EDITED_OBJECTS`.
   * `replaceTextObject`'s reasoning with a smaller prior.
   */
  readonly recolorPageObjects: PriorFills;
  /**
   * `never`, and the LIBRARY is what decides it.
   *
   * PDFium offers no way to reconstruct a page object from a description, so
   * there is no prior state that would put a removed object back — unlike the
   * four `never`s above, whose priors exist and are document-scaled. Undo takes
   * a checkpoint, which is a whole document image per entry.
   */
  readonly deletePageObjects: never;
  /**
   * `never`, and for the THIRD distinct reason on this type.
   *
   * `deletePageObjects` has no prior at all. The four above have priors that are
   * unserialisable. This one's prior exists, serialises cleanly, and is
   * **document-scaled** — every object the replacement changed, with the string
   * it held — which is exactly what an invertible entry may not retain.
   */
  readonly replaceAllText: never;
  /** The one object `replaceTextAt` picked, with the string it held: `replaceTextObject`'s prior, for its reason. */
  readonly replaceTextAt: PriorTextObjects;
  /**
   * `never`, and it is the FIRST reason on this type reached from the far end.
   *
   * `deletePageObjects` has no prior because PDFium can describe an object and
   * not rebuild one. A promotion's prior would be a **Form XObject and its
   * placement**, and PDFium can take a form apart and offers nothing that
   * constructs one — so every piece survives on the page and the container is
   * what cannot be put back.
   */
  readonly promoteFormObjects: never;
  /**
   * `never`, `deletePageObjects`' reason: a block edit makes and removes
   * objects, and PDFium cannot rebuild a removed one. The old strings alone
   * would undo the text and keep the lines (ADR-0096 Decision 6).
   */
  readonly editTextBlock: never;
  /** A checkpoint until Decision 7's prior lands (ADR-0176). */
  readonly editTextOperators: never;
}

/**
 * What a capture returns: the prior state, or a stated reason it could not be
 * taken.
 *
 * **Not an exception**, and the difference is the ADR decision of 2026-08-19.
 * "This command is invertible in general and is not on this document" is an
 * ordinary outcome the bus handles by taking a checkpoint instead — so it is a
 * value in the type, where the caller cannot fail to consider it, rather than a
 * throw the caller may or may not catch.
 *
 * A genuinely invalid command still throws. An out-of-range page index and a
 * forged session are not documents the log can route around; they are callers
 * getting it wrong, and they must not be quietly converted into checkpoints.
 */
export type CaptureResult<T> =
  | { readonly captured: true; readonly prior: T }
  | { readonly captured: false; readonly reason: string };

/**
 * One entry, in one of exactly two shapes, both carrying what the apply was
 * handed.
 *
 * Distributed over the kind union, so `command` and `inverse` are the same
 * command's — an entry pairing a `rotatePages` command with another command's
 * prior state does not compile.
 *
 * ## `read` is on BOTH shapes, and that is the point of it
 *
 * [ADR-0051](../../../docs/DECISIONS/0051-a-pre-read-may-be-parameterised-and-a-stored-effect-replays-it.md)
 * Decision 2. A command declaring `replay: 'stored-effect'` may not have its
 * pre-read resolved again on redo, so the value it was applied with is recorded
 * here — and putting it on one shape only would make
 * `{ invertible: true, reproducible: false }` a combination the axes permit and
 * the log cannot express, which is a gap nothing would report until somebody
 * declared it. `retainedBytes` and `trimTo` still classify on two states, so
 * there is no third one for them to miss either (DDD-1).
 *
 * **Required and nullable rather than optional.** `trimTo`'s own rule: *an
 * obligation that arrives as an absent value is one a caller forgets to check* —
 * so every construction site says what it is, and `undefined` means *this
 * command's replay re-reads, so nothing was kept*. It is not stored for a
 * `reapply-intent` command even where one has a pre-read, because `generateToc`'s
 * outline is document-scaled and storing it per entry would put a copy of every
 * bookmark in the log for a value redo must re-read anyway.
 */
export type LogEntryFor<K extends CommandKind> =
  | {
      readonly kind: 'invertible';
      /** The command whole, or its kind alone where the bus holds it ({@link RecordedCommand}). */
      readonly command: RecordedCommand<K>;
      /** The prior state, or a marker where the bus holds it ({@link RecordedInverse}). */
      readonly inverse: RecordedInverse<K>;
      /** What the apply was handed, where replay may not read it again. */
      readonly read: PreReadValue | undefined;
    }
  | {
      readonly kind: 'terminal';
      /**
       * The command whole, or its kind alone for a command whose intent the bus holds beside the entry
       * ({@link RecordedCommand}).
       */
      readonly command: RecordedCommand<K>;
      readonly checkpoint: Checkpoint;
      /** Why no inverse could be recorded. Carried so undo can explain itself. */
      readonly reason: string;
      /** What the apply was handed, where replay may not read it again. */
      readonly read: PreReadValue | undefined;
      /** Redo re-runs the command: this entry's effect is not its result. */
      readonly result: null;
    }
  | {
      readonly kind: 'terminal';
      /**
       * THE KIND AND NOTHING ELSE (ADR-0162): a command declared `stored-result` is redone from {@link result}, so
       * nothing re-runs it, and a credential it was applied with has no field to be recorded in. A redo or a replay
       * that reached for the command to re-apply does not compile.
       */
      readonly command: { readonly kind: K };
      readonly checkpoint: Checkpoint;
      /** Why no inverse could be recorded. Carried so undo can explain itself. */
      readonly reason: string;
      /** Nothing is re-applied, so nothing the apply was handed is kept. */
      readonly read: undefined;
      /** The image the apply produced, which redo installs: a whole document on disk, as the checkpoint is. */
      readonly result: Checkpoint;
    };

/**
 * What a re-runnable terminal entry keeps of its command: the command whole, or **the kind alone** for a command
 * declaring `replay: 'reapply-held-intent'`
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 3).
 *
 * The kind alone, not the command with its passwords taken out: a protect without them is still a valid protect, one
 * that writes no password, so a redo that re-ran it would compile and weaken the document. `{ kind }` is not a
 * command, so a caller reaching for it to re-run does not compile, and the bus's held table is the only source.
 *
 * On BOTH re-runnable shapes, though the one command declaring it today is terminal: which shape an entry takes is
 * decided by its capture at run time, and where the intent is kept is decided by the declaration, so neither may
 * assume the other.
 */
export type RecordedCommand<K extends CommandKind> = K extends CommandKind
  ? // DISTRIBUTED over `K` by the outer test, so `RecordedCommand<CommandKind>` is each kind's answer united rather
    // than one answer for the whole union, which would be `CommandOfKind` for every kind.
    DeclaredCommands[K]['replay'] extends 'reapply-held-intent'
    ? { readonly kind: K }
    : CommandOfKind<K>
  : never;

/**
 * What an invertible entry keeps of its prior state: the prior whole, or {@link HeldInverse} for a command whose intent
 * is held ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md)
 * Decision 8).
 *
 * Decided by the same declaration as {@link RecordedCommand}, because the reason is the same: a protect's prior is the
 * protection before it, and a second protect's prior is the first one's passwords. The bus keeps the prior beside the
 * entry with the command, and an entry built with the prior in it does not compile.
 */
export type RecordedInverse<K extends CommandKind> = K extends CommandKind
  ? DeclaredCommands[K]['replay'] extends 'reapply-held-intent'
    ? HeldInverse
    : CommandPrior[K]
  : never;

/** The marker a held entry keeps where its prior would be. It has no field a prior could be written in. */
export interface HeldInverse {
  readonly held: true;
}

/**
 * Any entry, as the log holds them.
 *
 * A mapped type collapsed to its own union rather than `LogEntryFor<CommandKind>`
 * — the second would let a `rotatePages` command pair with another command's
 * prior state, because the two type arguments would be resolved independently.
 */
export type LogEntry = { readonly [K in CommandKind]: LogEntryFor<K> }[CommandKind];

/**
 * The document-scaled files an entry holds: none for an invertible entry, its checkpoint for a terminal one, and its
 * result beside it where it was redone from one (ADR-0162).
 *
 * ONE RULE for every reader that counts or keeps them, `retainedBytes`, `checkpointPaths` and `trimTo`, so a file a
 * new shape adds cannot be retained by one and missed by another.
 */
export function filesOf(entry: LogEntry): readonly Checkpoint[] {
  if (entry.kind !== 'terminal') return [];
  return entry.result === null ? [entry.checkpoint] : [entry.checkpoint, entry.result];
}

/**
 * What a lane entry may ask of the log without holding the bus's capability.
 *
 * Queries only. "Is there anything to undo" is a fair question for any work
 * running in the lane; recording an entry or moving the cursor is not, because
 * an entry recorded without an applied command makes undo reverse a change the
 * document never received.
 */
/**
 * What a retention trim discarded.
 *
 * Always returned, never `undefined` for *nothing happened*. Invariant 18
 * obliges the caller to tell the user when history was shortened, and an
 * obligation that arrives as an absent value is one that gets skipped by a
 * caller writing `if (trim)`.
 */
export interface LogTrim {
  /** Entries the user can no longer reach, applied and redo tail together. */
  readonly droppedEntries: number;
  /** Document-scaled bytes reclaimed. Zero when only invertible entries went. */
  readonly droppedBytes: number;
}

export interface ReadonlyCommandLog {
  readonly entries: readonly LogEntry[];
  readonly redoDepth: number;
  /** Document-scaled bytes retained, cursor position irrelevant. */
  retainedBytes(): number;
  /** Every checkpoint file retained, by path — `retainedBytes`' set (ADR-0121). */
  checkpointPaths(): ReadonlySet<string>;
  /** How long a held file is now, a resealed one included (ADR-0171 Decision 8). */
  bytesOf(file: CheckpointFile): number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  peekRedo(): LogEntry | undefined;
  /** The applied entries the next undo takes back together, and the entries the next redo applies together (ADR-0200). Queries. */
  lastStep(): readonly LogEntry[];
  nextStep(): readonly LogEntry[];
  /** How many applied entries the canonical image includes (ADR-0115). */
  readonly imageHolds: number;
  /** The applied entries the canonical image does not include, oldest first (ADR-0115). */
  readonly pastImage: readonly LogEntry[];
}

/**
 * The log and its cursor.
 *
 * The cursor is a count of **applied** entries, not an index, so "nothing
 * applied" is `0` rather than `-1` and there is no off-by-one to get wrong at
 * either end.
 */
export class CommandLog implements ReadonlyCommandLog {
  /** @internal */
  readonly #entries: LogEntry[] = [];
  /** The held files rewritten in place since they were recorded, by path, and their length now ({@link resealed}). */
  readonly #resealed = new Map<string, number>();

  /** The entries recorded as joining the one before them (ADR-0200): by identity, so a trim that shifts positions moves nothing. */
  readonly #joined = new WeakSet<object>();

  /** How many entries are currently applied. */
  #applied = 0;

  /**
   * How many of the applied entries `main`'s canonical image already includes — THE BASE a rebuilt session replays
   * from ([ADR-0115](../../../docs/DECISIONS/0115-a-rebuilt-session-replays-what-the-image-does-not-hold.md)).
   *
   * Here and not beside the log, because {@link trimTo} sheds the oldest entries and shifts every position: a base
   * kept elsewhere would point at a different entry after the first trim, and nothing would say so. Never above
   * `#applied`: the bus refreshes the image on an undo that would step below it, and a trim never sheds past it.
   */
  #imageHolds = 0;

  /** Entries that are applied right now, oldest first. */
  get entries(): readonly LogEntry[] {
    return this.#entries.slice(0, this.#applied);
  }

  /** How many applied entries the canonical image includes. See {@link #imageHolds}. */
  get imageHolds(): number {
    return this.#imageHolds;
  }

  /**
   * The applied entries the canonical image does NOT include, oldest first — exactly what a session opened from that
   * image must re-apply to agree with this log again.
   */
  get pastImage(): readonly LogEntry[] {
    return this.#entries.slice(this.#imageHolds, this.#applied);
  }

  /**
   * The canonical image now includes every applied entry: called by the bus, after the log has moved, whenever an
   * operation replaced the image.
   */
  imageIsCurrent(): void {
    this.#imageHolds = this.#applied;
  }

  /** How many entries could be redone — the tail the cursor has stepped back over. */
  get redoDepth(): number {
    return this.#entries.length - this.#applied;
  }

  /**
   * Document-scaled bytes this log is holding, checkpoints included — ON DISK since ADR-0121, so this is what the
   * retention rule sheds against, and `DocumentService`'s memory figure no longer adds it.
   *
   * ## Why the log answers this rather than the caller summing `entries`
   *
   * **`entries` is the APPLIED view, and memory does not care about the
   * cursor.** Undo steps the cursor back and never pops, so a checkpoint in the
   * redo tail is invisible to `entries` and is still in the process. A caller
   * summing what it can see would under-report by exactly the amount an undo
   * just made invisible — the wrong direction, and undetectable from outside.
   *
   * So the log reports what it physically retains, which is the only question
   * `DocumentService`'s ceiling is asking.
   *
   * Only checkpoints are document-scaled. An invertible entry's `inverse` is a
   * `CommandPrior` — for `rotatePages`, one small record per page — and counting
   * it would put a rounding error into a figure compared against a budget.
   */
  retainedBytes(): number {
    let total = 0;
    for (const entry of this.#entries) {
      for (const file of filesOf(entry)) total += this.bytesOf(file);
    }
    return total;
  }

  /**
   * How long a held file is now: its recorded length, or what {@link resealed} recorded since
   * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 8).
   * The one answer, so the budget, a trim's report and a restore's count cannot disagree about one file.
   */
  bytesOf(file: CheckpointFile): number {
    return this.#resealed.get(file.path) ?? file.byteLength;
  }

  /**
   * Records that a held file was rewritten in place, encrypted under a protect's terms, and how long it is now. The
   * entry keeps its identity, which the bus's held table and the protect's positions are keyed by. Refuses a path the
   * log does not hold, since recording a length for a file nothing references would count bytes nobody keeps.
   */
  resealed(path: string, byteLength: number): void {
    if (!this.checkpointPaths().has(path)) {
      throw new Error('a resealed file must be one this log holds; this one is not.');
    }
    this.#resealed.set(path, byteLength);
  }

  /**
   * Every checkpoint file the log still holds, the redo tail included — `retainedBytes`' set, by path.
   *
   * **ON DISK since ADR-0121**, so a checkpoint the log lets go of — trimmed, or discarded with a redo tail a new
   * command replaced — is a file nothing references. `DocumentService` deletes the files of a document's directory
   * that are not in this set, after every lane entry: one rule for every way an entry leaves, rather than a deletion
   * at each place one can.
   */
  checkpointPaths(): ReadonlySet<string> {
    const paths = new Set<string>();
    for (const entry of this.#entries) {
      for (const file of filesOf(entry)) paths.add(file.path);
    }
    return paths;
  }

  /**
   * Sheds retained bytes until the log holds no more than `target`, and reports
   * what that cost.
   *
   * ## Dropping a checkpoint ENDS UNDO PAST IT, and that is the whole design
   *
   * A terminal entry is terminal for not being invertible, so undo cannot step
   * over one without the checkpoint it carries. Discarding that checkpoint
   * therefore makes every entry at or before it unreachable — not merely
   * unhelpful — which is why they go with it rather than being left in place
   * as a history nothing can walk. Keeping them would report a `canUndo` that
   * lies, which is worse than a shorter history.
   *
   * §4 says memory is *"one document plus a few checkpoints"*. This is *a few*
   * being enforced, and the number is not written here: the caller computes the
   * target from `DocumentService`'s ceiling, which §9.17 is the writer of record
   * for. A constant in this file would be a second policy for one concern.
   *
   * ## The REDO tail goes first, and that ordering is the only choice made here
   *
   * Both ends are the user's work and neither loss is free. A redo entry is work
   * they have already stepped back from; an undo entry is the path back to where
   * they are. So the tail is shed newest-first before any applied history is
   * touched — strictly less bad, and the alternative is not neutral: a
   * front-first walk destroys the history the user is standing on while holding
   * speculative entries behind them.
   *
   * **That ordering was UNREACHABLE through the bus and became reachable on
   * 2026-09-04**, which is the day this half stopped being documentation and
   * started being a mechanism. A redo tail can only hold a checkpoint if undo
   * stepped over a terminal entry, and `CommandBus.undo` used to refuse exactly
   * that. It now restores the entry's checkpoint and steps the cursor
   * ([ADR-0037](../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)),
   * so a terminal entry sitting in the redo tail is an ordinary state and a
   * trim that walked front-first would now discard applied history while
   * holding it.
   *
   * It was kept while unreachable on the argument that deleting it would be
   * correct for that tree and wrong the day clause (ii) landed, silently, in a
   * file nobody would be reading. That day arrived, and what changed with it is
   * the **obligation**: a branch nothing can reach owes no case, and this one
   * now owes one. `commandBus.test.ts` carries it, in the retention block —
   * this log's cases live there because reaching the state needs a bus.
   *
   * ## Invariant 18: this must never be silent
   *
   * A silently shortened history is work quietly becoming unrecoverable. The
   * return value is not a diagnostic — it is what the caller is obliged to tell
   * the user with, which is why a trim that dropped nothing is `0` rather than
   * `null`: an obligation that arrives as an absent value is one a caller
   * forgets to check.
   *
   * @param target the most this log may retain, in document-scaled bytes
   */
  trimTo(target: number): LogTrim {
    let droppedEntries = 0;
    let droppedBytes = 0;

    const shed = (entries: readonly LogEntry[]): void => {
      droppedEntries += entries.length;
      for (const entry of entries) {
        for (const file of filesOf(entry)) {
          droppedBytes += this.bytesOf(file);
          this.#resealed.delete(file.path);
        }
      }
    };

    // THE REDO TAIL, newest first, and ONLY while there is a checkpoint in it.
    //
    // The guard is not an optimisation. An invertible entry retains no
    // document-scaled bytes, so popping one reclaims nothing — and a loop
    // keyed on `retainedBytes() > target` alone would empty a checkpoint-free
    // tail entirely, discard the user's redo history, and still be over the
    // target. Pure loss for no gain, which is the worst thing a shedding rule
    // can do. Popping invertible entries that sit *in front of* a checkpoint is
    // different: they are in the tail being discarded anyway.
    const tailHoldsCheckpoint = (): boolean =>
      this.#entries.slice(this.#applied).some((entry) => entry.kind === 'terminal');
    while (this.retainedBytes() > target && tailHoldsCheckpoint()) {
      const removed = this.#entries.pop();
      if (removed === undefined) break;
      shed([removed]);
    }

    // Then the applied history, oldest first, in terminal-bounded chunks: the
    // entries before a checkpoint cannot be reached once it is gone.
    while (this.retainedBytes() > target) {
      const oldest = this.#entries.findIndex((entry) => entry.kind === 'terminal');
      // NOT AN ERROR AND NOT A LOOP. Nothing document-scaled is left, so the
      // target cannot be met by shedding — the remaining entries are invertible
      // and hold no checkpoint. The caller's ceiling is then exceeded by the
      // canonical images alone, which is a different problem with a different
      // answer (refusing the next open) and not one to solve by deleting undo.
      if (oldest === -1) break;
      // NEVER PAST THE BASE (ADR-0115). An applied entry the canonical image does not include exists nowhere else: shed
      // it and a host death loses its effect with nothing left to replay. The log stays over its target instead, which
      // is the case above in a different shape — a budget question, never a correctness one.
      if (oldest + 1 > this.#imageHolds) break;
      const removed = this.#entries.splice(0, oldest + 1);
      shed(removed);
      this.#applied = Math.max(0, this.#applied - removed.length);
      this.#imageHolds -= removed.length;
    }

    return { droppedEntries, droppedBytes };
  }

  get canUndo(): boolean {
    return this.#applied > 0;
  }

  get canRedo(): boolean {
    return this.redoDepth > 0;
  }

  /**
   * Records a newly applied entry, **truncating the redo tail first**.
   *
   * §4: a new command truncates the tail. Keeping it would let redo replay a
   * command against a document that has since diverged, which is a corrupted
   * document rather than a surprising undo history.
   *
   * ## GENERIC IN THE KIND, which one command could not reveal
   *
   * This took `LogEntry` until 2026-09-03 and the bus passes `LogEntryFor<K>`
   * for a generic `K`. Those are the same type when `CommandKind` has one
   * member and are **not** when it has two: for an unresolved `K`,
   * `CommandOfKind<K>` is assignable to no single union member, so the whole
   * entry is assignable to none of them.
   *
   * The signature was correct-by-accident, and the second command is what said
   * so. A cast at the call site would have been the workaround — the value
   * genuinely is a `LogEntry` for every concrete `K`, which is exactly the kind
   * of true statement that hides a signature saying less than it means.
   *
   * ## The one narrowing, and why it is HERE rather than at the callers
   *
   * `LogEntryFor<K>` with an unresolved `K` is assignable to no member of the
   * distributed union, and TypeScript has no way to say *this is one of them,
   * whichever K turns out to be*. Something has to assert it.
   *
   * Asserting it once, at the single point where an entry enters storage, means
   * every caller keeps a signature that says what it means. The alternative is
   * a cast at each call site — which is the same unsoundness spread over more
   * places, each of which would have to re-derive why it is safe. Both the
   * `command` and the `inverse` come from the same `K` by construction, which
   * is the property `LogEntryFor` exists to enforce and the reason this is safe
   * rather than convenient.
   */
  record<K extends CommandKind>(entry: LogEntryFor<K>, joinsPrevious = false): void {
    this.#entries.length = this.#applied;
    // JOINED ONLY WHERE THERE IS AN ENTRY TO JOIN (ADR-0200): the first entry of a log, or of what a trim left, is a step's head.
    if (joinsPrevious && this.#applied > 0) this.#joined.add(entry);
    this.#entries.push(entry as LogEntry);
    this.#applied += 1;
    // A RESEALED FILE THE TRUNCATED TAIL HELD leaves with it, so the map only ever names files this log holds.
    const held = this.checkpointPaths();
    for (const path of this.#resealed.keys()) if (!held.has(path)) this.#resealed.delete(path);
  }

  /**
   * Steps the cursor back and returns the entry that was undone.
   *
   * **Never pops.** The entry stays so redo can step forward over it, which is
   * the whole difference between this and a stack. Returns `undefined` at the
   * start of the log rather than throwing: "nothing to undo" is a state the UI
   * asks about constantly, not an error.
   */
  undo(): LogEntry | undefined {
    if (!this.canUndo) return undefined;
    this.#applied -= 1;
    return this.#entries[this.#applied];
  }

  /**
   * The entry redo would step forward over, **without moving the cursor**.
   *
   * The bus needs to know what it is about to re-apply before it commits to
   * moving: a redo that refuses — a stored-effect command — must leave the
   * cursor exactly where it was, and a `redo()` that moves first would have to
   * move back on failure. Two mutations of one field is how a cursor drifts.
   */
  peekRedo(): LogEntry | undefined {
    return this.canRedo ? this.#entries[this.#applied] : undefined;
  }

  /**
   * The applied entries the next undo takes back together, oldest first: the last applied entry and, going back, each
   * entry it joined (ADR-0200). One entry for anything that joined nothing. Empty only for an empty log.
   *
   * An entry at the front of the log is a head whatever it joined, because what it joined was shed: its own checkpoint is
   * the document as it was after the shed entries, so undoing it with the entries that joined IT is still coherent.
   */
  lastStep(): readonly LogEntry[] {
    let from = this.#applied - 1;
    if (from < 0) return [];
    while (from > 0 && this.#joins(from)) from -= 1;
    return this.#entries.slice(from, this.#applied);
  }

  /** Whether the entry at `index` was recorded as joining the one before it. */
  #joins(index: number): boolean {
    const entry = this.#entries[index];
    return entry !== undefined && this.#joined.has(entry);
  }

  /** The entries the next redo applies together, oldest first, by {@link lastStep}'s rule: the first redo entry and each that joined. */
  nextStep(): readonly LogEntry[] {
    if (!this.canRedo) return [];
    let to = this.#applied + 1;
    while (to < this.#entries.length && this.#joins(to)) to += 1;
    return this.#entries.slice(this.#applied, to);
  }

  /** Steps the cursor forward and returns the entry to re-apply. */
  redo(): LogEntry | undefined {
    if (!this.canRedo) return undefined;
    const entry = this.#entries[this.#applied];
    this.#applied += 1;
    return entry;
  }
}

// A `isKind(entry, 'rotatePages')` narrowing helper was written here and
// deleted: with one command kind the comparison is always true, and lint said
// so. A guard that cannot fail is the vacuous shape, and there is no caller for
// it — the second command kind is when it becomes a check rather than a shape.
