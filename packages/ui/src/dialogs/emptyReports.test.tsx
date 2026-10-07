// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DuplicatePagesBody from './DuplicatePagesBody.js';
import FlatFieldsBody from './FlatFieldsBody.js';
import { InDialog } from './inDialog.js';

/**
 * A dialog that found nothing offers Close and nothing else (the gallery, 2026-10-03). Duplicate pages offered
 * *"Remove 0 duplicate page(s)"*, disabled; Fields this page could have offered no button at all and sat outside the
 * pattern's width. (Edit an object did too, until it became a mode on the page whose empty state is
 * `ObjectEditLayer.test`'s, ADR-0153.) What is asserted is the footer's whole set of buttons, so a disabled action left
 * beside Close fails as surely as a missing Close.
 */
afterEach(() => {
  cleanup();
});

/** The names of the buttons in the dialog's footer. */
function footerButtons(): readonly string[] {
  const footer = document.querySelector<HTMLElement>('.m-dialog-footer');
  if (footer === null) throw new Error('the dialog has no footer');
  return within(footer)
    .getAllByRole('button')
    .map((button) => button.textContent);
}

const EMPTY: readonly { readonly dialog: string; readonly body: ReactElement }[] = [
  {
    dialog: 'Delete duplicate pages',
    body: <DuplicatePagesBody groups={[]} resolve={vi.fn()} truncated={false} update={vi.fn()} />,
  },
  {
    dialog: 'Fields this page could have',
    body: <FlatFieldsBody alreadyFields={0} candidates={[]} resolve={vi.fn()} truncated={false} update={vi.fn()} />,
  },
];

describe('a report that found nothing', () => {
  for (const { dialog, body } of EMPTY) {
    it(`${dialog}: its footer is Close alone`, () => {
      render(<InDialog>{body}</InDialog>);
      expect(footerButtons()).toStrictEqual(['Close']);
    });
  }
});

describe('the duplicate-pages action counts in words, not in "(s)"', () => {
  it('names one page in the singular', () => {
    render(
      <InDialog>
        <DuplicatePagesBody groups={[{ pages: [0, 3] }]} resolve={vi.fn()} truncated={false} update={vi.fn()} />
      </InDialog>,
    );
    expect(screen.getByRole('button', { name: 'Delete 1 duplicate page' })).toBeDefined();
  });

  it('and several in the plural', () => {
    render(
      <InDialog>
        <DuplicatePagesBody groups={[{ pages: [0, 3, 5] }]} resolve={vi.fn()} truncated={false} update={vi.fn()} />
      </InDialog>,
    );
    expect(screen.getByRole('button', { name: 'Delete 2 duplicate pages' })).toBeDefined();
  });
});
