// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SplitView } from './SplitView.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

afterEach(() => {
  cleanup();
});

/**
 * The view as its caller drives it: the caller owns the two pages, and the header asks it to change them. Each half's
 * content names the page it was handed, so a case reads what the HALF shows and not only what the header says.
 */
function Harness({ pageCount, onClose }: { readonly pageCount: number; readonly onClose: () => void }): ReactElement {
  activateCatalogue('en', EN);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(1);
  return (
    <I18nProvider i18n={i18n}>
      <SplitView
        pageCount={pageCount}
        left={<p data-half-shows={left} />}
        right={<p data-half-shows={right} />}
        leftPage={left}
        rightPage={right}
        onLeftPage={setLeft}
        onRightPage={setRight}
        onClose={onClose}
      />
    </I18nProvider>
  );
}

const box = (side: 'left' | 'right'): HTMLInputElement => {
  const found = document.querySelector<HTMLInputElement>(`[data-split-page="${side}"]`);
  if (found === null) throw new Error(`no ${side} page box`);
  return found;
};
const shows = (): string[] => [...document.querySelectorAll('[data-half-shows]')].map((each) => each.getAttribute('data-half-shows') ?? '');

describe('split view — the owner’s design: a header bar over two halves, one page each', () => {
  it('draws the header the design names: the title, both page boxes, "of N", Both twice and Close', () => {
    render(<Harness pageCount={5} onClose={() => undefined} />);
    expect(screen.getByText('Split View')).toBeTruthy();
    expect(screen.getByLabelText('Left page:')).toBe(box('left'));
    expect(screen.getByLabelText('Right page:')).toBe(box('right'));
    expect(screen.getByText('of 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Both back one page' }).textContent).toBe('Both');
    expect(screen.getByRole('button', { name: 'Both forward one page' }).textContent).toBe('Both');
    expect(screen.getByRole('button', { name: 'Close split view' })).toBeTruthy();
    // EACH HALF CARRIES ITS PAGE ABOVE IT, as a person reads the number.
    expect([...document.querySelectorAll('.m-split__label')].map((label) => label.textContent)).toStrictEqual([
      'Page 1',
      'Page 2',
    ]);
  });

  it('a page typed into one box moves that half alone, read as the number on screen', () => {
    render(<Harness pageCount={5} onClose={() => undefined} />);
    fireEvent.change(box('right'), { target: { value: '4' } });
    fireEvent.keyDown(box('right'), { key: 'Enter' });
    // ZERO-BASED IN THE CALLER, one-based on screen: page 4 is index 3.
    expect(shows()).toStrictEqual(['0', '3']);
    expect(box('right').value).toBe('4');
    expect(box('left').value).toBe('1');
  });

  it('the Enter that CONFIRMS A COMPOSITION moves no half (CR-COR-07)', () => {
    render(<Harness pageCount={5} onClose={() => undefined} />);
    fireEvent.change(box('right'), { target: { value: '4' } });
    fireEvent.keyDown(box('right'), { key: 'Enter', isComposing: true });
    expect(shows()).toStrictEqual(['0', '1']);
    // CONTROL: the Enter after it sends the page.
    fireEvent.keyDown(box('right'), { key: 'Enter' });
    expect(shows()).toStrictEqual(['0', '3']);
  });

  it('CONTROL: a page outside the document is not sent, and the box names the page on show again', () => {
    render(<Harness pageCount={5} onClose={() => undefined} />);
    fireEvent.change(box('left'), { target: { value: '9' } });
    fireEvent.keyDown(box('left'), { key: 'Enter' });
    expect(shows()).toStrictEqual(['0', '1']);
    expect(box('left').value).toBe('1');
  });

  it('Both moves BOTH halves one page together, and is disabled at either end', () => {
    render(<Harness pageCount={3} onClose={() => undefined} />);
    const back = screen.getByRole<HTMLButtonElement>('button', { name: 'Both back one page' });
    const forward = screen.getByRole<HTMLButtonElement>('button', { name: 'Both forward one page' });
    // AT THE START the left half is on the first page, so back has nowhere to take it.
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);
    fireEvent.click(forward);
    expect(shows()).toStrictEqual(['1', '2']);
    // NOW THE RIGHT HALF IS ON THE LAST PAGE, so forward is disabled though the left could still move.
    expect(forward.disabled).toBe(true);
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(shows()).toStrictEqual(['0', '1']);
  });

  it('Close and Esc both close it, and Esc in a box being edited only puts the page back', () => {
    let closed = 0;
    render(
      <Harness
        pageCount={5}
        onClose={() => {
          closed += 1;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close split view' }));
    expect(closed).toBe(1);

    fireEvent.change(box('left'), { target: { value: '3' } });
    fireEvent.keyDown(box('left'), { key: 'Escape' });
    // SPENT ON THE FIELD: the typed number is gone and the view stays open.
    expect(box('left').value).toBe('1');
    expect(closed).toBe(1);

    act(() => {
      fireEvent.keyDown(box('left'), { key: 'Escape' });
    });
    expect(closed).toBe(2);
  });
});
