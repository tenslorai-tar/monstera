import { useLingui } from '@lingui/react';
import type { AnnotationKindName } from '@monstera/contract';
import type { ReactElement } from 'react';

import { REDACT_MARK_LABEL } from '../messages/en.js';

/**
 * The annotation-types registry's RENDERER half — §7's *"Annotation types | geometry adapter,
 * renderer, kernel writer mapping | overlay, panel, persistence"*, and §6's *"every annotation
 * type registers … a renderer"*.
 *
 * ## One entry per kind, and the record is what makes that exhaustive
 *
 * Keyed on the contract's closed `AnnotationKindName`, so a kind added there is a compile error
 * here until somebody decides how it is drawn. A partial map would let a new kind arrive drawing
 * nothing with no decision taken, which is the silent omission this shape exists to refuse.
 *
 * ## `null` means the page raster draws it, and that is almost every kind
 *
 * PDF.js paints an annotation's own appearance stream onto the page canvas, so a square, an ink
 * stroke or a highlight is already on screen and a renderer here would draw it twice. The one
 * kind whose appearance does not show what it means is `redact`: measured 2026-09-15 in the
 * production build, MuPDF's Redact appearance is painted as a thin red outline and the content it
 * will remove stays fully visible.
 *
 * ## A mark must not look like a REDACTION, which is what it is not yet (the owner's item N1)
 *
 * A mark filled solid in `--redact-mark` is black, the box a burn-in leaves — so a page whose marks
 * nobody had applied would look exactly like a redacted one, while every word under the boxes is
 * still in the file and can be selected, saved and exported. So a pending mark has a look only it
 * has: diagonal hatching and a dashed edge in `--redact-mark`, with the content still visible
 * between the lines, and a *Marked for redaction* label on it. An APPLIED redaction is not drawn here at all — it is the engine's black box in
 * the page's own content, painted by the raster — so the two cannot be confused by construction:
 * this layer draws only what is still an annotation.
 *
 * ## What this is NOT yet
 *
 * The geometry adapter and the kernel writer mapping are the other two halves §7 lists, and
 * nothing calls them: the eraser and select hit-test the channel's `rect` directly, and the
 * kernel maps drafts in `pageAnnotations.ts`. Building empty halves ahead of a caller would be a
 * declaration nothing can contradict, so this file carries the half that has one.
 */

/**
 * How an existing annotation of one kind is drawn over its page, or `null` where the page raster draws it.
 *
 * The layer positions an element on the annotation's box and the renderer fills it, so a renderer names no
 * coordinates. A renderer that labels its mark draws the label as an element carrying `data-annotation-label`; the
 * layer measures every label on the page in one pass and says where it sits (`AnnotationLayer`'s `labelPlace`).
 */
export type AnnotationRenderer = (() => ReactElement) | null;

/**
 * A Redact mark that has not been applied: hatched, dashed, and labelled.
 *
 * **The hatching is not a fill.** What a pending mark says is *this is to be removed*, and a person reviewing marks
 * before applying them reads the words between the lines. A solid box would say *this is gone*, which is the
 * burn-in's look and is exactly the confusion the owner's item N1 removes.
 */
function RedactMark(): ReactElement {
  const { _ } = useLingui();
  return (
    <span className="m-redact-mark">
      <span className="m-redact-mark__label" data-annotation-label="">
        {_(REDACT_MARK_LABEL)}
      </span>
    </span>
  );
}

function redactMark(): ReactElement {
  return <RedactMark />;
}

export const ANNOTATION_RENDERERS: Readonly<Record<AnnotationKindName, AnnotationRenderer>> = {
  square: null,
  circle: null,
  line: null,
  ink: null,
  redact: redactMark,
  'text-box': null,
  'sticky-note': null,
  caret: null,
  polygon: null,
  polyline: null,
  highlight: null,
  underline: null,
  strikeout: null,
  callout: null,
  typewriter: null,
  'measure-distance': null,
  'measure-area': null,
  'measure-perimeter': null,
  stamp: null,
  other: null,
};
