// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { AZURE_KEY_SETTING_ID } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING } from '../settings/appearance.js';
import { ANNOTATION_OPACITY_SETTING, AZURE_DI_KEY_SETTING } from '../settings/editing.js';
import type { SettingsAnswer } from './settings.js';
import { controlFor, DIALOG_SETTINGS } from './settings.js';
import SettingsBody from './SettingsBody.js';

/**
 * The Settings dialog's body, driven through the controls a person uses.
 *
 * ## The join is against the REGISTERED set, not a list typed here
 *
 * Every setting the dialog can derive a control for must have one a person can
 * find by its label, and every setting it cannot must not — iterating the
 * rendered controls alone would make them the universe and miss a setting that
 * rendered nothing.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * A key's English text, refusing a key the catalogue lacks.
 *
 * A missing entry would otherwise search for `undefined`, which matches nothing —
 * so a label-absence assertion would pass for a setting whose title was never
 * written. That is the reassuring answer, and it is refused here.
 */
function english(key: MessageKey): string {
  const text = EN[key];
  if (text === undefined) throw new Error(`the English catalogue has no entry for ${key}`);
  return text;
}

/** Every ordinary setting at its fallback, as the command would open the dialog. */
const DEFAULTS = Object.fromEntries(
  DIALOG_SETTINGS.filter((setting) => controlFor(setting) !== 'secret').map((setting) => [
    setting.id,
    setting.fallback,
  ]),
);

function opened(options: {
  readonly storedSecrets?: readonly (typeof AZURE_KEY_SETTING_ID)[];
  readonly secretsAvailable?: boolean;
}): { readonly answers: SettingsAnswer[] } {
  const answers: SettingsAnswer[] = [];
  render(
    <Wrapped>
      <SettingsBody
        resolve={(answer) => {
          answers.push(answer);
        }}
        secretsAvailable={options.secretsAvailable ?? true}
        storedSecrets={options.storedSecrets ?? []}
        values={DEFAULTS}
      />
    </Wrapped>,
  );
  return { answers };
}

const SAVE = (): HTMLElement => screen.getByRole('button', { name: 'Save' });

/** A setting's control, found the way a person finds it: by its label. */
function control(title: MessageKey): HTMLElement {
  return screen.getByLabelText(english(title));
}

describe('SettingsBody', () => {
  it('has a labelled control for every setting it derives one for, and none for the rest', () => {
    opened({});

    for (const setting of ALL_SETTINGS) {
      const found = screen.queryByLabelText(english(setting.title));
      if (controlFor(setting) === undefined) expect(found, setting.id).toBeNull();
      else expect(found, setting.id).not.toBeNull();
    }
  });

  it('answers only what CHANGED', () => {
    const { answers } = opened({});

    fireEvent.change(control(THEME_SETTING.title), { target: { value: 'dark' } });
    fireEvent.click(SAVE());

    expect(answers).toStrictEqual([{ values: { [THEME_SETTING.id]: 'dark' }, secrets: {} }]);
  });

  it('a value its schema refuses disables Save and names the setting', () => {
    const { answers } = opened({});

    fireEvent.change(control(ANNOTATION_OPACITY_SETTING.title), { target: { value: '5' } });

    expect(SAVE()).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toContain(
      english(ANNOTATION_OPACITY_SETTING.title),
    );
    fireEvent.click(SAVE());
    expect(answers).toStrictEqual([]);
  });

  it('the key field is WRITE-ONLY: empty with a placeholder when a key is stored, and typing replaces it', () => {
    const { answers } = opened({ storedSecrets: [AZURE_KEY_SETTING_ID] });
    const field = control(AZURE_DI_KEY_SETTING.title) as HTMLInputElement;

    // THERE IS NO VALUE TO SHOW — the props carry an id — and the field says a
    // key is stored without holding it.
    expect(field.value).toBe('');
    expect(field.placeholder).toBe('••••••••');

    fireEvent.change(field, { target: { value: 'a new key' } });
    fireEvent.click(SAVE());

    expect(answers).toStrictEqual([
      { values: {}, secrets: { [AZURE_KEY_SETTING_ID]: 'a new key' } },
    ]);
  });

  it('removing a stored key answers an empty value', () => {
    const { answers } = opened({ storedSecrets: [AZURE_KEY_SETTING_ID] });
    fireEvent.click(screen.getByLabelText('Remove the stored key'));
    fireEvent.click(SAVE());
    expect(answers).toStrictEqual([{ values: {}, secrets: { [AZURE_KEY_SETTING_ID]: '' } }]);
  });

  it('CONTROL: saving without touching a stored key does not remove it', () => {
    const { answers } = opened({ storedSecrets: [AZURE_KEY_SETTING_ID] });
    fireEvent.click(SAVE());
    expect(answers).toStrictEqual([{ values: {}, secrets: {} }]);
  });

  it('with no secure storage the key field is disabled, says why, and answers no secret', () => {
    const { answers } = opened({ secretsAvailable: false });
    const field = control(AZURE_DI_KEY_SETTING.title) as HTMLInputElement;

    expect(field.disabled).toBe(true);
    expect(
      screen.getByText(
        'This computer has no secure place to keep a key, so one cannot be saved here.',
      ),
    ).toBeDefined();
    fireEvent.click(SAVE());
    expect(answers).toStrictEqual([{ values: {}, secrets: {} }]);
  });
});
