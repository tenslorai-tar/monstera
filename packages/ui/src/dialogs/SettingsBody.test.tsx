// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { AI_PROVIDERS, ANTHROPIC_KEY_SETTING_ID, AZURE_KEY_SETTING_ID } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { STARTING_STYLE_COLOUR } from '../annotations/annotationStyle.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN, STYLE_COLOUR_AUTO } from '../messages/en.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING } from '../settings/appearance.js';
import { ANNOTATION_COLOUR_SETTING, ANNOTATION_OPACITY_SETTING, AZURE_DI_KEY_SETTING } from '../settings/editing.js';
import { SETTINGS_PAGES } from '../settings/pages.js';
import type { SettingsAnswer } from './settings.js';
import { controlFor, DIALOG_SETTINGS } from './settings.js';
import SettingsBody from './SettingsBody.js';

/**
 * The Settings dialog's body, driven through the controls a person uses (the owner's design,
 * 2026-09-22; ADR-0094 for how a change reaches the command).
 *
 * ## Reports, not a Save
 *
 * There is no *Save*: each change is reported at once, so the cases assert what was reported after a
 * click rather than after a button that no longer exists.
 *
 * ## The join is against the REGISTERED set, not a list typed here
 *
 * Every setting the dialog can derive a control for must be reachable on exactly one page, and every
 * setting it cannot must be nowhere — iterating the rendered controls alone would make them the
 * universe and miss a setting that rendered nothing.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** A key's English text, refusing a key the catalogue lacks. */
function english(key: MessageKey): string {
  const text = EN[key];
  if (text === undefined) throw new Error(`the English catalogue has no entry for ${key}`);
  return text;
}

/** Every ordinary setting at its fallback, as the command would open the dialog. */
const DEFAULTS = Object.fromEntries(
  DIALOG_SETTINGS.filter((setting) => controlFor(setting) !== 'secret').map((setting) => [setting.id, setting.fallback]),
);

function opened(options: {
  readonly storedSecrets?: readonly (typeof AZURE_KEY_SETTING_ID | typeof ANTHROPIC_KEY_SETTING_ID)[];
  readonly secretsAvailable?: boolean;
  readonly values?: Readonly<Record<string, unknown>>;
}): { readonly reported: SettingsAnswer[]; readonly answers: SettingsAnswer[] } {
  const reported: SettingsAnswer[] = [];
  const answers: SettingsAnswer[] = [];
  render(
    <Wrapped>
      <SettingsBody
        resolve={(answer) => {
          answers.push(answer);
        }}
        secretsAvailable={options.secretsAvailable ?? true}
        storedSecrets={options.storedSecrets ?? []}
        update={(answer) => {
          reported.push(answer);
        }}
        values={{ ...DEFAULTS, ...options.values }}
      />
    </Wrapped>,
  );
  return { reported, answers };
}

/** Moves to the page whose row a setting is on, as a person does: by clicking it in the list. */
function goTo(category: string): void {
  const page = SETTINGS_PAGES.find((entry) => entry.id === category);
  if (page === undefined) throw new Error(`no settings page is declared for ${category}`);
  fireEvent.click(screen.getByRole('button', { name: english(page.title) }));
}

/** A setting's control, found the way a person finds it: by its label, on its own page. */
function control(setting: { readonly title: MessageKey; readonly category: string }): HTMLElement {
  goTo(setting.category);
  return screen.getByLabelText(english(setting.title));
}

