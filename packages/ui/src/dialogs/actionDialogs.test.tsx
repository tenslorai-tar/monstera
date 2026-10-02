// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import AiSetupBody from './AiSetupBody.js';
import ApplyRedactionsBody from './ApplyRedactionsBody.js';
import BatesNumberBody from './BatesNumberBody.js';
import DocumentPasswordBody from './DocumentPasswordBody.js';
import FlatFieldsBody from './FlatFieldsBody.js';
import HeaderFooterBody from './HeaderFooterBody.js';
import { InDialog } from './inDialog.js';
import PageTransitionBody from './PageTransitionBody.js';
import ProtectDocumentBody from './ProtectDocumentBody.js';
import RedactMatchesBody from './RedactMatchesBody.js';
import SanitizeDocumentBody from './SanitizeDocumentBody.js';
import WatermarkPagesBody from './WatermarkPagesBody.js';

/**
 * The dialogs of group 2 in the dialog pattern (2026-10-02) whose own behaviour has no body test: each draws its
 * questions as rows and ends in the footer — Cancel first, its one primary action last. What each answers is unchanged
 * code, proven by its command's cases; this proves the shape every one of them now shares.
 */

const PAGES = [2] as const;
const ignore = (): void => undefined;

const BODIES: readonly { readonly name: string; readonly body: ReactNode; readonly firstRow: string | null }[] = [
  { name: 'Watermark', body: <WatermarkPagesBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Text' },
  { name: 'Header and footer', body: <HeaderFooterBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Header' },
  { name: 'Bates numbers', body: <BatesNumberBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Prefix' },
  { name: 'Page transition', body: <PageTransitionBody pages={PAGES} resolve={ignore} update={ignore} />, firstRow: 'Transition' },
  { name: 'Sanitize', body: <SanitizeDocumentBody resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Protect', body: <ProtectDocumentBody resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Apply redactions', body: <ApplyRedactionsBody page={0} resolve={ignore} update={ignore} />, firstRow: '' },
  { name: 'Mark matches', body: <RedactMatchesBody page={0} resolve={ignore} update={ignore} />, firstRow: '' },
  {
    name: 'Document password',
    body: <DocumentPasswordBody name="a.pdf" retry={false} resolve={ignore} update={ignore} />,
    firstRow: 'Password',
  },
  {
    name: 'Fields from lines',
    body: <FlatFieldsBody candidates={[{ name: 'name', label: 'Name' }]} truncated={false} resolve={ignore} update={ignore} />,
    // A LIST TO CONFIRM, not questions: no row, and the footer all the same.
    firstRow: null,
  },
  { name: 'Set up AI', body: <AiSetupBody secretsAvailable resolve={ignore} update={ignore} />, firstRow: 'Provider' },
];

afterEach(() => {
  cleanup();
});

describe('the action dialogs in the dialog pattern', () => {
  for (const { name, body, firstRow } of BODIES) {
    it(`${name}: questions are rows, and it ends in the footer — Cancel first, its primary action last`, () => {
      render(<InDialog>{body}</InDialog>);
      const rows = [...document.querySelectorAll('.m-dialog-row .m-dialog-row__label')].map((label) => label.textContent);
      if (firstRow !== null) expect(rows.length).toBeGreaterThan(0);
      // WHERE A FIRST ROW IS NAMED, it is that one: the conversion kept the dialog's own first question first.
      if (firstRow !== null && firstRow !== '') expect(rows[0]).toBe(firstRow);
      const footer = document.querySelector('.m-dialog-footer');
      expect(footer).not.toBeNull();
      const buttons = [...(footer?.querySelectorAll('button') ?? [])];
      expect(buttons[0]?.textContent).toBe('Cancel');
      expect(buttons.at(-1)?.classList.contains('m-button--primary')).toBe(true);
    });
  }
});
