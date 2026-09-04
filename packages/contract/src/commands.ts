import { z } from 'zod';

/**
 * Every mutation the renderer can ask for, declared **once** (ADR-0009 §6).
 *
 * A zod discriminated union with the TypeScript type inferred from it, so the
 * wire schema and the type cannot drift — there is no second declaration to
 * forget to update.
 *
 * Commands are **intent**, not payload. `deletePages([3, 5])` is the same size
 * whether the document is 2 pages or 20,000 (invariant L11); any design where
 * the bytes crossing scale with document size per operation is wrong.
 *
 * **Inverses are deliberately absent from this file.** They stay kernel-only:
 * they carry structural prior state the renderer must not see, and a
 * renderer-supplied inverse would let the UI dictate undo (§6).
 */

/**
 * Rotate pages by a quarter turn multiple.
 *
 * `quarterTurns` rather than degrees, and the reason is a measured engine
 * behaviour rather than taste: **MuPDF stores `/Rotate 45` verbatim**, so a
 * degrees-typed command lets an arbitrary angle reach the page tree, where the
 * PDF specification permits only multiples of 90. The kernel normalises before
 * writing; making the wire type incapable of carrying 45 means it never has to
 * reject one.
 *
 * The *inverse* is a different matter and is not constrained to quarter turns —
 * §3 requires prior state restored **verbatim**, so a page that arrived
 * carrying a raw `45` must come back carrying `45`, not a tidied `0`.
 */
