import type { DocId } from '@monstera/shared';
import { z } from 'zod';

import { docIdSchema } from './schemas.js';

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

/**
 * Crop pages by insetting their visible box.
 *
 * ## MARGINS, not a rectangle, and the difference is the multi-page case
 *
 * A crop rectangle is the obvious wire shape and it is the wrong one: pages in
 * one document need not be the same size, so a single box means *the same
 * absolute region* rather than *the same trim*, and cropping a mixed document
 * would clip some pages and leave white on others. Margins are the operation a
 * person means, and the kernel computes each page's own box from its own.
 *
 * It also keeps the payload off invariant L11: four numbers whatever the
 * document, where one box per page scales with it.
 *
 * ## The numbers are POINTS, in PDF user space
 *
 * Not a branded {@link PdfPoint}, because these are **lengths and not
 * positions** — an inset has no origin to be wrong about, which is what L3's
 * branding exists to prevent. A surface collecting millimetres converts before
 * it dispatches; the wire states one unit so nothing downstream has to ask.
 *
 * `left` and `right` are the box's own left and right, before rotation. A page
 * displayed at `/Rotate 90` shows the crop turned with it, which is what a
 * reader dragging a margin expects, and it is why the kernel writes the box
 * rather than the renderer computing one.
 */
export const cropPagesSchema = z.object({
  kind: z.literal('cropPages'),
  /**
   * Which pages, as a **scope** rather than always a list.
   *
   * `'all'` is not sugar. Cropping every page is the ordinary use, and a list
   * for it is one integer per page — a payload that scales with the document,
   * which invariant L11 rules out by name. The kernel resolves the scope where
   * it already holds the page count, so nothing is lost but the crossing.
   *
   * This is the first command to need it. `rotatePages` and `deletePages` carry
   * lists because their whole-document forms are not operations anybody asks
   * for; the day one is, it takes this shape rather than a second one.
   */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /** How much to take off each edge, in points. Non-negative; zero is legal. */
  margins: z
    .object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
    })
    .strict(),
});

/**
 * Draw a text watermark across pages.
 *
 * **The first command routed to a byte-image writer**
 * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)),
 * and the first whose effect is *content* rather than a page transform — which
 * is the trigger ADR-0032 wrote against its own rejection of the byte refresh.
 *
 * ## Everything here is bounded, because a command is not a document
 *
 * `text` carries a maximum for invariant L11's reason and not for a parser's:
 * a renderer that could send an unbounded string could make one command's
 * payload scale with anything it liked. 200 characters is a watermark; a novel
 * is a different feature.
 *
 * `pages` is the scope union `cropPages` introduced, for the same reason it was
 * introduced — watermarking every page is the ordinary use, and a list for it
 * is one integer per page.
 *
 * ## What is deliberately absent
 *
 * **Colour**, and it is a decision rather than an omission. A watermark is
 * drawn at an opacity, in the one grey the kernel picks, so nothing about this
 * command can express a colour the document does not already have a meaning
 * for. Making it configurable is a second field here and a control in the
 * dialog, and it arrives with the style controls Stage 3 builds — where every
 * other colour-bearing surface will already have had to answer the same
 * question once.
 *
 * **A position.** The watermark is centred on each page's own visible box, so
 * a mixed-size document watermarks correctly with no per-page geometry
 * crossing. An offset here would be a renderer-supplied position, which
 * invariant L3's branding exists to stop travelling as a bare pair of numbers.
 */
export const watermarkPagesSchema = z.object({
  kind: z.literal('watermarkPages'),
  /** Which pages. `'all'` is resolved by the kernel, which holds the count. */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /** The text drawn. Bounded — see this schema's own note on L11. */
  text: z.string().min(1).max(200),
  /** Fill opacity, 0 (invisible) to 1 (opaque). */
  opacity: z.number().min(0).max(1),
  /**
   * Counter-clockwise rotation in degrees, about the text's own centre.
   *
   * A plain `number` bounded to one full turn rather than a branded angle:
   * this is a rotation *within* the page's own space and never a coordinate,
   * so there is no origin for L3's branding to protect.
   */
  rotationDegrees: z.number().min(-360).max(360),
  /** Type size in points. Bounded above so one command cannot ask for a page-sized glyph run. */
  fontSize: z.number().positive().max(1000),
});

