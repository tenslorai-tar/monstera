// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import BoxedCharactersBody from './BoxedCharactersBody.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('BoxedCharactersBody', () => {
  it('names each place by the character, its code point, its line and its column', () => {
    render(
      <Wrapped>
        <BoxedCharactersBody
          from="import"
          boxed={[
            { character: '中', line: 1_204, column: 8 },
            { character: String.fromCodePoint(0x13000), line: 3, column: null },
          ]}
          more={0}
        />
      </Wrapped>,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      '“中” (U+4E2D), line 1,204, column 8',
      // A CHARACTER PAST THE BMP by its whole code point, and a place with no column by its block's line.
      `“${String.fromCodePoint(0x13000)}” (U+13000), in the block that starts on line 3`,
    ]);
    // NOTHING PAST THE NAMED ONES, so no count is shown.
    expect(screen.queryByText(/more place/u)).toBeNull();
  });

  it('COUNTS the places past the named ones, outside the list that scrolls', () => {
    render(
      <Wrapped>
        <BoxedCharactersBody from="import" boxed={[{ character: '中', line: 1, column: 1 }]} more={12} />
      </Wrapped>,
    );

    const count = screen.getByText('And 12 more places.');
    // OUTSIDE THE SCROLL, so it stays beside the footer however long the list is.
    expect(count.closest('.m-dialog-scroll')).toBeNull();
    expect(screen.getByRole('list').closest('.m-dialog-scroll')).not.toBeNull();
  });

  /**
   * AN EDIT'S PLACES ARE PAGES, counted from 1, and its sentence is the edit's (ADR-0174). CONTROL: the import's
   * sentence, which says the PDF is open, is not shown for an edit; the cases above show it for an import.
   */
  it('names an edit’s places by page, counted as the person counts them, with the edit’s own sentence', () => {
    render(
      <Wrapped>
        <BoxedCharactersBody from="edit" boxed={[{ character: '中', page: 0 }, { character: '文', page: 11 }]} more={0} />
      </Wrapped>,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      '“中” (U+4E2D), page 1',
      '“文” (U+6587), page 12',
    ]);
    expect(screen.getByText(/^Your change is made\./u)).toBeTruthy();
    expect(screen.queryByText(/^The PDF is open\./u)).toBeNull();
  });
});
