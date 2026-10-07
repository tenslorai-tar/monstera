// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GenerateTocBody from './GenerateTocBody.js';
import { InDialog } from './inDialog.js';
import { GENERATE_TOC_RESULT } from './generateToc.js';

/**
 * The contents review (ADR-0197): the entries as the outline reads, each one editable, movable, nested and deletable, with
 * a place to add one — and what Insert answers is the rows as they were LEFT, pages from zero.
 */
afterEach(() => {
  cleanup();
});

const ENTRIES = [
  { title: 'Introduction', page: 0, depth: 0 },
  { title: 'Method', page: 2, depth: 0 },
  { title: 'Participants', page: 3, depth: 1 },
];

function opened(
  props: { entries?: readonly { title: string; page: number | null; depth: number }[]; pageCount?: number; tooLong?: boolean } = {},
): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <InDialog>
      <GenerateTocBody
        entries={props.entries ?? ENTRIES}
        pageCount={props.pageCount ?? 12}
        tooLong={props.tooLong ?? false}
        resolve={resolve}
        update={vi.fn()}
      />
    </InDialog>,
  );
  return resolve;
}

const answered = (resolve: ReturnType<typeof vi.fn>): unknown => GENERATE_TOC_RESULT.parse(resolve.mock.calls[0]?.[0]);
const press = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }));
};
const titles = (): string[] => screen.getAllByRole('textbox', { name: 'Title' }).map((box) => (box as HTMLInputElement).value);

describe('GenerateTocBody', () => {
  it('lists every entry with its title and its page as a person counts, and Insert with nothing touched answers them as they were', () => {
    const resolve = opened();
    expect(titles()).toStrictEqual(['Introduction', 'Method', 'Participants']);
    expect(screen.getAllByRole('textbox', { name: 'Page' }).map((box) => (box as HTMLInputElement).value)).toStrictEqual(['1', '3', '4']);
    press('Insert');
    expect(answered(resolve)).toStrictEqual({ entries: ENTRIES });
  });

  it('RENAME, MOVE, NEST and DELETE each change what is answered — and the order is the one left', () => {
    const resolve = opened();
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Title' })[1] as HTMLElement, { target: { value: 'Methods' } });
    press('Move entry 3 up');
    press('Move entry 1 in a level');
    press('Delete entry 3');
    press('Insert');
    // Method→Methods, Participants moved above it, Introduction nested a level, and the last row (Methods) deleted.
    expect(answered(resolve)).toStrictEqual({
      entries: [
        { title: 'Introduction', page: 0, depth: 1 },
        { title: 'Participants', page: 3, depth: 1 },
      ],
    });
  });

  it('OUTDENT is unavailable at the top level, and CONTROL: a nested row can move out', () => {
    opened();
    expect(screen.getByRole('button', { name: 'Move entry 1 out a level' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Move entry 3 out a level' }).hasAttribute('disabled')).toBe(false);
  });

  it('ADD takes a title and a page, puts the row at the end, and answers it zero-based', () => {
    const resolve = opened();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title of the new entry' }), { target: { value: 'Appendix' } });
    // NOT ADDABLE UNTIL IT HAS A PAGE THE DOCUMENT HAS.
    expect(screen.getByRole('button', { name: 'Add entry' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Page of the new entry' }), { target: { value: '99' } });
    expect(screen.getByRole('button', { name: 'Add entry' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Page of the new entry' }), { target: { value: '12' } });
    press('Add entry');
    expect(titles()).toStrictEqual(['Introduction', 'Method', 'Participants', 'Appendix']);
    press('Insert');
    expect(answered(resolve)).toStrictEqual({ entries: [...ENTRIES, { title: 'Appendix', page: 11, depth: 0 }] });
  });

  it('a row that cannot be written is NAMED and nothing is answered: an empty title, a page the document lacks', () => {
    const resolve = opened();
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Title' })[0] as HTMLElement, { target: { value: '  ' } });
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Page' })[2] as HTMLElement, { target: { value: '40' } });
    press('Insert');
    expect(resolve).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
    expect(alerts).toStrictEqual([
      'Entry 1 has no title. Type one, or delete the entry.',
      'Entry 3: type a page from 1 to 12, or leave the page empty.',
    ]);
    // CONTROL: fixed, it answers.
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Title' })[0] as HTMLElement, { target: { value: 'Intro' } });
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Page' })[2] as HTMLElement, { target: { value: '5' } });
    press('Insert');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('a row with no page is kept without one, as the outline has it', () => {
    const resolve = opened({ entries: [{ title: 'Elsewhere', page: null, depth: 0 }] });
    press('Insert');
    expect(answered(resolve)).toStrictEqual({ entries: [{ title: 'Elsewhere', page: null, depth: 0 }] });
  });

  it('an outline TOO LONG TO EDIT lists nothing and Insert answers no rows, so the bookmarks are written as they are', () => {
    const resolve = opened({ entries: [], tooLong: true });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByText(/more than 300 bookmarks/u)).toBeDefined();
    press('Insert');
    expect(answered(resolve)).toStrictEqual({});
  });

  it('a title past 100 characters is NAMED, not cut', () => {
    const resolve = opened({ entries: [{ title: 'z'.repeat(101), page: 0, depth: 0 }] });
    press('Insert');
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Entry 1: shorten the title to 100 characters or fewer.');
  });

  it('a document with NO BOOKMARKS says so, and Insert with no entries is refused in words', () => {
    const resolve = opened({ entries: [] });
    expect(screen.getByText(/has no bookmarks/u)).toBeDefined();
    press('Insert');
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('There are no entries. Add one, or choose Cancel.');
  });
});
