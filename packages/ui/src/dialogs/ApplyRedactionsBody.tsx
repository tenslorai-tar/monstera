import { useLingui } from '@lingui/react';
import {
  PDF_REDACT_COVERS,
  PDF_REDACT_IMAGES,
  type PdfRedactCover,
  type PdfRedactImages,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  APPLY_REDACTIONS_APPLY,
  APPLY_REDACTIONS_COVER,
  APPLY_REDACTIONS_COVER_NONE,
  APPLY_REDACTIONS_COVER_SOLID,
  APPLY_REDACTIONS_IMAGES,
  APPLY_REDACTIONS_KEEP_TITLE,
  APPLY_REDACTIONS_KEEP_TITLE_WARNS,
  APPLY_REDACTIONS_IMAGES_PIXELS,
  APPLY_REDACTIONS_IMAGES_REMOVE,
  APPLY_REDACTIONS_SCOPE,
  APPLY_REDACTIONS_SCOPE_ALL,
  APPLY_REDACTIONS_SCOPE_PAGE,
  APPLY_REDACTIONS_WARNS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Problem } from '../primitives/Problem.js';
import { pdfjsPageOf } from '../pageNumbering.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { type ApplyRedactionsAnswer, applyRedactionsDefaults } from './applyRedactions.js';

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
  // FROM THE ONE DEFINITION a burn-in without asking applies (`applyRedactionsDefaults`), so what this dialog starts
  // on and what *Confirm before redacting: off* does cannot drift apart. The title is removed by default — ADR-0079:
  // removal is the side that cannot leak, so keeping it is something a person asks for.
  const start = applyRedactionsDefaults(page);
  const [scope, setScope] = useState<'all' | 'page'>(start.pages === 'all' ? 'all' : 'page');
  const [cover, setCover] = useState<PdfRedactCover>(start.cover);
  const [images, setImages] = useState<PdfRedactImages>(start.images);
  const [keepTitle, setKeepTitle] = useState(start.keepTitle);

  return (
    <div className="m-apply-redactions">
      {/* A WARNING LOOKS LIKE ONE (the owner, 2026-10-08): this burns the marks in and cannot be undone. */}
      <Problem message={_(APPLY_REDACTIONS_WARNS)} />

      <DialogRow label={APPLY_REDACTIONS_SCOPE}>
        <select
          aria-label={_(APPLY_REDACTIONS_SCOPE)}
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
      </DialogRow>

      <DialogRow label={APPLY_REDACTIONS_COVER}>
        <select
          aria-label={_(APPLY_REDACTIONS_COVER)}
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
      </DialogRow>

      <DialogRow label={APPLY_REDACTIONS_IMAGES}>
        <select
          aria-label={_(APPLY_REDACTIONS_IMAGES)}
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
      </DialogRow>

      {/* OFF, AND THE LABEL SAYS WHAT IT RISKS. The other three controls choose between
          outcomes that are all safe; this one chooses to keep something a burn-in would
          otherwise remove, so the words have to carry the reason rather than name the
          field — a checkbox reading *Keep the title* is a setting, and one reading what
          a title can contain is a decision. A checkbox and not a select because it is
          the only control here whose two states are not peers: off is the safe side and
          stays the default however often somebody wants the other. */}
      <DialogRow label={APPLY_REDACTIONS_KEEP_TITLE} note={APPLY_REDACTIONS_KEEP_TITLE_WARNS}>
        <input
          aria-label={_(APPLY_REDACTIONS_KEEP_TITLE)}
          checked={keepTitle}
          data-redact-keep-title=""
          onChange={(event) => {
            setKeepTitle(event.target.checked);
          }}
          type="checkbox"
        />
      </DialogRow>

      <DialogFooter>
        <Button
          label={APPLY_REDACTIONS_APPLY}
          onClick={() => {
            resolve({ pages: scope === 'all' ? 'all' : [page], cover, images, keepTitle });
          }}
          variant="primary"
        />
      </DialogFooter>
    </div>
  );
}
