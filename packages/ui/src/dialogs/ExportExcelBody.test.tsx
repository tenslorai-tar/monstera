// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ExportExcelBody from './ExportExcelBody.js';

/**
 * The Excel export dialog's body. The command's half — that the answer reaches
 * `document.exportExcel` unchanged — is `commands/documentCommands.test.ts`'; this
 * half is that CHOOSING a layout is what puts it in the answer.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('ExportExcelBody', () => {
  it('answers ONE SHEET when the person chooses it', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <ExportExcelBody resolve={resolve} />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Every table on one sheet' }));
    fireEvent.click(screen.getByRole('button'));
    expect(resolve).toHaveBeenCalledWith({ layout: 'one-sheet' });
  });

  it('CONTROL: with nothing chosen it answers a sheet per page, the layout selected first', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <ExportExcelBody resolve={resolve} />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(resolve).toHaveBeenCalledWith({ layout: 'sheet-per-page' });
  });
});
