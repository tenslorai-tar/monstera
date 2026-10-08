import { useLingui } from '@lingui/react';
import {
  MAX_IMAGE_QUALITY,
  MAX_PAGE_IMAGE_DPI,
  MIN_IMAGE_QUALITY,
  MIN_PAGE_IMAGE_DPI,
  type PageImageFormat,
} from '@monstera/contract';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  EXPORT_PAGE_IMAGES_DPI,
  EXPORT_PAGE_IMAGES_DPI_NOTE,
  EXPORT_PAGE_IMAGES_FILES,
  EXPORT_PAGE_IMAGES_FORMAT,
  EXPORT_PAGE_IMAGES_FORMAT_NOTE,
  EXPORT_PAGE_IMAGES_JPEG,
  EXPORT_PAGE_IMAGES_OUT_OF_BOUNDS,
  EXPORT_PAGE_IMAGES_PAGES_NOTE,
  EXPORT_PAGE_IMAGES_PNG,
  EXPORT_PAGE_IMAGES_QUALITY,
  EXPORT_PAGE_IMAGES_QUALITY_NOTE,
  EXPORT_PAGE_IMAGES_UNCHANGED,
  EXPORT_PAGE_IMAGES_WEBP,
  PAGE_RANGE_EXPORT_EMPTY,
  SPLIT_DOCUMENT_APPLY,
} from '../messages/en.js';
import type { ExportPageImagesAnswer } from './exportPageImagesResult.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Problem } from '../primitives/Problem.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';

/** 150 dpi: sharp on a screen and in a slide, without a print-sized file per page. */
const DEFAULT_DPI = '150';
/** 85: the point past which a JPEG grows quickly for detail few people can see. */
const DEFAULT_QUALITY = '85';

/**
 * A whole number within `[min, max]`, or `null`.
 *
 * `pageRanges.ts`' `readPageNumber` reason: `Number.parseInt` reads `150dpi` as
 * `150`, which accepts text the person cannot have meant. The pattern is the
 * check, and `Input` deliberately has no `type="number"` to lean on.
 */
function wholeWithin(text: string, min: number, max: number): number | null {
  if (!/^\d+$/u.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * The page-image export dialog's body: which pages, which format, and how.
 *
 * ## The exports' one page row, with an encoding beside it
 *
 * `PageRangeChoice` asks which pages; *Every page* and *Select pages* both
 * build a list, so the mode does not leave this component. The count is shown
 * before the button, computed from the list that will actually be sent.
 *
 * ## Quality is asked for the lossy formats only
 *
 * JPEG and WebP take it; a PNG is lossless, so the field is hidden for it and
 * the answer carries the default — the channel's shape is one request for both formats, and the host
 * ignores quality for a PNG.
 *
 * ## The folder is main's, picked after this
 *
 * So the button names that next step, as the split's does.
 */
export default function ExportPageImagesBody({
  pageCount,
  resolve,
}: {
  readonly pageCount: number;
} & DialogAnswering<ExportPageImagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const range = usePageRange(pageCount);
  const [format, setFormat] = useState<PageImageFormat>('png');
  const [dpiText, setDpiText] = useState(DEFAULT_DPI);
  const [qualityText, setQualityText] = useState(DEFAULT_QUALITY);
  const encodingRef = useRef<HTMLDivElement>(null);

  const dpi = wholeWithin(dpiText, MIN_PAGE_IMAGE_DPI, MAX_PAGE_IMAGE_DPI);
  // A PNG never reads quality, so its field's text cannot make the export unusable.
  const quality =
    format === 'png'
      ? Number(DEFAULT_QUALITY)
      : wholeWithin(qualityText, MIN_IMAGE_QUALITY, MAX_IMAGE_QUALITY);
  const inBounds = dpi !== null && quality !== null;

  return (
    <div className="m-export-page-images">
      <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} note={EXPORT_PAGE_IMAGES_PAGES_NOTE} range={range} />
      <DialogRow label={EXPORT_PAGE_IMAGES_FORMAT} note={EXPORT_PAGE_IMAGES_FORMAT_NOTE}>
        <SegmentedControl<PageImageFormat>
          label={EXPORT_PAGE_IMAGES_FORMAT}
          options={[
            { value: 'png', label: EXPORT_PAGE_IMAGES_PNG },
            { value: 'jpeg', label: EXPORT_PAGE_IMAGES_JPEG },
            { value: 'webp', label: EXPORT_PAGE_IMAGES_WEBP },
          ]}
          value={format}
          onChange={setFormat}
        />
      </DialogRow>
      <div ref={encodingRef}>
        <DialogRow label={EXPORT_PAGE_IMAGES_DPI} note={EXPORT_PAGE_IMAGES_DPI_NOTE}>
          <Input label={EXPORT_PAGE_IMAGES_DPI} labelShownBeside value={dpiText} onValueChange={setDpiText} />
        </DialogRow>
        {format !== 'png' ? (
          <DialogRow label={EXPORT_PAGE_IMAGES_QUALITY} note={EXPORT_PAGE_IMAGES_QUALITY_NOTE}>
            <Input label={EXPORT_PAGE_IMAGES_QUALITY} labelShownBeside value={qualityText} onValueChange={setQualityText} />
          </DialogRow>
        ) : null}
      </div>
      <Problem
        message={
          inBounds
            ? undefined
            : _(EXPORT_PAGE_IMAGES_OUT_OF_BOUNDS, {
                minDpi: MIN_PAGE_IMAGE_DPI,
                maxDpi: MAX_PAGE_IMAGE_DPI,
                minQuality: MIN_IMAGE_QUALITY,
                maxQuality: MAX_IMAGE_QUALITY,
              })
        }
        about={{ within: encodingRef }}
      />
      {/* WHAT THE EXPORT WILL MAKE, not a refusal: shown while the bounds hold, where the problem sentence is not. */}
      {inBounds ? (
        <p className="m-export-page-images__count" role="status">
          {range.chosen === undefined
            ? _(EXPORT_PAGE_IMAGES_UNCHANGED)
            : _(EXPORT_PAGE_IMAGES_FILES, { files: range.chosen.length })}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          label={SPLIT_DOCUMENT_APPLY}
          variant="primary"
          // ENABLED WHATEVER IS TYPED IN THE PAGE ROW, because pressing it is what makes that row say what is wrong
          // (`PageRangeChoice`). Bounds are said as they are typed, so they still disable it.
          disabled={!inBounds}
          onClick={() => {
            // GUARDED AGAIN rather than trusting the disabled attribute, for
            // `SplitDocumentBody`'s reason.
            if (!inBounds) return;
            const pages = range.proceed();
            if (pages === undefined) return;
            resolve({ pages: [...pages], format, dpi, quality });
          }}
        />
      </DialogFooter>
    </div>
  );
}