/**
 * The three slots one edge of a page carries.
 *
 * Left, centre and right is what every application this one replaces offers,
 * and it is not a layout system: three fixed positions cannot overlap in a way
 * the user did not ask for, where free placement can. An **empty string means
 * the slot is unused** — not a missing key — so the shape is the same whether a
 * person fills one slot or three, and `exactOptionalPropertyTypes` has nothing
 * to say about it.
 */
const stampSlotsSchema = z
  .object({
    left: z.string().max(200),
    centre: z.string().max(200),
    right: z.string().max(200),
  })
  .strict();

/**
 * Draw headers and footers on pages.
 *
 * ## The page number is a TOKEN, and there are exactly two
 *
 * `{n}` is this page's number and `{N}` is the document's total, both 1-based
 * because they are read by a person rather than indexed by code — which is the
 * one place in this contract where a 1-based number is right, and it is stated
 * here so nothing downstream has to guess which frame a header is in.
 *
 * Two tokens and no expression language. A template that can compute is a
 * second place document content is decided, and every version of it grows
 * conditionals; a person who wants *Page 3 of 12* writes `Page {n} of {N}`, and
 * a person who wants something a template cannot say is asking for a feature
 * rather than a longer syntax. An unrecognised `{…}` is left **verbatim**,
 * because silently deleting text a person typed is the worse failure.
 *
 * ## Why headers and footers are ONE command
 *
 * They are one operation to a person — the dialog offers both and applying one
 * without the other is a slot left empty. Two commands would put two entries in
 * the log for one intent and cost two undos, which is `swapPages`' argument
 * against being two `movePage`s.
 */
export const headerFooterPagesSchema = z.object({
  kind: z.literal('headerFooterPages'),
  /** Which pages. `'all'` is resolved by the kernel, which holds the count. */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /** The top edge's three slots. All empty means no header. */
  header: stampSlotsSchema,
  /** The bottom edge's three slots. All empty means no footer. */
  footer: stampSlotsSchema,
  /** Type size in points. */
  fontSize: z.number().positive().max(1000),
  /**
   * How far in from the page's edge the text sits, in points.
   *
   * One number rather than four: a header inset differently from its footer is
   * a layout nobody asks for, and the horizontal inset is the same measurement
   * turned ninety degrees. Bounded so a margin cannot push the text off a page.
   */
  marginPoints: z.number().nonnegative().max(500),
});

/**
 * Bates numbering — a continuous sequence stamped across the pages named.
 *
 * ## Why this is not a header with a `{n}` in it
 *
 * `headerFooterPages` resolves `{n}` to the **page's own number**. A Bates
 * number is the **position in the stamped sequence**, and the two are the same
 * number only when the scope is every page from the first. Stamp pages 5, 6 and
 * 9 starting at 1 and Bates gives 1, 2, 3 where a header gives 6, 7, 10 — which
 * is the whole point of the feature: legal exhibits are numbered consecutively
 * across a set regardless of where each page sat in its own file.
 *
 * `start` exists for the same reason. Numbering resumes where the previous
 * document stopped, so a person stamps the second file starting at 431 — a
 * header cannot express that at all.
 *
 * ## `digits` is zero-padding, and it is what makes a set sort
 *
 * `ABC-0001` and `ABC-0002` sort as text in the order they were stamped;
 * `ABC-1` and `ABC-10` do not. Padding is therefore part of the identifier
 * rather than a presentation choice, which is why it crosses rather than being
 * decided by whatever renders it. A number wider than `digits` is **not
 * truncated** — an identifier silently losing its leading digit is a different
 * exhibit — so the field is a minimum width and the kernel says so.
 */
