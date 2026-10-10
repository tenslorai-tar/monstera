// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ImportAnnotationsResultBody from './ImportAnnotationsResultBody.js';

afterEach(cleanup);

it('names the missing page, unsupported kind and invalid entry separately', () => {
  activateCatalogue('en', EN);
  render(<I18nProvider i18n={i18n}><ImportAnnotationsResultBody imported={2} total={6} pages={3} more={0}
    skipped={[{ comment: 3, page: 5, reason: 'missing-page' },
      { comment: 4, reason: 'unsupported-kind' }, { comment: 5, reason: 'invalid-entry', field: 'quadPoints' },
      { comment: 6, reason: 'missing-entry', field: 'rect' }]} />
  </I18nProvider>);
  expect(screen.getByText('2 comments imported.')).toBeTruthy();
  expect(screen.getByText('Comment 3 was on page 5, which this document does not have (3 pages).')).toBeTruthy();
  expect(screen.getByText(/Comment 4.*kind/u)).toBeTruthy();
  expect(screen.getByText(/Comment 5.*marked text position/u)).toBeTruthy();
  expect(screen.getByText(/Comment 6 is missing its position entry/u)).toBeTruthy();
});

it('says exactly that a readable file contains no comments', () => {
  activateCatalogue('en', EN);
  render(<I18nProvider i18n={i18n}><ImportAnnotationsResultBody imported={0} total={0} pages={3} skipped={[]} more={0} /></I18nProvider>);
  expect(screen.getByText('This file contains no comments. Nothing was added.')).toBeTruthy();
  expect(screen.queryAllByRole('listitem')).toStrictEqual([]);
});

it('names a one-page document through the plural rule', () => {
  activateCatalogue('en', EN);
  render(<I18nProvider i18n={i18n}><ImportAnnotationsResultBody imported={1} total={2} pages={1}
    skipped={[{ comment: 2, page: 5, reason: 'missing-page' }]} more={0} /></I18nProvider>);
  expect(screen.getByText('Comment 2 was on page 5, which this document does not have (1 page).')).toBeTruthy();
});
