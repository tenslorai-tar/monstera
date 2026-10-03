// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue } from '../i18n.js';
import { InDialog } from './inDialog.js';
import { EN } from '../messages/en.js';
import PrintBody from './PrintBody.js';

/**
 * The print dialog's body. The command's half — that the answer reaches
 * `document.print` unchanged — is `commands/documentCommands.test.ts`'; this half is
 * that CHOOSING a resolution is what puts it in the answer.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <InDialog>{children}</InDialog>;
}

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
      const resolve = vi.fn();
      render(
        <Wrapped>
          <PrintBody dpi={300} resolve={resolve} update={() => undefined} />
        </Wrapped>,
      );
      fireEvent.click(screen.getByRole('radio', { name: label }));
      // BY NAME: in the dialog, the footer's Cancel and the header's close are buttons too.
      fireEvent.click(screen.getByRole('button', { name: 'Choose a printer…' }));
      expect(resolve).toHaveBeenCalledWith({ dpi });
      cleanup();
    }
  });

  it('CONTROL: with nothing chosen it answers the resolution it STARTED on — the setting’s, handed in', () => {
    for (const dpi of [300, 600] as const) {
      const resolve = vi.fn();
      render(
        <Wrapped>
          <PrintBody dpi={dpi} resolve={resolve} update={() => undefined} />
        </Wrapped>,
      );
      // BY NAME: in the dialog, the footer's Cancel and the header's close are buttons too.
      fireEvent.click(screen.getByRole('button', { name: 'Choose a printer…' }));
      expect(resolve).toHaveBeenCalledWith({ dpi });
      cleanup();
    }
  });
});
