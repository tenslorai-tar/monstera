// @vitest-environment happy-dom
import { STAMP_TOKENS } from '@monstera/contract';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HeaderFooterBody from './HeaderFooterBody.js';
import { InDialog } from './inDialog.js';

/**
 * The header-and-footer dialog's hint names the two tokens the kernel resolves, taken from the contract's one spelling.
 *
 * The hint used to carry them inside its own message, where the message format read each brace as a value to fill
 * and filled it with nothing: *"Type  for the page number and  for the page count"* (the gallery, 2026-10-03). A test
 * asserting the hint merely exists passes on that; this one reads the tokens in it.
 */
afterEach(() => {
  cleanup();
});

describe('HeaderFooterBody', () => {
  it('shows the tokens the kernel resolves, by the contract’s spelling', () => {
    render(
      <InDialog>
        <HeaderFooterBody pages={[0]} resolve={vi.fn()} update={vi.fn()} />
      </InDialog>,
    );
    expect(
      screen.getByText(`Type ${STAMP_TOKENS.page} for the page number and ${STAMP_TOKENS.count} for the page count.`),
    ).toBeDefined();
  });
});
