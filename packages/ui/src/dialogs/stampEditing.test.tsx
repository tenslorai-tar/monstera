// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BatesNumberBody from './BatesNumberBody.js';
import { BATES_NUMBER_RESULT } from './batesNumberResult.js';
import HeaderFooterBody from './HeaderFooterBody.js';
import { HEADER_FOOTER_RESULT } from './headerFooterResult.js';
import { InDialog } from './inDialog.js';
import WatermarkPagesBody from './WatermarkPagesBody.js';
import { WATERMARK_PAGES_RESULT } from './watermarkPagesResult.js';

/**
 * The stamp windows as Edit reopens them (ADR-0246 Decision 3) and their colour (Decision 7). Each case presses the
 * window's action WITHOUT touching a field, so the answer is the window's own reading of what it was filled with: a
 * window that opened on its defaults answers the defaults, and every recorded value below is off its default.
 */
afterEach(() => {
  cleanup();
});

const apply = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('the stamp windows, reopened by Edit', () => {
  it('the WATERMARK window answers the recorded settings and colour untouched, offers no scope, and says Apply changes', () => {
    const editing = { text: 'CONFIDENTIAL', opacity: 0.45, rotationDegrees: 30, fontSize: 60, family: 'Courier', colour: [0.8, 0.1, 0.1] as const };
    const resolve = vi.fn();
    render(
      <InDialog>
        <WatermarkPagesBody pages={[3]} editing={{ ...editing, colour: [...editing.colour] }} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    // THE SAME QUERY FINDS THE SCOPE in the adding window (the control below), so its absence here is the window's.
    expect(screen.queryByRole('button', { name: 'All pages' })).toBeNull();
    apply('Apply changes');
    expect(resolve).toHaveBeenCalledTimes(1);
    const answer: unknown = resolve.mock.calls[0]?.[0];
    expect(WATERMARK_PAGES_RESULT.parse(answer)).toStrictEqual({ pages: 'all', ...editing, colour: [...editing.colour] });
  });

  it('CONTROL: the watermark window ADDING answers no colour until one is picked, then the one picked', () => {
    const resolve = vi.fn();
    render(
      <InDialog>
        <WatermarkPagesBody pages={[3]} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    expect(screen.queryByRole('button', { name: 'All pages' })).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'DRAFT' } });
    apply('Add watermark');
    expect(resolve.mock.calls[0]?.[0]).not.toHaveProperty('colour');

    // THE STANDARD COLOUR IS PRESSED until another is, and picking red answers red as the command's 0–1 components.
    expect(screen.getByRole('button', { name: 'Standard colour' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    apply('Add watermark');
    expect(resolve.mock.calls[1]?.[0]).toMatchObject({ colour: [0.7529, 0, 0] });
  });

  it('the HEADERS AND FOOTERS window answers the recorded slots, size, margin and colour untouched', () => {
    const editing = {
      header: { left: 'Acme', centre: '', right: '' },
      footer: { left: '', centre: 'Page {n} of {N}', right: '' },
      family: 'Times',
      fontSize: 11,
      marginPoints: 40,
      colour: [0.1216, 0.3098, 0.749] as [number, number, number],
    };
    const resolve = vi.fn();
    render(
      <InDialog>
        <HeaderFooterBody pages={[3]} editing={editing} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    apply('Apply changes');
    expect(HEADER_FOOTER_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({ pages: 'all', ...editing });
  });

  it('the BATES window answers the recorded identifier, placement, size and margin untouched', () => {
    const editing = {
      prefix: 'ABC',
      suffix: '-X',
      start: 431,
      digits: 6,
      edge: 'header' as const,
      slot: 'left' as const,
      family: 'Courier',
      // NEITHER IS A FIELD IN THE WINDOW, so an edit that fell back to 9 and 36 would move the numbers.
      fontSize: 12,
      marginPoints: 50,
    };
    const resolve = vi.fn();
    render(
      <InDialog>
        <BatesNumberBody pages={[3]} editing={editing} resolve={resolve} update={vi.fn()} />
      </InDialog>,
    );
    apply('Apply changes');
    expect(BATES_NUMBER_RESULT.parse(resolve.mock.calls[0]?.[0])).toStrictEqual({ pages: 'all', ...editing });
  });
});
