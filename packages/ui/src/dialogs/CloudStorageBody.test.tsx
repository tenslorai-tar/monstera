// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import CloudStorageBody from './CloudStorageBody.js';

/**
 * The cloud list's rows. The Stage 9 run found four files with one name drawn as four identical rows; each row
 * now says when its file changed and how large it is, which is what the listing already carried.
 */
describe('CloudStorageBody', () => {
  it('two files with ONE NAME read differently: each row says when it changed and how large it is', () => {
    activateCatalogue('en', EN);
    const at = (day: number): number => new Date(2025, 0, day, 9).getTime();
    render(
      <I18nProvider i18n={i18n}>
        <CloudStorageBody
          providers={[{ provider: 'onedrive', state: 'signed-in' }]}
          listing={{
            provider: 'onedrive',
            files: [
              { id: 'a', name: 'lease.pdf', size: 2_516_582, modified: at(10) },
              { id: 'b', name: 'lease.pdf', size: 655_360, modified: at(3) },
            ],
          }}
          documentOpen={false}
          resolve={() => undefined}
          update={() => undefined}
        />
      </I18nProvider>,
    );

    const lines = [...document.querySelectorAll('.m-cloud__file-meta')].map((node) => node.textContent);
    expect(lines).toStrictEqual(['Jan 10 · 2.4 MB', 'Jan 3 · 640 KB']);
    // THE NAMES are still both there and still the same — the line is what separates them.
    const names = [...document.querySelectorAll('.m-cloud__file-name')].map((node) => node.firstChild?.textContent);
    expect(names).toStrictEqual(['lease.pdf', 'lease.pdf']);
    // And each Open button is still named by its file.
    expect(screen.getAllByRole('button', { name: /lease\.pdf/u })).toHaveLength(2);
  });
});