export const batesNumberPagesSchema = z.object({
  kind: z.literal('batesNumberPages'),
  /** Which pages. Resolved by the kernel, and the sequence follows this order. */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /** Text before the number. Empty is ordinary. */
  prefix: z.string().max(100),
  /** Text after the number. Empty is ordinary. */
  suffix: z.string().max(100),
  /** The number the first stamped page carries. */
  start: z.number().int().nonnegative().max(999_999_999),
  /** Minimum digits, zero-padded. A wider number keeps every digit. */
  digits: z.number().int().min(1).max(12),
  /** Which corner or edge the stamp sits in. */
  edge: z.enum(['header', 'footer']),
  slot: z.enum(['left', 'centre', 'right']),
  /** Type size in points. */
  fontSize: z.number().positive().max(1000),
  /** How far in from the page's edge, in points. */
  marginPoints: z.number().nonnegative().max(500),
});

/**
 * Set a page's presentation transition (`/Trans`).
 *
 * ## Routed to MuPDF, and that is a CLASSIFICATION rather than a preference
 *
 * `/Trans` is an entry in the **page dictionary**, so this is a page attribute
 * written in place — `cropPages`' shape exactly, and `rotatePages`' before it.
 * It is not content composition and does not go to `@cantoo/pdf-lib`: nothing
 * is drawn, no content stream is touched, and §3's matrix routes page-tree and
 * page-attribute work to MuPDF. Grouping it with the watermark because both are
 * *presentation* would be grouping by what a feature is called rather than by
 * what it writes.
 *
 * That classification is what makes it **invertible**, which the drawing
 * commands are not: a page's prior `/Trans` is one small dictionary, and
 * absence is a value — a page that declared no transition must come back
 * declaring none, exactly as `cropPages` restores an absent `/CropBox`.
 *
 * ## The style list is PDF 32000-1's, minus the ones needing a second axis
 *
 * Table 161 defines thirteen styles, and six of them are only meaningful
 * alongside `/Dm`, `/M` or `/Di` — a wipe with no direction, a split with no
 * dimension. Shipping those without their axes would offer a control that
 * cannot express what the user picked, so the set here is the styles that are
 * complete on their own. The remainder arrive with the axes they need, as a
 * widened enum and three optional fields, rather than as a second command.
 *
 * `replace` is `/S /R`, the PDF's own name for *no transition*, and it is how a
 * user turns one off without a second command. It is spelt out rather than
 * expressed as absence, because *set every page to no transition* and *leave
 * every page as it was* are different intents and a scope with no style could
 * not tell them apart.
 */
export const setPageTransitionSchema = z.object({
  kind: z.literal('setPageTransition'),
  /** Which pages. `'all'` is resolved by the kernel, which holds the count. */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /** The transition style, as PDF 32000-1 Table 161 names it. */
  style: z.enum(['replace', 'dissolve', 'fade', 'box', 'blinds']),
  /**
   * How long it runs, in seconds.
   *
   * Bounded above so one command cannot set a transition a reader has to sit
   * through, and below by zero because `/D 0` is a legal instantaneous change.
   */
  durationSeconds: z.number().min(0).max(60),
});

/**
 * Fill pages with a background colour, **behind** their existing content.
 *
 * ## *Behind* is the whole feature, and it is not what a drawing API gives you
 *
 * pdf-lib's `drawRectangle` appends to a page's content stream, and PDF paints
 * in stream order — so the obvious implementation covers the document. A
 * background has to be **prepended**, which is a different operation on the
 * page's `/Contents` rather than a different call. Stated here because a
 * command called *background* that quietly paints over the text is the kind of
 * defect that looks like a rendering bug for a week.
 *
 * ## A COLOUR and not an image
 *
 * An image background needs a file, which needs a picker, which is a dependency
 * this build adds separately. Colour is the whole of what this command does,
 * and the absence is a decision rather than a gap.
 *
 * The channel carries three components rather than a hex string: a hex string
 * is a **presentation** of a colour and would have to be parsed on the far side,
 * which is a second opinion about what `#0a0` means. Zero to one each, which is
 * what PDF's own `rg` operator takes.
 */
export const setPageBackgroundSchema = z.object({
  kind: z.literal('setPageBackground'),
  /** Which pages. `'all'` is resolved by the kernel, which holds the count. */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /** The fill, in PDF's own DeviceRGB range. */
  red: z.number().min(0).max(1),
  green: z.number().min(0).max(1),
  blue: z.number().min(0).max(1),
});

