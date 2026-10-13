// @vitest-environment happy-dom
import { COMPOSED_FAMILY_DEFAULT, type FontFamilyEntry } from '@monstera/contract';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InDialog } from './inDialog.js';
import NewFromTextBody from './NewFromTextBody.js';

/**
 * The new-PDF-from-text window answers with the family chosen in the one font row (the owner's L4). The family chosen is
 * one of this computer's, never the default, so a window that answered Arimo whatever was picked fails here; the default
 * case is the control in the other direction.
 */
afterEach(() => {
  cleanup();
});

const entry = (name: string): FontFamilyEntry => ({ name, origin: 'installed', embedding: 'subset', bold: true, italic: true });
const LISTED = { listed: true, families: [entry('Noto Sans')], more: 0 } as const;

describe('the new PDF window answers with the font chosen', () => {
  it('sends a family of this computer’s when one is picked', () => {
    const resolve = vi.fn();
    render(
      <InDialog>
        <NewFromTextBody fonts={LISTED} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: `Font: ${COMPOSED_FAMILY_DEFAULT}` }));
    const noto = document.querySelector('[data-font-choice="Noto Sans"]');
    if (noto === null) throw new Error('Noto Sans is not offered');
    fireEvent.click(noto);
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    expect(resolve.mock.calls).toStrictEqual([[{ family: 'Noto Sans' }]]);
  });

  it('CONTROL: it sends the default when nothing is picked', () => {
    const resolve = vi.fn();
    render(
      <InDialog>
        <NewFromTextBody fonts={LISTED} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }));
    expect(resolve.mock.calls).toStrictEqual([[{ family: COMPOSED_FAMILY_DEFAULT }]]);
  });
});
