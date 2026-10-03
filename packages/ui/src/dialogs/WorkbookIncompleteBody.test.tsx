// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import WorkbookIncompleteBody from './WorkbookIncompleteBody.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('WorkbookIncompleteBody', () => {
  it('names each block by sheet and rows, with the rows as a reader writes them', () => {
    render(
      <Wrapped>
        <WorkbookIncompleteBody missing={[{ sheet: 'Data', from: 38_251, to: 50_000 }]} more={0} />
      </Wrapped>,
    );

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      'Sheet “Data”, rows 38,251 to 50,000',
    ]);
    // NOTHING PAST THE NAMED ONES, so no count is shown.
    expect(screen.queryByText(/more block/u)).toBeNull();
  });

  it('COUNTS the blocks past the named ones, outside the list that scrolls (table A row 12)', () => {
    render(
      <Wrapped>
        <WorkbookIncompleteBody missing={[{ sheet: 'Data', from: 1, to: 5 }]} more={12} />
      </Wrapped>,
    );

    const count = screen.getByText('And 12 more blocks of rows.');
    // OUTSIDE THE SCROLL, so it stays beside the footer however long the list is.
    expect(count.closest('.m-dialog-scroll')).toBeNull();
    expect(screen.getByRole('list').closest('.m-dialog-scroll')).not.toBeNull();
  });
});