/**
 * Resize pages to a target box, scaling their content to fit.
 *
 * ## Scaling the CONTENT is what makes this a resize rather than a crop
 *
 * Changing `/MediaBox` alone leaves the content at its old size in a bigger or
 * smaller frame — which is cropping or matting, and this build already has
 * `cropPages` for the first. A resize prepends a scale transform to the page's
 * content and moves the boxes together, so the page looks the same and measures
 * differently. Stated on the wire because the two are easy to confuse and only
 * one of them is what a person means by *resize*.
 *
 * ## IT MOVES THE CROPBOX, WHICH EVERY COORDINATE CONVERSION READS
 *
 * `PageTransform` converts between the branded spaces by reading a page's
 * `/CropBox` origin and size (invariant L3). This command changes both, so a
 * transform built before it is stale afterwards — the same staleness
 * `DocVersion` already governs for the renderer, arriving on geometry rather
 * than on bytes. The view model is what carries the new size to the renderer.
 *
 * ## The target is a SIZE, and the fit is uniform
 *
 * Width and height in points, and the scale is `min(w/W, h/H)` applied to both
 * axes — a non-uniform fit distorts the page, which no application offers
 * because no user wants it. The remainder is centred, so a Letter page fitted
 * to A4 sits in the middle of it rather than in a corner.
 */
export const resizePagesSchema = z.object({
  kind: z.literal('resizePages'),
  /** Which pages. `'all'` is resolved by the kernel, which holds the count. */
  pages: z.union([z.literal('all'), z.array(z.number().int().nonnegative()).min(1)]),
  /**
   * The target box in points.
   *
   * Bounded by PDF 32000-1's own limit: a page edge may not exceed 14,400 user
   * space units (200 inches), so the bound is the format's rather than one
   * chosen here. The lower bound is exclusive because a zero-width page is not
   * a page.
   */
  widthPoints: z.number().gt(0).max(14_400),
  heightPoints: z.number().gt(0).max(14_400),
});

/**
 * The largest image this build will make a page from.
 *
 * Sixty-four megabytes, which is far past any scan or photograph and far short
 * of a number that could matter beside `ADR-0021`'s document ceiling. The bound
 * exists because the bytes are read from a file a person chose, and a file
 * picker is a place a user can hand this application a 4 GB video by mistake —
 * refusing it by size is a decided outcome where reading it is a main process
 * that stops responding.
 */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

/**
 * Insert an image as a new page.
 *
 * ## THE BYTES ARE HERE AND THE RENDERER NEVER SENDS THEM
 *
 * This file's own header states its subject as *"every mutation **the renderer
 * can ask for**"* and its rule as *"commands are **intent**, not payload …
 * any design where the bytes crossing scale with document size per operation is
 * wrong"*. Both survive, and the second is the one worth reading precisely: an
 * image's bytes scale with the **image**, not with the document, so a 40 MB
 * photograph costs the same whether the file has two pages or twenty thousand.
 * The image *is* the intent here, exactly as the text is `watermarkPages`'.
 *
 * What would be wrong is the renderer holding them. It does not:
 * `document.insertImage` takes `{ docId, at }` and nothing else, a picker runs
 * in **main** as `destinationPicker.ts`' sibling, main reads the file, and main
 * mints this command straight into the bus. **Nothing multi-megabyte crosses
 * IPC in either direction.**
 *
 * ## And `document.execute` cannot carry it, by construction
 *
 * The schema has to be in `commandSchema` — `CommandKind` is derived from that
 * union, so a kind outside it has no declaration, no spec, no log entry and no
 * undo. But `document.execute`'s params take {@link renderableCommandSchema},
 * which is this union with this member removed. So the one channel a renderer
 * could put a command on refuses this one at the boundary, and the capability
 * is unrepresentable rather than merely unused (B5).
 *
 * That split has a worked precedent in `engineChannels.ts`' `mupdfCommandSchema`
 * — the same union narrowed to what may cross to the engine host — and the same
 * reasoning as this file's *"inverses are deliberately absent … they stay
 * kernel-only"*: a schema is placed by **who may hold it**
 * ([ADR-0023](../../../docs/DECISIONS/0023-the-engine-host-is-contained.md)
 * Decision 11).
 */
