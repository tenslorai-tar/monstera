import { useLingui } from '@lingui/react';
import { OPTIMIZE_SETTING_NAMES, type OptimizeSetting } from '@monstera/contract';
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
  OPTIMIZE_SIZES,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { OptimizeAnswer, OptimizeProps } from './optimize.js';

/** Each setting's name, as a record so a fourth arrives owing its words. */
const NAMES: Readonly<Record<OptimizeSetting, MessageKey>> = {
  high: OPTIMIZE_HIGH,
  medium: OPTIMIZE_MEDIUM,
  low: OPTIMIZE_LOW,
};

const MEGABYTE = 1024 * 1024;

/**
 * A size as a person reads it, in the interface's locale: kilobytes under a megabyte, megabytes
 * from there, one decimal. Converted at the point of display, as the import dialogs' limits are.
 */
function readable(bytes: number, locale: string): string {
  const [value, unit] = bytes < MEGABYTE ? [bytes / 1024, 'kilobyte'] : [bytes / MEGABYTE, 'megabyte'];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, maximumFractionDigits: 1 }).format(value);
}

/**
 * The *Save a smaller copy* dialog's body (ADR-0087).
 *
 * **The measurement belongs to the setting it was taken at.** Choosing another setting hides it
 * and the save with it, so the sizes on screen are always the chosen setting's — and *save* is
 * never offered where the copy would not be smaller, which is the rule main applies again.
 */
export default function OptimizeBody({
  setting: measuredSetting,
  measured,
  resolve,
}: OptimizeProps & DialogAnswering<OptimizeAnswer>): ReactElement {
  const { _, i18n } = useLingui();
  const [setting, setSetting] = useState<OptimizeSetting>(measuredSetting);
  const shown = measured !== null && setting === measuredSetting ? measured : null;

  return (
    <div className="m-optimize">
      <p>{_(OPTIMIZE_KEEPS)}</p>
      <fieldset className="m-export-excel__layout">
        <legend>{_(OPTIMIZE_QUALITY)}</legend>
        {OPTIMIZE_SETTING_NAMES.map((each) => (
          <label key={each}>
            <input
              type="radio"
              name="optimize-setting"
              checked={setting === each}
              onChange={() => {
                setSetting(each);
              }}
            />
            {_(NAMES[each])}
          </label>
        ))}
      </fieldset>

      {shown === null ? null : (
        <p role="status">
          {shown.after < shown.before
            ? _(OPTIMIZE_SIZES, {
                before: readable(shown.before, i18n.locale),
                after: readable(shown.after, i18n.locale),
                percent: Math.round((1 - shown.after / shown.before) * 100),
              })
            : _(OPTIMIZE_NOT_SMALLER, {
                before: readable(shown.before, i18n.locale),
                after: readable(shown.after, i18n.locale),
              })}
        </p>
      )}

      <div className="m-optimize__actions">
        <Button
          label={OPTIMIZE_MEASURE}
          variant={shown !== null && shown.after < shown.before ? 'default' : 'primary'}
          onClick={() => {
            resolve({ kind: 'measure', setting });
          }}
        />
        {shown !== null && shown.after < shown.before ? (
          <Button
            label={OPTIMIZE_SAVE}
            variant="primary"
            onClick={() => {
              resolve({ kind: 'save', setting });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
