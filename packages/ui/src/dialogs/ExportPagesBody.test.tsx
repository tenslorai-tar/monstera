// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExportPagesBody from './ExportPagesBody.js';
import type { ExportPagesProps } from './exportPages.js';
import { InDialog } from './inDialog.js';

/**
 * The body PowerPoint and the two text exports share (ADR-0161): its one question is the pages. The commands' half —
 * that the pages reach `document.exportPowerPoint` and `document.exportText` — is `commands/documentCommands.test.ts`'.
 */

function opened(becomes: ExportPagesProps['becomes']): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <ExportPagesBody becomes={becomes} pageCount={4} resolve={resolve} update={() => undefined} />
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
    const resolve = opened('slides');
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ pages: [0, 1, 2, 3] });
  });

  it('answers the pages typed, and refuses at the press while they name none', () => {
    const resolve = opened('text');
    fireEvent.click(screen.getByRole('button', { name: 'Select pages' }));
    fireEvent.click(SAVE());
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Type the pages to export, for example 1-3, 5.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), { target: { value: '4, 2-3' } });
    fireEvent.click(SAVE());
    expect(resolve).toHaveBeenCalledWith({ pages: [1, 2, 3] });
  });

  it('says what each page becomes, by the export that opened it', () => {
    opened('slides');
    expect(screen.getByText('Each page becomes one slide.')).toBeTruthy();
    cleanup();
    opened('text');
    // CONTROL: the text exports' sentence, and not the slides' one.
    expect(screen.getByText('The text file holds these pages, in order.')).toBeTruthy();
    expect(screen.queryByText('Each page becomes one slide.')).toBeNull();
  });
});