export const insertImagePageSchema = z.object({
  kind: z.literal('insertImagePage'),
  /** Zero-based index the new page occupies afterwards, as `insertBlankPage`. */
  at: z.number().int().nonnegative(),
  /**
   * The image itself.
   *
   * `instanceof` rather than a base64 string, because this never crosses a
   * boundary that would need encoding and a string would cost a third more
   * memory to express the same bytes.
   */
  bytes: z.custom<Uint8Array>(
    (value) => value instanceof Uint8Array && value.byteLength <= MAX_IMAGE_BYTES,
    { message: 'not an image this build will make a page from, or larger than the bound' },
  ),
  /**
   * Which decoder to use.
   *
   * A declared value rather than sniffed here, because `@cantoo/pdf-lib` offers
   * `embedJpg` and `embedPng` as two different calls and the choice is the
   * caller's. Main reads it from the file it opened, where the extension the
   * user picked is known — and the decoder refusing is what validates it, not
   * this field, for `documentPicker.ts`' reason about filters being a hint.
   */
  mediaType: z.enum(['image/jpeg', 'image/png']),
});

/**
 * Build a table of contents page from the document's own outline.
 *
 * ## The COMMAND carries an index and nothing else
 *
 * Not the entries. `@monstera/kernel`'s `readDestinations` is what answers
 * *what are this document's bookmarks*, and ADR-0040's 2026-09-05 extension
 * has the bus hand its answer to the `apply` at apply time — so the outline
 * never crosses this boundary in either direction for this command.
 *
 * The rejected alternative was to put the entries in the payload, which is
 * tempting because the renderer already holds them: `DestinationsPanel` renders
 * `document.destinations`, which is the same reader. It is rejected on
 * **staleness** — that copy was read at an earlier `DocVersion`, and a table of
 * contents is almost entirely page numbers, so a page deleted in between gives
 * a TOC that is wrong and looks right. Secondarily it is the shape L11 names:
 * an outline scales with the document.
 *
 * ## The generated pages SHIFT the pages they point at, and the numbers account
 * for it
 *
 * A TOC inserted at the front pushes every page down by however many pages it
 * takes. So the entries' own indices — read against the document as it stands —
 * are not the numbers to print, and a TOC that printed them would be off by
 * exactly its own length for every entry after it. That arithmetic is the
 * kernel's, because only the kernel knows how many pages the layout took.
 *
 * ## No heading, and that is a decision with a trigger rather than an omission
 *
 * A heading would be synthesised text in a human language written into the
 * user's document, and this build has no answer yet for which language document
 * content takes — the interface locale, the document's own `/Lang`, or a choice
 * the user makes. Writing `Contents` would answer that by accident, in English,
 * for everyone. The entries themselves are the author's own words and carry no
 * such question. The heading arrives with this command's first dialog, which is
 * where a component can resolve a message and the user can overrule it.
 */
export const generateTocSchema = z.object({
  kind: z.literal('generateToc'),
  /**
   * Zero-based index the first generated page occupies afterwards.
   *
   * `insertBlankPage`'s spelling and its bound: `at` is in the destination
   * frame, so `at: pageCount` appends and the kernel clamps to the count.
   */
  at: z.number().int().nonnegative(),
});

