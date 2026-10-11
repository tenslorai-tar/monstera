// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { FontFamilyEntry } from '@monstera/contract';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_INTO_PDF, FontPicker, fontGroups } from './FontPicker.js';
import { activateCatalogue, i18n } from './i18n.js';
import {
  EN,
  FONT_GROUP_BUILT_IN,
  FONT_GROUP_BUNDLED,
  FONT_GROUP_COMPUTER,
  FONT_GROUP_DOCUMENT,
  FONT_GROUP_RECENT,
  FONT_LOOKS_LIKE,
  FONT_NOT_EMBEDDABLE,
  FONT_PARTIAL,
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
} as const;

describe('fontGroups, the one font list’s groups (D1 to D4)', () => {
  it('lists the groups in the owner’s order, the document’s subset tag stripped and said partial', () => {
    const groups = fontGroups(LIST, [{ name: 'ABCDEF+Garamond', partial: true }], ['Arial'], BUILT_INTO_PDF, '');
    expect(groups.map((group) => group.title)).toStrictEqual([
      FONT_GROUP_DOCUMENT,
      FONT_GROUP_RECENT,
      FONT_GROUP_COMPUTER,
      FONT_GROUP_BUNDLED,
      FONT_GROUP_BUILT_IN,
    ]);
    expect(groups[0]?.choices[0]).toStrictEqual({
      family: 'Garamond',
      label: { key: FONT_PARTIAL, values: { name: 'Garamond' } },
      note: undefined,
    });
    expect(groups[4]?.choices.map((choice) => choice.family)).toStrictEqual(['Helvetica', 'Times', 'Courier', 'Symbol', 'ZapfDingbats']);
  });

  it('says a bundled family LOOKS LIKE another and never names it as that family, and says a locked one in words', () => {
    const groups = fontGroups(LIST, [], [], [], '');
    const bundled = groups.find((group) => group.title === FONT_GROUP_BUNDLED)?.choices[0];
    expect(bundled).toStrictEqual({
      family: 'Carlito',
      label: { key: FONT_LOOKS_LIKE, values: { name: 'Carlito', like: 'Calibri' } },
      note: undefined,
    });
    const locked = groups.find((group) => group.title === FONT_GROUP_COMPUTER)?.choices.find((choice) => choice.family === 'Locked Sans');
    expect(locked?.note).toBe(FONT_NOT_EMBEDDABLE);
  });

  it('a search keeps the names that hold it, and finds Carlito by the family it looks like', () => {
    const groups = fontGroups(LIST, [], [], BUILT_INTO_PDF, 'calib');
    expect(groups.flatMap((group) => group.choices.map((choice) => choice.family))).toStrictEqual(['Carlito']);
  });

  it('CONTROL: with no list read the fonts every PDF has are still offered, so the picker is never empty', () => {
    const groups = fontGroups({ listed: false, families: [] }, [], [], BUILT_INTO_PDF, '');
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

  it('draws each name in its own typeface, and says the bundled one as looking like another', () => {
    const view = mount(() => undefined);
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    const carlito = view.container.querySelector('[data-font-choice="Carlito"] span');
    expect(carlito?.textContent).toBe('Carlito (looks like Calibri)');
    expect((carlito as HTMLElement | null)?.style.fontFamily).toContain('Carlito');
  });

  it('says in words when the computer’s fonts could not be listed, and still offers Helvetica', () => {
    const onPick = vi.fn();
    const view = mount(onPick, { listed: false, families: [] });
    fireEvent.click(view.getByRole('button', { name: 'Font: As on the page' }));
    expect(view.container.textContent).toContain('could not be listed');
    const helvetica = view.container.querySelector('[data-font-choice="Helvetica"]');
    if (helvetica === null) throw new Error('Helvetica is not offered');
    fireEvent.click(helvetica);
    expect(onPick).toHaveBeenCalledWith('Helvetica');
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
});
