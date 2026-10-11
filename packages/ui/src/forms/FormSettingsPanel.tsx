import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { FIELD_HIGHLIGHT_DESCRIPTION, FIELD_HIGHLIGHT_TITLE, FORM_SETTINGS_HINT, FORM_SETTINGS_TITLE } from '../messages/en.js';
import { FIELD_HIGHLIGHT_SETTING } from '../settings/viewing.js';
import type { SettingsStore } from '../settingsStore.js';
import { useSetting } from '../useSetting.js';

/**
 * The Properties tab while the Forms section is on show and nothing is selected (the owner's E4): the form's own
 * settings, never the annotation panel's colour, opacity and line width, which belong to marks and not to a form.
 *
 * The switch is the one setting `viewing.highlight-fields` (ADR-0226 Decision 4's wash), the same the View menu's
 * command toggles, so the two can never disagree.
 */
export function FormSettingsPanel({ settings }: { readonly settings: SettingsStore }): ReactElement {
  const { i18n } = useLingui();
  const highlighted = useSetting(settings, FIELD_HIGHLIGHT_SETTING);
  return (
    <section aria-label={i18n._(FORM_SETTINGS_TITLE)} className="m-properties" data-form-settings="">
      <header className="m-properties__head">
        <h2 className="m-properties__title">{i18n._(FORM_SETTINGS_TITLE)}</h2>
      </header>
      <label className="m-properties__check">
        <input
          checked={highlighted}
          onChange={(event) => {
            settings.set(FIELD_HIGHLIGHT_SETTING.id, event.target.checked);
          }}
          type="checkbox"
        />
        <span>{i18n._(FIELD_HIGHLIGHT_TITLE)}</span>
      </label>
      <p className="m-properties__meta">{i18n._(FIELD_HIGHLIGHT_DESCRIPTION)}</p>
      <p className="m-properties__meta">{i18n._(FORM_SETTINGS_HINT)}</p>
    </section>
  );
}
