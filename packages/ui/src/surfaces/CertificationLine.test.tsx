// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, SIGNATURES_COMMAND_TITLE, SIGN_DOCUMENT_COMMAND_TITLE } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { CertificationLine } from './CertificationLine.js';

/**
 * The certification line (ADR-0291's amendment of 2026-11-12): what it says for each level, unnamed and named, for the
 * copy, and that its buttons are a PROJECTION of the commands placed on it (ADR-0295): what is placed on
 * `certification-line` is drawn and run, and nothing placed elsewhere is.
 */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const CONTEXT: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

describe('the certification line', () => {
  for (const [level, said] of [
    ['no-changes', 'Certified by Grace Hopper, who allows no changes to it.'],
    ['form-fill', 'Certified by Grace Hopper, who allows only filling in its forms and signing it.'],
    ['form-fill-and-annotate', 'Certified by Grace Hopper, who allows only filling in its forms, signing it and adding comments.'],
  ] as const) {
    it(`a document certified ${level} says who and what may change, once, as a status`, () => {
      render(
        <Wrapped>
          <CertificationLine commands={undefined} line={{ kind: 'certified', level, signer: 'Grace Hopper' }} />
        </Wrapped>,
      );
      expect(screen.getByRole('status').textContent).toBe(said);
    });
  }

  it('a certifier with no name is not named, and the copy says it is not certified', () => {
    render(
      <Wrapped>
        <CertificationLine commands={undefined} line={{ kind: 'certified', level: 'no-changes', signer: '' }} />
        <CertificationLine commands={undefined} line={{ kind: 'uncertified-copy', signer: 'Grace Hopper' }} />
      </Wrapped>,
    );
    expect(screen.getAllByRole('status').map((line) => line.textContent)).toStrictEqual([
      'Certified. Its certifier allows no changes to it.',
      'This copy is not certified. The original, certified by Grace Hopper, is unchanged.',
    ]);
  });

  it('draws and runs the command PLACED on it, with the document’s context; CONTROL: one placed elsewhere is not drawn, nor any with no commands handed', () => {
    const ran: CommandContext[] = [];
    const placed: UiCommand = {
      id: 'test.placed',
      title: SIGNATURES_COMMAND_TITLE,
      placements: [{ surface: 'certification-line', order: 10 }],
      run: (context) => {
        ran.push(context);
      },
      feedback: { kind: 'visible' },
    };
    const elsewhere: UiCommand = {
      id: 'test.elsewhere',
      title: SIGN_DOCUMENT_COMMAND_TITLE,
      icon: 'File',
      placements: [{ surface: 'quick-toolbar', order: 10 }],
      run: () => undefined,
      feedback: { kind: 'visible' },
    };
    const { rerender } = render(
      <Wrapped>
        <CertificationLine
          commands={{ registry: new CommandRegistry([placed, elsewhere]), context: CONTEXT }}
          line={{ kind: 'certified', level: 'no-changes', signer: 'Grace Hopper' }}
        />
      </Wrapped>,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toStrictEqual(['Check signatures']);
    fireEvent.click(screen.getByRole('button', { name: 'Check signatures' }));
    expect(ran.map((context) => context.docId)).toStrictEqual([CONTEXT.docId]);
    rerender(
      <Wrapped>
        <CertificationLine commands={undefined} line={{ kind: 'certified', level: 'no-changes', signer: 'Grace Hopper' }} />
      </Wrapped>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