describe('SettingsBody', () => {
  it('every derivable setting is reachable on its page, and a setting with no control is nowhere', () => {
    opened({});

    for (const setting of ALL_SETTINGS) {
      if (controlFor(setting) === undefined || setting.remembered === true) {
        // REMEMBERED STATE AND UNRENDERABLE KINDS are not rows: a panel's width is not a question.
        goTo(setting.category === 'general' ? 'appearance' : setting.category);
        expect(screen.queryByLabelText(english(setting.title)), setting.id).toBeNull();
        continue;
      }
      // A PROVIDER'S KEY appears when its provider is the one chosen; anthropic is the default.
      if (setting.category === 'ai' && setting.secret === true && setting.id !== AI_PROVIDERS.anthropic.keySetting) {
        continue;
      }
      goTo(setting.category);
      expect(screen.queryByLabelText(english(setting.title)), setting.id).not.toBeNull();
    }
  });

  it('a change is REPORTED at once, with no Save to press', () => {
    const { reported } = opened({});

    // THE SEGMENTED CONTROL the design draws for a choice of three: its members are radios.
    const dark = THEME_SETTING.optionTitles?.['dark'];
    if (dark === undefined) throw new Error('the theme setting declares no title for its dark member');
    fireEvent.click(screen.getByRole('radio', { name: english(dark) }));

    expect(reported).toStrictEqual([{ values: { [THEME_SETTING.id]: 'dark' }, secrets: {} }]);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a value its schema refuses is NOT reported, and the footer names the setting', () => {
    const { reported } = opened({});

    fireEvent.change(control(ANNOTATION_OPACITY_SETTING), { target: { value: '5' } });

    expect(reported).toStrictEqual([]);
    expect(screen.getByRole('status').textContent).toContain(english(ANNOTATION_OPACITY_SETTING.title));
  });

  it('a COLOUR is a pair: unticking the no-choice box offers the starting colour, and the choice is reported', () => {
    const { reported } = opened({});
    goTo(ANNOTATION_COLOUR_SETTING.category);
    const auto = screen.getByLabelText<HTMLInputElement>(english(STYLE_COLOUR_AUTO));
    const swatch = screen.getByLabelText<HTMLInputElement>(english(ANNOTATION_COLOUR_SETTING.title));

    expect(auto.checked).toBe(true);
    expect(swatch.disabled).toBe(true);

    fireEvent.click(auto);
    expect(swatch.disabled).toBe(false);
    expect(swatch.value).toBe(STARTING_STYLE_COLOUR);
    fireEvent.change(swatch, { target: { value: '#0000ff' } });

    expect(reported.at(-1)).toStrictEqual({ values: { [ANNOTATION_COLOUR_SETTING.id]: '#0000ff' }, secrets: {} });
  });

  it('the key field is WRITE-ONLY: empty with a placeholder when a key is stored, and typing replaces it', () => {
    const { reported } = opened({ storedSecrets: [AZURE_KEY_SETTING_ID] });
    const field = control(AZURE_DI_KEY_SETTING) as HTMLInputElement;

    expect(field.value).toBe('');
    expect(field.placeholder).toBe('••••••••');

    fireEvent.change(field, { target: { value: 'a new key' } });

    expect(reported).toStrictEqual([{ values: {}, secrets: { [AZURE_KEY_SETTING_ID]: 'a new key' } }]);
  });

  it('removing a stored key reports an empty value, and CONTROL: touching nothing reports nothing', () => {
    const { reported } = opened({ storedSecrets: [AZURE_KEY_SETTING_ID] });
    goTo(AZURE_DI_KEY_SETTING.category);
    fireEvent.click(screen.getByLabelText('Remove the stored key'));
    expect(reported).toStrictEqual([{ values: {}, secrets: { [AZURE_KEY_SETTING_ID]: '' } }]);

    const untouched = opened({ storedSecrets: [AZURE_KEY_SETTING_ID] });
    expect(untouched.reported).toStrictEqual([]);
  });

  it('a setting that NEEDS the credential store is disabled with it missing, and says why', () => {
    // Found by the audit of 57de0e0..d2989fc: *Save chat history* encrypts with the keys' own cipher
    // (ADR-0093), so on a machine with no keyring main refuses every save while the switch read ON.
    opened({ secretsAvailable: false });
    goTo('ai');
    const history = screen.getByLabelText<HTMLInputElement>('Save chat history');
    expect(history.disabled).toBe(true);
    expect(screen.getAllByText(/no secure place to keep a key/u).length).toBeGreaterThan(0);
  });

  it('CONTROL: with the credential store available that same switch is offered', () => {
    opened({ secretsAvailable: true });
    goTo('ai');
    expect(screen.getByLabelText<HTMLInputElement>('Save chat history').disabled).toBe(false);
  });

  it('with no secure storage the key field is disabled and the row says why', () => {
    opened({ secretsAvailable: false });
    goTo(AZURE_DI_KEY_SETTING.category);
    expect((control(AZURE_DI_KEY_SETTING) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/no secure place to keep a key/u)).toBeDefined();
  });

  describe('the AI page asks which provider first', () => {
    it('shows ONE key field — the chosen provider’s — and marks which providers have a key', () => {
      opened({ storedSecrets: [ANTHROPIC_KEY_SETTING_ID] });
      goTo('ai');

      const fields = document.querySelectorAll('.m-settings-row__secret');
      expect(fields).toHaveLength(1);

      const chooser = screen.getByLabelText<HTMLSelectElement>('Provider');
      const stored = [...chooser.options].filter((option) => option.textContent.includes('key stored'));
      expect(stored.map((option) => option.value)).toStrictEqual(['anthropic']);

      // CHOOSING ANOTHER swaps the field rather than adding one.
      fireEvent.change(chooser, { target: { value: 'openai' } });
      expect(document.querySelectorAll('.m-settings-row__secret')).toHaveLength(1);
      expect(screen.getByLabelText('OpenAI API key')).toBeDefined();
    });
  });

  it('SEARCH finds a setting by its label and by its description, wherever it lives', () => {
    opened({});
    const search = screen.getByLabelText('Search settings');

    fireEvent.change(search, { target: { value: 'recognition language' } });
    expect(screen.getByLabelText('Recognition language')).toBeDefined();

    // BY DESCRIPTION: the words under the label, which is where a person's own wording lands.
    fireEvent.change(search, { target: { value: 'PDFium' } });
    expect(screen.getByLabelText('Draw pages with the other renderer')).toBeDefined();

    fireEvent.change(search, { target: { value: 'nothing matches this' } });
    expect(screen.getByText(/Nothing matches/u)).toBeDefined();
  });

  it('the footer reports the three ACTIONS, and Done answers with nothing left to apply', () => {
    const { reported, answers } = opened({});

    goTo('privacy');
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat history' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'clear-chat-history' });

    fireEvent.click(screen.getByRole('button', { name: 'Export settings…' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'export' });

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'reset' });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(answers).toStrictEqual([{ values: {}, secrets: {} }]);
  });

  it('every listed page INTRODUCES ITSELF with a line under its title (the owner’s design)', () => {
    opened({});
    for (const page of SETTINGS_PAGES) {
      const listed = screen.queryByRole('button', { name: english(page.title) });
      if (listed === null) continue;
      fireEvent.click(listed);
      const note = document.querySelector('.m-settings__page-note');
      expect(note?.textContent ?? '', page.id).not.toBe('');
    }
  });

  it('a page is listed for its ROWS or its words, never for having a note', () => {
    // THE SET, from both sides. Iterating the rendered list alone would make it the universe and
    // could not see a page that should be there and is not. The defect this separates: while the
    // listing keyed on *has a note*, writing a note for Viewing-with-no-settings would have put the
    // empty page from `settings2.png` straight back, and every page has a note now.
    opened({});
    const withRows = new Set(ALL_SETTINGS.filter((s) => controlFor(s) !== undefined && s.remembered !== true).map((s) => s.category));
    const expected = SETTINGS_PAGES.filter(
      (page) => withRows.has(page.id) || (['keyboard', 'updates', 'privacy'] as string[]).includes(page.id),
    ).map((page) => page.id);
    const listed = SETTINGS_PAGES.filter(
      (page) => screen.queryByRole('button', { name: english(page.title) }) !== null,
    ).map((page) => page.id);

    expect(listed).toStrictEqual(expected);
    // AND THE CONTROL that makes the line above mean something: a page with neither rows nor words
    // exists in the declared order and is absent from the list.
    expect(expected).not.toContain('saving');
    expect(listed).not.toContain('saving');
  });

  it('a page with no setting of its own still says something — never an empty page', () => {
    opened({});
    for (const page of SETTINGS_PAGES) {
      const listed = screen.queryByRole('button', { name: english(page.title) });
      if (listed === null) continue;
      fireEvent.click(listed);
      const body = document.querySelector('.m-settings__page');
      // A HEADING PLUS SOMETHING: a row, a note, or an action. A page that drew only its own title
      // is the empty page the owner's design pass called out.
      expect((body?.childElementCount ?? 0) > 1, page.id).toBe(true);
    }
  });
});
