import { useLingui } from '@lingui/react';
import {
  PDF_REDACT_COVERS,
  PDF_REDACT_IMAGES,
  type PdfRedactCover,
  type PdfRedactImages,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId, useState } from 'react';

import {
  APPLY_REDACTIONS_APPLY,
  APPLY_REDACTIONS_COVER,
  APPLY_REDACTIONS_COVER_NONE,
  APPLY_REDACTIONS_COVER_SOLID,
  APPLY_REDACTIONS_IMAGES,
  APPLY_REDACTIONS_IMAGES_PIXELS,
  APPLY_REDACTIONS_IMAGES_REMOVE,
  APPLY_REDACTIONS_SCOPE,
  APPLY_REDACTIONS_SCOPE_ALL,
  APPLY_REDACTIONS_SCOPE_PAGE,
  APPLY_REDACTIONS_WARNS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ApplyRedactionsAnswer } from './applyRedactions.js';

/** Each cover's own words, exhaustive over the contract's list. */
const COVER_TITLES: Readonly<Record<PdfRedactCover, MessageKey>> = {
  solid: APPLY_REDACTIONS_COVER_SOLID,
  none: APPLY_REDACTIONS_COVER_NONE,
};

/** Each image method's own words, exhaustive for the same reason. */
const IMAGE_TITLES: Readonly<Record<PdfRedactImages, MessageKey>> = {
  pixels: APPLY_REDACTIONS_IMAGES_PIXELS,
  remove: APPLY_REDACTIONS_IMAGES_REMOVE,
};

/**
 * Confirm a burn-in, and choose what it leaves behind.
 *
 * ## The sentence says what is irreversible, not *are you sure*
 *
 * A confirm that asks for certainty tells a person nothing they did not
 * already know. This one says the two facts that decide the answer: the
 * content is removed rather than covered, and the only way back is undo in
 * this session.
 *
 * ## `this page` is offered by NUMBER
 *
 * `pdfjsPageOf` is the one converter between the kernel's zero-based indices
 * and the number on screen, and the payload carries the kernel index it was
 * given — so the label and the payload cannot disagree, which is the wired-pair
 * blind spot this repository names by name.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ApplyRedactionsBody({
  page,
  resolve,
}: { readonly page: number } & DialogAnswering<ApplyRedactionsAnswer>): ReactElement {
  const { _ } = useLingui();
  const scopeId = useId();
  const coverId = useId();
  const imagesId = useId();
  const [scope, setScope] = useState<'all' | 'page'>('page');
  const [cover, setCover] = useState<PdfRedactCover>('solid');
  const [images, setImages] = useState<PdfRedactImages>('pixels');

  return (
    <div className="m-apply-redactions">
      <p className="m-apply-redactions__warning">{_(APPLY_REDACTIONS_WARNS)}</p>

      <label className="m-document-choice" htmlFor={scopeId}>
        {_(APPLY_REDACTIONS_SCOPE)}
        <select
          id={scopeId}
          data-redact-scope=""
          onChange={(event) => {
            setScope(event.target.value === 'all' ? 'all' : 'page');
          }}
          value={scope}
        >
          <option value="page">
            {_(APPLY_REDACTIONS_SCOPE_PAGE, { page: pdfjsPageOf(page) })}
          </option>
          <option value="all">{_(APPLY_REDACTIONS_SCOPE_ALL)}</option>
        </select>
      </label>

      <label className="m-document-choice" htmlFor={coverId}>
        {_(APPLY_REDACTIONS_COVER)}
        <select
          id={coverId}
          data-redact-cover=""
          onChange={(event) => {
            setCover(event.target.value as PdfRedactCover);
          }}
          value={cover}
        >
          {PDF_REDACT_COVERS.map((choice) => (
            <option key={choice} value={choice}>
              {_(COVER_TITLES[choice])}
            </option>
          ))}
        </select>
      </label>

      <label className="m-document-choice" htmlFor={imagesId}>
        {_(APPLY_REDACTIONS_IMAGES)}
        <select
          id={imagesId}
          data-redact-images=""
          onChange={(event) => {
            setImages(event.target.value as PdfRedactImages);
          }}
          value={images}
        >
          {PDF_REDACT_IMAGES.map((choice) => (
            <option key={choice} value={choice}>
              {_(IMAGE_TITLES[choice])}
            </option>
          ))}
        </select>
      </label>

      <Button
        label={APPLY_REDACTIONS_APPLY}
        onClick={() => {
          resolve({ pages: scope === 'all' ? 'all' : [page], cover, images });
        }}
        variant="primary"
      />
    </div>
  );
}
