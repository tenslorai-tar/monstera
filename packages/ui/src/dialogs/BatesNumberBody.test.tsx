// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BatesNumberBody from './BatesNumberBody.js';
import { InDialog } from './inDialog.js';

/**
 * The first number is shown in a row that says what it is. It was the bare number under the fields, *0001*, with
 * nothing naming it (the gallery, 2026-10-03), so what is asserted is the value inside the row named for it.
 */
afterEach(() => {
  cleanup();
});

describe('BatesNumberBody', () => {
  it('shows the first number in the row named for it', () => {
    render(
      <InDialog>
        <BatesNumberBody pages={[0]} resolve={vi.fn()} update={vi.fn()} />
      </InDialog>,
    );
    const row = screen.getByText('First number').closest('.m-dialog-row');
    expect(row?.querySelector('output')?.textContent).toBe('0001');
  });
});
