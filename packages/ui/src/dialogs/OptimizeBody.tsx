import { useLingui } from '@lingui/react';
import { OPTIMIZE_SETTING_NAMES, type OptimizeSetting, type OptimizeTarget } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useState } from 'react';

import {
  OPTIMIZE_HIGH,
  OPTIMIZE_KEEPS,
  OPTIMIZE_LOW,
  OPTIMIZE_MEASURE,
  OPTIMIZE_MEDIUM,
  OPTIMIZE_NOT_SMALLER,
  OPTIMIZE_QUALITY,
  OPTIMIZE_SAVE,
  OPTIMIZE_SIZE,
  OPTIMIZE_SIZE_AMOUNT,
  OPTIMIZE_SIZE_OUT_OF_BOUNDS,
  OPTIMIZE_SIZE_UNIT,
  OPTIMIZE_SIZES,
  OPTIMIZE_SMALLEST,
  OPTIMIZE_UNIT_KB,
  OPTIMIZE_UNIT_MB,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import { Problem } from '../primitives/Problem.js';
import { SegmentedControl } from '../primitives/SegmentedControl.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { OptimizeAnswer, OptimizeProps } from './optimize.js';

/** Each setting's name, as a record so a fourth arrives owing its words. */
const NAMES: Readonly<Record<OptimizeSetting, MessageKey>> = {
  high: OPTIMIZE_HIGH,
  medium: OPTIMIZE_MEDIUM,
  low: OPTIMIZE_LOW,
};

const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;

/** The sizes a person may ask for, the channel's own bounds: a kilobyte to a gigabyte. */
const LEAST = KILOBYTE;
const MOST = 1024 * MEGABYTE;

type Unit = 'kb' | 'mb';
const UNIT_BYTES: Readonly<Record<Unit, number>> = { kb: KILOBYTE, mb: MEGABYTE };

/**
 * A size as a person reads it, in the interface's locale: kilobytes under a megabyte, megabytes
 * from there, one decimal. Converted at the point of display, as the import dialogs' limits are.
 */
function readable(bytes: number, locale: string): string {
  const [value, unit] = bytes < MEGABYTE ? [bytes / KILOBYTE, 'kilobyte'] : [bytes / MEGABYTE, 'megabyte'];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value);
}

/**
 * The size the box says, in bytes, or `null` where it says no size this dialog can ask for. A number with at most two
 * decimals, nothing else: `Number.parseFloat` reads `2MB` as 2, which accepts text the person cannot have meant.
 */
function bytesOf(text: string, unit: Unit): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/u.test(trimmed)) return null;
  const bytes = Math.round(Number(trimmed) * UNIT_BYTES[unit]);
  return bytes >= LEAST && bytes <= MOST ? bytes : null;
}

/** How a size in bytes starts in the box: in megabytes from a megabyte, else kilobytes, two decimals at most. */
function boxOf(bytes: number): { readonly text: string; readonly unit: Unit } {
  const unit: Unit = bytes >= MEGABYTE ? 'mb' : 'kb';
  return { text: String(Math.round((bytes / UNIT_BYTES[unit]) * 100) / 100), unit };
}

/** Whether two choices are the same choice, so a measurement of one may be shown for the other. */
function sameTarget(a: OptimizeTarget, b: OptimizeTarget): boolean {
  return a.kind === 'setting' ? b.kind === 'setting' && a.setting === b.setting : b.kind === 'size' && a.bytes === b.bytes;
}

/**
 * The *Save a smaller copy* dialog's body (ADR-0087, ADR-0298).
 *
 * **The measurement belongs to the choice it was taken for.** Choosing another setting, or typing
 * another size, hides it and the save with it, so the sizes on screen are always the chosen
 * choice's — and *save* is never offered where the copy would not be smaller, which is the rule
 * main applies again. A size the file cannot reach is still offered as the smallest it can go
 * (ADR-0298 Decision 3): a person is never refused because of their document.
 */
