// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { FontFamilyEntry } from '@monstera/contract';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_ONLY, BUILT_INTO_PDF, FontPicker, fontGroups } from './FontPicker.js';
import { activateCatalogue, i18n } from './i18n.js';
import {
  EN,
  FONT_GROUP_BUILT_IN,
  FONT_GROUP_BUNDLED,
  FONT_GROUP_COMPUTER,
  FONT_GROUP_DOCUMENT,
  FONT_GROUP_RECENT,
  TEXT_FORMAT_FAMILY,
  TEXT_FORMAT_FAMILY_RUN,
} from './messages/en.js';

const family = (over: Partial<FontFamilyEntry>): FontFamilyEntry => ({
  name: 'Arial',
  origin: 'installed',
  embedding: 'subset',
  bold: true,
  italic: true,
  ...over,
});

const LIST = {
  listed: true,
  families: [
    family({ name: 'Arial' }),
    family({ name: 'Locked Sans', embedding: 'never' }),
    family({ name: 'Carlito', origin: 'bundled', looksLike: 'Calibri' }),
  ],
  more: 0,
} as const;

describe('fontGroups, the one font list’s groups (D1 to D4)', () => {
  it('lists the groups in the owner’s order, the document’s subset tag stripped and nothing said of it (N12)', () => {
    const groups = fontGroups(LIST, [{ name: 'ABCDEF+Garamond', partial: true }], ['Arial'], BUILT_INTO_PDF, '');
    expect(groups.map((group) => group.title)).toStrictEqual([
      FONT_GROUP_DOCUMENT,
      FONT_GROUP_RECENT,
      FONT_GROUP_COMPUTER,
      FONT_GROUP_BUNDLED,
      FONT_GROUP_BUILT_IN,
    ]);
    expect(groups[0]?.choices[0]).toStrictEqual({ family: 'Garamond', like: undefined });
    expect(groups[4]?.choices.map((choice) => choice.family)).toStrictEqual(['Helvetica', 'Times', 'Courier', 'Symbol', 'ZapfDingbats']);
  });

  it('LEAVES OUT a family whose licence forbids embedding, from every group the list feeds (N12)', () => {
    const groups = fontGroups(LIST, [], ['Locked Sans', 'Arial'], [], '');
    const offered = groups.flatMap((group) => group.choices.map((choice) => choice.family));
    expect(offered).not.toContain('Locked Sans');
    // CONTROL: the families beside it in the same list, and in Recent, are offered, so the absence is the licence's.
    expect(offered).toStrictEqual(['Arial', 'Arial', 'Carlito']);
  });

  it('CONTROL: a document’s own font stays under In this document whatever its licence, as the owner asked', () => {
    const groups = fontGroups(LIST, [{ name: 'Locked Sans', partial: false }], [], [], '');
    expect(groups.find((group) => group.title === FONT_GROUP_DOCUMENT)?.choices.map((choice) => choice.family)).toStrictEqual(['Locked Sans']);
  });

  it('a search keeps the names that hold it, and finds Carlito by the family it looks like', () => {
    const groups = fontGroups(LIST, [], [], BUILT_INTO_PDF, 'calib');
    expect(groups.flatMap((group) => group.choices.map((choice) => choice.family))).toStrictEqual(['Carlito']);
  });

  it('RECENT offers only what this picker offers elsewhere: a family another consumer chose that this one cannot set is not offered', () => {
    // A callout's picker: the standard faces alone. Carlito was chosen for a text box in the same session.
    const standard = fontGroups({ listed: true, families: [], more: 0 },[], ['Carlito', 'Times'], ['Helvetica', 'Times', 'Courier'], '');
    expect(standard.find((group) => group.title === FONT_GROUP_RECENT)?.choices.map((choice) => choice.family)).toStrictEqual(['Times']);
    // CONTROL: where Carlito IS offered (a text box's picker over the list), Recent offers it.
    const full = fontGroups(LIST, [], ['Carlito', 'Times'], ['Helvetica', 'Times', 'Courier'], '');
    expect(full.find((group) => group.title === FONT_GROUP_RECENT)?.choices.map((choice) => choice.family)).toStrictEqual(['Carlito', 'Times']);
  });

  it('CONTROL: with no list read the fonts every PDF has are still offered, so the picker is never empty', () => {
    const groups = fontGroups({ listed: false, families: [], more: 0 },[], [], BUILT_INTO_PDF, '');
    expect(groups.map((group) => group.title)).toStrictEqual([FONT_GROUP_BUILT_IN]);
  });
});

