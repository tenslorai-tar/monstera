import type { DocId, DocVersion } from '@monstera/shared';
import { z } from 'zod';

import { docIdSchema, docVersionSchema } from './schemas.js';

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

/**
 * Replace one page with another open document's pages.
 *
 * ## Why this is a COMMAND and not two commands
 *
 * It is a delete and an insert at one index, and composing it from
 * `deletePages` plus `mergeDocument` would produce **two log entries** — so one
 * user action would take two undos, and a document could rest in the state
 * between them, which is a page missing and nothing put back. One intent is one
 * entry (ADR-0009 §4).
 *
 * ## Its inverse is the target's checkpoint, like every other cross-document
 * command
 *
 * Not a new shape. The prior state is the replaced page and everything it
 * reaches, plus the absence of what arrived — `deletePages`' argument and
 * `mergeDocument`'s in one command. `CommandPrior` types it `never` and the bus
 * checkpoints the target.
 *
 * ## The WHOLE source replaces one page
 *
 * A source of three pages replacing page 4 leaves a document one page shorter
 * plus three, which is what *replace with this document* means. Choosing which
 * of the source's pages to use is the same capability *insert selected pages*
 * is owed, and blocked on the same missing page count.
 */
export const replacePageSchema = z.object({
  kind: z.literal('replacePage'),
  /** The open document whose pages take the replaced page's place. */
  source: docIdSchema,
  /** Zero-based index of the TARGET page being replaced. */
  at: z.number().int().nonnegative(),
});

/**
 * The largest coordinate an annotation may name, in PDF units.
 *
 * The format's own limit, not one invented here: PDF 32000-1 Annex C.2 puts the
 * maximum page dimension at **14,400 units** — 200 inches — so a coordinate past
 * this cannot lie on any conforming page. It bounds the payload for invariant
 * L11's reason rather than a parser's: a renderer that could send an
 * unbounded number could make one command's payload say anything.
 *
 * Symmetric about zero because a `/MediaBox` may have a negative origin, so a
 * legal page can put content at a negative coordinate.
 */
export const MAX_PAGE_COORDINATE = 14400;

/**
 * The widest border an annotation may carry, in points.
 *
 * Two inches. Not a format limit — the format states none — so it is a
 * statement about what the value means: a border wider than this is not a
 * border, and the number is here rather than at a call site so a reader can
 * disagree with it in one place.
 */
export const MAX_ANNOTATION_BORDER = 144;

/**
 * How many characters a text annotation may carry.
 *
 * `MAX_ANNOTATION_CONTENTS`' argument in the other direction — that one bounds
 * what a hostile document may send **out** to a panel, and this bounds what a
 * renderer may send **in**. The two are separate numbers on purpose: a note
 * this build writes and a note it merely lists are different trusts, and one
 * constant serving both would make a change to either a change to the other.
 *
 * Generous enough that no note a person types meets it, so a refusal here is
 * evidence something built the command from a file rather than from a dialog.
 */
export const MAX_ANNOTATION_TEXT = 4096;

/**
 * The point sizes a text annotation may declare.
 *
 * A range rather than a ceiling, because the failure at the bottom is the
 * quieter one: `0` is a legal number the format accepts and renders as nothing,
 * which is a text box the user typed into and cannot see. The floor makes that
 * unrepresentable instead of leaving it to a viewer to be sensible about.
 */
export const MIN_ANNOTATION_FONT = 1;
export const MAX_ANNOTATION_FONT = 1296;

/**
 * How many points one ink stroke may carry.
 *
 * The renderer keeps points two CSS pixels apart, so this is over eight
 * thousand pixels of travel — more than a page holds at any sane zoom. It is
 * declared here rather than in the tool because it bounds the **payload**, and
 * a bound the sender alone knows is a bound the receiver is trusting.
 */
export const MAX_INK_POINTS = 4096;

/**
 * How many vertices one polygon or polyline may carry.
 *
 * **A separate bound from {@link MAX_INK_POINTS}, because it counts a different
 * thing.** A stroke's points are samples of a drag, so its bound is a distance
 * a hand could travel; these are *presses*, one per deliberate click. Two
 * hundred and fifty-six is a shape nobody draws by hand and is three orders of
 * magnitude below the sampled bound — reusing that one would have been a limit
 * whose stated reason is about pixels of travel applied to a count of clicks.
 */
export const MAX_POLYGON_POINTS = 256;

/**
 * How a polygon's border is drawn — `/BE`, in the format's own vocabulary.
 *
 * **A union rather than `cloudy: true`**, for {@link lineEndingSchema}'s reason
 * and with the same shape: the format defines a border effect with a style and
 * an intensity, this build writes one of them, and a boolean is a field that
 * cannot grow. The polygon tool sends `'solid'` and the cloud tool sends
 * `'cloudy'` — one annotation type, two tools, exactly as a line and an arrow
 * are.
 */
export const borderEffectSchema = z.enum(['solid', 'cloudy']);

/** How a polygon's border is drawn. See {@link borderEffectSchema}. */
export type BorderEffect = z.infer<typeof borderEffectSchema>;

/**
 * A rectangle an annotation occupies, in **PDF user space**.
 *
 * ## The space is the whole of what this type declares
 *
 * These four numbers are the page's own coordinate system — y **up**, origin at
 * the page's visible box as the document defines it. That is not where either
 * end of this command naturally works: the overlay measures a drag in CSS
 * pixels down from the top of a rendered page, and MuPDF's annotation API takes
 * the page's *displayed* space, which is y-down and turned by `/Rotate`.
 *
 * So both ends convert, and this schema is the one place that says what they
 * convert **to**. The wired-tools rule names exactly this hazard: two halves
 * either side of a boundary, each correct in its own frame, with the unit
 * change living in a literal at a call site. Page indices paid for it once;
 * this is the coordinate space the same rule anticipated.
 *
 * Why user space and not either of the two frames that touch it: it is the
 * frame the **document** is written in, so a stored rectangle keeps its meaning
 * when the page is rotated, when the zoom changes, and when a page op moves the
 * page. The other two both vary with something that is not the document.
 *
 * ## Not normalised here
 *
 * A drag runs in whichever direction the pointer went, and requiring
 * `x0 <= x1` at the boundary would mean the renderer normalises and the kernel
 * trusts it. The kernel normalises, where it is already resolving the page.
 */
