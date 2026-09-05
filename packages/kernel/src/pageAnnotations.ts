import type { AnnotationDraft, AnnotationRect, CommandOfKind } from '@monstera/contract';
import { type PageTransform, pageTransform, pdfPoint, toViewport } from '@monstera/shared';
import type { PDFAnnotation, PDFDocument, PDFPage } from 'mupdf';

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
function placed(rect: AnnotationRect, transform: PageTransform): [number, number, number, number] {
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

/**
 * How each annotation type is written — §7's *kernel writer mapping*, as a
 * table indexed by the draft's own discriminant.
 *
 * **Indexed, never switched**, for `CommandBus#preReadFor`'s reason: a `switch`
 * here would be a second routing place, and a mapped type over the union means
 * a member added to `annotationDraftSchema` without an entry is a compile error
 * rather than a runtime fall-through. Twenty tools land in this table.
 */
type AnnotationWriter<T extends AnnotationDraft['type']> = (
  annotation: PDFAnnotation,
  draft: Extract<AnnotationDraft, { type: T }>,
) => void;

const writers: { readonly [T in AnnotationDraft['type']]: AnnotationWriter<T> } = {
  square: (annotation, draft): void => {
    annotation.setColor([...draft.colour]);
    // AN EMPTY INTERIOR, which is what makes this an outline rather than a
    // filled box. Not a default standing in for a missing feature: a fill is a
    // second colour, and the control that would choose it is the style panel.
    // Written explicitly because MuPDF's own default is not this build's
    // decision to inherit.
    annotation.setInteriorColor([]);
    annotation.setBorderWidth(draft.borderWidth);
  },
};

/** The MuPDF subtype each drafted annotation becomes. */
const subtypes = { square: 'Square' } as const satisfies Record<AnnotationDraft['type'], string>;

/**
 * Adds the drawn annotation to its page.
 *
 * The rectangle is resolved and checked **before** anything is created, so a
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
    const rect = placed(draft.rect, transform);

    if (rect[2] - rect[0] <= 0 || rect[3] - rect[1] <= 0) {
      throw new RangeError(
        `an annotation with no area cannot be drawn. The rectangle given was ` +
          `${String(draft.rect.x0)}, ${String(draft.rect.y0)} to ${String(draft.rect.x1)}, ` +
          `${String(draft.rect.y1)} in the page's own space.`,
      );
    }
    if (!touchesPage(rect, transform)) {
      throw new RangeError(
        `that annotation lies entirely outside page ${String(command.page)}, whose displayed ` +
          `region is ${String(transform.viewport.width)} by ` +
          `${String(transform.viewport.height)} units, so nothing would be visible.`,
      );
    }

    const annotation = loaded.createAnnotation(subtypes[draft.type]);
    annotation.setRect(rect);
    // THE TABLE, indexed by the draft's own discriminant.
    //
    // No assertion, and that is a fact about the union having ONE member rather
    // than about the pattern being assertion-free. The day a second annotation
    // type is declared, TypeScript resolves `writers[draft.type]` to the union
    // of every entry's parameter type instead of pairing the entry with the
    // draft that selected it, and this line stops compiling. The repair is an
    // assertion confined to it — which is what a mapped table over a
    // discriminated union costs, and it is cheaper than a `switch`, because a
    // member added without an entry is a compile error here rather than a
    // runtime fall-through.
    writers[draft.type](annotation, draft);
    // The appearance stream. Without it the annotation is a dictionary with no
    // `/AP`, which every viewer is free to render its own way or not at all —
    // and MuPDF's own renderer would still draw it, so a proof that rasterised
    // through MuPDF could not see the difference.
    annotation.update();
  });

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
