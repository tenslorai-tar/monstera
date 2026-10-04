// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InDialog } from './inDialog.js';
import PrintBody from './PrintBody.js';

/**
 * The print dialog's body. The command's half — that the answer reaches
 * `document.print` unchanged — is `commands/documentCommands.test.ts`'; this half is
 * that CHOOSING a resolution, and pages, is what puts them in the answer.
 */

function opened(dpi: 150 | 300 | 600 = 300): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <PrintBody dpi={dpi} pageCount={3} resolve={resolve} update={() => undefined} />
    </InDialog>,
  );
  return resolve;
}

// BY NAME: in the dialog, the footer's Cancel and the header's close are buttons too.
const PRINT = (): HTMLElement => screen.getByRole('button', { name: 'Choose a printer…' });

afterEach(() => {
  cleanup();
});

describe('PrintBody', () => {
  it('answers the resolution the person chose, for the two not selected first', () => {
    // EACH CHOICE IS ITS NAME AND THE NOTE UNDER IT, which together are the radio's accessible name.
    for (const [dpi, label] of [
      [150, /^Draft\s*150 dots per inch\./u],
      [600, /^High\s*Up to 600 dots per inch\./u],
    ] as const) {
      const resolve = opened();
      fireEvent.click(screen.getByRole('radio', { name: label }));
      fireEvent.click(PRINT());
      expect(resolve).toHaveBeenCalledWith({ dpi, pages: [0, 1, 2] });
      cleanup();
    }
  });

  it('CONTROL: with nothing chosen it answers the resolution it STARTED on — the setting’s, handed in', () => {
    for (const dpi of [300, 600] as const) {
      const resolve = opened(dpi);
      fireEvent.click(PRINT());
      expect(resolve).toHaveBeenCalledWith({ dpi, pages: [0, 1, 2] });
      cleanup();
    }
  });

  it('ITS PAGES ARE THE EXPORTS’ SHARED ROW (ADR-0161): refused at the press while they name none, the typed ones sent', () => {
    const resolve = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.click(PRINT());
    expect(resolve).not.toHaveBeenCalled();
    // PRINT'S OWN SENTENCE, not an export's.
    expect(screen.getByRole('alert').textContent).toBe('Type the pages to print, for example 1-3, 5.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '2-3' } });
    fireEvent.click(PRINT());
    expect(resolve).toHaveBeenCalledWith({ dpi: 300, pages: [1, 2] });
  });
});
