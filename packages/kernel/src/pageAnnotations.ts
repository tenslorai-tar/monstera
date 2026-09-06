import type {
  AnnotationDraft,
  AnnotationKindName,
  AnnotationPoint,
  AnnotationRect,
  CommandOfKind,
  LineEnding,
} from '@monstera/contract';
import {
  type PageTransform,
  pageTransform,
  pdfPoint,
  toPdf,
  toViewport,
  viewportPoint,
} from '@monstera/shared';
import type {
  PDFAnnotation,
  PDFAnnotationLineEndingStyle,
  PDFAnnotationType,
  PDFDocument,
  PDFPage,
} from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { displayedBox } from './pageBoxes.js';
import { snapRotation } from './rotatePages.js';

/**
 * Writing one annotation a tool drew.
 *
 * ## THE COORDINATE BOUNDARY IS THIS MODULE'S SUBJECT
 *
 * The command carries a rectangle in **PDF user space** — y up, the page's own
 * frame ({@link AnnotationRect} says why). MuPDF's `PDFAnnotation.setRect` does
 * **not** take that space, and its declaration does not say so.
 *
 * Measured 2026-09-05 against MuPDF 1.28.0, on `/MediaBox [0 0 200 300]`:
 * `setRect([10, 20, 110, 70])` stores `/Rect [9.5 229.5 110.5 280.5]`. The y
 * values are flipped about the box's top; on a `/Rotate 90` page the axes swap
 * as well. The space it takes is the page's **displayed** space — y down, after
 * rotation, origin at the visible box's corner.
 *
 * That is the wired-tools rule's blind spot arriving exactly where it said it
 * would: two halves either side of a boundary, each correct in its own frame,
 * with the unit change in a literal at the call site. `getRect` returns what
 * `setRect` was given, so a round trip through MuPDF's own API agrees with
 * itself whichever space you believed you were in — and the annotation is on
 * the wrong part of the page.
 *
 * ## The conversion is `PageTransform`, and that it IS MuPDF's was measured
 *
 * Invariant L3 and §6: one converter, one affine implementation, no bare
 * y-flip. So the rectangle goes through {@link toViewport} at scale 1, built
 * from the page's displayed box and its effective rotation.
 *
 * That is a claim about MuPDF's frame written in this repository's terms, and
 * the two could differ without anything noticing — so they are compared rather
 * than assumed. `PDFPage.getTransform()` is `pdf_page_transform`, the matrix
 * MuPDF itself places the annotation with; `pageBoxes.test.ts` maps probe
 * points through both across four rotations, cropped and uncropped, and
 * requires them equal. That check lives beside the box rule because the box is
 * what the two could disagree about.
 *
 * ## What this module deliberately does not do
 *
 * **It marks authorship, as of 2026-09-06.** This paragraph read *"it does not"*
 * until [ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md),
 * and the reason it did not — that inventing a scheme inside the first drawing
 * tool is how a sidecar hack starts, since the tempting fields (`/NM`, `/T`)
 * already mean something else — is why the scheme is a **key of its own** rather
 * than one of them. See {@link markAuthored}. The weaker half is still asserted
 * beside it: a foreign annotation on the same page keeps every key it arrived
 * with, which is what rules out an add rewriting the array it joins.
 *
 * **It does not clamp.** A rectangle that overlaps the page is written as
 * drawn; one that misses it entirely is refused, because an annotation nothing
 * can see is the display-only defect at document scale. Clamping instead would
 * silently move what the caller asked for.
 */

/**
 * The page dictionary for a validated index, or a named refusal.
 *
 * The third copy of this shape in the kernel, and it is deliberately not shared
 * yet: `pageCrop.ts` and `rotatePages.ts` hold their own, each phrased for the
 * command it refuses on behalf of. What would make it one function is a caller
 * that needs the page OBJECT and the page — this one needs the `PDFPage` as
 * well, to create an annotation on it, which neither of those does.
 */