export const annotationRectSchema = z
  .object({
    x0: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
    y0: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
    x1: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
    y1: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
  })
  .strict();

/** A rectangle in PDF user space. See {@link annotationRectSchema}. */
export type AnnotationRect = z.infer<typeof annotationRectSchema>;

/**
 * A colour an annotation is drawn in, as the three components `/C` holds.
 *
 * A tuple rather than a hex string, because that is what the format stores and
 * what MuPDF's `setColor` takes — a string here would be parsed at both ends,
 * which is two opinions about a notation neither of them owns. Components run
 * 0 to 1, as PDF's DeviceRGB does, not 0 to 255.
 *
 * A document value rather than chrome, so it is exempt from the design-token
 * rule by that rule's own words (`docs/ARCHITECTURE.md` §10.2 names *a
 * user-chosen annotation color* as genuinely dynamic).
 */
export const annotationColourSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

/** An annotation's colour. See {@link annotationColourSchema}. */
export type AnnotationColour = z.infer<typeof annotationColourSchema>;

/**
 * How opaque an annotation is drawn — `/CA`, from 0.1 to 1.
 *
 * ## On EVERY member, because it is a property of an annotation
 *
 * `/CA` is defined on the annotation dictionary rather than on any subtype, so a
 * field on some drafts and not others would be this schema deciding which marks
 * a person may fade — a rule the format does not have. It is written by one
 * call at the one creation site for the same reason the `srcRef` mark is: a
 * per-kind line is twelve chances to omit one, and the omission's symptom is a
 * mark that ignores the control.
 *
 * ## The floor is 0.1 and not 0
 *
 * A fully transparent annotation is in the file, is selectable by nothing a
 * person can see, and looks exactly like a tool that did not fire — the
 * display-only defect with a slider in front of it. Ten percent is faint and
 * still visibly there. A person who wants a mark gone deletes it, which is what
 * the eraser is for.
 */
export const annotationOpacitySchema = z.number().min(0.1).max(1);

/** How opaque an annotation is. See {@link annotationOpacitySchema}. */
export type AnnotationOpacity = z.infer<typeof annotationOpacitySchema>;

/**
 * One point in PDF user space, for an annotation whose shape is not a box.
 *
 * The same frame and the same bounds as {@link annotationRectSchema}, which is
 * why the bound is that constant rather than a second one: a coordinate is a
 * coordinate, and two numbers describing where something is on a page cannot
 * mean different things depending on which annotation asked.
 */
export const annotationPointSchema = z
  .object({
    x: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
    y: z.number().min(-MAX_PAGE_COORDINATE).max(MAX_PAGE_COORDINATE),
  })
  .strict();

/** A point in PDF user space. See {@link annotationPointSchema}. */
export type AnnotationPoint = z.infer<typeof annotationPointSchema>;

/**
 * How a line's ends are drawn — `/LE`, in the format's own vocabulary.
 *
 * **A union of two rather than a boolean**, because the format has ten endings
 * and this build will want more than one of them: `arrow: true` is a field that
 * cannot grow, where a member added here reaches every reader as a compile
 * error at the one place that maps it.
 *
 * Named for what PDF calls them, not for the tool that produces them. The line
 * tool sends `'none'` and the arrow tool sends `'closed-arrow'`, and they are
 * the same annotation type with a different value — which is what the format
 * says they are.
 */
export const lineEndingSchema = z.enum(['none', 'closed-arrow']);

/** How a line's end is drawn. See {@link lineEndingSchema}. */
export type LineEnding = z.infer<typeof lineEndingSchema>;

/**
 * What one annotation the user just drew IS.
 *
 * ## A union inside ONE command, and not a command per tool
 *
 * Stage 3 lands about twenty drawing tools. A command kind each would be twenty
 * passes through the registration tax — schema, both declaration axes, the spec
 * table, the host channel's union, the renderer's, a dispatch test — for
 * twenty operations that differ in the shape they draw and in nothing else.
 * `docs/ARCHITECTURE.md` §7 already says so from the other side: the registry
 * row is *Annotation types*, whose entry carries a *kernel writer mapping*,
 * which is a mapping precisely because the command is one.
 *
 * Discriminated on `type` with one member today. A one-member union reads as
 * over-engineering only until the second arrives, and the alternative — an
 * inline object now, a union later — is a schema change that reaches every
 * caller rather than a member added to a list.
 */
/**
 * One of the three text markups, as a draft.
 *
 * ## Three members from one factory, because the format says they are one thing
 *
 * `/Highlight`, `/Underline` and `/StrikeOut` differ in their name and in how a
 * viewer paints the same quadrilaterals, and in nothing else. Measured
 * 2026-09-06 against MuPDF 1.28.0: each accepts `addQuadPoint`, each answers
 * `hasRect()` **false**, and each stores the quads it was given. So one factory
 * writes all three, and there is no second place for the fourth to drift from.
 *
 * They stay **separate members** rather than one member with a `markup` field
 * for the reason `square` and `circle` are separate: the reader's vocabulary is
 * derived from this union, and a panel telling somebody *text markup* where the
 * file says *StrikeOut* would be this build's convenience shown as the
 * document's content.
 *
 * ## TWO POINTS, and the text between them is MuPDF's to decide
 *
 * The payload is where the drag started and where it ended — not a rectangle,
 * and not the quads. *Which characters lie between two points* is a question
 * the engine already answers, through `StructuredText.highlight`, and a
 * renderer that computed quads would be a second opinion about it built on a
 * text layer this application does not have (B3a). The kernel resolves them,
 * so the intent stays four numbers whatever the page holds.
 *
 * **A drag that selects no text is refused**, not stored: a markup annotation
 * with no quads is an object in the file that paints nothing, which is the
 * display-only defect at document scale.
 */
