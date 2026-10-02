// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL, EN, EXPORT_WORD_TITLE } from '../messages/en.js';
import { Dialog } from '../primitives/Dialog.js';
import ExportWordBody from './ExportWordBody.js';

/**
 * The Word export dialog's body. The command's half — that the answer reaches
 * `document.exportWord` unchanged — is `commands/documentCommands.test.ts`'; this
 * half is that CHOOSING a mode is what puts it in the answer.
 */

/** IN THE DIALOG, as the registry mounts it: the footer's Cancel is the popup's own close and exists only inside one. */
function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return (
    <I18nProvider i18n={i18n}>
      <Dialog closeLabel={CLOSE_LABEL} onOpenChange={() => undefined} open title={EXPORT_WORD_TITLE}>
        {children}
      </Dialog>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('ExportWordBody', () => {
  // THE RADIO'S NAME IS ITS SHORT NAME AND SENTENCE TOGETHER, because the whole row is the radio's label: what a screen
  // reader reads on reaching it, and what a person clicks. Matched by the short name at the start.
  it('answers the mode the person chose, for each of the three', () => {
    const labels = { layout: /^Page layout/u, text: /^Words only/u, rich: /^Editable text/u } as const;
    for (const [mode, label] of Object.entries(labels)) {
      const resolve = vi.fn();
      render(
        <Wrapped>
          <ExportWordBody resolve={resolve} update={() => undefined} />
        </Wrapped>,
      );
      fireEvent.click(screen.getByRole('radio', { name: label }));
      fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Choose where to save…' }));
    expect(resolve).toHaveBeenCalledWith({ mode: 'rich' });
  });

  it('the three modes are one group named by its question, and each says what a person gets', () => {
    render(
      <Wrapped>
        <ExportWordBody resolve={vi.fn()} update={() => undefined} />
      </Wrapped>,
    );
    const group = screen.getByRole('radiogroup', { name: /^What to keep/u });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Each line where it sits on the page/u })).toBeDefined();
  });
});