function pageAt(document: PDFDocument, page: number, total: number): PDFPage {
  if (!Number.isInteger(page) || page < 0 || page >= total) {
    throw new RangeError(
      `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
        'Page indices are zero-based.',
    );
  }
  return document.loadPage(page);
}

/**
 * The page's transform at scale 1, or `null` when the page displays no region.
 *
 * **Nullable for the READER's sake, and {@link transformFor} throws for the
 * writer's.** Adding an annotation to a page with no frame is a refusal — there
 * is nowhere to put it. Listing the annotations already on such a page is not:
 * they are there, a panel headed *the annotations in this document* must say
 * so, and refusing the whole document because one page has a broken `/MediaBox`
 * would hide every other page's marks behind one hostile one.
 */
export function frameOf(loaded: PDFPage): PageTransform | null {
  const object = loaded.getObject();
  const box = displayedBox(object);
  if (box === null) return null;
  // The EFFECTIVE rotation, snapped, exactly as `readPageGeometry` reads it and
  // through the same function: the renderer drew the page turned, so the frame
  // the user pointed in is the turned one. `getInheritable` because a page may
  // take its rotation from an ancestor `/Pages` node.
  const inherited = object.getInheritable('Rotate');
  const rotation = inherited.isNumber() ? snapRotation(inherited.asNumber()) : 0;
  return pageTransform(box, rotation, 1);
}

/** {@link frameOf}, refusing rather than answering `null`. What a write needs. */
function transformFor(loaded: PDFPage): PageTransform {
  const frame = frameOf(loaded);
  if (frame === null) {
    throw new RangeError(
      'this page displays no region — it has no /MediaBox of four numbers, or its /CropBox and ' +
        '/MediaBox do not overlap — so there is no frame to place an annotation in',
    );
  }
  return frame;
}

/**
 * A rectangle in PDF user space, as the four numbers MuPDF's annotation API
 * takes.
 *
 * Both corners go through the transform and the result is normalised
 * **afterwards**. That ordering does the work twice over, and neither half is
 * about tidiness:
 *
 * - The command's rectangle need not be ordered, because a drag runs whichever
 *   way the pointer went — {@link annotationRectSchema} says so and leaves it
 *   here.
 * - Even an ordered one comes out unordered: every rotation but 0 reverses at
 *   least one axis, and the y-flip reverses the other, so the corner that was
 *   smallest in PDF space is not the corner that is smallest in the page's
 *   displayed space.
 *
 * Taking `min` and `max` of the two transformed corners covers both, and it is
 * correct for an affine map precisely because the transform sends corners to
 * corners. Nothing here relies on MuPDF normalising an inverted rectangle; what
 * it does with one was not measured, and a rule that depends on an unmeasured
 * tolerance is a rule that changes when the version does.
 */
export function placedRect(
  rect: AnnotationRect,
  transform: PageTransform,
): [number, number, number, number] {
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

/**
 * The box an annotation occupies, in the page's **displayed** space.
 *
 * One function because the reader and the writer must agree about it: what
 * {@link readRect} reports is what a surface draws a handle on and what
 * {@link applyPlaceAnnotation} maps a placement out of, and two answers to
 * *where is it now* would land a resize a border-width away from where the
 * handle was dropped.
 *
 * `getRect` is refused by four subtypes; see {@link readRect} for the
 * measurement and for why `getBounds` alone is not the answer either.
 */
function displayedBoxOf(annotation: PDFAnnotation): [number, number, number, number] {
  const [x0, y0, x1, y1] = annotation.hasRect()
    ? annotation.getRect()
    : annotation.getBounds();
  return [x0, y0, x1, y1];
}

/**
 * The box the annotation's own POINTS span, or `null` when it has none.
 *
 * Not the same box as {@link displayedBoxOf} for the four subtypes that have
 * one: `getBounds` is the **appearance's** extent and carries the stroke width,
 * measured at 2 points on an ink stroke and up to 11 on a cloud. The difference
 * is what makes a resize land where the handle was dropped rather than a border
 * away from it — see {@link applyPlaceAnnotation}.
 */
function geometryBoxOf(annotation: PDFAnnotation): [number, number, number, number] | null {
  const points: (readonly [number, number])[] = [];
  if (annotation.hasVertices()) points.push(...annotation.getVertices());
  if (annotation.hasInkList()) for (const stroke of annotation.getInkList()) points.push(...stroke);
  if (annotation.hasLine()) points.push(...annotation.getLine());
  const [first, ...rest] = points;
  if (first === undefined) return null;
  let [x0, y0] = first;
  let [x1, y1] = first;
  for (const [x, y] of rest) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/**
 * Where an existing annotation is, in **PDF user space** — {@link placedRect}
 * run backwards.
 *
 * `PDFAnnotation.getRect` answers in the page's *displayed* space, which is the
 * space `setRect` takes and not the space a command names: y down, after
 * rotation, origin at the visible box's corner. Measured 2026-09-05 and
 * recorded at the top of this file, where the whole coordinate boundary is.
 *
 * **So the reader converts, and it converts through the same transform the
 * writer used.** A rectangle answered in MuPDF's frame would be a second
 * coordinate space crossing the contract — and it would agree with the writer's
 * on exactly the fixture every early case uses, an upright page whose box
 * starts at the origin, which is the wired-tools rule's blind spot arriving on
 * the read side.
 *
 * Normalised after the conversion, for {@link placedRect}'s reason: every
 * rotation but 0 reverses an axis and the y-flip reverses the other, so the
 * corner that was smallest coming in is not the corner that is smallest going
 * out.
 *
 * ## `getRect` IS REFUSED BY FOUR OF THE NINE SUBTYPES THIS BUILD WRITES
 *
 * Measured 2026-09-06, MuPDF 1.28.0, on a `/MediaBox [0 0 200 300]` page at
 * rotation 0 and 90. The same refusal family as `Polygon.setRect` — the
 * annotation's rectangle is *computed from* its geometry, so the format has no
 * `/Rect` to hand back:
 *
 * | subtype | `hasRect` | `getRect` | `getBounds` |
 * |---|---|---|---|
 * | `Square`, `FreeText`, `Redact` | true | the rectangle it was given | that, outset by the border |
 * | `Text`, `Caret` | true | the clamped box MuPDF chose | a larger icon box |
 * | `Ink`, `Line`, `Polygon`, `PolyLine` | **false** | ***"X annotations have no Rect property"*** | the appearance's box |
 *
 * So the reader asks `hasRect` and takes `getBounds` for the rest — which is
 * the *appearance's* box, generous by the border width, and correct in the same
 * space.
 *
 * **`getBounds` alone would have been wrong, and only on a rotated page.**
 * A `/Text` placed at (30, 40) answers `getRect` `[30 40 40 50]` upright and
 * `[20 40 30 50]` at `/Rotate 90` — the clamped box anchors on the other side —
 * while `getBounds` answers `[30 40 46 56]` for **both**, because its icon
 * appearance is placed without that flip. Taking bounds everywhere would put a
 * sticky note's hit box ten points off, on rotated pages only, which is a
 * fixture almost nobody writes. `hasRect` is what keeps the accurate answer
 * where the format has one.
 */
function readRect(annotation: PDFAnnotation, transform: PageTransform): AnnotationRect {
  const [x0, y0, x1, y1] = displayedBoxOf(annotation);
  const a = toPdf(viewportPoint(x0, y0), transform);
  const b = toPdf(viewportPoint(x1, y1), transform);
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/**
 * A point as the degenerate rectangle at it.
 *
 * What a POINT-placed annotation hands the geometry, and it is deliberately a
 * conversion rather than a size: the two subtypes that use it are given their
 * extent by MuPDF and disagree about how — a `/Text` keeps the corner, a
 * `/Caret` keeps the centre — so any size chosen here would be right for one of
 * them and silently wrong for the other. A degenerate box says the one thing
 * this build is deciding, which is where the annotation goes.
 */
function pointBox(at: AnnotationPoint): AnnotationRect {
  return { x0: at.x, y0: at.y, x1: at.x, y1: at.y };
}

/**
 * A vertex list in the page's displayed frame, as MuPDF's setters take it.
 *
 * Shared by the two vertex subtypes because it is one conversion, unlike the
 * point-placed pair beside them: `/Polygon` and `/PolyLine` are handed the same
 * numbers in the same frame and differ only in what else is written.
 */
function placedPoints(
  points: readonly AnnotationPoint[],
  transform: PageTransform,
): [number, number][] {
  return points.map((point) => {
    const placed = toViewport(pdfPoint(point.x, point.y), transform);
    return [placed.x, placed.y];
  });
}

/** The box a vertex list occupies, in the displayed frame. */
function verticesBox(
  points: readonly AnnotationPoint[],
  transform: PageTransform,
): [number, number, number, number] {
  const placed = placedPoints(points, transform);
  return [
    Math.min(...placed.map(([x]) => x)),
    Math.min(...placed.map(([, y]) => y)),
    Math.max(...placed.map(([x]) => x)),
    Math.max(...placed.map(([, y]) => y)),
  ];
}

/**
 * Whether a rectangle in the page's displayed frame touches the page at all.
 *
 * The frame's origin is its own corner and its extent is the transform's
 * viewport, so the page is `0, 0` to `viewport.width, viewport.height` — there
 * is no second place that says where the page is.
 */
export function touchesPage(
  rect: readonly [number, number, number, number],
  transform: PageTransform,
): boolean {
  const [x0, y0, x1, y1] = rect;
  return x1 > 0 && y1 > 0 && x0 < transform.viewport.width && y0 < transform.viewport.height;
}

/** The format's own name for each ending this build can write. */
const ENDINGS = {
  none: 'None',
  'closed-arrow': 'ClosedArrow',
} as const satisfies Record<LineEnding, PDFAnnotationLineEndingStyle>;

/**
 * Everything one annotation type knows about itself — §7's registry entry,
 * kernel side: the *geometry adapter* and the *writer mapping* in one value.
 *
 * ## A table indexed by the draft's discriminant, never a switch
 *
 * `CommandBus#preReadFor`'s reason: a `switch` would be a second routing place,
 * and a mapped type over the union means a member added to
 * `annotationDraftSchema` without an entry is a compile error rather than a
 * runtime fall-through. Twenty tools land here.
 *
 * ## Why `degenerate` is a member and not one rule
 *
 * *Nothing a reader could see* is not one shape. A box with zero height is
 * invisible; a **line** with zero height is a horizontal rule, which is a thing
 * people draw on purpose. A single area test would refuse it — and the refusal
 * would look correct, because the same test is right for the two shapes beside
 * it. That is the first place a per-type adapter earns its keep rather than
 * being architecture written ahead of need.
 *
 * ## Parameterised by the DRAFT, not by its tag
 *
 * `AnnotationKind<SquareDraft>` rather than `AnnotationKind<'square'>`, and the
 * difference is what lets one entry serve two members: a function taking the
 * wider `SquareDraft | CircleDraft` is assignable where one taking either alone
 * is expected — parameter contravariance, which `strictFunctionTypes` enforces
 * here rather than merely permitting. Tagged, the same object needs an
 * assertion to sit in two slots.
 *
 * @template D the draft this entry answers for
 */
interface AnnotationKind<D> {
  /** What MuPDF is asked to create. */
  readonly subtype: PDFAnnotationType;
  /**
   * The box it occupies, in the page's **displayed** frame.
   *
   * Used to refuse an annotation nothing could see. It is not what is written:
   * a line's `/Rect` is MuPDF's to compute, and it widens the box to fit an
   * arrowhead by an amount this build has no business predicting.
   */
  readonly bounds: (draft: D, transform: PageTransform) => [number, number, number, number];
  /** Whether the shape has no extent of its own. See the note above. */
  readonly degenerate: (draft: D) => boolean;
  /**
   * Writes everything but the appearance stream.
   *
   * **What it is written ON is a parameter**, and it arrived with the text
   * markups: *which characters lie between these two points* is a question only
   * the page can answer, and a callout needs the document to mint a `/Name`.
   * Most entries ignore both.
   *
   * An object rather than two more positions, so the entry that needs a third
   * thing adds a field instead of a parameter every other entry has to accept.
   *
   * **It may throw**, which the three markups do when a drag selected no text.
   * {@link applyAddAnnotation} deletes the annotation it had just created
   * before rethrowing, so this module's stated invariant holds: a refused
   * command leaves nothing behind.
   */
  readonly write: (
    annotation: PDFAnnotation,
    draft: D,
    transform: PageTransform,
    on: { readonly page: PDFPage; readonly document: PDFDocument },
  ) => void;
}

/** One draft, narrowed by its tag. */
type DraftOf<T extends AnnotationDraft['type']> = Extract<AnnotationDraft, { type: T }>;

/**
 * A rect-shaped entry, which `square` and `circle` both are.
 *
 * **Shared, unlike the schema members**, and the difference is what each is
 * for: the schema is read one member at a time by someone asking what a circle
 * draft is, where this is executed and the two executions are the same three
 * calls. A copy here would be two places to fix when the fill arrives with the
 * style controls.
 */
type OutlineDraft = DraftOf<'square' | 'circle'>;

function outlineKind(subtype: PDFAnnotationType): AnnotationKind<OutlineDraft> {
  return {
    subtype,
    bounds: (draft, transform) => placedRect(draft.rect, transform),
    // BOTH AXES. A box with no width and a box with no height are both
    // invisible, and either is a drag that did not happen.
    degenerate: (draft) => draft.rect.x0 === draft.rect.x1 || draft.rect.y0 === draft.rect.y1,
    write: (annotation, draft, transform): void => {
      annotation.setRect(placedRect(draft.rect, transform));
      annotation.setColor([...draft.colour]);
      // AN EMPTY INTERIOR, which is what makes this an outline rather than a
      // filled shape. Not a default standing in for a missing feature: a fill
      // is a second colour, and the control that would choose it is the style
      // panel. Written explicitly because MuPDF's own default is not this
      // build's decision to inherit.
      annotation.setInteriorColor([]);
      annotation.setBorderWidth(draft.borderWidth);
    },
  };
}

/** The three text markups, which the format says are one thing under three names. */
type MarkupDraft = DraftOf<'highlight' | 'underline' | 'strikeout'>;

/**
 * A text-markup entry — the first whose geometry comes out of the PAGE.
 *
 * ## MuPDF decides which characters are selected, and that is the point
 *
 * `StructuredText.highlight(p, q)` is the engine's own answer to *what text lies
 * between these two points*, returning one quadrilateral per line of the run.
 * A renderer computing that would need a text layer this application does not
 * have, and would be a second opinion about a question MuPDF already owns
 * (B3a) — one that agrees on a single line of Latin text and disagrees on
 * everything else.
 *
 * Measured 2026-09-06, MuPDF 1.28.0, on a two-line page: a drag across one line
 * answers one quad and `copy` answers that line's text; a drag spanning both
 * answers two quads, each the full width of its own line rather than the
 * rectangle the pointer swept. That is what makes this a text selection rather
 * than a region.
 *
 * ## The quads come back in the DISPLAYED frame, which is where they are stored
 *
 * `toStructuredText` works in the same space `setRect` takes, so the two points
 * go through {@link placedPoints} on the way in and the quads need no
 * conversion on the way out. There is no second transform here.
 *
 * ## An empty selection is REFUSED
 *
 * A markup with no quads is an object in the file that paints nothing — the
 * display-only defect at document scale, and the one a person is most likely to
 * produce by dragging across a picture. {@link applyAddAnnotation} removes the
 * annotation it had created before rethrowing.
 */
function markupKind(subtype: PDFAnnotationType): AnnotationKind<MarkupDraft> {
  const ends = (
    draft: MarkupDraft,
    transform: PageTransform,
  ): readonly [[number, number], [number, number]] => {
    const [from, to] = placedPoints([draft.from, draft.to], transform);
    if (from === undefined || to === undefined) throw new Error('a drag has two ends');
    return [from, to];
  };
  return {
    subtype,
    // THE BOX THE DRAG SWEPT, which is what the off-page test needs. It is not
    // what gets stored — the quads are wider, being whole lines — and that is
    // the right way round: a drag entirely off the page selects nothing anyway,
    // and one that touches it is refused later if it caught no text.
    bounds: (draft, transform) =>
      placedRect(
        { x0: draft.from.x, y0: draft.from.y, x1: draft.to.x, y1: draft.to.y },
        transform,
      ),
    // A CLICK SELECTS NOTHING, which is the same refusal as an empty run and is
    // made here so the common case never reaches the engine.
    degenerate: (draft) => draft.from.x === draft.to.x && draft.from.y === draft.to.y,
    write: (annotation, draft, transform, on): void => {
      const [from, to] = ends(draft, transform);
      const quads = on.page.toStructuredText().highlight(from, to, MAX_MARKUP_QUADS);
      if (quads.length === 0) {
        throw new RangeError(
          'that drag selected no text, so there is nothing to mark. A highlight, an underline ' +
            'and a strikeout are all runs of text: over a picture, a scanned page or a margin ' +
            'there is nothing for them to name.',
        );
      }
      for (const quad of quads) annotation.addQuadPoint(quad);
      annotation.setColor([...draft.colour]);
    },
  };
}

/**
 * How many lines one markup may span.
 *
 * `MAX_GESTURE_POINTS`' kind of bound on a different noun: a person dragging
 * across a page selects tens of lines and a hostile document cannot make the
 * number grow, since it is bounded by what is on the page. Far past a sweep and
 * short of a payload nobody meant.
 */
const MAX_MARKUP_QUADS = 4096;

const kinds: { readonly [T in AnnotationDraft['type']]: AnnotationKind<DraftOf<T>> } = {
  square: outlineKind('Square'),
  circle: outlineKind('Circle'),
  line: {
    subtype: 'Line',
    bounds: (draft, transform) =>
      placedRect(
        { x0: draft.from.x, y0: draft.from.y, x1: draft.to.x, y1: draft.to.y },
        transform,
      ),
    // ONE AXIS IS ENOUGH FOR A LINE. A horizontal rule has zero height and is
    // a thing people draw; only a line whose two ends are the same point has
    // nothing to show.
    degenerate: (draft) => draft.from.x === draft.to.x && draft.from.y === draft.to.y,
    write: (annotation, draft, transform): void => {
      // `setLine`, NOT `setRect`. Measured 2026-09-06: MuPDF writes `/L` from
      // these two points and computes `/Rect` itself — widening it to fit an
      // arrowhead, by an amount this build would have had to predict. It takes
      // the same displayed frame `setRect` does, verified on a rotated page.
      const from = toViewport(pdfPoint(draft.from.x, draft.from.y), transform);
      const to = toViewport(pdfPoint(draft.to.x, draft.to.y), transform);
      annotation.setLine([from.x, from.y], [to.x, to.y]);
      // THE END ONLY. `/LE` is a pair and the start stays `None`: an arrow
      // points at where the drag finished, which is the one thing a person
      // drawing one is deciding.
      annotation.setLineEndingStyles('None', ENDINGS[draft.ending]);
      annotation.setColor([...draft.colour]);
      annotation.setBorderWidth(draft.borderWidth);
    },
  },
  redact: {
    subtype: 'Redact',
    bounds: (draft, transform) => placedRect(draft.rect, transform),
    degenerate: (draft) => draft.rect.x0 === draft.rect.x1 || draft.rect.y0 === draft.rect.y1,
    write: (annotation, draft, transform): void => {
      // TWO CALLS, and the two it does NOT make are measured rather than
      // chosen: MuPDF 1.28.0 refuses `setBorderWidth` on a Redact with "Redact
      // annotations have no BS property" and `setInteriorColor` with "no IC
      // property". So this cannot spread `outlineKind`, and the draft carries
      // no border width for the same reason.
      annotation.setRect(placedRect(draft.rect, transform));
      annotation.setColor([...draft.colour]);
      // NOTHING IS APPLIED. `applyRedactions` is the burn-in — a full rewrite
      // with object GC and no prior revisions (ADR-0008 rule 1) — and it is a
      // different command with a different save mode. A mark says *this is to
      // be removed*; calling it here would make the two indistinguishable at
      // exactly the moment the difference matters.
    },
  },
  ink: {
    subtype: 'Ink',
    bounds: (draft, transform) => {
      const placed = draft.points.map((point) => toViewport(pdfPoint(point.x, point.y), transform));
      return [
        Math.min(...placed.map((point) => point.x)),
        Math.min(...placed.map((point) => point.y)),
        Math.max(...placed.map((point) => point.x)),
        Math.max(...placed.map((point) => point.y)),
      ];
    },
    // EVERY POINT THE SAME POINT is a dot, not a stroke — a pointer held still
    // and released. The schema already refuses fewer than two, so what is left
    // to refuse here is a stroke that went nowhere.
    degenerate: (draft) =>
      // NO POINT DIFFERS FROM THE ONE BEFORE IT, which is the same property as
      // *they are all the same point* and needs no first element to exist. The
      // schema's `min(2)` does not reach the type, so an implementation reading
      // `points[0]` would either carry an assertion or a check for a state the
      // validator already refuses.
      draft.points.every((point, index) => {
        const previous = draft.points[index - 1];
        return previous === undefined || (point.x === previous.x && point.y === previous.y);
      }),
    write: (annotation, draft, transform): void => {
      // ONE STROKE INSIDE THE LIST the format wants. `setInkList` takes the
      // same displayed frame `setRect` and `setLine` do — measured 2026-09-06,
      // including on a rotated page — and MuPDF computes `/Rect` from it.
      annotation.setInkList([
        draft.points.map((point) => {
          const placed = toViewport(pdfPoint(point.x, point.y), transform);
          return [placed.x, placed.y];
        }),
      ]);
      annotation.setColor([...draft.colour]);
      annotation.setBorderWidth(draft.borderWidth);
    },
  },
  'text-box': {
    subtype: 'FreeText',
    bounds: (draft, transform) => placedRect(draft.rect, transform),
    degenerate: (draft) => draft.rect.x0 === draft.rect.x1 || draft.rect.y0 === draft.rect.y1,
    write: (annotation, draft, transform): void => {
      annotation.setRect(placedRect(draft.rect, transform));
      // THE TEXT IS `/Contents`, which is the format's own answer for a
      // `/FreeText` and not a second opinion: §12.5.6.6 says the text a
      // FreeText displays *is* its contents, where for every other subtype the
      // same key is a note about the annotation. So this is the one member so
      // far whose `/Contents` a reader must render rather than merely show
      // beside a row — and the annotations panel already carries it, which is
      // why a text box appears there with its own words.
      annotation.setContents(draft.text);
      // `setDefaultAppearance` RATHER THAN A HAND-BUILT `/DA` STRING. The
      // default appearance is a content-stream fragment — `/Helv 12 Tf 0 g` —
      // and writing one here would be this build spelling an operator sequence
      // MuPDF already spells, which is B3a on a string. It also owns the
      // resource dictionary the font name resolves through, and a `/DA` naming
      // a font no `/DR` carries renders as nothing.
      //
      // `Helv` is the base-14 Helvetica every viewer has. A chosen font is the
      // style controls' to supply, and until then a face that needs no
      // embedding is the one that cannot produce a document whose text is
      // missing on another machine.
      annotation.setDefaultAppearance('Helv', draft.fontSize, [...draft.colour]);
      // NOTHING SETS A BORDER HERE, AND THE OBJECT HAS ONE. Measured
      // 2026-09-06: `createAnnotation('FreeText')` on MuPDF 1.28.0 produces
      // `/AP /BS /CL /Contents /DA /F /P /RD /Rect /Subtype /Type` — so a `/BS`
      // and a `/CL` arrive from the engine rather than from any call this
      // function makes. The reasoning that a text box is left plain was sound
      // and the document is not what it described; `pageAnnotations.test.ts`
      // pins the whole key set so a version that writes a different one is a
      // red build.
      //
      // AND THE `/CL` IS DELETED, as of 2026-09-06. That paragraph used to end
      // by calling the stray callout line the reason the callout tool would be
      // a small job. Building it produced the opposite finding: `/IT
      // /FreeTextCallout` is what makes a `/CL` mean anything, MuPDF writes no
      // `/IT` at all, and PDF 32000 §12.5.6.6 says `/CL` applies only where
      // `/IT` names a callout.
      //
      // So every text box this build has written carries a leader line from the
      // page's corner that a conforming viewer ignores and a lenient one draws.
      // Measured: `createAnnotation('FreeText')` with nothing else called
      // stores `/CL [0 300 80 275.3846]`. That is the *stray line on somebody's
      // page* this comment predicted, and removing it is cheaper than hoping
      // every reader checks `/IT`.
      annotation.getObject().delete('CL');
      // AND IT DRAWS ITS BOX, as of 2026-09-07. Until the typewriter row this
      // did not: MuPDF leaves `/BS << /W 0 >>` and its appearance stream is
      // `0 w … re W n`, a clip with no stroke — so a *text box* drew no box and
      // was, on the page, exactly what a typewriter is. Two controls whose
      // output cannot be told apart is the display-only sin with a second
      // button on it, and the one whose name was wrong for its appearance is
      // this one.
      //
      // ONE POINT, which the style controls will own. `setColor` is deliberately
      // not called beside it: measured 2026-09-07, `/C` on a `/FreeText` is the
      // BACKGROUND — MuPDF emits `re f` before the stroke — and the text's
      // colour comes from `/DA`. A fill nobody asked for is a text box that
      // hides what is under it.
      annotation.setBorderWidth(1);
    },
  },
  typewriter: {
    subtype: 'FreeText',
    bounds: (draft, transform) => placedRect(draft.rect, transform),
    degenerate: (draft) => draft.rect.x0 === draft.rect.x1 || draft.rect.y0 === draft.rect.y1,
    write: (annotation, draft, transform, on): void => {
      annotation.setRect(placedRect(draft.rect, transform));
      annotation.setContents(draft.text);
      annotation.setDefaultAppearance('Helv', draft.fontSize, [...draft.colour]);
      // NO BORDER, which is the whole difference from the row above and is why
      // that row now sets one. MuPDF's own default is already this, so nothing
      // is called — stated rather than left as an absence somebody removes.
      annotation.getObject().delete('CL');
      annotation.getObject().put('IT', on.document.newName('FreeTextTypeWriter'));
    },
  },
  callout: {
    subtype: 'FreeText',
    // THE BOX ONLY. MuPDF expands `/Rect` itself once `/IT` is written, so a
    // bound including the leader would be this build predicting an expansion
    // the engine performs — and the point it leads from is refused separately
    // below, where the message can say which of the two was off the page.
    bounds: (draft, transform) => placedRect(draft.rect, transform),
    degenerate: (draft) => draft.rect.x0 === draft.rect.x1 || draft.rect.y0 === draft.rect.y1,
    write: (annotation, draft, transform, on): void => {
      annotation.setRect(placedRect(draft.rect, transform));
      annotation.setContents(draft.text);
      annotation.setDefaultAppearance('Helv', draft.fontSize, [...draft.colour]);
      const [at] = placedPoints([draft.at], transform);
      if (at === undefined) throw new Error('a callout has a point it leads from');
      // `setCalloutPoint` RATHER THAN `setCalloutLine`, and the difference is a
      // rule this build does not have to hold: which edge of the box the line
      // meets is geometry MuPDF works out from the rectangle it was given.
      // Measured 2026-09-06 — a point at (10, 120) against a box spanning x
      // 80–180 stored `/CL [10 180 100 240]`, whose second point is on the box
      // rather than at a corner this file chose.
      annotation.setCalloutPoint(at);
      // `/IT`, WRITTEN BY HAND BECAUSE MuPDF DOES NOT. Measured the same day:
      // `setCalloutPoint` and `setCalloutLine` store `/CL` and no `/IT`, and
      // PDF 32000 §12.5.6.6 says `/CL` applies only where `/IT` names a
      // callout — so without this the annotation is a text box carrying a key
      // a conforming reader ignores.
      //
      // IT IS LOAD-BEARING RATHER THAN DECLARATIVE, which is the assertion
      // worth having: with `/IT` present MuPDF expands `/Rect` to cover the
      // leader and records the inset back to the box in `/RD`, so the rectangle
      // the eraser and the select tool hit-test against includes the line. A
      // case asserts that expansion rather than the key, for the cloud's
      // reason — a stored key that changes nothing is what an inert write looks
      // like.
      annotation.getObject().put('IT', on.document.newName('FreeTextCallout'));
    },
  },
  'sticky-note': {
    subtype: 'Text',
    // THE POINT'S OWN BOX, which is what makes this entry different from every
    // one above it: the annotation's extent is MuPDF's, not the draft's, so
    // there is nothing to measure but where it was put. `touchesPage` then
    // asks whether that point is on the page, which is the only question a
    // marker can be refused on.
    bounds: (draft, transform) => placedRect(pointBox(draft.at), transform),
    // A POINT IS NEVER DEGENERATE, and this is the third shape that test has
    // taken in this file. A box can have no width, a line can have no length,
    // and an icon anchored at a point always occupies the twenty points MuPDF
    // gives it — so there is no *nothing a reader could see* state to refuse,
    // and `false` here is the honest answer rather than a check waived.
    degenerate: () => false,
    write: (annotation, draft, transform): void => {
      // THE RECTANGLE IS A POINT AND MuPDF SIZES IT. Measured 2026-09-06 over
      // seven requested sizes on a `/MediaBox [0 0 200 300]` page: the box is
      // anchored at the displayed top-left corner and its side is CLAMPED to
      // between 10 and 20 points — 0, 1, 5 and 10 all store 10, and 20, 30 and
      // 60 all store 20. A degenerate request therefore lands at the floor, so
      // a note this build writes is 10 points square.
      //
      // Passing the point's own box says exactly what is being decided, which
      // is where the icon goes. Passing a size would be a number surviving only
      // inside a ten-point band and silently discarded outside it.
      //
      // NOT a fixed 20 — that was the first reading, from a single 30-point
      // sample, and it was wrong for the one input this function actually
      // sends. `pageAnnotations.test.ts` pins the number that arrives.
      annotation.setRect(placedRect(pointBox(draft.at), transform));
      annotation.setContents(draft.text);
      annotation.setColor([...draft.colour]);
      // THE ICON IS A CONSTANT AND NOT A FIELD. `/Name` chooses between the
      // format's eight standard icons, and no row in `docs/FEATURES.md` owes a
      // control that picks one — unlike the colour beside it, which *style
      // controls* owes by name. A payload field nothing will ever set is the
      // display-only sin one layer in, so the choice is made here and stated.
      //
      // `Comment` is the speech bubble every viewer draws for a note, which is
      // what a reader has to recognise without being told.
      annotation.setIcon('Comment');
      // NOTHING SETS A BORDER OR AN APPEARANCE, AND BOTH ARE REFUSED. Measured
      // the same day: MuPDF answers `setBorderWidth` on a `/Text` with *"Text
      // annotations have no BS property"* and `setDefaultAppearance` with
      // *"no DA property"*, exactly as it refuses them on a Redact.
      //
      // AND THE ENGINE WRITES A SECOND OBJECT: a `/Popup` lands in `/Annots`
      // beside the note, so one command adds TWO entries to the array. The
      // walk does not see it — `getAnnotations()` answered `[Text, Square]` for
      // a page whose `/Annots` held three — and `deleteAnnotation` on the note
      // takes the popup with it, measured at three entries down to one. So the
      // handle ADR-0041 defines is unaffected, and that is a fact about this
      // engine rather than an assumption: `/Popup` is the second subtype the
      // walk filters, after the widgets that made the handle a walk position in
      // the first place.
    },
  },
  caret: {
    subtype: 'Caret',
    bounds: (draft, transform) => placedRect(pointBox(draft.at), transform),
    degenerate: () => false,
    write: (annotation, draft, transform): void => {
      // A DIFFERENT RULE FROM THE NOTE'S, WHICH IS WHY THIS IS A SECOND ENTRY.
      // Measured 2026-09-06 over the same seven requested sizes: a caret is a
      // genuinely fixed 20 by 14 CENTRED on the requested box — every size from
      // degenerate to 60 produced the same extent about the requested centre —
      // where a `/Text` keeps a corner and clamps its side between 10 and 20.
      //
      // A shared point-shaped helper would have hidden that. Both subtypes take
      // a point and answer with a box, so one function would have looked
      // correct and been measured on whichever of the two was written first;
      // the clamp is visible only when the two answers are compared across a
      // range. Two entries force the comparison and each carries the rule it
      // actually obeys.
      annotation.setRect(placedRect(pointBox(draft.at), transform));
      annotation.setColor([...draft.colour]);
      // NO CONTENTS, and the draft has no field for one. A caret is an
      // insertion mark: the annotation IS the position, and text attached to it
      // would be a note that happens to be caret-shaped — which is the sticky
      // note, one entry up.
      //
      // Nothing else is written because nothing else is accepted. Measured the
      // same day: MuPDF refuses `setIcon` with *"Caret annotations have no Name
      // property"*, and `setBorderWidth` and `setDefaultAppearance` likewise. So
      // this is not a minimal entry that could grow — it is the whole of what
      // the writer of record will take.
    },
  },
  polygon: {
    subtype: 'Polygon',
    bounds: (draft, transform) => verticesBox(draft.points, transform),
    // THE POLYGON'S OWN RULE, and a fourth shape for this test. A polygon whose
    // vertices are all one point is three clicks in one place; the schema
    // already refuses fewer than three, so what is left is a shape with no
    // extent in either axis. Unlike a line, one axis is not enough: a polygon
    // flat in y is a zig-zag along a rule, which is a thing somebody can draw.
    degenerate: (draft) =>
      draft.points.every((point) => point.x === draft.points[0]?.x) &&
      draft.points.every((point) => point.y === draft.points[0]?.y),
    write: (annotation, draft, transform): void => {
      // `setVertices`, NOT `setRect`. Measured 2026-09-06: MuPDF refuses
      // `setRect` on a `/Polygon` with *"Polygon annotations have no Rect
      // property"* and computes `/Rect` itself from the vertices, insetting it
      // by `/RD` — `[2 2 2 2]` for a solid border and `[11 11 11 11]` for a
      // cloudy one, whose bumps sit outside the corners and pushed the box past
      // the page edge in the reading. It takes the same displayed frame
      // `setLine` and `setInkList` do.
      //
      // NOTHING REPEATS THE FIRST VERTEX. MuPDF closes the shape, so a payload
      // that carried the corner twice would store a duplicate in `/Vertices`.
      annotation.setVertices(placedPoints(draft.points, transform));
      annotation.setColor([...draft.colour]);
      annotation.setInteriorColor([]);
      annotation.setBorderWidth(draft.borderWidth);
      // THE CLOUD, and it is one call rather than a subtype. `/BE` is what the
      // format says separates the two, which is why the draft carries a border
      // effect instead of this being a third table entry — the same arrangement
      // as a line and an arrow, whose difference is `/LE`.
      //
      // TWO CALLS, AND THE SECOND IS NOT OPTIONAL. `setBorderEffect('Cloudy')`
      // alone writes `/BE << /S /C >>` and the effect is INERT: measured
      // 2026-09-06, `/RD` stays at the solid border's 2 rather than growing to
      // 11, which is what it does when the scallops actually displace the box.
      // A cloud that stores as a cloud and renders as a plain polygon is the
      // display-only sin inside a dictionary, and it was caught by the case
      // that asserts `/RD` rather than `/BE` — asserting the key would have
      // passed on the broken version.
      //
      // The intensity is a number no control chooses, so it is decided here
      // rather than carried in the draft: `2` is the fuller of the two
      // intensities viewers draw and is what makes a cloud recognisable as one
      // at a glance. A field for it would be a payload value nothing could set,
      // which is the argument that kept the note's icon out of its draft.
      if (draft.border === 'cloudy') {
        annotation.setBorderEffect('Cloudy');
        annotation.setBorderEffectIntensity(2);
      }
    },
  },
  polyline: {
    subtype: 'PolyLine',
    bounds: (draft, transform) => verticesBox(draft.points, transform),
    // TWO POINTS IN THE SAME PLACE is a click, not a run of segments — the
    // line's rule, because an open polyline flat in one axis is exactly the
    // horizontal rule that rule exists to permit.
    degenerate: (draft) =>
      draft.points.every((point) => point.x === draft.points[0]?.x) &&
      draft.points.every((point) => point.y === draft.points[0]?.y),
    write: (annotation, draft, transform): void => {
      annotation.setVertices(placedPoints(draft.points, transform));
      annotation.setColor([...draft.colour]);
      annotation.setInteriorColor([]);
      annotation.setBorderWidth(draft.borderWidth);
      // NO BORDER EFFECT, AND THE DRAFT HAS NO FIELD FOR ONE. Measured: MuPDF
      // answers `setBorderEffect` here with *"PolyLine annotations have no BE
      // property"*, so a cloud cannot be an open shape. That measurement is
      // what made these two separate members rather than one carrying a flag
      // legal for half its values.
    },
  },
  highlight: markupKind('Highlight'),
  underline: markupKind('Underline'),
  strikeout: markupKind('StrikeOut'),
};

/**
 * The private key that says this build wrote the annotation — the `srcRef`
 * marking scheme invariant L5 has always named
 * ([ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)).
 *
 * Prefixed with the application's own name so it cannot collide with a key the
 * format defines or another producer writes, which is what makes it private
 * data rather than an opinion about somebody else's field.
 *
 * Measured 2026-09-06 against MuPDF 1.28.0: the key is accepted, survives a
 * save, a reopen and a second save, and reads back as a boolean.
 */
const AUTHORED_KEY = 'Monstera_Authored';

/**
 * Marks an annotation as this build's.
 *
 * **Called at the one place that creates one**, which is what keeps the scheme
 * from acquiring a second opinion: *which annotations are ours* has one writer
 * and one reader, in this file, and a command that starts minting annotations
 * elsewhere has to come through here (B3a).
 */
function markAuthored(annotation: PDFAnnotation): void {
  annotation.getObject().put(AUTHORED_KEY, true);
}

/**
 * Whether this build wrote it.
 *
 * **The value is checked, not the key's presence.** A document carrying
 * `/Monstera_Authored` with a string value, or with `false`, is foreign — the
 * mark is a claim and a malformed one is not that claim. A key that was never
 * written reads as MuPDF's shared null object, whose `isBoolean` is false, so
 * absence and a wrong value take the same branch without a second check.
 *
 * **Absence is what foreign means**, and that is one-sided by construction
 * rather than by economy: we may not write onto an annotation we did not
 * author, so nothing can ever be marked foreign.
 */
function authoredHere(annotation: PDFAnnotation): boolean {
  const mark = annotation.getObject().get(AUTHORED_KEY);
  return mark.isBoolean() && mark.asBoolean();
}

/**
 * Adds the drawn annotation to its page.
 *
 * Everything is resolved and checked **before** anything is created, so a
 * refused command leaves no half-built annotation on the page — `applyCropPages`
 * validates in full for the same reason, and here the cost of not doing it is
 * an invisible object a user cannot select to delete.
 */
export const applyAddAnnotation: Apply<'mupdf', 'addAnnotation'> = (
  session: MupdfSession,
  command: CommandOfKind<'addAnnotation'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    const transform = transformFor(loaded);
    const draft = command.annotation;
    // THE TABLE, indexed by the draft's own discriminant. The cast is confined
    // to this one line and is what a mapped table over a discriminated union
    // costs: TypeScript resolves `kinds[draft.type]` to the union of every
    // entry rather than pairing the entry with the draft that selected it. It
    // is still cheaper than a `switch`, because a member added to the schema
    // without an entry is a compile error at the table.
    const kind = kinds[draft.type] as AnnotationKind<typeof draft>;

    if (kind.degenerate(draft)) {
      throw new RangeError(
        `an annotation with no extent cannot be drawn. What was asked for was a ` +
          `${draft.type} whose two ends are the same, in the page's own space.`,
      );
    }
    if (!touchesPage(kind.bounds(draft, transform), transform)) {
      throw new RangeError(
        `that annotation lies entirely outside page ${String(command.page)}, whose displayed ` +
          `region is ${String(transform.viewport.width)} by ` +
          `${String(transform.viewport.height)} units, so nothing would be visible.`,
      );
    }

    const annotation = loaded.createAnnotation(kind.subtype);
    try {
      kind.write(annotation, draft, transform, { page: loaded, document });
    } catch (thrown) {
      // A REFUSED COMMAND LEAVES NOTHING BEHIND, which is this module's stated
      // invariant and was free until a `write` could fail. The text markups can:
      // *which characters lie between two points* is not knowable before the
      // page is asked, so their refusal cannot happen with the other two.
      // Without this the page keeps an annotation with no quads — an object
      // that paints nothing, which is exactly what the refusal is for.
      loaded.deleteAnnotation(annotation);
      throw thrown;
    }
    // THE MARK — one call at the one creation site, rather than a line every
    // entry in `kinds` has to remember. A per-kind mark would be eleven chances
    // to omit one, and the omission's symptom is an annotation of ours that
    // reads as somebody else's, which nothing about that kind would show.
    markAuthored(annotation);
    // The appearance stream. Without it the annotation is a dictionary with no
    // `/AP`, which every viewer is free to render its own way or not at all —
    // and MuPDF's own renderer would still draw it, so a proof that rasterised
    // through MuPDF could not see the difference.
    annotation.update();
  });

/**
 * What kind an annotation on the page IS, as a surface may name it.
 *
 * ## A CLOSED union, not the subtype the document carries
 *
 * `/Subtype` is a `/Name` and a document is hostile by invariant 25's premise,
 * so passing it through would be an arbitrary string reaching a renderer that
 * has to label it — and B9 bans a literal user-facing string, so there would be
 * no key for a subtype nobody anticipated. A closed union means the renderer
 * can only render what it has a message for (B5), and `'other'` is the honest
 * answer for the rest.
 *
 * **The members are the ones this build WRITES, plus `'other'`.** A foreign
 * highlight is `'other'` today and gains its own member on the day a highlight
 * tool does — at which point the surface needs a key for it anyway. Adding a
 * member before the tool would be a label nothing can produce from this
 * application's own documents and everything else's, which is the harder half
 * to keep honest.
 *
 * **RE-EXPORTED FROM THE CONTRACT RATHER THAN DERIVED HERE**, which is where
 * this type went the day it became the third statement of one list. It was
 * `AnnotationDraft['type'] | 'other'` — correct, and correct is not the test:
 * the channel spelt the same set out by hand, so the reader's vocabulary had a
 * derivation, a literal and this. `commands.ts` now holds the one declaration
 * and asserts it against the draft union in both directions, and everything
 * else imports it.
 */
export type { AnnotationKindName };

/** One annotation on a page, as a panel needs to name it. */
export interface ListedAnnotation {
  /** Zero-based, so a caller can hand it straight to a jump. */
  readonly page: number;
  /**
   * Its position in THIS WALK, on its own page — the half of a handle that says
   * which annotation ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)).
   *
   * **Not an index into the page's `/Annots` array**, and the difference is not
   * academic. Measured 2026-09-06 on one page carrying a text field and three
   * squares: this walk yields **three** entries and `/Annots` holds **four**,
   * because MuPDF filters widgets out of `getAnnotations()`. So the two indices
   * differ by the number of form fields above the annotation — on exactly the
   * documents Stage 4 exists for, and silently, since both are in range.
   *
   * Which makes {@link readAnnotations} the one place either index is derived,
   * and the resolver its inverse rather than a second walk written elsewhere:
   * *which objects on this page are annotations* is MuPDF's rule, and a second
   * opinion about it agrees on every document without a form (B3a).
   *
   * It is meaningful only against the `DocVersion` this answer carried. Across
   * versions it is not an identity at all, which is why a command naming an
   * annotation carries that version and is refused when the document has moved.
   */
  readonly index: number;
  /**
   * Where it is, in **PDF user space** — the same frame a draft names, so the
   * surface converts it with the transform it already holds.
   *
   * **The bounding box, not the shape.** A `/Line`'s rect is the box its two
   * ends span and a `/Polygon`'s is the box around its vertices, so a point
   * inside this is near the annotation rather than on it. That is what an
   * eraser hit-tests against, and it is stated rather than refined: testing the
   * geometry would mean the renderer re-deriving each subtype's shape from a
   * rectangle that does not carry it.
   *
   * **`null` when the page displays no region** — no `/MediaBox` of four
   * numbers, or a `/CropBox` that does not overlap it. The annotation is still
   * listed, because it is still there; there is simply no frame to express its
   * place in, and a number invented for that case would be a location a surface
   * would act on.
   */
  readonly rect: AnnotationRect | null;
  readonly kind: AnnotationKindName;
  /**
   * The annotation's `/Contents`, or the empty string.
   *
   * Carried because it is the only thing that tells two rectangles on one page
   * apart, and it is nearly always a **foreign** annotation's — this build sets
   * no contents on anything it writes, because there is no control that would
   * collect one. That is owed with the comment field, and until then a row of
   * this build's own is identified by its kind and its page.
   */
  readonly contents: string;
  /**
   * Whether **this build wrote it** — the `srcRef` mark, read
   * ([ADR-0043](../../../docs/DECISIONS/0043-an-annotation-this-build-wrote-carries-a-private-mark.md)).
   *
   * `false` means the annotation came with the document, or was written by a
   * version of this build older than the scheme. It is **provenance and not
   * permission**: a person may erase or move either, and this is what lets a
   * surface say which one they are about to change.
   */
  readonly authored: boolean;
}

/** MuPDF's subtype back to the name a surface may use. */
const NAMED: Readonly<Record<string, AnnotationKindName>> = {
  Square: 'square',
  Circle: 'circle',
  Line: 'line',
  Ink: 'ink',
  Redact: 'redact',
  // A FOREIGN `/FreeText` NOW HAS A NAME TOO, which is the closed union's rule
  // working in the direction that is easy to miss: a member is added the day a
  // tool writes that kind, and from that day every document's FreeText stops
  // being `other`. So the panel starts naming text boxes this build did not
  // write, which is right — the label says what the object is, not who made it.
  // A FOREIGN `/FreeText` IS A TEXT BOX unless it says otherwise, and `NAMED`
  // cannot see that it does: the walk keys on `getType()`, which answers
  // `FreeText` for a callout too. `calloutNamed` below is what separates them,
  // because the difference is `/IT` rather than the subtype.
  FreeText: 'text-box',
  Text: 'sticky-note',
  Caret: 'caret',
  // BOTH TOOLS ANSWER TO ONE NAME, because a reader is told what is on the page
  // and a cloud IS a `/Polygon`. The `/BE` that separates the two tools is not
  // read here — the panel says what the object is, and *Cloud* against *Shape*
  // would be this build's tool vocabulary applied to somebody else's document.
  Polygon: 'polygon',
  PolyLine: 'polyline',
  // THREE NAMES FOR THREE SUBTYPES, unlike the pair above: a cloud and a
  // polygon are both `/Polygon`, and these are genuinely different objects.
  Highlight: 'highlight',
  Underline: 'underline',
  StrikeOut: 'strikeout',
};

/**
 * What a surface may call this annotation.
 *
 * `?? 'other'` IS THE WHOLE POINT of the closed union: a subtype this build
 * cannot name is listed rather than dropped, because a panel that silently
 * omitted a document's own comments would be worse than one that names them
 * vaguely.
 *
 * **`/FreeText` is the one subtype that is two kinds**, and the difference is a
 * key rather than the subtype: `/IT /FreeTextCallout` is what makes one a
 * callout, and `getType()` answers `FreeText` either way. So the table cannot
 * separate them and this reads the key — which is also why the check is on the
 * key's VALUE rather than its presence, since `/IT` has other legal values
 * (`FreeTextTypeWriter` among them) that are not this.
 */
function kindOf(annotation: PDFAnnotation): AnnotationKindName {
  const named = NAMED[annotation.getType()] ?? 'other';
  if (named !== 'text-box') return named;
  const intent = annotation.getObject().get('IT');
  if (!intent.isName()) return 'text-box';
  return INTENDED[intent.asName()] ?? 'text-box';
}

/**
 * `/IT`'s three names, as a reader may call them.
 *
 * **A table with a fallback, unlike {@link NAMED}, and the difference is what
 * the format says.** An absent or unrecognised `/IT` on a `/FreeText` means
 * `FreeText` — the default is in the specification — so *anything else* is a
 * text box rather than `'other'`. `NAMED` has no such default, which is why its
 * miss is `'other'` and this one's is a real kind.
 */
const INTENDED: Readonly<Record<string, AnnotationKindName>> = {
  FreeText: 'text-box',
  FreeTextCallout: 'callout',
  FreeTextTypeWriter: 'typewriter',
};

/**
 * How many annotations may be listed.
 *
 * A document-scaled read, bounded for the reason `document.destinations`' is:
 * a payload that grows without limit is a renderer that can be handed anything.
 * The number is `MAX_DESTINATIONS`' argument on a different noun — far past
 * what a panel could present and short of what a hostile document could try.
 *
 * The caller is told when the bound stopped the walk, because *this document
 * has that many* and *you asked for that many* are different answers and a
 * surface offering to act on all of them would act on some.
 */
const MAX_LISTED = 4096;

/**
 * Every annotation in the document, in page order.
 *
 * ## Whole-document rather than per page, unlike the links read
 *
 * `document.pageLinks` takes a page because a link is drawn over one and a
 * reader asks about what is on screen. A panel asks *where are the comments in
 * this document* — a question whose answer is the whole of it — and a
 * per-page read would make the panel ask once per page and stitch the answers,
 * which is the same payload arriving as N round trips.
 *
 * Bounded and reported, exactly as the duplicate report is.
 */
export function readAnnotations(
  session: MupdfSession,
): Promise<{ readonly annotations: readonly ListedAnnotation[]; readonly truncated: boolean }> {
  return withDocument(session, (document) => {
    const found: ListedAnnotation[] = [];
    const pages = document.countPages();
    for (let page = 0; page < pages; page += 1) {
      // RESET PER PAGE, and counted from the walk rather than from `found`. The
      // two agree today and would diverge the moment anything here skips an
      // entry — at which point a handle would name the annotation after the one
      // the caller was shown, which is the failure mode with no symptom.
      let index = 0;
      const loaded = document.loadPage(page);
      // ONE TRANSFORM PER PAGE, resolved before the walk rather than inside it:
      // it is the page's, not the annotation's, and building it per entry would
      // read the boxes once per mark on a page that may carry hundreds.
      const transform = frameOf(loaded);
      for (const annotation of loaded.getAnnotations()) {
        if (found.length >= MAX_LISTED) return { annotations: found, truncated: true };
        found.push({
          page,
          index: index++,
          rect: transform === null ? null : readRect(annotation, transform),
          // `?? 'other'` IS THE WHOLE POINT of the closed union: a subtype this
          // build cannot name is listed rather than dropped, because a panel
          // that silently omitted a document's own comments would be worse than
          // one that names them vaguely.
          kind: kindOf(annotation),
          contents: annotation.getContents().slice(0, MAX_LISTED_CONTENTS),
          authored: authoredHere(annotation),
        });
      }
    }
    return { annotations: found, truncated: false };
  });
}

/**
 * How much of an annotation's `/Contents` crosses.
 *
 * A bound on text a hostile document controls, and it is a **slice** rather
 * than a refusal for the reason the outline's title bound is: a note longer
 * than this is a note, and refusing to list the annotation would hide it.
 */
const MAX_LISTED_CONTENTS = 512;

/**
 * Refuses, naming what is missing — the handle, not the operation.
 *
 * The page **is** validated first, so an out-of-range index is still a caller
 * error here rather than a capture refusal that the bus converts into a
 * checkpoint of a command that was never going to apply. `captureDeletePages`
 * takes the same care for the same reason.
 */
export function captureAddAnnotation(
  session: MupdfSession,
  command: CommandOfKind<'addAnnotation'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    pageAt(document, command.page, document.countPages());
    return {
      captured: false,
      reason:
        'an added annotation cannot be recorded as prior state: removing it again needs a handle ' +
        'naming which annotation on the page it is, and this command mints an object whose ' +
        'identity is not in its payload',
    };
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `CommandPrior['addAnnotation']` is `never`, so nothing can construct an
 * argument. It throws rather than resolving, for `invertDeletePages`' reason: a
 * reachable path here would mean the type had been widened, and a quiet resolve
 * would land that as an undo that silently did nothing.
 */
export const invertAddAnnotation: Invert<'mupdf', 'addAnnotation'> = (): Promise<void> => {
  throw new Error(
    'an added annotation has no inverse yet; undo restores the checkpoint the bus took (ADR-0037)',
  );
};

/**
 * The annotation a handle names, resolved through the walk that minted it.
 *
 * **This is {@link readAnnotations}' inverse and it must stay that way.** The
 * index is a position in `getAnnotations()`, which filters widgets out — so on a
 * page carrying form fields it is not the `/Annots` position, and the two differ
 * by the number of fields above it. Resolving through anything else agrees on
 * every document without a form, which is what would make the disagreement ship.
 *
 * That is B3a rather than tidiness: *which objects on this page are annotations*
 * is MuPDF's rule. There is one caller of it in each direction and they are in
 * this file, eleven lines apart.
 *
 * Refuses rather than guessing. An index past the end is a caller that built a
 * handle from something other than an answer this module gave, and the message
 * names the count so the reader can see which of the two numbers is wrong.
 */
function annotationAt(loaded: PDFPage, index: number): PDFAnnotation {
  const walked = loaded.getAnnotations();
  const found = walked[index];
  if (found === undefined) {
    throw new RangeError(
      `Annotation ${String(index)} is outside this page, which has ${String(walked.length)} ` +
        'annotation(s). The index is a position in the engine walk that document.annotations ' +
        'answers with, not a position in the page /Annots array.',
    );
  }
  return found;
}

/**
 * Removes the annotation a handle names.
 *
 * ## The version is NOT checked here, and that is the design rather than a gap
 *
 * [ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)
 * Decision 3: the bus holds the document's version and this apply does not, so
 * the staleness refusal belongs where `sources` are resolved and happens before
 * anything here runs. An apply that re-derived it would be a second opinion
 * about a question the declaration table answers, and the second command to
 * name existing state would write a third.
 *
 * So this function is the same shape as every other apply: it validates what it
 * can see — the page, then the index — and writes.
 */
export const applyRemoveAnnotation: Apply<'mupdf', 'removeAnnotation'> = (
  session: MupdfSession,
  command: CommandOfKind<'removeAnnotation'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    // EVERY INDEX IS RESOLVED BEFORE ANYTHING IS DELETED, which is what makes
    // the order the payload arrived in irrelevant: a `PDFAnnotation` is a handle
    // to the object, so once resolved it does not care what its neighbours'
    // positions become. Resolving lazily inside the loop would make each
    // removal shift the ones after it, and every index would still be in range.
    //
    // It is also what keeps a refusal whole. `applyAddAnnotation` validates in
    // full before creating anything for the same reason: a command that deleted
    // three of five and then refused would leave the page in a state no undo
    // step describes.
    // DUPLICATES ARE REFUSED RATHER THAN DEDUPLICATED, because a payload naming
    // one annotation twice is a caller that built its list from something other
    // than one walk, and quietly deleting it once would hide that.
    if (new Set(command.indices).size !== command.indices.length) {
      throw new RangeError(
        'a removal names the same annotation more than once, which is a handle list built from ' +
          'something other than one walk. An index is a position in a single answer and each ' +
          'appears at most once in it.',
      );
    }
    const doomed = command.indices.map((index) => annotationAt(loaded, index));
    for (const annotation of doomed) loaded.deleteAnnotation(annotation);
  });

/**
 * Moves and resizes annotations, each into the box the command names.
 *
 * ## The geometry is MAPPED, because four subtypes have no rectangle to set
 *
 * `Ink`, `Line`, `Polygon` and `PolyLine` refuse `getRect`, and MuPDF computes
 * their rectangle from the points — so *place it here* has to be expressed as
 * *move every point of it by this affine*. The affine sends the box it occupies
 * now onto the box asked for, which is a translation when the two are the same
 * size and a scale when they are not: one operation, and the nudge and the
 * handle drag differ only in the numbers.
 *
 * ## Every geometry the annotation carries, not the first one found
 *
 * A foreign `/Highlight` has a `/Rect` **and** `/QuadPoints`, and moving the
 * rectangle alone leaves the highlighted quads where they were — the annotation
 * arrives somewhere else and paints nothing. So each `has…` is asked
 * independently and every answer that is yes is mapped. That is the branch a
 * fixture built from this build's own annotations would never reach, since
 * nothing here writes quad points yet.
 *
 * ## A degenerate source box translates rather than dividing by zero
 *
 * A `/Caret` is 20 by 14 and a `/Text` 10 by 10, so neither is degenerate — but
 * a foreign annotation may be, and a zero-width box has no scale onto anything.
 * The factor is 1 on that axis, which makes the operation a move: the honest
 * reading of *put this thing with no width there*.
 */
export const applyPlaceAnnotation: Apply<'mupdf', 'placeAnnotation'> = (
  session: MupdfSession,
  command: CommandOfKind<'placeAnnotation'>,
): Promise<void> =>
  withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    const transform = transformFor(loaded);
    const indices = command.placements.map((placement) => placement.index);
    if (new Set(indices).size !== indices.length) {
      throw new RangeError(
        'a placement names the same annotation more than once, so two rectangles are asked for ' +
          'one object and the later would silently win.',
      );
    }
    // RESOLVED IN FULL BEFORE ANYTHING MOVES, `applyRemoveAnnotation`'s rule: a
    // command that placed two of five and then refused would leave the page in
    // a state no undo step describes.
    const targets = command.placements.map((placement) => ({
      annotation: annotationAt(loaded, placement.index),
      rect: placement.rect,
    }));

    for (const { annotation, rect } of targets) {
      const [bx0, by0, bx1, by1] = displayedBoxOf(annotation);
      // THE POINTS' OWN BOX, which is NOT the box a reader is shown. `getBounds`
      // carries the stroke width — 2 points on an ink stroke, 11 on a cloud —
      // and that outset does not scale with the placement. Mapping the geometry
      // out of the reported box lands the annotation's visible extent a border
      // away from where the handle was dropped, and the error grows with the
      // scale rather than staying constant. Measured at 2.5 points on the first
      // run of this file's stroke case, which is what found it.
      const [sx0, sy0, sx1, sy1] = geometryBoxOf(annotation) ?? [bx0, by0, bx1, by1];
      const [px0, py0, px1, py1] = placedRect(rect, transform);
      // So the TARGET is inset by the same outset, and the visible box then
      // lands on what was asked for. Unless the box asked for is smaller than
      // the border it carries, where the inset target inverts and the honest
      // answer is to place the geometry itself and let the outset overflow.
      const inset: [number, number, number, number] = [
        px0 + (sx0 - bx0),
        py0 + (sy0 - by0),
        px1 - (bx1 - sx1),
        py1 - (by1 - sy1),
      ];
      const [tx0, ty0, tx1, ty1] =
        inset[2] > inset[0] && inset[3] > inset[1] ? inset : [px0, py0, px1, py1];
      const kx = sx1 - sx0 === 0 ? 1 : (tx1 - tx0) / (sx1 - sx0);
      const ky = sy1 - sy0 === 0 ? 1 : (ty1 - ty0) / (sy1 - sy0);
      const map = ([x, y]: readonly [number, number]): [number, number] => [
        tx0 + (x - sx0) * kx,
        ty0 + (y - sy0) * ky,
      ];

      // THE RECTANGLE IS SET FROM THE COMMAND, not from the inset above: a
      // subtype with a `/Rect` has no geometry to carry an outset, so its
      // reported box IS the rectangle and the two are the same numbers.
      if (annotation.hasRect()) annotation.setRect([px0, py0, px1, py1]);
      if (annotation.hasVertices()) annotation.setVertices(annotation.getVertices().map(map));
      if (annotation.hasInkList()) {
        annotation.setInkList(annotation.getInkList().map((stroke) => stroke.map(map)));
      }
      if (annotation.hasLine()) {
        const [from, to] = annotation.getLine();
        if (from === undefined || to === undefined) {
          throw new RangeError('a /Line annotation answered with fewer than two endpoints');
        }
        annotation.setLine(map(from), map(to));
      }
      if (annotation.hasQuadPoints()) {
        const quads = annotation.getQuadPoints();
        annotation.clearQuadPoints();
        for (const quad of quads) {
          const [ulx, uly, urx, ury, llx, lly, lrx, lry] = quad;
          const [ax, ay] = map([ulx, uly]);
          const [bx, by] = map([urx, ury]);
          const [cx, cy] = map([llx, lly]);
          const [dx, dy] = map([lrx, lry]);
          annotation.addQuadPoint([ax, ay, bx, by, cx, cy, dx, dy]);
        }
      }
      // THE APPEARANCE IS REGENERATED, which is what makes the move visible.
      // Without it the dictionary says one place and the `/AP` draws another,
      // and MuPDF's own renderer would still show the move — so a proof that
      // rasterised through MuPDF could not see this line missing.
      annotation.update();
    }
  });

