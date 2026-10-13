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
  it('says the level, then what was left out by kind and 1-based page, in Monstera’s words (the owner’s N7)', () => {
    render(
      <Wrapped>
        <PdfaRemovalsBody
          level={3}
          leftOut={[
            { page: 0, kind: 'comment-popup', count: 1 },
            { page: 4, kind: 'hidden-mark', count: 2 },
          ]}
          leftOutMore={7}
          otherLeftOut={1}
          tagsDropped={false}
        />
      </Wrapped>,
    );

    // LEVEL 3, not the default, so a body that said 2b whatever was asked is seen.
    expect(screen.getByText('Saved as PDF/A-3b.')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toStrictEqual([
      'One comment pop-up on page 1. The comments and their text are kept.',
      '2 hidden marks on page 5.',
      '7 more items like these on later pages.',
      'One other item the archival format cannot hold.',
    ]);
    // NEVER THE CONVERTER: neither its name nor its words appear.
    expect(document.body.textContent).not.toMatch(/Ghostscript|not permitted/u);
    expect(screen.queryByText(/screen readers/u)).toBeNull();
  });

  it('says the tags were not kept, which the converter never mentions, with no empty list', () => {
    render(
      <Wrapped>
        <PdfaRemovalsBody level={2} leftOut={[]} leftOutMore={0} otherLeftOut={0} tagsDropped />
      </Wrapped>,
    );

    expect(screen.getByText(/screen readers/u)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