function textMarkupDraft<T extends 'highlight' | 'underline' | 'strikeout'>(
  type: T,
): z.ZodObject<{
  type: z.ZodLiteral<T>;
  from: typeof annotationPointSchema;
  to: typeof annotationPointSchema;
  colour: typeof annotationColourSchema;
  opacity: typeof annotationOpacitySchema;
}> {
  return z
    .object({
      type: z.literal(type),
      /** Where the drag started, in PDF user space. */
      from: annotationPointSchema,
      /** Where it ended. Order is not meaningful — a selection has two ends. */
      to: annotationPointSchema,
      /**
       * `/C`, which on these subtypes is the colour of the paint rather than of
       * a stroke: a `/Highlight` is filled with it, an `/Underline` and a
       * `/StrikeOut` draw their rule in it.
       */
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
    })
    .strict();
}

export const annotationDraftSchema = z.discriminatedUnion('type', [
  z
    .object({
      /** `/Subtype /Square`, which is what a rectangle annotation is. */
      type: z.literal('square'),
      /** Where it sits, in PDF user space. See {@link annotationRectSchema}. */
      rect: annotationRectSchema,
      /** The stroke colour. */
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      /**
       * The stroke width in points. Zero is legal and means a hairline.
       *
       * No interior colour, so the shape is an outline. A fill is a second
       * colour and a control to choose it, which arrives with the style
       * controls rather than as a field nothing can set.
       */
      borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Circle`, which the format uses for an ellipse.
       *
       * **The same four fields as `square`, deliberately repeated** rather
       * than shared through an intersection. A discriminated union's members
       * are read one at a time — a reader asking *what is a circle draft*
       * should find the answer here rather than in a base type two files away
       * — and the day one of them gains a field the other does not, a shared
       * base becomes an intersection with an exception in it.
       */
      type: z.literal('circle'),
      /** The box the ellipse is inscribed in, in PDF user space. */
      rect: annotationRectSchema,
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Line`, which is a line and an arrow both.
       *
       * **One member for two tools**, because that is what the format says
       * they are: an arrow is a line whose `/LE` names an ending. Two members
       * would mean two writers doing the same three calls, and the second
       * would drift.
       *
       * Two POINTS rather than a rectangle, and that is not a spelling
       * preference — a rectangle cannot express which diagonal was drawn, so a
       * line stored as one comes back with its arrowhead at whichever corner
       * the reader chose to call the end.
       */
      type: z.literal('line'),
      /** Where the drag started. */
      from: annotationPointSchema,
      /** Where it ended — the end an arrowhead is drawn at. */
      to: annotationPointSchema,
      /** How the `to` end is drawn. `'none'` for a plain line. */
      ending: lineEndingSchema,
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Ink` — one freehand stroke.
       *
       * **ONE stroke, not a list of them**, although `/InkList` holds several.
       * A drag produces one, and a field the surface cannot fill is the shape
       * that got a whole command backed out of this file once: the multi-stroke
       * form needs a tool that can continue an annotation, which does not
       * exist. The kernel wraps this in the list the format wants.
       */
      type: z.literal('ink'),
      /**
       * Where the pointer went, in PDF user space, in order.
       *
       * **Bounded, and the bound is not invariant L11's.** L11 forbids a
       * payload that scales with the DOCUMENT; a stroke scales with the drag,
       * which is a different thing and still needs a limit — intent that can
       * grow without one is a renderer that can send anything. The renderer
       * decimates as it records, so this is thousands of pixels of travel
       * rather than a few seconds of dragging.
       *
       * Two points minimum: one point is a dot, which is a click rather than a
       * stroke, and the kernel would have nothing to draw.
       */
      points: z.array(annotationPointSchema).min(2).max(MAX_INK_POINTS),
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Redact` — a MARK, and marking is the whole of it.
       *
       * Burning a redaction in is a full rewrite with object GC and no prior
       * revisions ([ADR-0008](../../../docs/DECISIONS/0008-save-mode-is-determined-by-purpose.md)
       * rule 1), because an incremental save leaves the covered content
       * readable by walking the xref chain. That is a different command with a
       * different save mode, and this one must never be mistaken for it: a
       * mark says *this is to be removed* and removes nothing.
       *
       * **NO BORDER WIDTH**, unlike every other outline here, and it is a
       * measurement rather than an omission: MuPDF 1.28.0 answers
       * `setBorderWidth` on a Redact with *"Redact annotations have no BS
       * property"*, and `setInteriorColor` with *"no IC property"*. A field the
       * writer of record refuses is the display-only sin inside a payload — a
       * value a person could set that nothing could apply.
       */
      type: z.literal('redact'),
      /** The region marked for removal, in PDF user space. */
      rect: annotationRectSchema,
      /** What the mark is outlined in until it is applied. */
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /FreeText` — text that sits on the page rather than in a
       * popup, which is what makes it the first draft carrying words.
       *
       * **The first member whose content a person types**, and therefore the
       * first that cannot be built from a gesture alone: its tool has to ask.
       * That is what made `commit` able to await a dialog
       * ([ADR-0038](../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)'s
       * shape on a tool rather than on a command).
       */
      type: z.literal('text-box'),
      /** The box the text is laid out in, in PDF user space. */
      rect: annotationRectSchema,
      /**
       * What it says.
       *
       * **Bounded, and the bound is a payload rule rather than a view of what a
       * person would type.** Intent that can grow without a limit is a renderer
       * that can send anything, which is the argument `/Contents` is bounded by
       * on the way out. It is generous enough that no real note meets it, so a
       * refusal here means something built this command from a file.
       *
       * **Not optional and not empty.** A `/FreeText` with no text is a
       * rectangle with an invisible border — a control that appears to do
       * nothing, which is the display-only sin arriving as a payload. The tool
       * answers `undefined` when the dialog is dismissed or the field is blank,
       * so nothing here has to represent *a text box with no text*.
       */
      text: z.string().min(1).max(MAX_ANNOTATION_TEXT),
      /** The colour the text is drawn in. */
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      /**
       * Point size.
       *
       * A field the style controls will own, carried now for the reason the
       * shape tools' colour is: a command field that exists and a control that
       * does not is the shape this build has taken four times, and a schema
       * that has to grow later is the one it rejected.
       */
      fontSize: z.number().min(MIN_ANNOTATION_FONT).max(MAX_ANNOTATION_FONT),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Text` — the note icon a reader clicks to read a comment.
       *
       * **THE FIRST MEMBER PLACED BY A POINT RATHER THAN A SHAPE**, and the
       * point is a measurement rather than a simplification. MuPDF 1.28.0
       * **clamps** a `/Text`'s box to between 10 and 20 points square, anchored
       * at the displayed top-left corner — measured 2026-09-06 across seven
       * requested sizes on a `/MediaBox [0 0 200 300]` page: 0, 1, 5 and 10 all
       * store a 10-square box and 20, 30 and 60 all store a 20-square one. So
       * the size a caller asks for survives only inside a ten-point band and is
       * discarded outside it, which makes a `rect` field four numbers of which
       * two are mostly ignored by the writer of record — a value a person could
       * set that nothing reliably applies, which is the display-only sin
       * arriving inside a payload and the argument that took the border width
       * off the redact mark.
       *
       * The first reading of that measurement said *a fixed 20 by 20*, from a
       * single 30-point sample. It was one axis of evidence carrying a claim
       * about a rule, and the number it predicted for a point — the one this
       * member actually sends — was wrong by half.
       *
       * An icon's size is the reader's business anyway: a note is a marker, and
       * a marker that scaled with how far somebody happened to drag would be
       * two notes at two sizes meaning the same thing.
       */
      type: z.literal('sticky-note'),
      /** Where the icon is anchored, in PDF user space. */
      at: annotationPointSchema,
      /**
       * The comment the icon opens.
       *
       * `text-box`' bound and its argument. **Required**, for the same reason
       * that one is: a note icon carrying nothing is a control a reader clicks
       * to be shown an empty popup, which is the display-only sin one
       * interaction further on than a blank text box. The tool answers
       * `undefined` when the dialog is dismissed, so nothing here represents a
       * note with no note in it.
       *
       * `/Contents` here is a comment ABOUT the page rather than text drawn on
       * it, which is the ordinary meaning of the key and the opposite of what
       * `text-box` needs — one more reason those are two members rather than
       * one with a flag.
       */
      text: z.string().min(1).max(MAX_ANNOTATION_TEXT),
      /**
       * What the icon is drawn in — `/C`, which for a `/Text` colours the icon
       * itself rather than a stroke.
       *
       * No icon SHAPE beside it, and that is the distinction this file has
       * otherwise blurred: a field with no control is carried here when a
       * FEATURES row already owes the control (colour, border width and font
       * size are all owed by *style controls*), and refused when nothing owes
       * it. No row in `docs/FEATURES.md` promises a choice of note icon, so
       * `/Name` is the kernel's constant rather than a payload field nothing
       * would ever set.
       */
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Caret` — *something belongs here*, drawn as a wedge between
       * two characters.
       *
       * **The first member with no content at all**, and that is what it is
       * for: a caret is a proofreader's insertion mark, so the annotation IS
       * the position. A `text` field would make it a note that happens to be
       * caret-shaped, and the member above already is one.
       *
       * Placed by a point for `sticky-note`'s measured reason and by a
       * DIFFERENT rule, which is why the two are separate members rather than
       * one point-shaped shape. A caret is a **genuinely fixed 20 by 14,
       * centred** on whatever rectangle it is given: measured over the same
       * seven requested sizes that showed the note's clamp, every one from a
       * degenerate request to a 60-point one produced the same extent about the
       * requested centre.
       *
       * So one of these two subtypes clamps and the other does not, and both
       * were nearly written down as *fixed*. A helper that took a point and
       * produced *the* point annotation would have hidden exactly that — the
       * clamp is only visible when the two are measured across a range and
       * their answers compared, which two entries force and one would not.
       */
      type: z.literal('caret'),
      /** The insertion point, in PDF user space. */
      at: annotationPointSchema,
      /** What the wedge is drawn in. */
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /Polygon` — a closed shape, and a cloud.
       *
       * **ONE MEMBER FOR TWO TOOLS**, which is `line`'s arrangement and is what
       * the format says these are: a cloud is a polygon whose `/BE` names an
       * effect. Measured 2026-09-06 —
       * `Polygon.setBorderEffect('Cloudy')` stores `/BE << /S /C /I 2 >>`, grows
       * `/RD` from `[2 2 2 2]` to `[11 11 11 11]` and pushes the computed
       * `/Rect` past the page edge, because the bumps sit outside the vertices.
       *
       * **The first member built from PRESSES rather than from a drag**
       * ([ADR-0042](../../../../docs/DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md)).
       * The payload does not say so and should not: a command is intent, and
       * *these are the corners* is the same intent however the person entered
       * them.
       */
      type: z.literal('polygon'),
      /**
       * The corners, in PDF user space, in order.
       *
       * **Three minimum**, where the polyline's bound is two, and it is the
       * shape's own rule rather than a stricter version of one: two corners
       * closed back on themselves is a line drawn twice, which the `line`
       * member already expresses and draws better.
       *
       * MuPDF closes the shape itself — nothing repeats the first vertex at the
       * end, and a payload that did would put a duplicate corner in `/Vertices`
       * for every polygon this build writes.
       */
      points: z.array(annotationPointSchema).min(3).max(MAX_POLYGON_POINTS),
      /** Solid, or the cloud's scalloped border. */
      border: borderEffectSchema,
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /PolyLine` — an open run of segments.
       *
       * **NO BORDER EFFECT, and it is measured rather than an oversight.**
       * MuPDF 1.28.0 answers `setBorderEffect` on a `/PolyLine` with *"PolyLine
       * annotations have no BE property"*, so a cloud cannot be an open shape
       * and this member has no field for one. That is the redact mark's rule
       * arriving a second time: a field the writer of record refuses is a value
       * a person could set that nothing could apply.
       *
       * It is also why this is a separate member from `polygon` rather than one
       * with a flag. The two differ in the minimum they accept AND in whether a
       * border effect is expressible, and a shared member would have had to
       * carry a field legal for half of its own values.
       */
      type: z.literal('polyline'),
      /**
       * The points, in PDF user space, in order.
       *
       * **Two minimum**: an open run of one segment is a line, which is legal
       * and is what a person gets if they finish after two presses. Unlike the
       * polygon, nothing closes it.
       */
      points: z.array(annotationPointSchema).min(2).max(MAX_POLYGON_POINTS),
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER),
    })
    .strict(),
  textMarkupDraft('highlight'),
  textMarkupDraft('underline'),
  textMarkupDraft('strikeout'),
  z
    .object({
      /**
       * `/Subtype /FreeText` with `/IT /FreeTextCallout` — a note with a line
       * pointing at what it is about.
       *
       * ## Its own member rather than a field on `text-box`
       *
       * The two write the same subtype, and that is where the resemblance ends.
       * A text box is placed by one drag; a callout is a point AND a box, and
       * an optional `at` on the text-box member would be a field legal for half
       * its values with a tool that can never fill it — the shape this schema
       * rejected for the cloud's border effect and for the same reason.
       *
       * ## MEASURED: `/IT` is what makes it a callout, and MuPDF does not write
       * it
       *
       * 2026-09-06, MuPDF 1.28.0. `setCalloutPoint` and `setCalloutLine` store
       * `/CL` and nothing else — no `/IT` — and the annotation's `/Rect` stays
       * the text box's. Written by hand through the object API, `/IT
       * /FreeTextCallout` makes MuPDF **expand `/Rect` to cover the leader
       * line** and record the inset back to the box in `/RD`. So the key is
       * load-bearing rather than decorative: without it the rectangle a reader
       * hit-tests against excludes the line, and PDF 32000 says `/CL` applies
       * only where `/IT` names a callout.
       *
       * ## Two points of leader, and the elbow is OWED
       *
       * The payload carries where it points and where the note sits, and MuPDF
       * computes which edge of the box the line meets. A three-point leader with
       * a knee needs a press the gesture can tell apart from the box's corner,
       * which is a tool question rather than a payload one.
       */
      type: z.literal('callout'),
      /** What it points AT, in PDF user space. */
      at: annotationPointSchema,
      /** The box the note sits in. */
      rect: annotationRectSchema,
      /** What it says. `text-box`' field and its rules. */
      text: z.string().min(1).max(MAX_ANNOTATION_TEXT),
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      fontSize: z.number().min(MIN_ANNOTATION_FONT).max(MAX_ANNOTATION_FONT),
    })
    .strict(),
  z
    .object({
      /**
       * `/Subtype /FreeText` with `/IT /FreeTextTypeWriter` — words typed onto
       * the page, with no box around them.
       *
       * ## What separates it from `text-box` had to be MADE REAL
       *
       * The two write the same subtype and the same three calls, and until
       * 2026-09-07 they would have produced identical documents: a text box
       * drew no box. Measured — `createAnnotation('FreeText')` leaves
       * `/BS << /W 0 >>` and MuPDF's appearance stream is `0 w … re W n`, a
       * clip with no stroke. Two controls whose output cannot be told apart is
       * the display-only sin with a second button on it.
       *
       * So the text box gained the border its name promises and this one keeps
       * none, which is what a typewriter is. The key is written too, because
       * `/IT` is what a reader's own editing tools consult, and the format's
       * default for an absent `/IT` is `FreeText` — so the box says nothing and
       * these two say what they are.
       */
      type: z.literal('typewriter'),
      /** The box the words are laid out in, in PDF user space. */
      rect: annotationRectSchema,
      /** What it says. `text-box`' field and its rules. */
      text: z.string().min(1).max(MAX_ANNOTATION_TEXT),
      colour: annotationColourSchema,
      opacity: annotationOpacitySchema,
      fontSize: z.number().min(MIN_ANNOTATION_FONT).max(MAX_ANNOTATION_FONT),
    })
    .strict(),
]);

/** One annotation, as the tool that drew it describes it. */
export type AnnotationDraft = z.infer<typeof annotationDraftSchema>;


/**
 * What a READER may call an annotation it found — every kind this build writes,
 * plus `'other'`.
 *
 * ## It lives here because {@link annotationDraftSchema} is the authority
 *
 * This list used to be spelt out a second time, inside `document.annotations`'
 * answer schema, and the two were kept in step by hand. That is B3a's shape
 * exactly: *which kinds does this build write* is a question the draft union
 * already answers, and a second statement of it agrees most of the time.
 *
 * The sticky note is what found it. Adding a member to the union above reddened
 * the build at the channel — which is the *good* direction, because
 * `ListedAnnotation`'s kind is derived and TypeScript could see the two lists
 * disagree. The other direction is the quiet one: a name added to the channel's
 * enum that no tool writes is a label the catalogue carries and nothing can
 * reach, and nothing at all would have reported it.
 *
 * ## Asserted rather than computed, and that is deliberate
 *
 * Deriving the enum from `annotationDraftSchema.options` would mean mapping over
 * the members, which produces `string[]` — `z.enum` would then answer a schema
 * whose inferred type is `string`, and every reader that switches on a kind
 * would lose its exhaustiveness check. So the list is written and the
 * relationship is a **compile-time assertion in both directions**, which costs
 * two type aliases and keeps the union narrow.
 *
 * Both directions, because they fail differently and only one of them is loud:
 * a missing name is a kind the kernel can produce and the channel cannot carry,
 * and an extra one is a label nothing will ever produce.
 */
export const annotationKindNameSchema = z.enum([
  'square',
  'circle',
  'line',
  'ink',
  'redact',
  'text-box',
  'sticky-note',
  'caret',
  // ONE NAME FOR THE POLYGON AND THE CLOUD, because a reader is being told what
  // is on the page and both are `/Polygon`. The border effect separates the two
  // tools, not the two objects — the same reason a line and an arrow share a
  // name here.
  'polygon',
  'polyline',
  // THREE NAMES FOR THREE SUBTYPES, unlike the pair above, and the difference is
  // what the file says: a cloud and a polygon are both `/Polygon`, where these
  // are `/Highlight`, `/Underline` and `/StrikeOut`. A reader is told what the
  // object is.
  'highlight',
  'underline',
  'strikeout',
  // A NAME OF ITS OWN, although a callout is a `/FreeText` like a text box —
  // and this is the pair the polygon/cloud rule does NOT cover. What separates
  // them is `/IT /FreeTextCallout`, a key in the file rather than a tool's
  // vocabulary, so a reader looking at a callout is looking at something the
  // document itself distinguishes.
  'callout',
  // THE THIRD `/FreeText` KIND, and the three are separated by `/IT` rather
  // than by the subtype — which is a fact about the file and not a tool's
  // vocabulary, so a reader is being told what the document says.
  'typewriter',
  'other',
]);

/** What a reader may call an annotation. See {@link annotationKindNameSchema}. */
export type AnnotationKindName = z.infer<typeof annotationKindNameSchema>;

/** Every kind a tool can write has a name a reader can use. */
const _everyDraftIsNameable: AnnotationDraft['type'] extends AnnotationKindName ? true : never =
  true;
void _everyDraftIsNameable;

/** And no name exists that no tool writes — `'other'` being the one exception. */
const _everyNameIsWritten: Exclude<AnnotationKindName, 'other'> extends AnnotationDraft['type']
  ? true
  : never = true;
void _everyNameIsWritten;

/**
 * Add one annotation to one page.
 *
 * §3's matrix at `docs/ARCHITECTURE.md`:386 puts *Annotations (all types),
 * appearance streams* on MuPDF, so this is written through the structural
 * writer of record rather than composed into the content stream. That is a
 * classification and not a preference: an annotation is an object in
 * `/Annots` with its own appearance stream, which is what makes it selectable,
 * editable and erasable later; drawing the same rectangle into `/Contents`
 * would produce a document that looks identical and has no annotation in it.
 *
 * ## One page, and one annotation
 *
 * A tool commits one shape at the end of one drag, so a command carrying a list
 * would have exactly one member at every call site this stage builds. The
 * multi-page form Stage 3 does name — *stamps: multi-page apply* — repeats an
 * annotation across a scope, which is a different intent with a different undo,
 * and it takes the scope union `cropPages` introduced rather than widening this.
 */
export const addAnnotationSchema = z.object({
  kind: z.literal('addAnnotation'),
  /** Zero-based index of the page it goes on. */
  page: z.number().int().nonnegative(),
  /** What was drawn. */
  annotation: annotationDraftSchema,
});

/**
 * How many annotations one removal may name.
 *
 * `MAX_POLYGON_POINTS`' kind of bound and not the channel's: this is **intent**
 * — how many marks a person selected on one page — where `MAX_ANNOTATIONS`
 * bounds a document-scaled read. The two numbers are deliberately unrelated and
 * stated separately, which is `MAX_ANNOTATIONS`' own note about
 * `MAX_DUPLICATE_PAGES` applied one noun along: two bounds that happen to agree
 * are not one bound.
 *
 * Far past what a marquee over one page collects and far short of what a
 * hostile renderer could try.
 */
export const MAX_REMOVED_ANNOTATIONS = 1024;

/**
 * Removes annotations on one page, named by where they sat in a walk the caller
 * has seen.
 *
 * ## PLURAL, and it became plural the day something could select two
 *
 * This carried one `index` until the select tool, and one index cannot express
 * *delete these*. Not for want of trying: a caller could send one command per
 * annotation, in **descending** index order so the removals below stay valid,
 * taking the new version from each answer. That works, and it is wrong twice
 * over. It makes deleting five marks five undo steps, when a person made one
 * decision. And *descending order keeps the rest valid* is a rule about the
 * kernel's own walk, held in a loop in the renderer — the second opinion B3a
 * spends its time on, about the one question ADR-0041 exists to answer.
 *
 * With the list on this side the rule dissolves rather than moving: the kernel
 * resolves all of them first, and a resolved annotation is a handle to an
 * object rather than a position. `deletePages([3, 5])` is the precedent on the
 * neighbouring noun.
 *
 * ## ONE PAGE, because a selection cannot span two
 *
 * The overlay is mounted per page and a gesture belongs to the page it started
 * on, so neither a click nor a marquee can reach a second one. A payload of
 * `{ page, index }` pairs would be a shape nothing can currently produce —
 * built ahead of its caller, and unexercised in the direction that matters. The
 * day a surface can select across pages is the day this gains that shape.
 *
 * ## The version is part of the NAME, not a precaution beside it
 *
 * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md).
 * `page` and `index` locate an annotation in `document.annotations`' answer, and
 * that answer is a total order over a fixed set **for one version only** —
 * across versions the pair is not an identity at all, it is arithmetic that
 * still lands somewhere. So the three fields are one name, and the kernel
 * refuses the command when the document has moved rather than acting on two
 * thirds of it.
 *
 * The failure it prevents leaves no trace: a stale index is in range, names a
 * real annotation and deletes it, and the document afterwards is well formed.
 *
 * ## The index is the WALK's, which the reader must not re-derive
 *
 * Not a position in the page's `/Annots` array. MuPDF filters widgets out of
 * the walk, so on a page carrying form fields the two differ by the number of
 * fields above the annotation — and both are in range. `pageAnnotations.ts`
 * mints it and resolves it; nothing else computes either.
 */
export const removeAnnotationSchema = z.object({
  kind: z.literal('removeAnnotation'),
  /** Zero-based index of the page they sit on. */
  page: z.number().int().nonnegative(),
  /**
   * Their positions in the walk that produced the answer this names.
   *
   * **Order is not part of the intent.** The kernel resolves every index to an
   * annotation *before* deleting any of them, so what a removal shifts is
   * positions and these are no longer positions by then. A caller that had to
   * sort — or that sent one command per annotation in descending order — would
   * be holding a rule about the walk on the wrong side of the boundary.
   *
   * At least one, because a removal of nothing is not a command.
   */
  indices: z.array(z.number().int().nonnegative()).min(1).max(MAX_REMOVED_ANNOTATIONS).readonly(),
  /** The version that answer carried. Refused if the document has moved. */
  version: docVersionSchema,
});

/**
 * How many annotations one placement may move.
 *
 * {@link MAX_REMOVED_ANNOTATIONS}' number and its argument, stated separately
 * because they are separate bounds: this one is *how many a person is dragging*
 * and that one is *how many they are deleting*, and tying them would move either
 * silently.
 */
export const MAX_PLACED_ANNOTATIONS = 1024;

/**
 * Moves or resizes annotations on one page, each to a rectangle it should now
 * occupy.
 *
 * ## ONE COMMAND FOR BOTH, because the payload says where, not how
 *
 * A nudge is a translation and a handle drag is a scale, and the difference is
 * entirely in the rectangles a surface computes. Two commands would be two
 * declarations, two applies and two undo entries for one operation the format
 * cannot tell apart.
 *
 * ## The rectangle is the annotation's own box, and for four subtypes it is
 * DERIVED from the geometry
 *
 * `Ink`, `Line`, `Polygon` and `PolyLine` have no `/Rect` to set — MuPDF refuses
 * `getRect` on them and computes the rectangle from the points. So the kernel
 * maps the geometry from the box it currently occupies into this one, which is
 * what makes a polygon draggable at all rather than a subtype the tool has to
 * exclude.
 *
 * **A `/Text` and a `/Caret` move but do not resize.** MuPDF clamps their boxes
 * (`pageAnnotations.ts` carries the measurement), so a request to make a note
 * bigger stores the same box in the new place. That is the engine's rule
 * arriving intact rather than a refusal invented here.
 *
 * ## Plural for `removeAnnotation`'s reason
 *
 * Nudging four selected marks is one decision and must be one version bump, or
 * three of the four handles are stale before the second command is sent.
 */
export const placeAnnotationSchema = z.object({
  kind: z.literal('placeAnnotation'),
  /** Zero-based index of the page they sit on. */
  page: z.number().int().nonnegative(),
  /** Where each named annotation should end up. Order carries no meaning. */
  placements: z
    .array(
      z.object({
        /** Its position in the walk that produced the answer this names. */
        index: z.number().int().nonnegative(),
        /** The box it should occupy, in PDF user space. */
        rect: annotationRectSchema,
      }),
    )
    .min(1)
    .max(MAX_PLACED_ANNOTATIONS)
    .readonly(),
  /** The version that answer carried. Refused if the document has moved. */
  version: docVersionSchema,
});

/**
 * The URI schemes a link this build writes may carry.
 *
 * ## The list is short because we are the PRODUCER here
 *
 * Invariant 24 says opening a document runs none of its content — no embedded
 * JavaScript, no automatic action. That is a rule about what this application
 * *does with* a document. Writing a link is the other direction: the document
 * we produce travels, and a `javascript:` URI in it is the active content that
 * invariant refuses to run, authored by us for somebody else's reader to meet.
 * Writing what we would not open is the display-only sin turned outward.
 *
 * `file:` is refused for the neighbouring reason: it puts a path off this
 * machine into a document that leaves it, which is a `FileHandle`'s whole
 * argument arriving in a payload nobody thought of as one.
 *
 * So three schemes, and the refusal is in the SCHEMA rather than in a check
 * some caller runs: a link with a scheme this build will not write is
 * unrepresentable (B5), and a surface that wanted one would have to amend this.
 */
export const LINK_SCHEMES = ['https:', 'http:', 'mailto:'] as const;

/**
 * How long a link's URI may be.
 *
 * Intent, so it is bounded for `MAX_ANNOTATION_TEXT`'s reason rather than
 * because a URL cannot be longer: a person types this, and a renderer that
 * could send an unbounded string is one that can send anything.
 */
export const MAX_LINK_URI = 2048;

/**
 * A URI a link may point at — parsed, not pattern-matched.
 *
 * `new URL(...)` is the platform's own parser, which is what decides what a
 * scheme is; a regular expression here would be a second opinion about a
 * grammar that already has one, and it would disagree on exactly the inputs
 * somebody chose deliberately.
 */
/**
 * The platform's URL parser, declared rather than imported.
 *
 * This package compiles with `lib: ["ES2023"]` and `types: []` — no DOM, no
 * Node — because its schemas run in main, in the renderer and inside the engine
 * host, and a lib that named `document` or `process` would let one of them
 * reach for something the others do not have. `URL` is a WHATWG global present
 * in every one of those runtimes and absent from that lib.
 *
 * So this is one line of ambient declaration rather than a widened lib: the
 * alternative was adding `DOM`, which would make the whole browser surface
 * visible in the package whose job is to be environment-free.
 *
 * Only `protocol` is declared, because only `protocol` is used.
 */
declare const URL: new (input: string) => { readonly protocol: string };

export const linkUriSchema = z
  .string()
  .min(1)
  .max(MAX_LINK_URI)
  .refine(
    (value) => {
      try {
        return (LINK_SCHEMES as readonly string[]).includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `not an absolute URL with one of these schemes: ${LINK_SCHEMES.join(' ')}` },
  );

/** Where a link goes. */
export const linkTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uri'), uri: linkUriSchema }).strict(),
  z
    .object({
      kind: z.literal('page'),
      /** Zero-based, as every page index that crosses this contract is. */
      page: z.number().int().nonnegative(),
    })
    .strict(),
]);

/** Where a link goes. See {@link linkTargetSchema}. */
export type LinkTarget = z.infer<typeof linkTargetSchema>;

/**
 * Adds a link over a rectangle of one page.
 *
 * ## A LINK IS NOT AN ANNOTATION, and that is measured rather than stylistic
 *
 * Measured 2026-09-06 against MuPDF 1.28.0. `PDFPage.createLink(bbox, uri)`
 * makes a `/Link` that `getLinks()` returns and `getAnnotations()` does **not**;
 * `createAnnotation('Link')` makes a different object that appears in the
 * annotation walk, is refused `setRect` — *"Link annotations have no Rect
 * property"* — and does **not** appear in `getLinks()`. Two ways to write the
 * same subtype, with different behaviour, and only one of them produces a link
 * a reader can follow.
 *
 * So this is its own command rather than a member of `annotationDraftSchema`.
 * It also keeps the annotation walk, the eraser and the annotations panel
 * exactly as they were: a link is invisible to all three, and
 * `document.pageLinks` is the read that already answers for them.
 *
 * ## The target is a UNION, not a URI with a convention in it
 *
 * MuPDF spells an internal destination as a URI too — `#page=3&zoom=…` — and it
 * would have been easy to make this one string. Rejected: a page number typed
 * into a URL field is then this build parsing its own convention out of a
 * string, and the schema could not tell a link to page 3 from a link to a site
 * called `#page=3`. The union says which was meant, and the kernel formats it
 * through `formatLinkURI`, which is MuPDF's own rule (B3a).
 */
export const addLinkSchema = z.object({
  kind: z.literal('addLink'),
  /** Zero-based index of the page the link sits on. */
  page: z.number().int().nonnegative(),
  /** The rectangle it covers, in PDF user space. */
  rect: annotationRectSchema,
  target: linkTargetSchema,
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
  replacePageSchema,
  addAnnotationSchema,
  removeAnnotationSchema,
  placeAnnotationSchema,
  addLinkSchema,
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
  replacePageSchema,
  // RENDERABLE, and it is the union's own test rather than an exception: the
  // intent is a page index and a rectangle in the page's own space, which is
  // six numbers whatever the document weighs. The picture the user is pointing
  // at never crosses, in either direction.
  addAnnotationSchema,
  // RENDERABLE, and its intent is three numbers — but note what it is NOT: the
  // renderer names a row of an answer it was given, never an object. It cannot
  // reach an annotation main did not just describe to it, and cannot express one
  // that was never listed.
  removeAnnotationSchema,
  // RENDERABLE, and the same test with a rectangle added: the renderer names
  // rows of an answer it was given and says where each should end up. What it
  // cannot express is HOW — the geometry a polygon or a stroke is made of never
  // crosses in either direction, and the kernel maps it.
  placeAnnotationSchema,
  // RENDERABLE, and the payload is a rectangle plus either a URI a person typed
  // or a page index. What the renderer cannot express is the destination's
  // FORM: a page link is written through MuPDF's own `formatLinkURI`, so the
  // `/GoTo` array is never something a surface spells.
  addLinkSchema,
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
  if (command.kind === 'mergeDocument' || command.kind === 'replacePage') {
    return [command.source];
  }
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
 * Which kinds {@link sourceIdsOf} answers non-empty for.
 *
 * **Exported so the kernel can anchor it**, which is the whole point. The `if`
 * above is a hand-kept list, and a hand-kept list is right only where something
 * else refuses to let it drift. The anchor is the kernel's `sources` axis; this
 * package cannot import the kernel, so the tie is written *there*, in
 * `commandDeclarations.test.ts`, as a mutual assignability between this type
 * and the kinds whose declaration says `sources: 'one'`.
 *
 * ## The line below checks less than its old name claimed
 *
 * It checks that both names are real `CommandKind`s. That is all it has ever
 * checked. It was called `_switchCoversExactlyThose` and introduced as
 * *"checked in both directions"*, and it is neither: adding a third kind to
 * this type leaves it green, and so does dropping one from the `if`.
 *
 * The comment also said the kernel's `commandDeclarations.test.ts` held the
 * other half. **That file did not mention this axis at all** until 2026-09-06 —
 * measured with `grep -n sources` over it, which returned nothing. The citation
 * named a real file doing real work of its own, so opening it confirmed a test
 * exists rather than that this claim was in it, and the half the comment itself
 * called load-bearing was resting on no assertion anywhere.
 *
 * Kept and renamed rather than deleted: a misspelt kind here is still worth a
 * compile error, and a name that overstates a check is worse than no check.
 */
export type NamesASecondDocument = 'mergeDocument' | 'replacePage';
const _bothNamesAreCommandKinds: NamesASecondDocument extends CommandKind ? true : never = true;
void _bothNamesAreCommandKinds;

/**
 * The version a command's payload says it was composed against, if any.
 *
 * `sourceIdsOf`'s sibling on ADR-0041's axis, and deliberately the same shape:
 * *which state a payload names* is a question about the payload, and the payload
 * is the contract's. The kernel asks rather than reading fields, so a second
 * command that names existing state is added in one place.
 *
 * The `if` is on the KIND for `sourceIdsOf`'s reason. A structural test —
 * `'version' in command` — would pick up any future field spelt `version`,
 * including one that is not a `DocVersion` and one that means something else
 * entirely; and a `switch` with a `default` stops being exhaustive, so a new
 * kind falls through it silently.
 */
export function targetVersionOf(command: Command): DocVersion | undefined {
  if (command.kind === 'removeAnnotation') return command.version;
  if (command.kind === 'placeAnnotation') return command.version;
  return undefined;
}

/**
 * Which kinds {@link targetVersionOf} answers with a version for.
 *
 * Exported for the kernel to anchor against its `targets` axis, exactly as
 * {@link NamesASecondDocument} is anchored against `sources`. That tie lives in
 * `commandDeclarations.test.ts` and is a mutual assignability — this package
 * cannot import the kernel, so the half checkable here is only that the name is
 * a real kind, and saying so is what stopped the sibling above from spending a
 * range asserting nothing.
 */
export type NamesAnAnnotation = 'removeAnnotation' | 'placeAnnotation';
const _thatNameIsACommandKind: NamesAnAnnotation extends CommandKind ? true : never = true;
void _thatNameIsACommandKind;