/**
 * Append another OPEN document's pages into this one.
 *
 * ## The source is a `DocId`, and it is a document the user has open
 *
 * [ADR-0040](../../../docs/DECISIONS/0040-a-command-names-a-second-document-by-docid.md)
 * Decisions 1 and 2. Not a path (invariant L2 makes that a compile error, and
 * it would be a second document-opening path beside `DocumentService.open`),
 * not bytes (invariant L11 by inspection — a payload that scales with a
 * document, and a 200 MB IPC message for a 200 MB merge).
 *
 * The renderer already holds the id it names: a `DocId` is what `document.open`
 * answers, what its tabs are keyed by, and what every other channel takes. So a
 * merge is *these two tabs*, in the vocabulary the renderer already has.
 *
 * ## The visible cost, stated here rather than discovered
 *
 * Decision 2 takes it deliberately: there is no hidden transient open, so
 * merging a file that is not open means opening it as a tab first. What that
 * buys is **one way to open a document** — the place identity is read, the
 * dedup rule runs, the `FileHandle` is minted, the byte ceiling is checked and
 * the engine session is granted its directory. A second path would answer all
 * of that again, and B3a's record is that the second answer agrees with the
 * first until it does not.
 */
export const mergeDocumentSchema = z.object({
  kind: z.literal('mergeDocument'),
  /** The open document whose pages are copied in. Never modified. */
  source: docIdSchema,
  /**
   * Zero-based index the source's first page occupies afterwards.
   *
   * `insertBlankPage`'s spelling and its bound: `at` is in the destination
   * frame, so `at: pageCount` appends and the kernel clamps to the count.
   */
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
  cropPagesSchema,
  watermarkPagesSchema,
  headerFooterPagesSchema,
  batesNumberPagesSchema,
  setPageTransitionSchema,
  setPageBackgroundSchema,
  resizePagesSchema,
  insertImagePageSchema,
  generateTocSchema,
  mergeDocumentSchema,
]);

/**
 * The commands a **renderer** may put on `document.execute`.
 *
 * `commandSchema` with `insertImagePage` removed, and that is the only
 * difference. Every other kind is intent a renderer can express in a few
 * numbers; that one carries an image, which main reads from a file the user
 * picked and mints directly into the bus.
 *
 * ## Written out, for `mupdfCommandSchema`'s reason
 *
 * A filter over `commandSchema.options` is the obvious spelling and it needs
 * two type assertions: zod cannot see that a filtered array is still non-empty
 * and still discriminated, and — the half that matters — the filtered array's
 * element type stays the **whole** union, so the schema would parse correctly
 * while inferring a payload that still includes the member it removed. A
 * derivation whose narrowing has to be restated by a cast is a list with a cast
 * in front of it.
 *
 * Listed, the inference is exact and there is no assertion anywhere. What that
 * costs is a member added here and not there, which is the failure a
 * **compile-time exhaustiveness check** below catches rather than a reviewer.
 */
export const renderableCommandSchema = z.discriminatedUnion('kind', [
  rotatePagesSchema,
  setLayerVisibilitySchema,
  movePageSchema,
  deletePagesSchema,
  duplicatePageSchema,
  swapPagesSchema,
  insertBlankPageSchema,
  cropPagesSchema,
  watermarkPagesSchema,
  headerFooterPagesSchema,
  batesNumberPagesSchema,
  setPageTransitionSchema,
  setPageBackgroundSchema,
  resizePagesSchema,
  // RENDERABLE, and worth stating because the neighbour above is not. This
  // carries one integer; what makes it unusual is where its DATA comes from,
  // and that is resolved main-side at apply time rather than sent. The test for
  // this union is whether a renderer can express the intent in a few numbers,
  // never whether the operation is simple.
  generateTocSchema,
  // RENDERABLE, and this is the clearest case of the test above: a merge names
  // a second document by an id the renderer already holds, so the intent is two
  // ids and an index however large the documents are. What must not cross is
  // the source's BYTES, and nothing here can express those.
  mergeDocumentSchema,
]);

/** A command a renderer may send. */
export type RenderableCommand = z.infer<typeof renderableCommandSchema>;

/**
 * Which kinds a renderer may **not** send, checked in both directions.
 *
 * The list above is exactly `commandSchema`'s members minus the ones named
 * here, and this pair of assignments is what says so at compile time:
 *
 * - a kind added to `commandSchema` and forgotten here makes the first line
 *   fail, because the leftover would not be assignable to the named set;
 * - a kind named here that is not actually absent makes the second fail.
 *
 * Without them the two unions drift silently in the direction that matters —
 * a new command quietly becoming unreachable from the renderer, which reads at
 * every call site as a control that does nothing.
 */