/**
 * Reports that a placement's prior state is not recorded, and validates first.
 *
 * **Not `addAnnotation`'s *not yet* and not `removeAnnotation`'s *never*.** The
 * prior state here is expressible — it is the geometry the annotation carried —
 * and recording it would make this the first invertible annotation command.
 * What stops it is that the inverse cannot be the rectangle: for the four
 * subtypes with no `/Rect`, placing the old box back maps the points through a
 * second affine, and the reported box carries a border outset that does not
 * scale with it. The round trip is close and not equal, and an undo that
 * restores something *nearly* right is worse than a checkpoint.
 *
 * The trigger for revisiting it is a prior that carries the geometry itself —
 * vertices, ink strokes or a line — which is bounded and serialisable, and is a
 * `CommandPrior` entry rather than a rectangle.
 */
export function capturePlaceAnnotation(
  session: MupdfSession,
  command: CommandOfKind<'placeAnnotation'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    for (const placement of command.placements) annotationAt(loaded, placement.index);
    return {
      captured: false,
      reason:
        'a moved annotation is not recorded as prior state yet: restoring it by rectangle is ' +
        'lossy for the four subtypes whose geometry defines their box, so the prior would have ' +
        'to carry the geometry itself',
    };
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `CommandPrior['placeAnnotation']` is `never`. It throws for
 * {@link invertAddAnnotation}'s reason.
 */
export const invertPlaceAnnotation: Invert<'mupdf', 'placeAnnotation'> = (): Promise<void> => {
  throw new Error(
    'a moved annotation has no inverse yet; undo restores the checkpoint the bus took (ADR-0037)',
  );
};

/**
 * Reports that prior state cannot be recorded, and validates first.
 *
 * `captureAddAnnotation`'s shape and its care: the page and the index are
 * checked here so a handle naming nothing is a caller error rather than a
 * capture refusal the bus turns into a checkpoint of a command that was never
 * going to apply.
 *
 * The reason is **structural**, unlike its neighbour's. A removed annotation's
 * prior state is its whole object graph — a dictionary that may reference an
 * appearance stream, which references fonts and images — so recording it means
 * inventing a serialisation for arbitrary PDF objects, and those bytes would sit
 * in a log whose `retainedBytes` counts checkpoints only.
 */
export function captureRemoveAnnotation(
  session: MupdfSession,
  command: CommandOfKind<'removeAnnotation'>,
): Promise<CaptureResult<never>> {
  return withDocument(session, (document) => {
    const loaded = pageAt(document, command.page, document.countPages());
    // EVERY index, not the first: a capture that validated one of five would
    // let the bus checkpoint a command that is about to refuse on the fourth.
    for (const index of command.indices) annotationAt(loaded, index);
    return {
      captured: false,
      reason:
        'a removed annotation cannot be recorded as prior state: its prior state is the whole ' +
        'object graph it owned, including any appearance stream and the fonts and images that ' +
        'stream references, which is unbounded and has no serialisation here',
    };
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `CommandPrior['removeAnnotation']` is `never`, so nothing can construct an
 * argument. It throws for `invertAddAnnotation`'s reason: a reachable path here
 * would mean the type had been widened, and a quiet resolve would land that as
 * an undo that silently did nothing.
 */
export const invertRemoveAnnotation: Invert<'mupdf', 'removeAnnotation'> = (): Promise<void> => {
  throw new Error(
    'a removed annotation has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
};
