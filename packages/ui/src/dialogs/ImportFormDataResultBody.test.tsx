// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { IMPORT_SKIP_REASONS } from '@monstera/contract';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ImportFormDataResultBody from './ImportFormDataResultBody.js';

/**
 * The import result dialog says how many fields were filled and names each field it left alone with its own sentence.
 *
 * Every reason the contract lists has a sentence of its own (the list is derived, so a reason added there with no
 * sentence is a red case here and not a blank row in a person's dialog), and the sentences differ from one another.
 */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('the import result dialog', () => {
  it('says how many were filled and names each field left alone, with a different sentence for each reason', () => {
    const skipped = IMPORT_SKIP_REASONS.map((reason, at) => ({ name: `field_${String(at)}`, reason }));
    render(
      <Wrapped>
        <ImportFormDataResultBody filled={12} skipped={skipped} more={0} />
      </Wrapped>,
    );
    expect(screen.getByText('Filled 12 fields.')).toBeTruthy();
    expect(screen.getByText(/5 fields were left as they were/u)).toBeTruthy();
    const sentences = skipped.map((skip) => screen.getByText(skip.name).parentElement?.textContent ?? '');
    expect(new Set(sentences.map((text) => text.replace(/^field_\d+/u, ''))).size).toBe(IMPORT_SKIP_REASONS.length);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan('field_0'.length + 10);
  });

  it('says the rest are counted and not listed, and says nothing of it when none are', () => {
    render(
      <Wrapped>
        <ImportFormDataResultBody filled={1} skipped={[{ name: 'a', reason: 'read-only' }]} more={40} />
      </Wrapped>,
    );
    expect(screen.getByText(/41 fields were left as they were/u)).toBeTruthy();
    expect(screen.getByText('…and 40 more.')).toBeTruthy();
    cleanup();
    render(
      <Wrapped>
        <ImportFormDataResultBody filled={1} skipped={[{ name: 'a', reason: 'read-only' }]} more={0} />
      </Wrapped>,
    );
    expect(screen.queryByText(/and \d+ more/u)).toBeNull();
  });

  it('says a file that filled nothing because every field already held its values', () => {
    render(
      <Wrapped>
        <ImportFormDataResultBody filled={0} skipped={[{ name: 'a', reason: 'read-only' }]} more={0} />
      </Wrapped>,
    );
    expect(screen.getByText(/already held those values/u)).toBeTruthy();
  });
});
