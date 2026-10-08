// @vitest-environment happy-dom
import type { MessageKey } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOCUMENT_PASSWORD_APPLY,
  DOCUMENT_PASSWORD_EMPTY,
  DOCUMENT_PASSWORD_WRONG,
  EN,
  FORM_FIELD_DROPDOWN_APPLY,
  FORM_FIELD_NAME_EMPTY,
  HEADER_FOOTER_APPLY,
  HEADER_FOOTER_EMPTY,
  PROTECT_DOCUMENT_APPLY,
  PROTECT_DOCUMENT_NEEDS_A_PASSWORD,
  REDACT_MATCHES_APPLY,
  REDACT_MATCHES_EMPTY,
  WATERMARK_PAGES_APPLY,
  WATERMARK_PAGES_NO_TEXT,
} from '../messages/en.js';
import DocumentPasswordBody from './DocumentPasswordBody.js';
import FormFieldDropdownBody from './FormFieldDropdownBody.js';
import HeaderFooterBody from './HeaderFooterBody.js';
import HelpBody from './HelpBody.js';
import { InDialog } from './inDialog.js';
import ProtectDocumentBody from './ProtectDocumentBody.js';
import RedactMatchesBody from './RedactMatchesBody.js';
import WatermarkPagesBody from './WatermarkPagesBody.js';

/**
 * Every input dialog but *Open from web address*, under `primitives/attempt.ts`' rule: it OPENS saying nothing about
 * what has not been typed yet, and says it once the person presses the action — which answers nothing. The press is
 * what keeps the first half from being vacuous: a dialog that never rendered the sentence at all would pass "opens
 * quiet", and fails here at "says it once pressed". That one's own cases are `OpenFromUrlBody.test.tsx`.
 */

afterEach(() => {
  cleanup();
});

/** A key's English words. THROWS on a missing key, since an `undefined` here would make "not shown" pass vacuously. */
function english(key: MessageKey): string {
  const words = EN[key];
  if (words === undefined) throw new Error(`no English for ${key}`);
  return words;
}

interface Case {
  readonly dialog: string;
  readonly body: (resolve: (answer: unknown) => void) => ReactElement;
  readonly apply: MessageKey;
  readonly missing: MessageKey;
}

const CASES: readonly Case[] = [
  {
    dialog: 'Header and footer',
    body: (resolve) => <HeaderFooterBody pages={[0]} resolve={resolve} update={vi.fn()} />,
    apply: HEADER_FOOTER_APPLY,
    missing: HEADER_FOOTER_EMPTY,
  },
  {
    dialog: 'Protect document',
    body: (resolve) => <ProtectDocumentBody resolve={resolve} update={vi.fn()} />,
    apply: PROTECT_DOCUMENT_APPLY,
    missing: PROTECT_DOCUMENT_NEEDS_A_PASSWORD,
  },
  {
    dialog: 'Redact matches',
    body: (resolve) => <RedactMatchesBody page={0} resolve={resolve} update={vi.fn()} />,
    apply: REDACT_MATCHES_APPLY,
    missing: REDACT_MATCHES_EMPTY,
  },
  {
    dialog: 'Document password',
    body: (resolve) => <DocumentPasswordBody name="report.pdf" retry={false} resolve={resolve} update={vi.fn()} />,
    apply: DOCUMENT_PASSWORD_APPLY,
    missing: DOCUMENT_PASSWORD_EMPTY,
  },
  {
    // A STATUS LINE rather than an alert, which is why the gallery's first reading did not flag it.
    dialog: 'Watermark',
    body: (resolve) => <WatermarkPagesBody pages={[0]} resolve={resolve} update={vi.fn()} />,
    apply: WATERMARK_PAGES_APPLY,
    missing: WATERMARK_PAGES_NO_TEXT,
  },
  {
    dialog: 'Form field (dropdown)',
    body: (resolve) => <FormFieldDropdownBody known={[]} resolve={resolve} update={vi.fn()} />,
    apply: FORM_FIELD_DROPDOWN_APPLY,
    missing: FORM_FIELD_NAME_EMPTY,
  },
];

describe('a missing entry is said only once the person tries to go on', () => {
  for (const { dialog, body, apply, missing } of CASES) {
    it(`${dialog}: opens quiet with its action pressable, and once pressed says what is missing and answers nothing`, () => {
      const resolve = vi.fn();
      render(<InDialog>{body(resolve)}</InDialog>);
      const action = screen.getByRole('button', { name: english(apply) });

      expect(screen.queryByText(english(missing))).toBeNull();
      expect(action.hasAttribute('disabled')).toBe(false);

      act(() => {
        fireEvent.click(action);
      });
      expect(screen.getByText(english(missing))).toBeDefined();
      expect(resolve).not.toHaveBeenCalled();
    });
  }

  for (const { dialog, body } of CASES) {
    it(`${dialog}: opens with focus IN its field, since typing is the first thing a person does there`, () => {
      render(<InDialog>{body(vi.fn())}</InDialog>);
      expect(document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName).toMatch(/^(INPUT|TEXTAREA)$/u);
    });
  }

  it('CONTROL: Help centre, whose search box it was not opened to type into, opens on the popup', async () => {
    render(
      <InDialog>
        <HelpBody article={null} context={null} resolve={vi.fn()} showable={[]} update={vi.fn()} />
      </InDialog>,
    );
    // Its body HOLDS a text field, which is what makes it the control: a dialog that took its first one would fail here.
    expect(screen.getByRole('textbox')).toBeDefined();
    const popup = screen.getByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement).toBe(popup);
    });
  });

  it('Document password: a WRONG password is said on opening, because it reports what the person just did', () => {
    render(
      <InDialog>
        <DocumentPasswordBody name="report.pdf" retry resolve={vi.fn()} update={vi.fn()} />
      </InDialog>,
    );
    expect(screen.getByText(english(DOCUMENT_PASSWORD_WRONG))).toBeDefined();
  });
});
