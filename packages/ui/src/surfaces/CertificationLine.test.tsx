// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, SIGNATURES_COMMAND_TITLE } from '../messages/en.js';
import { CertificationLine } from './CertificationLine.js';

/**
 * The certification line (ADR-0291's amendment of 2026-11-12): what it says for each level, unnamed and named, for the
 * copy, and that its button runs the command it was given. The App half, that the button is the registered *Check
 * signatures* run with the document on show, is `App.test.tsx`'s.
 */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('the certification line', () => {
  for (const [level, said] of [
    ['no-changes', 'Certified by Grace Hopper, who allows no changes to it.'],
    ['form-fill', 'Certified by Grace Hopper, who allows only filling in its forms and signing it.'],
    ['form-fill-and-annotate', 'Certified by Grace Hopper, who allows only filling in its forms, signing it and adding comments.'],
  ] as const) {
    it(`a document certified ${level} says who and what may change, once, as a status`, () => {
      render(
        <Wrapped>
          <CertificationLine check={undefined} line={{ kind: 'certified', level, signer: 'Grace Hopper' }} />
        </Wrapped>,
      );
      expect(screen.getByRole('status').textContent).toBe(said);
    });
  }

  it('a certifier with no name is not named, and the copy says it is not certified', () => {
    render(
      <Wrapped>
        <CertificationLine check={undefined} line={{ kind: 'certified', level: 'no-changes', signer: '' }} />
        <CertificationLine check={undefined} line={{ kind: 'uncertified-copy', signer: 'Grace Hopper' }} />
      </Wrapped>,
    );
    expect(screen.getAllByRole('status').map((line) => line.textContent)).toStrictEqual([
      'Certified. Its certifier allows no changes to it.',
      'This copy is not certified. The original, certified by Grace Hopper, is unchanged.',
    ]);
  });

  it('its button carries the command’s own title and runs it; CONTROL: with no command, no button', () => {
    let ran = 0;
    const { rerender } = render(
      <Wrapped>
        <CertificationLine
          check={{
            title: SIGNATURES_COMMAND_TITLE,
            run: () => {
              ran += 1;
            },
          }}
          line={{ kind: 'certified', level: 'no-changes', signer: 'Grace Hopper' }}
        />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check signatures' }));
    expect(ran).toBe(1);
    rerender(
      <Wrapped>
        <CertificationLine check={undefined} line={{ kind: 'certified', level: 'no-changes', signer: 'Grace Hopper' }} />
      </Wrapped>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
