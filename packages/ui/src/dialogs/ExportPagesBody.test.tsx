// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExportPagesBody from './ExportPagesBody.js';
import { InDialog } from './inDialog.js';

/**
 * The body the two text exports share (ADR-0161): its one question is the pages. The commands' half — that the pages reach
 * `document.exportText` — is `commands/documentCommands.test.ts`'. PowerPoint asks a second question and has its own body.
 */

function opened(): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ExportPagesBody pageCount={4} resolve={resolve} update={() => undefined} />
    </InDialog>,
  );
  return resolve;
}

const SAVE = (): HTMLElement => screen.getByRole('button', { name: 'Choose where to save…' });

afterEach(() => {
  cleanup();
});

describe('ExportPagesBody', () => {
  it('answers every page when nothing is chosen', () => {
    const resolve = opened();
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ pages: [0, 1, 2, 3] });
  });

  it('answers the pages typed, and refuses at the press while they name none', () => {
    const resolve = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.click(SAVE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Type the pages to export, for example 1-3, 5.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '4, 2-3' } });
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ pages: [1, 2, 3] });
  });

  it('says the text file holds the pages, and not that each becomes a slide', () => {
    opened();
    expect(screen.getByText('The text file holds these pages, in order.')).toBeTruthy();
    // CONTROL: the PowerPoint sentence is that dialog's own.
    expect(screen.queryByText('Each page becomes one slide.')).toBeNull();
  });
});