export const rotatePagesSchema = z.object({
  kind: z.literal('rotatePages'),
  /** Zero-based page indices. */
  pages: z.array(z.number().int().nonnegative()).min(1),
  /** Clockwise quarter turns. 0 is not a command; it is a no-op with a log entry. */
  quarterTurns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

/**
 * The command union.
 *
 * Adding a kind here is what makes the routing table below incomplete, which is
 * a compile error — see `commandSpecs.ts`. That is the mechanism: a new command
 * cannot be added without routing it and without declaring both of §3a's axes.
 */
/**
 * Show or hide one optional-content group.
 *
 * ## A COMMAND, not a view setting, and the distinction is where it is stored
 *
 * A layer's visibility lives in the document — `/OCProperties`' default
 * configuration — so turning one off and saving produces a file that opens with
 * it off, in every other reader. That makes it a mutation, and a mutation goes
 * through the bus with a capture and an inverse like every other one. A toggle
 * held in renderer state would render correctly and vanish on save, which is
 * the wired-tools rule's own example of a control that does not survive.
 *
 * ## The layer is named by INDEX, which is its position in `/OCGs`
 *
 * Naming a layer by its title instead would need a second opinion about which
 * layer a title means — two layers may share one — and would put this build in
 * the business of resolving that.
 *
 * **The index is NOT MuPDF's layer index**, and the difference is measured
 * rather than notional: a document listing *Visible* then *Hidden* in `/OCGs`
 * is reported by `countLayers`/`getLayerName` with Hidden at 0
 * (`layers.test.ts`, 2026-09-03). This said the opposite until the same day's
 * round-trip case showed that MuPDF's layer API writes session state a save
 * does not carry, so the whole command moved to the object tree — see
 * `layers.ts`, which is the one place either enumeration is read.
 */
export const setLayerVisibilitySchema = z.object({
  kind: z.literal('setLayerVisibility'),
  /** The layer's position in `/OCProperties/OCGs`. */
  layer: z.number().int().nonnegative(),
  /** What it becomes. The inverse carries what it was. */
  visible: z.boolean(),
});

/**
 * Move one page to another position.
 *
 * ## A MOVE, not a permutation, and invariant 11 is why
 *
 * The obvious shape for reorder is the one the spike's reference implementation
 * takes: `permutation: number[]`, a source index for every destination slot.
 * **That is a payload that scales with the document** — 20,000 numbers for a
 * 20,000-page file, on every drag — which is exactly the design §2 rules out:
 * *"any design where payload size scales with document size per operation is
 * wrong."*
 *
 * A move is two integers whatever the document. The kernel derives the full
 * permutation from them, on the side that holds the document anyway, so nothing
 * is lost but the crossing.
 *
 * It also removes a shape the permutation form cannot police: `rearrangePages`
 * semantics make an omitted index a **deletion**, so a permutation that is
 * short by one silently deletes a page. A move cannot express that. B5 —
 * the illegal state is unrepresentable rather than validated.
 *
 * ## `from` and `to` are both destination-frame indices
 *
 * `to` is where the page ends up in the finished document, not a slot in the
 * original. Those differ whenever `to > from`, and the difference is an
 * off-by-one that renders plausibly: moving page 0 to index 2 of a five-page
 * document gives `1 2 0 3 4`, not `1 2 3 0 4`. Stated here because the two
 * readings are equally natural and only one of them is what a reader dragging a
 * thumbnail onto a gap means.
 */
export const movePageSchema = z.object({
  kind: z.literal('movePage'),
  /** Zero-based index of the page to move. */
  from: z.number().int().nonnegative(),
  /** Zero-based index it occupies afterwards. */
  to: z.number().int().nonnegative(),
});

/**
 * Remove pages from the document.
 *
 * ## The indices are all in the ORIGINAL frame, and all removed at once
 *
 * `deletePages([1, 3])` removes the pages that are at 1 and 3 **now**, not the
 * page at 1 followed by whatever slid into 3. The two readings differ on every
 * multi-page delete and both render plausibly, so the frame is stated rather
 * than left to whoever writes the loop — this file's header already makes the
 * same statement about `movePage`'s two indices, for the same reason.
 *
 * Applying them one at a time in the kernel is the shape that has the bug: it
 * needs each later index shifted by how many earlier ones were removed, which
 * is arithmetic a reader has to re-derive at every call site. The kernel builds
 * one keep-set instead, so the order the indices arrive in cannot matter.
 *
 * ## Duplicates are accepted and a delete of everything is refused
 *
 * A repeated index is the same page named twice, which is a set operation with
 * an obvious answer, and refusing it would make a UI that gathers a selection
 * responsible for de-duplicating it. **A document with no pages is a different
 * matter**: it is not a PDF a reader can open, and the refusal cannot live in
 * this schema because it needs the page count. It is the kernel's, stated in
 * `pageOrder.ts` and thrown before anything is written.
 */
export const deletePagesSchema = z.object({
  kind: z.literal('deletePages'),
  /** Zero-based page indices, in the document as it stands. */
  pages: z.array(z.number().int().nonnegative()).min(1),
});

/**
 * Duplicate one page, placing the copy immediately after it.
 *
 * ## The destination is not a parameter, and that is a decision
 *
 * *Duplicate and put it somewhere* is two operations, and this build already
 * has the second: `movePage`. A `to` here would let one command express a
 * duplicate-and-move whose undo is a single step, which is a different feature
 * — and one whose inverse has to know which of the two halves to reverse.
 *
 * The copy lands **after** the source because that is where every application
 * this one replaces puts it, and because the alternative — after the last
 * page — makes the result invisible on a long document.
 */
export const duplicatePageSchema = z.object({
  kind: z.literal('duplicatePage'),
  /** Zero-based index of the page to copy. */
  page: z.number().int().nonnegative(),
});

/**
 * Exchange two pages.
 *
 * ## Not two moves, and not one move
 *
 * Two `movePage` commands put an intermediate document in the log and cost the
 * reader two presses of undo for one intent. One move is a *different*
 * operation: moving page 0 to index 3 of `0 1 2 3` gives `1 2 3 0`, where
 * swapping them gives `3 1 2 0`. They coincide only for adjacent pages, which
 * is exactly the case a reader tries first and the reason this needs its own
 * kind rather than a clever call site.
 *
 * ## `a` and `b` are interchangeable, and that is a property of the operation
 *
 * The permutation is symmetric, so the command carries no notion of source and
 * destination and neither does its inverse — a transposition is its own
 * inverse. `movePage`'s comment warns that its inverse is *not* the transposed
 * move; the difference is that nothing else shifts here.
 */
export const swapPagesSchema = z.object({
  kind: z.literal('swapPages'),
  /** Zero-based index of one page. */
  a: z.number().int().nonnegative(),
  /** Zero-based index of the other. */
  b: z.number().int().nonnegative(),
});

/**
 * Insert an empty page.
 *
 * ## No size on the wire, and that is a decision rather than a gap
 *
 * The new page takes the geometry of the page it follows — its `/MediaBox`,
 * `/CropBox` and `/Rotate` — which is what every application this one replaces
 * defaults to and the only default that cannot be wrong for a document of one
 * size. A width and a height here would be a **renderer-supplied geometry**,
 * and the renderer's coordinate spaces are branded precisely so a bare pair of
 * numbers cannot travel as a page box (invariant L3).
 *
 * Choosing a *different* size — A4 into a Letter document — is a separate
 * feature with a dialog, and it arrives as a second field on this command
 * rather than as a second command. Stated so the absence reads as a decision.
 *
 * `at` is where the new page ends up, so `at: 0` puts it first and
 * `at: pageCount` appends. That is the destination frame `movePage`'s own `to`
 * uses, and stating it here is what keeps the two from disagreeing.
 */
export const insertBlankPageSchema = z.object({
  kind: z.literal('insertBlankPage'),
  /** Zero-based index the new page occupies afterwards. */
  at: z.number().int().nonnegative(),
});

export const commandSchema = z.discriminatedUnion('kind', [
  rotatePagesSchema,
  setLayerVisibilitySchema,
  movePageSchema,
  deletePagesSchema,
  duplicatePageSchema,
  swapPagesSchema,
  insertBlankPageSchema,
]);

export type Command = z.infer<typeof commandSchema>;
export type CommandKind = Command['kind'];

/** Narrows the union to one member, for a spec's `apply` signature. */
export type CommandOfKind<K extends CommandKind> = Extract<Command, { kind: K }>;