describe('FontPicker', () => {
  activateCatalogue('en', EN);
  const mount = (onPick: (family: string) => void, list: Parameters<typeof FontPicker>[0]['list'] = LIST) =>
    render(
      <I18nProvider i18n={i18n}>
        <FontPicker
          builtIn={BUILT_INTO_PDF}
          inDocument={[]}
          label={TEXT_FORMAT_FAMILY}
          list={list}
          onPick={onPick}
          unset={TEXT_FORMAT_FAMILY_RUN}
          value={undefined}
        />
      </I18nProvider>,
    );

  it('opens to a search and a grouped list, and Enter chooses the first match', () => {
    const onPick = vi.fn();
    const view = mount(onPick);
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    const search = view.getByRole('combobox', { name: 'Search fonts' });
    fireEvent.change(search, { target: { value: 'ari' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('Arial');
    // CLOSED AGAIN once a font is chosen.
    expect(view.queryByRole('listbox')).toBeNull();
  });

  it('draws each name in its own typeface and says nothing else of it: every option’s text is its name (N12)', () => {
    const view = mount(() => undefined);
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    const carlito = view.container.querySelector('[data-font-choice="Carlito"]');
    expect(carlito?.textContent).toBe('Carlito');
    expect((carlito?.querySelector('span') as HTMLElement | null)?.style.fontFamily).toContain('Carlito');
    const options = [...view.container.querySelectorAll('[role="option"]')];
    // NON-VACUOUS: the list has options to compare, the computer's and the built-in ones.
    expect(options.length).toBeGreaterThan(3);
    expect(options.filter((option) => option.textContent !== option.getAttribute('data-font-choice'))).toStrictEqual([]);
  });

  it('says in words when the computer’s fonts could not be listed, and still offers Helvetica', () => {
    const onPick = vi.fn();
    const view = mount(onPick, { listed: false, families: [], more: 0 });
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    expect(view.container.textContent).toContain('could not be listed');
    const helvetica = view.container.querySelector('[data-font-choice="Helvetica"]');
    if (helvetica === null) throw new Error('Helvetica is not offered');
    fireEvent.click(helvetica);
    expect(onPick).toHaveBeenCalledWith('Helvetica');
  });

  it('says in words that MORE families are on the computer than the list holds, and how many (BBBBBBBB-8)', () => {
    const view = mount(() => undefined, { ...LIST, more: 3 });
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    expect(view.container.textContent).toContain('3 more font families are on this computer than this list can hold');
    // THE LIST IS STILL THE LIST: the families it holds are offered as before.
    expect(view.container.querySelector('[data-font-choice="Arial"]')).not.toBeNull();
  });

  it('CONTROL: a list with nothing past its bound says nothing of more', () => {
    const view = mount(() => undefined, LIST);
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    expect(view.container.textContent).not.toContain('than this list can hold');
  });

  it('says in words when the computer was read and NO fonts came back, and still offers Helvetica (L5)', () => {
    const view = mount(() => undefined, { listed: true, families: [], more: 0 });
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    expect(view.container.textContent).toContain('No fonts were found on this computer.');
    expect(view.container.querySelector('[data-font-choice="Helvetica"]')).not.toBeNull();
  });

  it('CONTROL: a consumer that sets the standard faces alone, and a list that holds fonts, say nothing of an empty list (L5)', () => {
    const standard = mount(() => undefined, BUILT_IN_ONLY);
    fireEvent.click(standard.getByRole('button', { name: 'Font: As on the page' }));
    expect(standard.container.textContent).not.toContain('No fonts were found');
    // NON-VACUOUS: the open list is drawn, the built-in faces in it.
    expect(standard.container.querySelector('[data-font-choice="Helvetica"]')).not.toBeNull();
    standard.unmount();
    const full = mount(() => undefined, LIST);
    fireEvent.click(full.getByRole('button', { name: 'Font: As on the page' }));
    expect(full.container.textContent).not.toContain('No fonts were found');
  });

  it('Escape closes the list and goes no further, so an editor around it is not finished by the key', () => {
    const outer = vi.fn();
    const view = render(
      <I18nProvider i18n={i18n}>
        <div onKeyDown={outer}>
          <FontPicker
            builtIn={BUILT_INTO_PDF}
            inDocument={[]}
            label={TEXT_FORMAT_FAMILY}
            list={LIST}
            onPick={() => undefined}
            unset={TEXT_FORMAT_FAMILY_RUN}
            value="Arial"
          />
        </div>
      </I18nProvider>,
    );
    fireEvent.click(view.getByRole('button', { name: 'Font: Arial' }));
    fireEvent.keyDown(view.getByRole('combobox'), { key: 'Escape' });
    expect(view.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('Escape gives the focus back to the field, so leaving the panel afterwards is seen (text-regression 7b)', () => {
    const view = mount(() => undefined);
    const field = view.getByRole('button', { name: 'Font: As on the page' });
    fireEvent.click(field);
    const search = view.getByRole('combobox', { name: 'Search fonts' });
    search.focus();
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'Escape' });
    // CONTROL in the same case: the box that held the focus is gone, so a focus left in it would now be the body's.
    expect(view.queryByRole('combobox', { name: 'Search fonts' })).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  describe('closes as every drop-down does (the owner R9)', () => {
    /** The picker inside a panel, beside another control, with a page beside the panel. */
    const inPanel = () =>
      render(
        <I18nProvider i18n={i18n}>
          <section data-panel="">
            <FontPicker
              builtIn={BUILT_INTO_PDF}
              inDocument={[]}
              label={TEXT_FORMAT_FAMILY}
              list={LIST}
              onPick={() => undefined}
              unset={TEXT_FORMAT_FAMILY_RUN}
              value="Arial"
            />
            <input aria-label="Size" />
          </section>
          <div data-page="" />
        </I18nProvider>,
      );

    it('a press elsewhere in the PANEL closes it', () => {
      const view = inPanel();
      fireEvent.click(view.getByRole('button', { name: 'Font: Arial' }));
      expect(view.queryByRole('listbox')).not.toBeNull();
      fireEvent.pointerDown(view.getByRole('textbox', { name: 'Size' }));
      expect(view.queryByRole('listbox')).toBeNull();
    });

    it('a press on the PAGE closes it, and the focus it held in the search goes back to the field first', () => {
      const view = inPanel();
      const field = view.getByRole('button', { name: 'Font: Arial' });
      fireEvent.click(field);
      const search = view.getByRole('combobox', { name: 'Search fonts' });
      search.focus();
      const page = view.container.ownerDocument.querySelector('[data-page]');
      if (page === null) throw new Error('no page');
      fireEvent.pointerDown(page);
      expect(view.queryByRole('listbox')).toBeNull();
      // NOT LEFT ON THE BODY, so the panel around it hears the press move the focus on (text-regression 7b's reason).
      expect(document.activeElement).toBe(field);
    });

    it('Escape closes it WHEREVER THE FOCUS IS, not only from its search box, and goes no further', () => {
      const outer = vi.fn();
      const view = render(
        <I18nProvider i18n={i18n}>
          <div onKeyDown={outer}>
            <FontPicker
              builtIn={BUILT_INTO_PDF}
              inDocument={[]}
              label={TEXT_FORMAT_FAMILY}
              list={LIST}
              onPick={() => undefined}
              unset={TEXT_FORMAT_FAMILY_RUN}
              value="Arial"
            />
            <input aria-label="Size" />
          </div>
        </I18nProvider>,
      );
      fireEvent.click(view.getByRole('button', { name: 'Font: Arial' }));
      const size = view.getByRole('textbox', { name: 'Size' });
      size.focus();
      fireEvent.keyDown(size, { key: 'Escape' });
      expect(view.queryByRole('listbox')).toBeNull();
      expect(outer).not.toHaveBeenCalled();
    });

    it('CONTROL: a press INSIDE the list — on a name, on its search — keeps it open until a choice is made', () => {
      const onPick = vi.fn();
      const view = render(
        <I18nProvider i18n={i18n}>
          <FontPicker
            builtIn={BUILT_INTO_PDF}
            inDocument={[]}
            label={TEXT_FORMAT_FAMILY}
            list={LIST}
            onPick={onPick}
            unset={TEXT_FORMAT_FAMILY_RUN}
            value="Arial"
          />
        </I18nProvider>,
      );
      fireEvent.click(view.getByRole('button', { name: 'Font: Arial' }));
      const carlito = view.container.querySelector('[data-font-choice="Carlito"]');
      if (carlito === null) throw new Error('Carlito is not offered');
      fireEvent.pointerDown(view.getByRole('combobox', { name: 'Search fonts' }));
      fireEvent.pointerDown(carlito);
      fireEvent.pointerDown(view.getByRole('listbox'));
      expect(view.queryByRole('listbox')).not.toBeNull();
      expect(onPick).not.toHaveBeenCalled();
      fireEvent.click(carlito);
      expect(onPick).toHaveBeenCalledWith('Carlito');
      expect(view.queryByRole('listbox')).toBeNull();
    });
  });
});
