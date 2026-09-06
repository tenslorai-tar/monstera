import type {
  AnnotationDraft,
  AnnotationRect,
  CommandOfKind,
  LineEnding,
} from '@monstera/contract';
import { type PageTransform, pageTransform, pdfPoint, toViewport } from '@monstera/shared';
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
 * **It does not mark authorship.** Invariant L5 — a save never rewrites
 * annotations the app did not author — needs a `srcRef` scheme, and inventing
 * one inside the first drawing tool is how a sidecar hack starts: the tempting
 * fields (`/NM`, `/T`) already mean something else, and smuggling provenance
 * through them is the pathology §3 bans by name. `docs/FEATURES.md` carries the
 * `srcRef` row and it stays open. Nothing here is blocked on it, because adding
 * an annotation reads no foreign one — and a case asserts that a foreign
 * annotation on the same page keeps every key it arrived with.
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

/** The page's transform at scale 1, which is the frame MuPDF's annotations use. */
function transformFor(loaded: PDFPage): PageTransform {
  const object = loaded.getObject();
  const box = displayedBox(object);
  if (box === null) {
    throw new RangeError(
      'this page displays no region — it has no /MediaBox of four numbers, or its /CropBox and ' +
        '/MediaBox do not overlap — so there is no frame to place an annotation in',
    );
  }
  // The EFFECTIVE rotation, snapped, exactly as `readPageGeometry` reads it and
  // through the same function: the renderer drew the page turned, so the frame
  // the user pointed in is the turned one. `getInheritable` because a page may
  // take its rotation from an ancestor `/Pages` node.
  const inherited = object.getInheritable('Rotate');
  const rotation = inherited.isNumber() ? snapRotation(inherited.asNumber()) : 0;
  return pageTransform(box, rotation, 1);
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
function placedRect(
  rect: AnnotationRect,
  transform: PageTransform,
): [number, number, number, number] {
  const a = toViewport(pdfPoint(rect.x0, rect.y0), transform);
  const b = toViewport(pdfPoint(rect.x1, rect.y1), transform);
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

/**
 * Whether a rectangle in the page's displayed frame touches the page at all.
 *
 * The frame's origin is its own corner and its extent is the transform's
 * viewport, so the page is `0, 0` to `viewport.width, viewport.height` — there
 * is no second place that says where the page is.
 */
function touchesPage(rect: readonly [number, number, number, number], transform: PageTransform): boolean {
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
  /** Writes everything but the appearance stream. */
  readonly write: (annotation: PDFAnnotation, draft: D, transform: PageTransform) => void;
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
};

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
    kind.write(annotation, draft, transform);
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
 */
export type AnnotationKindName = AnnotationDraft['type'] | 'other';

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
}

/** MuPDF's subtype back to the name a surface may use. */
const NAMED: Readonly<Record<string, AnnotationKindName>> = {
  Square: 'square',
  Circle: 'circle',
  Line: 'line',
  Ink: 'ink',
  Redact: 'redact',
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
      for (const annotation of document.loadPage(page).getAnnotations()) {
        if (found.length >= MAX_LISTED) return { annotations: found, truncated: true };
        found.push({
          page,
          index: index++,
          // `?? 'other'` IS THE WHOLE POINT of the closed union: a subtype this
          // build cannot name is listed rather than dropped, because a panel
          // that silently omitted a document's own comments would be worse than
          // one that names them vaguely.
          kind: NAMED[annotation.getType()] ?? 'other',
          contents: annotation.getContents().slice(0, MAX_LISTED_CONTENTS),
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
