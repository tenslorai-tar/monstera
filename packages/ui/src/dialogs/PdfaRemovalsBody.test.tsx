// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import PdfaRemovalsBody from './PdfaRemovalsBody.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('PdfaRemovalsBody', () => {
  it('lists each removal in the converter’s own words, marked as English', () => {
    const removed = [
      'not permitted in PDF/A, annotation will not be present in output file',
      'Transparency group not permitted in PDF/A, removing',
    ];
    render(
      <Wrapped>
        <PdfaRemovalsBody removed={removed} tagsDropped={false} />
      </Wrapped>,
    );

    expect(screen.getByText(/The PDF\/A file was saved/u)).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toStrictEqual(removed);
    expect(items.every((item) => item.getAttribute('lang') === 'en')).toBe(true);
    expect(screen.queryByText(/screen readers/u)).toBeNull();
  });

  it('says the tags were not kept, which the converter never mentions, with no empty list', () => {
    render(
      <Wrapped>
        <PdfaRemovalsBody removed={[]} tagsDropped />
      </Wrapped>,
    );

    expect(screen.getByText(/screen readers/u)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
