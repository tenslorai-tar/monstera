import { z } from 'zod';

import {
  LISTED_POINTS_MAX,
  MAX_ANNOTATION_BORDER,
  annotationAuthorSchema,
  annotationBlendSchema,
  annotationInstantSchema,
  annotationKindNameSchema,
  annotationPointSchema,
  annotationRectSchema,
  annotationWordsStyleSchema,
  measureScaleSchema,
} from './commands.js';
import { measuredKindSchema } from './measurement.js';

/**
 * How much of one mark's note a listing carries; past it the entry is a slice and says `cut`. One line in a panel,
 * and a SLICE rather than a refusal: a note longer than this is still a note, and refusing the annotation would
 * hide it from the list it belongs in.
 *
 * In this module rather than `channels.ts` because the row below is also the engine host's, and a host loads the
 * contract through `host.ts`, which leaves the renderer's channel map out (ADR-0026).
 */
export const MAX_ANNOTATION_CONTENTS = 512;

/**
 * One annotation, as a list of them crosses ANY boundary: from the engine host to `main` (`engine/annotations`) and
 * from `main` to the renderer (`document.annotations`). ONE definition, which both channels take, so a key the
 * reader starts listing is admitted at both crossings or at neither (B3a). It was two until 2026-10-16, and the
 * host's strict copy lacked `object` and `measured` when the renderer's gained them: every document with marks
 * answered `internal` from the host, which no unit test saw because they run the reader in the test's own process.
 * Strict, as the host side was: a key nobody declared is a reader and a schema that disagree, never data to drop.
 */
