import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  WATERMARK_PAGES_ALL,
  WATERMARK_PAGES_APPLY,
  WATERMARK_PAGES_NO_TEXT,
  WATERMARK_PAGES_OPACITY,
  WATERMARK_PAGES_OPACITY_RANGE,
  WATERMARK_PAGES_NOT_A_NUMBER,
  WATERMARK_PAGES_ROTATION,
  WATERMARK_PAGES_SIZE,
  WATERMARK_PAGES_SIZE_RANGE,
  WATERMARK_PAGES_TEXT,
  WATERMARK_PAGES_THIS,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { WatermarkPagesAnswer } from './watermarkPagesResult.js';

/**
 * The appearance a watermark has unless the person changes it.
 *
 * Chosen so the dialog is usable by typing one word: a 45° diagonal at 30%
 * opacity is what every application this one replaces draws, and a person who
 * wants exactly that should not have to fill three more fields to get it.
 *
 * These are **defaults for a control**, not tokens: they describe content
 * written into a document another reader will open, which is what §10.2's rule
 * about raw values in components is scoped away from.
 */
const DEFAULT_OPACITY = '30';
const DEFAULT_ROTATION = '45';
const DEFAULT_SIZE = '48';

/** What the numeric fields hold while they are being typed. */
interface Appearance {
  readonly opacity: string;
  readonly rotationDegrees: string;
  readonly fontSize: string;
}

const DEFAULTS: Appearance = {
  opacity: DEFAULT_OPACITY,
  rotationDegrees: DEFAULT_ROTATION,
  fontSize: DEFAULT_SIZE,
};

/**
 * The watermark dialog's body — the text, its appearance, and a scope.
 *
 * ## OPACITY IS A PERCENTAGE HERE AND A FRACTION ON THE WIRE
 *
 * `watermarkPagesSchema` carries `0…1`, and a person types `30`. The conversion
 * happens here, once, at the point the two units meet — which is the shape the
 * wired-tools rule's own blind spot calls for: *a third thing that states the
 * correspondence*, rather than a literal at a call site that nothing can
 * compare. Here the correspondence is `percent / 100` in a single named
 * function, so a field reading `30` and a command carrying `0.3` cannot come
 * apart without this line changing.
 *
 * The unit is in the label, so nothing about the field asks the reader to guess.
 *
 * ## An empty field is the DEFAULT, and a wrong one is not
 *
 * `CropPagesBody`'s distinction with a different filling: there an empty margin
 * means *do not crop this edge*, because zero is a meaningful answer. A
 * watermark at zero opacity or zero size is not an operation anybody wants, so
 * an empty field falls back to the default rather than to zero. Text that is
 * not a number is a mistake and is named, and only that state disables the
 * control.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function WatermarkPagesBody({
  page,
  resolve,
}: {
  readonly page: number;
} & DialogAnswering<WatermarkPagesAnswer>): ReactElement {
  const { _ } = useLingui();
  const [text, setText] = useState('');
  const [appearance, setAppearance] = useState<Appearance>(DEFAULTS);
  const [everyPage, setEveryPage] = useState(true);

  const trimmed = text.trim();
  const parsed = readAppearance(appearance);
  const ready = trimmed.length > 0 && parsed !== null;

  return (
    <div className="m-watermark-pages">
      <Input
        label={WATERMARK_PAGES_TEXT}
        value={text}
        onValueChange={(next) => {
          setText(next);
        }}
      />
      <Input
        label={WATERMARK_PAGES_OPACITY}
        value={appearance.opacity}
        onValueChange={(next) => {
          setAppearance({ ...appearance, opacity: next });
        }}
      />
      <Input
        label={WATERMARK_PAGES_ROTATION}
        value={appearance.rotationDegrees}
        onValueChange={(next) => {
          setAppearance({ ...appearance, rotationDegrees: next });
        }}
      />
      <Input
        label={WATERMARK_PAGES_SIZE}
        value={appearance.fontSize}
        onValueChange={(next) => {
          setAppearance({ ...appearance, fontSize: next });
        }}
      />
      <fieldset className="m-watermark-pages__scope">
        {/* TWO BUTTONS RATHER THAN A CHECKBOX, for `CropPagesBody`'s reason:
            the choice is between two named things, and a checkbox makes one of
            them the absence of the other. */}
        <Button
          label={WATERMARK_PAGES_THIS}
          variant={everyPage ? 'default' : 'primary'}
          onClick={() => {
            setEveryPage(false);
          }}
        />
        <Button
          label={WATERMARK_PAGES_ALL}
          variant={everyPage ? 'primary' : 'default'}
          onClick={() => {
            setEveryPage(true);
          }}
        />
      </fieldset>
      <p className="m-watermark-pages__problem" role="status">
        {ready ? '' : _(problemOf(trimmed, appearance))}
      </p>
      <Button
        label={WATERMARK_PAGES_APPLY}
        variant="primary"
        disabled={!ready}
        onClick={() => {
          // GUARDED AGAIN rather than trusting the disabled attribute, for
          // `CropPagesBody`'s reason: the schema behind `resolve` refuses an
          // opacity above 1, and a mismatch would be a thrown
          // `DialogResultRejected` over the user's document.
          if (parsed === null || trimmed.length === 0) return;
          resolve({ pages: everyPage ? 'all' : [page], text: trimmed, ...parsed });
        }}
      />
    </div>
  );
}

