// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExportWordBody from './ExportWordBody.js';
import { InDialog } from './inDialog.js';
import type { ScanReader } from './scanReader.js';

/**
 * The Word export dialog's body. The command's half — that the answer reaches
 * `document.exportWord` unchanged — is `commands/documentCommands.test.ts`'; this
 * half is that CHOOSING a mode, and pages, is what puts them in the answer.
 */

function opened(readers: readonly ScanReader[] = []): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ExportWordBody pageCount={3} readers={readers} resolve={resolve} update={() => undefined} />
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
      expect(resolve).toHaveBeenCalledWith({ mode, pages: [0, 1, 2], reading: 'typed' });
      cleanup();
    }
  });

  it('CONTROL: with nothing chosen it answers rich, the mode selected first, and every page', () => {
    const resolve = opened();
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ mode: 'rich', pages: [0, 1, 2], reading: 'typed' });
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
    expect(resolve).toHaveBeenCalledWith({ mode: 'rich', pages: [0, 2], reading: 'typed' });
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

  describe('a handwritten or scanned document (ADR-0202)', () => {
    it('the question comes first, typed text is chosen, and no reader is shown until the pages are said to be pictures', () => {
      opened(['built-in', 'claude']);
      expect(screen.getByRole('radiogroup', { name: /^What is in this document\?/u })).toBeDefined();
      expect((screen.getByRole('radio', { name: /^Typed text/u })).checked).toBe(true);
      expect(screen.queryByRole('radiogroup', { name: /^Read the pages with/u })).toBeNull();
    });

    it('offers EXACTLY the readers this machine has, the first chosen, and answers the one picked with the words-only mode', () => {
      const resolve = opened(['built-in', 'claude']);
      fireEvent.click(screen.getByRole('radio', { name: /^Handwritten or scanned/u }));
      const group = screen.getByRole('radiogroup', { name: /^Read the pages with/u });
      expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
      expect((screen.getByRole('radio', { name: /^This computer/u })).checked).toBe(true);
      fireEvent.click(screen.getByRole('radio', { name: /^Claude/u }));
      fireEvent.click(SAVE());
      // THE MODE IS FIXED AT WORDS ONLY: a layout of pictures the words sit beside is not an editable file.
      expect(resolve).toHaveBeenCalledWith({ mode: 'text', pages: [0, 1, 2], reading: 'claude' });
    });

    it('the three modes are not offered for pictures; CONTROL: they are for typed text', () => {
      opened(['built-in']);
      expect(screen.getByRole('radiogroup', { name: /^What to keep/u })).toBeDefined();
      fireEvent.click(screen.getByRole('radio', { name: /^Handwritten or scanned/u }));
      expect(screen.queryByRole('radiogroup', { name: /^What to keep/u })).toBeNull();
    });

    it('SAYS WHAT IS SENT before anything is: a service names its page count, this computer sends nothing', () => {
      opened(['built-in', 'claude']);
      fireEvent.click(screen.getByRole('radio', { name: /^Handwritten or scanned/u }));
      expect(screen.queryByText(/will be sent to/u)).toBeNull();
      fireEvent.click(screen.getByRole('radio', { name: /^Claude/u }));
      expect(screen.getByText('All 3 pages of this document will be sent to Anthropic’s Claude to be read.')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '2' } });
      expect(screen.getByText('One page of this document will be sent to Anthropic’s Claude to be read.')).toBeDefined();
    });

    it('with NO reader it says so and offers no way to go on', () => {
      const resolve = opened([]);
      fireEvent.click(screen.getByRole('radio', { name: /^Handwritten or scanned/u }));
      expect(document.querySelector('[data-export-word-no-reader]')).not.toBeNull();
      expect(SAVE().hasAttribute('disabled')).toBe(true);
      fireEvent.click(SAVE());
      expect(resolve).not.toHaveBeenCalled();
    });
  });
});
