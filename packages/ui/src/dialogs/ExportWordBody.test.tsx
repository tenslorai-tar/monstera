// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExportWordBody from './ExportWordBody.js';
import { InDialog } from './inDialog.js';

/**
 * The Word export dialog's body. The command's half — that the answer reaches
 * `document.exportWord` unchanged — is `commands/documentCommands.test.ts`'; this
 * half is that CHOOSING a mode, and pages, is what puts them in the answer.
 */

function opened(): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ExportWordBody pageCount={3} resolve={resolve} update={() => undefined} />
    </InDialog>,
  );
  return resolve;
}

const SAVE = (): HTMLElement => screen.getByRole('button', { name: 'Choose where to save…' });

afterEach(() => {
  cleanup();
});

describe('ExportWordBody', () => {
  // THE RADIO'S NAME IS ITS SHORT NAME AND SENTENCE TOGETHER, because the whole row is the radio's label: what a screen
  // reader reads on reaching it, and what a person clicks. Matched by the short name at the start.
  it('answers the mode the person chose, for each of the three', () => {
    const labels = { layout: /^Page layout/u, text: /^Words only/u, rich: /^Editable text/u } as const;
    for (const [mode, label] of Object.entries(labels)) {
      const resolve = opened();
      fireEvent.click(screen.getByRole('radio', { name: label }));
      fireEvent.click(SAVE());
      expect(resolve).toHaveBeenCalledWith({ mode, pages: [0, 1, 2] });
      cleanup();
    }
  });

  it('CONTROL: with nothing chosen it answers rich, the mode selected first, and every page', () => {
    const resolve = opened();
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ mode: 'rich', pages: [0, 1, 2] });
  });

  it('ITS PAGES ARE THE EXPORTS’ SHARED ROW (ADR-0161): a page the document lacks is refused at the press, the typed ones sent', () => {
    const resolve = opened();
    expect(screen.getByRole('group', { name: 'Pages' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    const field = screen.getByRole('textbox', { name: 'Page numbers' });
    fireEvent.change(field, { target: { value: '4' } });
    // NOT WHILE TYPING: the row says nothing until the person tries to go on.
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(SAVE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('“4” is outside this document, which has 3 pages.');

    fireEvent.change(field, { target: { value: '3, 1' } });
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ mode: 'rich', pages: [0, 2] });
  });

  it('Select pages with nothing typed says the export’s own sentence and sends nothing', () => {
    const resolve = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.click(SAVE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Type the pages to export, for example 1-3, 5.');
  });

  it('the three modes are one group named by its question, and each says what a person gets', () => {
    opened();
    const group = screen.getByRole('radiogroup', { name: /^What to keep/u });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Each line where it sits on the page/u })).toBeDefined();
  });
});