/**
 * The one place the percentage a person types becomes the fraction the command
 * carries.
 *
 * Named rather than written inline at the `resolve` above, because the two
 * halves of this feature live either side of a boundary and the unit is what
 * changes across it — which is exactly where the wired pair's blind spot is. A
 * literal `/ 100` at the call site is a number nothing can compare; this is a
 * function both a reader and a test can name.
 */
function fractionOfPercent(percent: number): number {
  return percent / 100;
}

/** The parsed appearance, or `null` if a field is text that is not a number. */
function readAppearance(appearance: Appearance): Omit<WatermarkPagesAnswer, 'pages' | 'text'> | null {
  const opacity = readNumber(appearance.opacity, DEFAULT_OPACITY);
  const rotation = readNumber(appearance.rotationDegrees, DEFAULT_ROTATION, { signed: true });
  const size = readNumber(appearance.fontSize, DEFAULT_SIZE);
  if (opacity === null || rotation === null || size === null) return null;

  // THE COMMAND'S OWN BOUNDS, checked before `resolve` sees them. The schema
  // would refuse these too, and it refuses by throwing at the user; refusing
  // here disables a button and says which field is wrong.
  if (opacity > 100) return null;
  if (size <= 0 || size > 1000) return null;
  if (rotation < -360 || rotation > 360) return null;

  return {
    opacity: fractionOfPercent(opacity),
    rotationDegrees: rotation,
    fontSize: size,
  };
}

/**
 * One field's number, falling back to its default when empty.
 *
 * A PATTERN, not `parseFloat`, for `CropPagesBody`'s reason: `parseFloat` reads
 * `12abc` as 12, which is the quiet-drop failure `parsePageRanges` refuses.
 */
function readNumber(
  text: string,
  fallback: string,
  options: { readonly signed?: boolean } = {},
): number | null {
  const value = text.trim().length === 0 ? fallback : text.trim();
  const pattern = options.signed === true ? /^-?\d+(?:\.\d+)?$/u : /^\d+(?:\.\d+)?$/u;
  if (!pattern.test(value)) return null;
  return Number(value);
}

/**
 * Which sentence a refusal deserves.
 *
 * Four states rather than one, because *that is not a number* is unhelpful
 * about an opacity of `150`, which plainly is one. The order is the order a
 * person fills the form, so the message names the first thing that is wrong
 * rather than the last.
 */
function problemOf(text: string, appearance: Appearance): MessageKey {
  if (text.length === 0) return WATERMARK_PAGES_NO_TEXT;
  const opacity = readNumber(appearance.opacity, DEFAULT_OPACITY);
  if (opacity !== null && opacity > 100) return WATERMARK_PAGES_OPACITY_RANGE;
  const size = readNumber(appearance.fontSize, DEFAULT_SIZE);
  if (size !== null && (size <= 0 || size > 1000)) return WATERMARK_PAGES_SIZE_RANGE;
  return WATERMARK_PAGES_NOT_A_NUMBER;
}
