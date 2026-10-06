// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import WordCountBody from './WordCountBody.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

/** Every figure different, so a row showing another row's number is a different table. */
const COUNTED = {
  words: 3_482,
  characters: 21_906,
  charactersNoSpaces: 18_377,
  lines: 611,
  cjkCharacters: 148,
  pagesCounted: 12,
  pageCount: 12,
} as const;

/** The table as a person reads it: each row's header and its number. */
function rows(): string[][] {
  return screen
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
}

describe('the word count dialog', () => {
  it('is a TWO-COLUMN TABLE in the owner’s order, each measure named by its row and its number beside it', () => {
    render(
      <Wrapped>
        <WordCountBody {...COUNTED} />
      </Wrapped>,
    );
    expect(rows()).toStrictEqual([
      ['Pages', '12'],
      ['Words', '3,482'],
      ['Characters (with spaces)', '21,906'],
      ['Characters (no spaces)', '18,377'],
      ['Lines', '611'],
      ['CJK characters', '148'],
    ]);
    // THE NAME IS THE ROW'S HEADER, so a screen reader announces it with the number rather than a bare figure.
    expect(screen.getByRole('rowheader', { name: 'Words' })).toBeTruthy();
    expect(screen.queryByText(/incomplete/u)).toBeNull();
  });

  it('CONTROL: a walk that stopped early says the totals are incomplete under the same table', () => {
    render(
      <Wrapped>
        <WordCountBody {...COUNTED} pagesCounted={7} />
      </Wrapped>,
    );
    expect(rows()[0]).toStrictEqual(['Pages', '7']);
    expect(screen.getByText('Counted 7 of 12 pages — these totals are incomplete.')).toBeTruthy();
  });
});
