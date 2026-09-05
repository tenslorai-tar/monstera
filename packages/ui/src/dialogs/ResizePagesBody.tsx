import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  RESIZE_PAGES_A3,
  RESIZE_PAGES_A4,
  RESIZE_PAGES_A5,
  RESIZE_PAGES_ALL,
  RESIZE_PAGES_APPLY,
  RESIZE_PAGES_HEIGHT,
  RESIZE_PAGES_LEGAL,
  RESIZE_PAGES_LETTER,
  RESIZE_PAGES_NOT_A_SIZE,
  RESIZE_PAGES_TABLOID,
  RESIZE_PAGES_THIS,
  RESIZE_PAGES_UNIFORM_NOTE,
  RESIZE_PAGES_WIDTH,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { ResizePagesAnswer } from './resizePagesResult.js';

/**
 * The standard sizes, in **points**, which is the unit the format uses.
 *
 * Rounded to whole points because that is how every one of these is defined in
 * practice — A4 is 210×297 mm, which is 595.276 points, and no producer writes
 * the fraction. Writing it would make two documents built to *A4* by different
 * tools disagree in the fourth decimal for no gain anyone can see.
 */
const PRESETS = [
  { key: 'a3', label: RESIZE_PAGES_A3, width: 842, height: 1191 },
  { key: 'a4', label: RESIZE_PAGES_A4, width: 595, height: 842 },
  { key: 'a5', label: RESIZE_PAGES_A5, width: 420, height: 595 },
  { key: 'letter', label: RESIZE_PAGES_LETTER, width: 612, height: 792 },
  { key: 'legal', label: RESIZE_PAGES_LEGAL, width: 612, height: 1008 },
  { key: 'tabloid', label: RESIZE_PAGES_TABLOID, width: 792, height: 1224 },
] as const;

/** PDF 32000-1's own limit on a page edge: 200 inches. */
const MAX_POINTS = 14_400;

/** The size the fields open on — the one most documents are already meant for. */
const A4 = { width: 595, height: 842 } as const;

/**
 * The resize dialog's body.
 *
 * ## A PRESET WRITES INTO THE FIELDS; it is not a second kind of state
 *
 * The obvious shape is *either a chosen preset or a custom size*, and it is the
 * shape with an illegal state in it: a preset selected while the fields say
 * something else, which then has to be resolved by a rule nobody can see. Here
 * the two numbers are the only state and a preset button is a shortcut that
 * fills them, so what the dialog will do is always exactly what is on screen
 * (B5 over a sync rule).
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function ResizePagesBody({
  page,
  resolve,
}: {
  readonly page: number;
} & DialogAnswering<ResizePagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const [width, setWidth] = useState(String(A4.width));
  const [height, setHeight] = useState(String(A4.height));
  const [everyPage, setEveryPage] = useState(true);

  const widthPoints = readPoints(width);
  const heightPoints = readPoints(height);
  const ready = widthPoints !== null && heightPoints !== null;

  return (
    <div className="m-resize-pages">
      <fieldset className="m-resize-pages__presets">
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            label={preset.label}
            // NO `primary` VARIANT ON A PRESET. It is a button that fills two
            // fields, not a selection — showing one as chosen would be the
            // second state this dialog does not keep, drawn on screen.
            onClick={() => {
              setWidth(String(preset.width));
              setHeight(String(preset.height));
            }}
          />
        ))}
      </fieldset>
      <Input
        label={RESIZE_PAGES_WIDTH}
        value={width}
        onValueChange={(next) => {
          setWidth(next);
        }}
      />
      <Input
        label={RESIZE_PAGES_HEIGHT}
        value={height}
        onValueChange={(next) => {
          setHeight(next);
        }}
      />
      <p className="m-resize-pages__note">{_(RESIZE_PAGES_UNIFORM_NOTE)}</p>
      <fieldset className="m-resize-pages__scope">
        {/* TWO BUTTONS RATHER THAN A CHECKBOX, for `CropPagesBody`'s reason. */}
        <Button
          label={RESIZE_PAGES_THIS}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={RESIZE_PAGES_ALL}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <p className="m-resize-pages__problem" role="status">
        {ready ? '' : _(RESIZE_PAGES_NOT_A_SIZE)}
      </p>
      <Button
        label={RESIZE_PAGES_APPLY}
        variant="primary"
        disabled={!ready}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `CropPagesBody`'s reason: the schema behind `resolve` refuses a
          // size outside the format's bounds, and a mismatch would be a thrown
          // `DialogResultRejected` over the user's document.
          if (widthPoints === null || heightPoints === null) return;
          resolve({ pages: everyPage ? 'all' : [page], widthPoints, heightPoints });
        }}
      />
    </div>
  );
}

/**
 * An edge in points, or `null` when the field is not a size the format allows.
 *
 * A PATTERN, not `parseFloat`, for `CropPagesBody`'s reason: `parseFloat` reads
 * `12abc` as 12, which is the quiet-drop failure `parsePageRanges` refuses.
 * **Zero is refused** — unlike the transition dialog's duration, where zero is
 * a legal instantaneous change — because a page with a zero edge is not a page.
 */
function readPoints(text: string): number | null {
  const value = text.trim();
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const points = Number(value);
  return points > 0 && points <= MAX_POINTS ? points : null;
}
