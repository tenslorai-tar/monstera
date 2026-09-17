// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { COMPARE_RESULT_DIALOG } from './compareDocuments.js';
import CompareResultBody from './CompareResultBody.js';

/**
 * The comparison's findings as a person reads them. The walk's half is
 * `commands/compareDocuments.test.ts`; this half is that the rule, the partial walk and each
 * line's side are said in words.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const FOUND = {
  kind: 'compared' as const,
  otherName: 'contract-v2.pdf',
  shared: 3,
  compared: 3,
  extraPages: -1,
  changedLines: 2,
  clippedPages: 0,
  pages: [
    {
      page: 2,
      changes: [
        { kind: 'removed' as const, text: 'Due 1 May' },
        { kind: 'added' as const, text: 'Due 8 May' },
      ],
    },
  ],
};

describe('CompareResultBody', () => {
  it('states the rule, the count, the extra page, and which side each line is on in words', () => {
    render(
      <Wrapped>
        <CompareResultBody {...FOUND} />
      </Wrapped>,
    );
    expect(screen.getByText(/with the page at the same number in contract-v2\.pdf/u)).toBeDefined();
    expect(screen.getByText('2 lines differ in the 3 pages both documents have.')).toBeDefined();
    expect(screen.getByText('contract-v2.pdf has one more page, which was not compared.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Page 2' })).toBeDefined();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      'Only in this documentDue 1 May',
      'Only in contract-v2.pdfDue 8 May',
    ]);
  });

  it('a walk stopped by a change says how far it got INSTEAD of a count that reads as whole', () => {
    render(
      <Wrapped>
        <CompareResultBody {...FOUND} compared={1} />
      </Wrapped>,
    );
    expect(screen.getByText(/Compared 1 of 3 pages/u)).toBeDefined();
    expect(screen.queryByText(/lines differ/u)).toBeNull();
  });

  it('CONTROL: identical pages say no lines differ', () => {
    render(
      <Wrapped>
        <CompareResultBody {...FOUND} changedLines={0} extraPages={0} pages={[]} />
      </Wrapped>,
    );
    expect(screen.getByText('No lines differ in the 3 pages both documents have.')).toBeDefined();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('the props refuse a list past the bound, so a body is never handed more than it says it shows', () => {
    const tooMany = {
      ...FOUND,
      changedLines: 1001,
      pages: [{ page: 1, changes: Array.from({ length: 1001 }, () => ({ kind: 'added' as const, text: 'x' })) }],
    };
    expect(COMPARE_RESULT_DIALOG.props.safeParse(tooMany).success).toBe(false);
    expect(COMPARE_RESULT_DIALOG.props.safeParse(FOUND).success).toBe(true);
  });
});