export default function OptimizeBody({ target: measuredTarget, size, measured, resolve }: OptimizeProps & DialogAnswering<OptimizeAnswer>): ReactElement {
  const { _, i18n } = useLingui();
  const [choice, setChoice] = useState<OptimizeSetting | 'size'>(measuredTarget.kind === 'setting' ? measuredTarget.setting : 'size');
  const start = boxOf(measuredTarget.kind === 'size' ? measuredTarget.bytes : size);
  const [amount, setAmount] = useState(start.text);
  const [unit, setUnit] = useState<Unit>(start.unit);

  const bytes = bytesOf(amount, unit);
  const target: OptimizeTarget | null =
    choice === 'size' ? (bytes === null ? null : { kind: 'size', bytes }) : { kind: 'setting', setting: choice };
  const shown = measured !== null && target !== null && sameTarget(target, measuredTarget) ? measured : null;
  const smaller = shown !== null && shown.after < shown.before;

  return (
    <div className="m-optimize">
      <p>{_(OPTIMIZE_KEEPS)}</p>
      <DialogRow label={OPTIMIZE_QUALITY}>
        <div aria-label={_(OPTIMIZE_QUALITY)} className="m-export-excel__layout" role="radiogroup">
          {OPTIMIZE_SETTING_NAMES.map((each) => (
            <label key={each}>
              <input
                type="radio"
                name="optimize-setting"
                checked={choice === each}
                onChange={() => {
                  setChoice(each);
                }}
              />
              {_(NAMES[each])}
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="optimize-setting"
              checked={choice === 'size'}
              onChange={() => {
                setChoice('size');
              }}
            />
            {_(OPTIMIZE_SIZE)}
          </label>
        </div>
      </DialogRow>

      {choice === 'size' ? (
        <DialogRow label={OPTIMIZE_SIZE_AMOUNT}>
          <Input label={OPTIMIZE_SIZE_AMOUNT} labelShownBeside value={amount} onValueChange={setAmount} />
          <SegmentedControl<Unit>
            label={OPTIMIZE_SIZE_UNIT}
            options={[
              { value: 'kb', label: OPTIMIZE_UNIT_KB },
              { value: 'mb', label: OPTIMIZE_UNIT_MB },
            ]}
            value={unit}
            onChange={setUnit}
          />
        </DialogRow>
      ) : null}
      {choice === 'size' && bytes === null ? (
        <Problem message={_(OPTIMIZE_SIZE_OUT_OF_BOUNDS, { least: readable(LEAST, i18n.locale), most: readable(MOST, i18n.locale) })} />
      ) : null}

      {shown === null ? null : (
        <p role="status">
          {!smaller
            ? _(OPTIMIZE_NOT_SMALLER, { before: readable(shown.before, i18n.locale), after: readable(shown.after, i18n.locale) })
            : shown.fits
              ? _(OPTIMIZE_SIZES, {
                  before: readable(shown.before, i18n.locale),
                  after: readable(shown.after, i18n.locale),
                  percent: Math.round((1 - shown.after / shown.before) * 100),
                })
              : _(OPTIMIZE_SMALLEST, { after: readable(shown.after, i18n.locale) })}
        </p>
      )}

      {/* THE PATTERN'S FOOTER: Cancel, then measuring, then saving once a measurement found a smaller file — the
          action of the moment is the primary one. */}
      <DialogFooter>
        <Button
          label={OPTIMIZE_MEASURE}
          variant={smaller ? 'default' : 'primary'}
          disabled={target === null}
          onClick={() => {
            if (target !== null) resolve({ kind: 'measure', target });
          }}
        />
        {smaller ? (
          <Button
            label={OPTIMIZE_SAVE}
            variant="primary"
            onClick={() => {
              resolve({ kind: 'save' });
            }}
          />
        ) : null}
      </DialogFooter>
    </div>
  );
}
