// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import {
  AI_PROVIDERS,
  type AiModelListAnswer,
  type AiProviderId,
  ANTHROPIC_KEY_SETTING_ID,
  AZURE_KEY_SETTING_ID,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { STARTING_STYLE_COLOUR } from '../annotations/annotationStyle.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN, STYLE_COLOUR_AUTO } from '../messages/en.js';
import { AZURE_OPENAI_ENDPOINT_SETTING } from '../settings/ai.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { THEME_SETTING } from '../settings/appearance.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_OPACITY_SETTING,
  AUTHOR_NAME_SETTING,
  AZURE_DI_KEY_SETTING,
} from '../settings/editing.js';
import { SETTINGS_PAGES } from '../settings/pages.js';
import type { SettingDefinition } from '../registries/settings.js';
import type { SettingsAnswer } from './settings.js';
import { controlFor, DIALOG_SETTINGS, listedPages } from './settings.js';
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
  readonly models?: Readonly<Partial<Record<AiProviderId, AiModelListAnswer>>>;
}): { readonly reported: SettingsAnswer[]; readonly answers: SettingsAnswer[] } {
  const reported: SettingsAnswer[] = [];
  const answers: SettingsAnswer[] = [];
  render(
    <Wrapped>
      <SettingsBody
        resolve={(answer) => {
          answers.push(answer);
        }}
        models={options.models ?? {}}
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

    // ONE VISIT PER PAGE, every setting of that page checked there. Visiting the page once per SETTING re-rendered the
    // dialog as many times as there are settings, and the case crossed vitest's five seconds under a busy parallel run
    // (5.1 s beside App.test, 0.97 s alone, 2026-09-28) — a cost that grew with every setting registered.
    const pageOf = (setting: SettingDefinition): string => (setting.category === 'general' ? 'appearance' : setting.category);
    /** The provider whose own row a setting is — its key, or Azure OpenAI's address — shown only while it is chosen. */
    const ownerOf = (setting: SettingDefinition): string | undefined =>
      setting.id === AZURE_OPENAI_ENDPOINT_SETTING.id
        ? 'azure-openai'
        : Object.entries(AI_PROVIDERS).find(([, entry]) => entry.keySetting === setting.id)?.[0];
    const pages = [...new Set(ALL_SETTINGS.map(pageOf))];

    for (const page of pages) {
      goTo(page);
      const here = ALL_SETTINGS.filter((setting) => pageOf(setting) === page);
      // THE PROVIDER-OWNED ROWS LAST, since choosing a provider changes what the page shows.
      for (const setting of [...here.filter((s) => ownerOf(s) === undefined), ...here.filter((s) => ownerOf(s) !== undefined)]) {
        if (controlFor(setting) === undefined || setting.remembered === true) {
          // REMEMBERED STATE AND UNRENDERABLE KINDS are not rows: a panel's width is not a question.
          expect(screen.queryByLabelText(english(setting.title)), setting.id).toBeNull();
          continue;
        }
        // A PROVIDER'S OWN ROW appears while that provider is chosen, so it is chosen first: every one is reached,
        // rather than the default provider's alone.
        const owner = ownerOf(setting);
        if (owner !== undefined) fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: owner } });
        expect(screen.queryByLabelText(english(setting.title)), setting.id).not.toBeNull();
      }
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

  it('YOUR NAME FOR COMMENTS says it asks for a name (WCAG 1.3.5, ADR-0116); a text field about nobody says nothing', () => {
    opened({});
    expect(control(AUTHOR_NAME_SETTING).getAttribute('autocomplete')).toBe('name');
    // THE CONTROL: another text setting, which is not about the user, carries no purpose — the dialog takes it from
    // each setting rather than stamping every text field.
    const other = DIALOG_SETTINGS.find(
      (setting) => controlFor(setting) === 'text' && setting.purpose === undefined && setting.id !== AUTHOR_NAME_SETTING.id,
    );
    if (other === undefined) throw new Error('another text setting exists to compare with');
    expect(control(other).getAttribute('autocomplete')).toBeNull();
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

  it('a chosen colour ticked back reports the no-choice value', () => {
    // FROM A STORED CHOICE, so the report is a change: from the fallback the same click would leave
    // the setting where it was, which is the control below.
    const { reported } = opened({ values: { [ANNOTATION_COLOUR_SETTING.id]: '#0000ff' } });
    const swatch = control(ANNOTATION_COLOUR_SETTING) as HTMLInputElement;
    expect(swatch.disabled).toBe(false);
    expect(swatch.value).toBe('#0000ff');

    fireEvent.click(screen.getByLabelText(english(STYLE_COLOUR_AUTO)));

    expect(reported.at(-1)).toStrictEqual({ values: { [ANNOTATION_COLOUR_SETTING.id]: 'auto' }, secrets: {} });
  });

  it('CONTROL: unticking and ticking back from no choice leaves the setting at no choice', () => {
    // WHAT WAS LAST REPORTED FOR IT, or nothing at all: a body that kept the starting colour it
    // offered on the untick would leave that colour stored after a round trip that chose nothing.
    const { reported } = opened({});
    goTo(ANNOTATION_COLOUR_SETTING.category);
    const auto = screen.getByLabelText(english(STYLE_COLOUR_AUTO));
    fireEvent.click(auto);
    fireEvent.click(auto);

    const last = reported.filter((answer) => ANNOTATION_COLOUR_SETTING.id in answer.values).at(-1);
    expect(last?.values[ANNOTATION_COLOUR_SETTING.id] ?? 'auto').toBe('auto');
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

  it('with no secure storage EVERY key field is disabled, and each says why', () => {
    // NO "AND NO SECRET IS REPORTED": with nothing typed that clause holds for a body that ignores
    // the store entirely, and typing into a disabled field is a thing only a synthetic event can do.
    // Measured 2026-09-24: such an event IS reported. What stops a real one is the disabled field,
    // asserted here, and main's store refusing to write with no cipher (`secretStore.ts`).
    opened({ secretsAvailable: false });
    const secretSettings = DIALOG_SETTINGS.filter((setting) => controlFor(setting) === 'secret');
    // A VACUITY GUARD, then the join against the REGISTERED set rather than a list typed here: a
    // provider's key is shown only while its provider is chosen, so the chooser is set first.
    expect(secretSettings.length).toBeGreaterThan(1);
    for (const setting of secretSettings) {
      goTo(setting.category);
      const provider = Object.entries(AI_PROVIDERS).find(([, entry]) => entry.keySetting === setting.id)?.[0];
      if (provider !== undefined) {
        fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: provider } });
      }
      const field = screen.getByLabelText<HTMLInputElement>(english(setting.title));
      expect(field.disabled, setting.id).toBe(true);
      expect(screen.getAllByText(/no secure place to keep a key/u).length, setting.id).toBeGreaterThan(0);
    }
  });

  describe('the AI page asks which provider first', () => {
    it('shows ONE key field — the chosen provider’s — and marks which providers have a key', () => {
      opened({ storedSecrets: [ANTHROPIC_KEY_SETTING_ID] });
      goTo('ai');

      const fields = document.querySelectorAll('.m-settings-row__secret');
      expect(fields).toHaveLength(1);

      const chooser = screen.getByLabelText<HTMLSelectElement>('AI provider');
      const stored = [...chooser.options].filter((option) => option.textContent.includes('key stored'));
      expect(stored.map((option) => option.value)).toStrictEqual(['anthropic']);

      // CHOOSING ANOTHER swaps the field rather than adding one.
      fireEvent.change(chooser, { target: { value: 'openai' } });
      expect(document.querySelectorAll('.m-settings-row__secret')).toHaveLength(1);
      expect(screen.getByLabelText('OpenAI API key')).toBeDefined();
    });

    it('asks it ONCE: the provider whose key is shown is the provider the Assistant asks', () => {
      // Two drop-downs put two answers to *which provider* on one page. The page's chooser is `ai.provider` itself.
      const { reported } = opened({});
      goTo('ai');

      expect(document.querySelectorAll('.m-settings__page select')).toHaveLength(2);
      expect(screen.getAllByLabelText(/provider/iu)).toHaveLength(1);
      fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'gemini' } });
      expect(reported.at(-1)?.values).toStrictEqual({ 'ai.provider': 'gemini' });
      expect(screen.getByLabelText('Google Gemini API key')).toBeDefined();
    });

    it('a key field says its name ONCE on screen — the row’s bold label — and keeps it as its accessible name', () => {
      opened({});
      goTo('ai');

      const field = screen.getByLabelText('Anthropic API key');
      const own = document.querySelector(`label[for="${field.id}"]`);
      expect(own?.className).toBe('m-visually-hidden');
      // THE VISIBLE ONE is the row's, so hiding the field's did not leave the row unnamed.
      const row = field.closest('.m-settings-row');
      expect(row?.querySelector('.m-settings-row__label')?.textContent).toBe('Anthropic API key');
    });

    it('shows Azure OpenAI’s address only while Azure OpenAI is the provider', () => {
      opened({});
      goTo('ai');
      expect(screen.queryByLabelText('Azure OpenAI endpoint')).toBeNull();

      fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'azure-openai' } });
      expect(screen.getByLabelText('Azure OpenAI endpoint')).toBeDefined();
    });
  });

  describe('the AI MODEL row lists what main held when the dialog opened (ADR-0117 Decision 3)', () => {
    const vision = (id: string, sees: boolean | null): AiModelListAnswer['models'][number] => ({
      id,
      label: `${id} label`,
      capabilities: { vision: sees, streaming: null },
    });
    /** Anthropic's list with a BLIND model first, so a default ignoring the use would pick it. */
    const ANTHROPIC: AiModelListAnswer = { source: 'fetched', models: [vision('blind', false), vision('sees', true)] };
    const OPENAI: AiModelListAnswer = { source: 'fallback', models: [vision('gpt-a', null), vision('gpt-b', null)] };

    it('selects the default the use can take, lists the blind model DISABLED, and says the list was fetched', () => {
      const { reported } = opened({ models: { anthropic: ANTHROPIC, openai: OPENAI } });
      goTo('ai');

      const row = screen.getByLabelText<HTMLSelectElement>('AI model');
      expect(row.value).toBe('sees');
      const blind = [...row.options].find((option) => option.value === 'blind');
      expect(blind?.disabled).toBe(true);
      expect(blind?.textContent).toBe('blind label (cannot read images)');
      expect(screen.getByText('Listed by Anthropic this session.')).toBeDefined();
      // SHOWING THE DEFAULT STORES NOTHING: a choice is stored only when a person makes one.
      expect(reported.map((report) => report.values)).not.toContainEqual(
        expect.objectContaining({ 'ai.models': expect.anything() as unknown }),
      );
    });

    it('follows the provider row: OpenAI’s list, its source in words, and the blind rule off where nothing reads images', () => {
      opened({ models: { anthropic: ANTHROPIC, openai: { source: 'fetched', models: [vision('gpt-blind', false)] } } });
      goTo('ai');
      fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'openai' } });

      const row = screen.getByLabelText<HTMLSelectElement>('AI model');
      expect([...row.options].map((option) => option.value)).toStrictEqual(['gpt-blind']);
      expect(row.options[0]?.disabled).toBe(false);
      expect(row.value).toBe('gpt-blind');
    });

    it('a choice writes ONLY the shown provider’s entry, keeping the others', () => {
      const { reported } = opened({
        models: { anthropic: ANTHROPIC, openai: OPENAI },
        values: { 'ai.models': { anthropic: 'sees' } },
      });
      goTo('ai');
      fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'openai' } });
      fireEvent.change(screen.getByLabelText('AI model'), { target: { value: 'gpt-b' } });

      expect(reported.at(-1)?.values).toStrictEqual({ 'ai.models': { anthropic: 'sees', openai: 'gpt-b' } });
      expect(
        screen.getByText(
          'OpenAI has not been asked this session, so this is this build’s own list. Choosing OpenAI in the Assistant asks it.',
        ),
      ).toBeDefined();
    });

    it('a stored model the list no longer names stays selected, marked, never replaced', () => {
      opened({ models: { anthropic: ANTHROPIC }, values: { 'ai.models': { anthropic: 'retired' } } });
      goTo('ai');

      const row = screen.getByLabelText<HTMLSelectElement>('AI model');
      expect(row.value).toBe('retired');
      expect(row.selectedOptions[0]?.textContent).toBe('retired (not offered now)');
    });

    it('a list main could not answer says so, and offers nothing as though it were a list', () => {
      opened({ models: {} });
      goTo('ai');

      const row = screen.getByLabelText<HTMLSelectElement>('AI model');
      expect(row.disabled).toBe(true);
      expect(row.selectedOptions[0]?.textContent).toBe('No models to choose from');
      expect(screen.getByText('The list of models could not be read.')).toBeDefined();
    });

    it('a provider that publishes no list says so, by name', () => {
      opened({ models: { perplexity: { source: 'no-list', models: [] } } });
      goTo('ai');
      fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'perplexity' } });

      expect(screen.getByText('Perplexity publishes no list of models to choose from.')).toBeDefined();
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

  it('the Privacy page and the footer report their four ACTIONS, and Done answers with nothing left to apply', () => {
    const { reported, answers } = opened({});

    goTo('privacy');
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat history' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'clear-chat-history' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear recent files' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'clear-recent' });

    fireEvent.click(screen.getByRole('button', { name: 'Export settings…' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'export' });

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(reported.at(-1)).toStrictEqual({ values: {}, secrets: {}, action: 'reset' });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(answers).toStrictEqual([{ values: {}, secrets: {} }]);
  });

  it('the AI PROVIDER is a row on the AI page, Anthropic by default, and a change reports the value the Assistant reads', () => {
    // ADR-0117 Decision 1: Part F's *"AI: provider"*. The Assistant's picker writes the same `ai.provider`.
    const { reported } = opened({});
    goTo('ai');
    const row = screen.getByLabelText('AI provider');
    expect((row as HTMLSelectElement).value).toBe('anthropic');
    fireEvent.change(row, { target: { value: 'openai' } });
    expect(reported.at(-1)?.values).toMatchObject({ 'ai.provider': 'openai' });
  });

  it('the RATING opt-out is on the Privacy page, where Part F lists it, and Advanced holds no row for it', () => {
    // `BUILD-PROMPT.md`:626 lists the review-prompt opt-out under Privacy; the owner moved it there 2026-09-27.
    opened({});
    goTo('privacy');
    expect(screen.getByLabelText('Ask me to rate Monstera')).toBeDefined();
    // Advanced had no other row, so it is not listed at all — a page with nothing on it would be a dead one.
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull();
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
  });

  it('CONTROL: a page with neither rows nor words is NOT listed — asked of a set that leaves one empty', () => {
    // The application's own set leaves no page empty since Saving gained autosave, so the case the line
    // above needs — a declared page absent from the list — is built: every setting but Saving's.
    const withoutSaving = DIALOG_SETTINGS.filter((setting) => setting.category !== 'saving');
    expect(listedPages(withoutSaving).map((page) => page.id)).not.toContain('saving');
    // Against the full set, which lists it — so the absence above is the rule and not a page never listed.
    expect(listedPages(DIALOG_SETTINGS).map((page) => page.id)).toContain('saving');
    // And the two word pages stay listed with no setting at all.
    expect(listedPages([]).map((page) => page.id)).toStrictEqual(['keyboard', 'updates']);
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
