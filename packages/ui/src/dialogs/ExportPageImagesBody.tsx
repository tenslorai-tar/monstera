import { useLingui } from '@lingui/react';
import {
  MAX_JPEG_QUALITY,
  MAX_PAGE_IMAGE_DPI,
  MIN_JPEG_QUALITY,
  MIN_PAGE_IMAGE_DPI,
  type PageImageFormat,
} from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  DELETE_PAGES_HINT,
  EXPORT_PAGE_IMAGES_ALL,
  EXPORT_PAGE_IMAGES_DPI,
  EXPORT_PAGE_IMAGES_EMPTY,
  EXPORT_PAGE_IMAGES_FILES,
  EXPORT_PAGE_IMAGES_FORMAT,
  EXPORT_PAGE_IMAGES_JPEG,
  EXPORT_PAGE_IMAGES_LABEL,
  EXPORT_PAGE_IMAGES_OUT_OF_BOUNDS,
  EXPORT_PAGE_IMAGES_PNG,
  EXPORT_PAGE_IMAGES_QUALITY,
  EXPORT_PAGE_IMAGES_RANGES,
  SPLIT_DOCUMENT_APPLY,
} from '../messages/en.js';
import { parsePageRanges } from '../pageRanges.js';
import type { ExportPageImagesAnswer } from './exportPageImagesResult.js';
import { renderRangeProblem } from './pageRangeProblem.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
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
 * ## `SplitDocumentBody`'s page choice, with an encoding beside it
 *
 * *Every page* and *these pages* both build a list, so the mode does not leave
 * this component. The count is shown before the button, computed from the list
 * that will actually be sent.
 *
 * ## Quality is asked for JPEG only
 *
 * A PNG is lossless, so the field is hidden for it and the answer carries the
 * default — the channel's shape is one request for both formats, and the host
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
  const [everyPage, setEveryPage] = useState(true);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<PageImageFormat>('png');
  const [dpiText, setDpiText] = useState(DEFAULT_DPI);
  const [qualityText, setQualityText] = useState(DEFAULT_QUALITY);

  const parsed = parsePageRanges(text, pageCount);
  const pages = everyPage
    ? Array.from({ length: pageCount }, (_unused, page) => page)
    : parsed.ok
      ? parsed.value
      : [];
  const dpi = wholeWithin(dpiText, MIN_PAGE_IMAGE_DPI, MAX_PAGE_IMAGE_DPI);
  // A PNG never reads quality, so its field's text cannot make the export unusable.
  const quality =
    format === 'png'
      ? Number(DEFAULT_QUALITY)
      : wholeWithin(qualityText, MIN_JPEG_QUALITY, MAX_JPEG_QUALITY);
  const inBounds = dpi !== null && quality !== null;
  const usable = pages.length > 0 && inBounds;

  return (
    <div className="m-export-page-images">
      <fieldset className="m-export-page-images__pages">
        <label>
          <input
            type="radio"
            name="export-pages"
            checked={everyPage}
            onChange={() => {
              setEveryPage(true);
            }}
          />
          {_(EXPORT_PAGE_IMAGES_ALL)}
        </label>
        <label>
          <input
            type="radio"
            name="export-pages"
            checked={!everyPage}
            onChange={() => {
              setEveryPage(false);
            }}
          />
          {_(EXPORT_PAGE_IMAGES_RANGES)}
        </label>
      </fieldset>
      {everyPage ? null : (
        <Input
          label={EXPORT_PAGE_IMAGES_LABEL}
          placeholder={DELETE_PAGES_HINT}
          value={text}
          onValueChange={setText}
        />
      )}
      <fieldset className="m-export-page-images__format">
        <legend>{_(EXPORT_PAGE_IMAGES_FORMAT)}</legend>
        <label>
          <input
            type="radio"
            name="export-format"
            checked={format === 'png'}
            onChange={() => {
              setFormat('png');
            }}
          />
          {_(EXPORT_PAGE_IMAGES_PNG)}
        </label>
        <label>
          <input
            type="radio"
            name="export-format"
            checked={format === 'jpeg'}
            onChange={() => {
              setFormat('jpeg');
            }}
          />
          {_(EXPORT_PAGE_IMAGES_JPEG)}
        </label>
      </fieldset>
      <Input label={EXPORT_PAGE_IMAGES_DPI} value={dpiText} onValueChange={setDpiText} />
      {format === 'jpeg' ? (
        <Input
          label={EXPORT_PAGE_IMAGES_QUALITY}
          value={qualityText}
          onValueChange={setQualityText}
        />
      ) : null}
      <p className="m-export-page-images__problem" role="status">
        {!inBounds
          ? _(EXPORT_PAGE_IMAGES_OUT_OF_BOUNDS, {
              minDpi: MIN_PAGE_IMAGE_DPI,
              maxDpi: MAX_PAGE_IMAGE_DPI,
              minQuality: MIN_JPEG_QUALITY,
              maxQuality: MAX_JPEG_QUALITY,
            })
          : everyPage || parsed.ok
            ? _(EXPORT_PAGE_IMAGES_FILES, { files: pages.length })
            : renderRangeProblem(parsed, text, _, EXPORT_PAGE_IMAGES_EMPTY)}
      </p>
      <Button
        label={SPLIT_DOCUMENT_APPLY}
        variant="primary"
        disabled={!usable}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `SplitDocumentBody`'s reason.
          if (!usable) return;
          resolve({ pages: [...pages], format, dpi, quality });
        }}
      />
    </div>
  );
}