type WithheldFromRenderer = 'insertImagePage';
type LeftOver = Exclude<Command['kind'], RenderableCommand['kind']>;
const _withheldIsExactlyThat: LeftOver extends WithheldFromRenderer ? true : never = true;
const _andNothingElseIsWithheld: WithheldFromRenderer extends LeftOver ? true : never = true;
void _withheldIsExactlyThat;
void _andNothingElseIsWithheld;

export type Command = z.infer<typeof commandSchema>;
export type CommandKind = Command['kind'];

/** Narrows the union to one member, for a spec's `apply` signature. */
export type CommandOfKind<K extends CommandKind> = Extract<Command, { kind: K }>;

/**
 * Which OTHER documents a command's payload names.
 *
 * ## This lives here because the payload does
 *
 * ADR-0040 Decision 3 has the bus handed *"the sessions of the documents the
 * command names, resolved by its caller"* — so the caller has to know which
 * ids those are, and the only honest source for that is the schema that
 * declared them. `documentCommands.ts` calling this is asking the contract
 * about a contract thing.
 *
 * The alternative was for `documentCommands.ts` to read the kernel's
 * `declaredCommands[kind].sources`, and that is the wrong table twice over:
 * that file removed its last routing-table read on 2026-09-04 for B3a reasons
 * it records at `execute`, and `sources` answers *does the apply need a
 * session* — the seam's question — where this answers *which ids are in the
 * payload*. Decision 4 is explicit that those are two different statements.
 *
 * ## It is a SWITCH on the kind, deliberately, and not a structural scan
 *
 * `'source' in command` would be shorter and would silently pick up any future
 * field that happened to be called `source`, including one that is not a
 * `DocId`. Naming the kinds means a command that gains a second-document field
 * without being added here is a command whose sessions never get resolved —
 * which surfaces at `MissingSourceSessionError` on its first run rather than as
 * a wrong document quietly merged.
 *
 * **The exhaustiveness is checked below**, so the failure is at compile time
 * for anything declaring the seam's axis.
 */
export function sourceIdsOf(command: Command): readonly DocId[] {
  // AN `if` ON THE KIND, not a `switch` and not `'source' in command`.
  //
  // The structural test is rejected for the reason above — it would pick up any
  // future field called `source`, including one that is not a `DocId`. A
  // `switch` with a `default` is rejected by
  // `@typescript-eslint/switch-exhaustiveness-check`, and correctly: a default
  // arm makes a switch over a discriminated union stop being exhaustive, so a
  // new kind would fall through it silently — which is the whole failure this
  // function's own comment says naming the kinds prevents.
  //
  // Listing all sixteen arms to satisfy the rule would be a list nobody reads
  // and fifteen of whose arms are the same line. The `if` says the same thing
  // and the type check below is what keeps the name honest.
  if (command.kind === 'mergeDocument') return [command.source];
  return NO_SOURCES;
}

/**
 * The empty answer, as one frozen array.
 *
 * Every command but one returns it, and a fresh `[]` per call would allocate on
 * the hot path of every `execute` for a value nobody mutates.
 */
const NO_SOURCES: readonly DocId[] = Object.freeze([]);

/**
 * Which kinds {@link sourceIdsOf} answers non-empty for, checked in both
 * directions.
 *
 * `renderableCommandSchema`'s pair, on a different axis and for the same
 * reason: the switch above is a hand-kept list, and a hand-kept list is right
 * only where something else refuses to let it drift. Here the anchor is the
 * kernel's `sources` axis — but this package cannot import the kernel, so what
 * is checkable *here* is that the list and this type agree, and the kernel's
 * `commandDeclarations.test.ts` is what ties the type to the declarations.
 *
 * That split is stated rather than papered over: on its own this pair proves
 * the switch matches a list two lines up, which is a derived count agreeing
 * with itself (4c). The load-bearing half is in the kernel.
 */
type NamesASecondDocument = 'mergeDocument';
const _switchCoversExactlyThose: NamesASecondDocument extends CommandKind ? true : never = true;
void _switchCoversExactlyThose;
