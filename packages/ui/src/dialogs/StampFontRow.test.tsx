// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BatesNumberBody from './BatesNumberBody.js';
import HeaderFooterBody from './HeaderFooterBody.js';
import { InDialog } from './inDialog.js';
import WatermarkPagesBody from './WatermarkPagesBody.js';

/**
 * The three stamp dialogs answer with the family chosen in the one font picker (D1).
 *
 * The family chosen is COURIER, never the default, so a dialog that dropped the choice and answered Helvetica fails here
 * rather than passing on the value it would have sent anyway. The default case is the control for the other direction:
 * a dialog that answered nothing until a font was picked would be refused by the result schema at the user.
 */
afterEach(() => {
  cleanup();
});

type Resolve = (answer: unknown) => void;

const DIALOGS: readonly {
  readonly name: string;
  readonly apply: string;
  readonly mount: (resolve: Resolve) => ReactElement;
  readonly fill?: () => void;
}[] = [
  {
    name: 'watermark',
    apply: 'Add watermark',
    mount: (resolve) => <WatermarkPagesBody pages={[0]} resolve={resolve} update={vi.fn()} />,
    fill: () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), { target: { value: 'DRAFT' } });
    },
  },
  {
    name: 'header and footer',
    apply: 'Add',
    mount: (resolve) => <HeaderFooterBody pages={[0]} resolve={resolve} update={vi.fn()} />,
    fill: () => {
      const first = screen.getAllByRole('textbox')[0];
      if (first === undefined) throw new Error('the header and footer dialog has no slot to type in');
      fireEvent.change(first, { target: { value: 'Report' } });
    },
  },
  {
    name: 'Bates number',
    apply: 'Number pages',
    mount: (resolve) => <BatesNumberBody pages={[0]} resolve={resolve} update={vi.fn()} />,
  },
];

function open(dialog: (typeof DIALOGS)[number]): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(<InDialog>{dialog.mount(resolve)}</InDialog>);
  dialog.fill?.();
  return resolve;
}

describe('a stamp dialog answers with the font chosen', () => {
  for (const dialog of DIALOGS) {
    it(`the ${dialog.name} dialog sends the family picked`, () => {
      const resolve = open(dialog);
      fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
      const courier = document.querySelector('[data-font-choice="Courier"]');
      if (courier === null) throw new Error('Courier is not offered');
      fireEvent.click(courier);
      fireEvent.click(screen.getByRole('button', { name: dialog.apply }));
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0]?.[0]).toMatchObject({ family: 'Courier' });
    });

    it(`CONTROL: the ${dialog.name} dialog sends Helvetica when nothing is picked`, () => {
      const resolve = open(dialog);
      fireEvent.click(screen.getByRole('button', { name: dialog.apply }));
      expect(resolve.mock.calls[0]?.[0]).toMatchObject({ family: 'Helvetica' });
    });
  }

  it('offers the three faces a stamp writer can set, and says nothing about the computer’s fonts', () => {
    const bates = DIALOGS[2];
    if (bates === undefined) throw new Error('the Bates dialog is not in the table');
    open(bates);
    fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
    const offered = [...document.querySelectorAll('[data-font-choice]')].map((each) => each.getAttribute('data-font-choice'));
    // DISTINCT, because *Recent* is the session's and repeats a family an earlier case picked.
    expect([...new Set(offered)].sort()).toEqual(['Courier', 'Helvetica', 'Times']);
    expect(document.body.textContent).not.toContain('could not be listed');
  });
});
