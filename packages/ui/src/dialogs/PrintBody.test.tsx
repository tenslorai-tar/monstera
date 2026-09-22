// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import PrintBody from './PrintBody.js';

/**
 * The print dialog's body. The command's half — that the answer reaches
 * `document.print` unchanged — is `commands/documentCommands.test.ts`'; this half is
 * that CHOOSING a resolution is what puts it in the answer.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('PrintBody', () => {
  it('answers the resolution the person chose, for the two not selected first', () => {
    for (const [dpi, label] of [
      [150, 'Draft — 150 dots per inch'],
      [600, 'High — up to 600 dots per inch, lower on a large page'],
    ] as const) {
      const resolve = vi.fn();
      render(
        <Wrapped>
          <PrintBody resolve={resolve} update={() => undefined} />
        </Wrapped>,
      );
      fireEvent.click(screen.getByRole('radio', { name: label }));
      fireEvent.click(screen.getByRole('button'));
      expect(resolve).toHaveBeenCalledWith({ dpi });
      cleanup();
    }
  });

  it('CONTROL: with nothing chosen it answers 300, the resolution selected first', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <PrintBody resolve={resolve} update={() => undefined} />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(resolve).toHaveBeenCalledWith({ dpi: 300 });
  });
});
