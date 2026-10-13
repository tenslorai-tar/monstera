// @vitest-environment happy-dom
import type { FontFamilyEntry } from '@monstera/contract';
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

  it('offers this computer’s fonts beside the three built in, and sends the one picked (ADR-0235)', () => {
    const resolve = vi.fn();
    render(
      <InDialog>
        <BatesNumberBody fonts={LISTED} pages={[0]} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
    const offered = [...document.querySelectorAll('[data-font-choice]')].map((each) => each.getAttribute('data-font-choice'));
    // DISTINCT, because *Recent* is the session's and repeats a family an earlier case picked.
    expect([...new Set(offered)].sort()).toEqual(['Arimo', 'Courier', 'Helvetica', 'Noto Sans', 'Times']);
    const arimo = document.querySelector('[data-font-choice="Arimo"]');
    if (arimo === null) throw new Error('Arimo is not offered');
    fireEvent.click(arimo);
    fireEvent.click(screen.getByRole('button', { name: 'Number pages' }));
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({ family: 'Arimo' });
  });

  it('CONTROL: where the computer’s list could not be read it says so in words, and still offers the three built in', () => {
    open(DIALOGS[2] ?? raise('the Bates dialog is not in the table'));
    fireEvent.click(screen.getByRole('button', { name: 'Font: Helvetica' }));
    const offered = [...document.querySelectorAll('[data-font-choice]')].map((each) => each.getAttribute('data-font-choice'));
    expect([...new Set(offered)].sort()).toEqual(['Courier', 'Helvetica', 'Times']);
    expect(document.body.textContent).toContain('could not be listed');
  });
});

const entry = (name: string, origin: 'installed' | 'bundled'): FontFamilyEntry => ({
  name,
  origin,
  embedding: 'subset',
  bold: true,
  italic: true,
});

/** A computer's list as main answers it: one installed family and one bundled. */
const LISTED = { listed: true, families: [entry('Noto Sans', 'installed'), entry('Arimo', 'bundled')], more: 0 } as const;

function raise(why: string): never {
  throw new Error(why);
}
