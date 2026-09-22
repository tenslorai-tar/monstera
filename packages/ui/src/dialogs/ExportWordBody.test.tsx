// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import ExportWordBody from './ExportWordBody.js';

/**
 * The Word export dialog's body. The command's half — that the answer reaches
 * `document.exportWord` unchanged — is `commands/documentCommands.test.ts`'; this
 * half is that CHOOSING a mode is what puts it in the answer.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('ExportWordBody', () => {
  it('answers the mode the person chose, for each of the three', () => {
    const labels = {
      layout: 'The page layout — each line where it sits on the page',
      text: 'Just the words',
      rich: 'Text and its fonts — editable, flows like a normal document',
    } as const;
    for (const [mode, label] of Object.entries(labels)) {
      const resolve = vi.fn();
      render(
        <Wrapped>
          <ExportWordBody resolve={resolve} update={() => undefined} />
        </Wrapped>,
      );
      fireEvent.click(screen.getByRole('radio', { name: label }));
      fireEvent.click(screen.getByRole('button'));
      expect(resolve).toHaveBeenCalledWith({ mode });
      cleanup();
    }
  });

  it('CONTROL: with nothing chosen it answers rich, the mode selected first', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <ExportWordBody resolve={resolve} update={() => undefined} />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(resolve).toHaveBeenCalledWith({ mode: 'rich' });
  });
});