export const listedAnnotationSchema = z
  .object({
    /** Zero-based, so a panel can hand it straight to a jump. */
    page: z.number().int().nonnegative(),
    /**
     * Its position among the annotations on that page, in the walk that
     * produced this answer — the half of a handle that says which one
     * ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)).
     *
     * **Not an index into the page's `/Annots` array.** MuPDF filters
     * widgets out of the walk, so on a page carrying form fields the
     * two differ by the number of fields above the annotation, and both
     * are in range. Nothing outside the kernel's reader derives either.
     *
     * Valid only against the `version` beside it. A command naming an
     * annotation carries that version and is refused if the document
     * has moved, because across versions this is not an identity.
     */
    index: z.number().int().nonnegative(),
    /**
     * Where it is, in **PDF user space** — the frame a draft names, so
     * a surface converts it with the `PageTransform` it already holds
     * rather than being handed a second coordinate space.
     *
     * **The bounding box, not the shape.** A line's rectangle is the
     * box its ends span; a point inside it is near the annotation
     * rather than on it. That is what the eraser hit-tests against.
     *
     * **`null` when the page displays no region**, which is a real
     * state a hostile document can produce. The annotation is still
     * listed — it is still there — and a surface that needs a place
     * skips it rather than acting on an invented one.
     */
    rect: annotationRectSchema.nullable(),
    /**
     * A line's two ends, or a polygon's or polyline's corners, in PDF user space, on those alone and up to
     * `LISTED_POINTS_MAX` (the owner's O8): the select tool's handles move each point rather than scaling a box.
     */
    points: z.array(annotationPointSchema).min(2).max(LISTED_POINTS_MAX).exactOptional(),
    /**
     * What a MEASUREMENT measures and at which scale: its `/IT` and its own `/Measure`, read by the kernel's one
     * reading of them, the one that rewrites `/Contents` after a reshape (the owner's B1). So a drag shows the
     * reading the release will write, worked out by the contract's `measureLabel` from the points under the
     * pointer, and the label and the Comment take that one number. Absent on every other mark, and on a
     * measurement whose `/Measure` this build cannot read, which keeps the words it has.
     */
    measured: z
      .object({ kind: measuredKindSchema, scale: measureScaleSchema })
      .strict()
      .exactOptional(),
    /**
     * The annotation dictionary's object number, absent where it is a direct object. Not a handle (that is
     * `index` with the version): it names the mark to the renderer's PDF.js, which builds its own annotation
     * ids from it, so a reshape's drag can draw the page without the mark it is reshaping (the owner's B1).
     */
    object: z.number().int().positive().exactOptional(),
    /**
     * What it is drawn in — `/C`, `/CA` and `/BS`'s width.
     *
     * Carried so a styles panel can show what an annotation IS rather
     * than only what it is about to become. **`borderWidth` is `null`
     * where the subtype has none**: measured 2026-09-07, six of the
     * thirteen refuse `setBorderWidth` outright, and a zero here would
     * be a width a control then offers to change.
     *
     * The colour is a bare number list rather than
     * `annotationColourSchema` because a document may carry one, three
     * or four components — grey, RGB or CMYK — where this build writes
     * three. A reader is being told what is there.
     */
    style: z
      .object({
        colour: z.array(z.number().min(0).max(1)).max(4).readonly(),
        opacity: z.number().min(0).max(1),
        borderWidth: z.number().min(0).max(MAX_ANNOTATION_BORDER).nullable(),
      })
      .strict(),
    /**
     * **A closed union, not the document's `/Subtype`.**
     *
     * A subtype is a `/Name` a hostile document chooses, and a renderer
     * receiving one would have to label a string nobody anticipated —
     * which B9 forbids, since there is no message key for it. The
     * members are the kinds this build writes; everything else is
     * `other`, which is honest and which a panel has a key for.
     *
     * A member is added on the day a tool writes that kind, not before:
     * a label for something no document here produces is a string in
     * the catalogue that nothing can reach.
     *
     * **IMPORTED RATHER THAN SPELT OUT**, which it was until the sticky
     * note arrived and made the two lists disagree. `commands.ts` owns
     * *what this build writes* — the draft union is that question's
     * answer — so a second enum here was a second opinion about it
     * (B3a), and the direction that stayed quiet was a name listed here
     * that no tool produces.
     */
    kind: annotationKindNameSchema,
    /**
     * The annotation's own note, or empty.
     *
     * Almost always a FOREIGN annotation's: nothing this build writes
     * sets one, because no control collects it. That arrives with the
     * comment field, and until then a row of this build's own is
     * identified by its kind and its page.
     */
    contents: z.string().max(MAX_ANNOTATION_CONTENTS),
    /**
     * Whether **this build wrote it** — the `srcRef` mark, which is a
     * private key on the annotation's own dictionary
     * ([ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)).
     *
     * `false` means it came with the document, or was written by a
     * version of this build older than the scheme. The scheme is
     * one-sided by construction: we may not write onto an annotation we
     * did not author, so nothing is ever marked foreign and absence is
     * what foreign means.
     *
     * **Provenance, not permission.** A person may erase or move
     * either; this is what lets the surface say which one is about to
     * change, and what makes *annotations this build did not author* a
     * computable set rather than a sentence in an invariant.
     */
    authored: z.boolean(),
    /**
     * The walk index of the annotation this one ANSWERS, or `null`.
     *
     * PDF 32000-1 §12.5.6.2's `/IRT` with `/RT /R` — a reply, in the
     * format's own terms. Carried so a surface can show a thread rather
     * than two marks stacked on one spot: without it a reply is
     * indistinguishable from a loose note sitting on the comment it
     * answers, which is what every panel here would have drawn.
     *
     * **Resolved to a walk index on this side of the boundary**, never
     * handed over as an object number. The walk is the only identity
     * this contract has for an annotation
     * ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)),
     * and a raw object number would be a second one — valid against the
     * file rather than against this answer's `version`, and meaningless
     * to everything that already speaks in indices.
     *
     * **`null` also covers a reference the walk does not contain**, and
     * that is a real state rather than a defect: `/IRT` may point at a
     * widget, at an annotation on another page, or at an object that is
     * not an annotation at all. A reply to something this answer cannot
     * name is listed as an ordinary mark, which is honest — the
     * alternative is an index into a list the target is not in.
     *
     * Always on the SAME page, when it is present: `/IRT` naming a mark
     * on another page is answered as `null` for that reason, since the
     * index would be read against this entry's own page.
     */
    inReplyTo: z.number().int().nonnegative().nullable(),
    /**
     * Who made it — `/T`, or empty where the document names nobody (ADR-0103). Sliced to
     * the bound rather than refused, for `contents`' reason: a long name is still a name.
     */
    author: annotationAuthorSchema,
    /**
     * When it was made — `/CreationDate` as a UTC instant, or `null` where the document
     * carries none or one that does not parse. Never invented: a mark with no date says so.
     */
    created: annotationInstantSchema.nullable(),
    /**
     * The blend its appearance is DRAWN in — what a viewer shows, read from the appearance
     * stream rather than from the dictionary's `/BM` claim (ADR-0103).
     */
    blend: annotationBlendSchema,
    /**
     * Present and true on a STAMP WHOSE APPEARANCE DRAWS A PICTURE — what *Comment › Image* places. A picture
     * a person put on a page is this, not page content, so `document.pageObjects` never lists it; Edit
     * object's *Images* reads this to find it (the owner's item 14g). Absent on everything else, so a walk
     * that predates it reads as it did.
     */
    pictured: z.literal(true).exactOptional(),
    /**
     * Present and true where `contents` is a SLICE of longer words. A panel shows the slice; an editor reads
     * the mark's whole words through `document.annotationWords` before it starts, so no edit saves a slice
     * over a long comment.
     */
    cut: z.literal(true).exactOptional(),
    /**
     * How a TEXT MARK'S WORDS are drawn — a text box's, a typewriter's or a callout's `/DA` and `/Q` — so a
     * double-click edits them in their own box, in their own size and colour (ADR-0154 Decision 3). Absent on
     * every other kind, and on a text mark whose `/DA` says something the bounds cannot hold (an auto size,
     * for one): that one is edited on a card beside it instead, never refused.
     */
    typed: annotationWordsStyleSchema.exactOptional(),
  })
  .strict();
