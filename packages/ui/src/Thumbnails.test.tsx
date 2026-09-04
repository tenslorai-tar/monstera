// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Thumbnails } from './Thumbnails.js';
import type { DocumentView } from './documentView.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

/**
 * The thumbnail strip.
 *
 * ## The observer is stubbed, and everything is reported visible
 *
 * happy-dom fires no intersections, so nothing would ever be drawn and every
 * case would assert about an empty strip. `useVisiblePages` seeds the first
 * page visible, which is what these cases rely on — the lazy behaviour itself
 * belongs to `PageList.test.tsx`, which drives the same hook through a
 * controllable double, and duplicating it here would be a second set of
 * assertions about one mechanism.
 */

/** Every rasterisation, as `[pdfjsPage, scale]`. */
const rasterised: [number, number][] = [];

vi.mock('./renderPage.js', () => ({
  renderPage: (_document: unknown, pdfjsPage: number, _canvas: unknown, scale: number) => {
    rasterised.push([pdfjsPage, scale]);
    return Promise.resolve({ width: 600 * scale, height: 800 * scale });
  },
}));

beforeEach(() => {
  rasterised.length = 0;
  const target: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  target.IntersectionObserver = class {
    observe(): void {
      // Never fires; the hook's seed is what makes the first page draw.
    }
    unobserve(): void {
      // Unused here.
    }
    disconnect(): void {
      // Unused here.
    }
  } as unknown as typeof IntersectionObserver;
});

function view(): DocumentView {
  return { document: { numPages: 4 }, close: () => Promise.resolve() } as unknown as DocumentView;
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe('Thumbnails', () => {
  it('renders a control per page, named by the number a person reads', () => {
    const { container } = render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(4);
    // PDF.JS'S NUMBERING, which is what a reader sees. Asserting the converted
    // label is what catches an off-by-one that a count alone would miss, and
    // this build has shipped that off-by-one once.
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toStrictEqual([
      'Page 1',
      'Page 2',
      'Page 3',
      'Page 4',
    ]);
  });

  it('CLICKING JUMPS, with the zero-based index the kernel counts in', () => {
    // The whole reason a thumbnail is a button: a strip that only displayed
    // would be the display-only defect. And the number matters — the label
    // says "Page 3" and the jump says 2, which is the correspondence
    // `pageNumbering.ts` owns.
    const jump = vi.fn();
    const { container } = render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={0} onJump={jump} />
      </Wrapped>,
    );

    container.querySelectorAll('button')[2]?.click();
    expect(jump).toHaveBeenCalledWith(2);
  });

  it('marks the page the reader is on, and marks only that one', () => {
    const { container } = render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={2} onJump={vi.fn()} />
      </Wrapped>,
    );

    const marked = [...container.querySelectorAll('button')].filter(
      (button) => button.getAttribute('aria-current') === 'true',
    );
    // ONE, not "at least one": a strip that marked everything is as useless as
    // one that marked nothing, and only a count separates them.
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute('aria-label')).toBe('Page 3');
  });

  it('draws only what is visible, and at a scale that fits the column', () => {
    render(
      <Wrapped>
        <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );

    // ONE PAGE, not four. A strip that rasterised its whole document at open is
    // the cost lazy rendering exists to prevent, and with four pages the
    // difference is visible in this list.
    expect(rasterised.map(([page]) => page)).toStrictEqual([1]);
    // Scale 1 first, because the page's own size is what the fitting scale is
    // computed from — a strip that assumed a size would be wrong for every
    // document that is not the one it was written against.
    expect(rasterised[0]?.[1]).toBe(1);
  });

  it('draws NOTHING before the parser is open', () => {
    // The control for the case above: `[1]` is only meaningful if a strip with
    // no view produces `[]` rather than the same list for a different reason.
    render(
      <Wrapped>
        <Thumbnails view={undefined} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );

    expect(rasterised).toStrictEqual([]);
  });

  describe('drag-reorder', () => {
    /**
     * Renders a draggable strip, with an accessor that THROWS for a missing
     * thumbnail rather than the file's `?.` idiom — every case below asserts
     * that a spy was or was not called, and `undefined?.dispatchEvent()` calls
     * nothing, which is indistinguishable from the control passing.
     */
    function strip(): {
      readonly at: (index: number) => HTMLButtonElement;
      readonly move: ReturnType<typeof vi.fn>;
    } {
      const move = vi.fn();
      const { container } = render(
        <Wrapped>
          <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} onMove={move} />
        </Wrapped>,
      );
      const buttons = [...container.querySelectorAll('button')];
      return {
        at: (index) => {
          const button = buttons[index];
          if (button === undefined) throw new Error(`the strip has no thumbnail ${String(index)}`);
          return button;
        },
        move,
      };
    }

    it('DROPPING ONE PAGE ON ANOTHER dispatches the move, in destination-frame indices', () => {
      // The UI half of the wired pair. The kernel half proves `movePage`
      // reorders and survives a save; this proves the control sends exactly
      // that command with exactly those numbers — and the numbers are the
      // point, because a strip that sent the drop target's neighbour would look
      // right on the first drag of a four-page document.
      const { at, move } = strip();

      fireEvent.dragStart(at(0));
      fireEvent.drop(at(2));

      expect(move).toHaveBeenCalledWith(0, 2);
    });

    it('CONTROL: dropping a page on ITSELF dispatches nothing', () => {
      // `movePage` accepts it and inverts to a no-op, so this is not about
      // correctness of the command — it is about not putting an undo step in
      // the log for a reader who changed their mind mid-drag.
      const { at, move } = strip();

      fireEvent.dragStart(at(1));
      fireEvent.drop(at(1));

      expect(move).not.toHaveBeenCalled();
    });

    it('CONTROL: a drop with no drag before it dispatches nothing', () => {
      // A drop can arrive from outside the strip — a file, another window — and
      // reordering to a source index the strip never recorded would move a page
      // the reader never picked up.
      const { at, move } = strip();

      fireEvent.drop(at(2));

      expect(move).not.toHaveBeenCalled();
    });

    it('MOVES BY KEYBOARD, because a drag is mouse-only', () => {
      // B9: a11y is substrate. There is no keyboard sequence that produces
      // `dragstart`, so a reorder available solely by dragging is a mutation a
      // keyboard user cannot perform — a defect rather than a gap.
      const { at, move } = strip();

      fireEvent.keyDown(at(2), { key: 'ArrowUp', altKey: true });
      expect(move).toHaveBeenCalledWith(2, 1);

      fireEvent.keyDown(at(2), { key: 'ArrowDown', altKey: true });
      expect(move).toHaveBeenLastCalledWith(2, 3);
    });

    it('CONTROL: the chord needs Alt, and stops at both ends', () => {
      // Without the modifier this would hijack the arrows the strip's own focus
      // movement uses; without the bounds it would dispatch a move to -1, which
      // the schema refuses and the reader experiences as a control that
      // sometimes errors.
      const { at, move } = strip();

      fireEvent.keyDown(at(2), { key: 'ArrowUp' });
      fireEvent.keyDown(at(0), { key: 'ArrowUp', altKey: true });
      fireEvent.keyDown(at(3), { key: 'ArrowDown', altKey: true });

      expect(move).not.toHaveBeenCalled();
    });

    it('CONTROL: a strip with no onMove is NOT draggable', () => {
      // A draggable control whose drop did nothing is the display-only defect
      // with a grab cursor on it. The compare pane's second view is the caller
      // this exists for.
      const { container } = render(
        <Wrapped>
          <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} />
        </Wrapped>,
      );

      expect([...container.querySelectorAll('button')].every((b) => b.draggable)).toBe(false);
    });
  });

  describe('swap', () => {
    /** A strip whose current page is 1, so `current` is not the index clicked. */
    function swappable(): {
      readonly at: (index: number) => HTMLButtonElement;
      readonly swap: ReturnType<typeof vi.fn>;
      readonly jump: ReturnType<typeof vi.fn>;
    } {
      const swap = vi.fn();
      const jump = vi.fn();
      const { container } = render(
        <Wrapped>
          {/* CURRENT IS 1, NOT 0. With the current page at index 0 a handler
              that sent `(page, page)` or `(0, page)` would pass every case
              below — the same reason the command fixtures do not sit on the
              first page. */}
          <Thumbnails view={view()} pageCount={4} current={1} onJump={jump} onSwap={swap} />
        </Wrapped>,
      );
      const buttons = [...container.querySelectorAll('button')];
      return {
        at: (index) => {
          const button = buttons[index];
          if (button === undefined) throw new Error(`the strip has no thumbnail ${String(index)}`);
          return button;
        },
        swap,
        jump,
      };
    }

    it('SHIFT+CLICK swaps the clicked page with the one being read', () => {
      // The UI half of swap's pair; `pageOrder.test.ts` is the kernel half and
      // says the exchange survives a save. Both arguments are asserted: a
      // handler that sent the clicked index twice, or the current page twice,
      // would exchange nothing and look identical from here.
      const { at, swap, jump } = swappable();

      fireEvent.click(at(3), { shiftKey: true });

      expect(swap).toHaveBeenCalledWith(1, 3);
      // AND IT DID NOT ALSO JUMP. Shift+click is one gesture with one meaning;
      // navigating as well would move the reader off the page they were
      // comparing against, which is the page they just swapped.
      expect(jump).not.toHaveBeenCalled();
    });

    it('THE KEYBOARD PATH IS THE SAME HANDLER, because a button click carries the modifier', () => {
      // B9, and the reason there is no second handler to keep in step:
      // Shift+Enter on a focused button dispatches a click with `shiftKey` set,
      // so the keyboard route is not a parallel implementation of this one.
      const { at, swap } = swappable();

      at(3).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

      expect(swap).toHaveBeenCalledWith(1, 3);
    });

    it('CONTROL: a plain click still jumps, and swaps nothing', () => {
      const { at, swap, jump } = swappable();

      fireEvent.click(at(3));

      expect(jump).toHaveBeenCalledWith(3);
      expect(swap).not.toHaveBeenCalled();
    });

    it('CONTROL: shift-clicking the CURRENT page dispatches nothing', () => {
      // `swapPages` accepts it and inverts to a no-op, so this is not about the
      // command being wrong — it is about not putting an undo step in the log
      // for a document that did not change.
      const { at, swap, jump } = swappable();

      fireEvent.click(at(1), { shiftKey: true });

      expect(swap).not.toHaveBeenCalled();
      // AND IT DID NOT FALL THROUGH TO A JUMP either: the gesture was a swap
      // that declined itself, not a navigation.
      expect(jump).not.toHaveBeenCalled();
    });

    it('CONTROL: a strip with no onSwap treats shift+click as an ordinary click', () => {
      // The compare pane's second view again. A gesture that silently did
      // nothing there would be the display-only defect without even a control
      // to point at.
      const jump = vi.fn();
      const { container } = render(
        <Wrapped>
          <Thumbnails view={view()} pageCount={4} current={1} onJump={jump} />
        </Wrapped>,
      );
      const third = [...container.querySelectorAll('button')][3];
      if (third === undefined) throw new Error('the strip has no thumbnail 3');

      fireEvent.click(third, { shiftKey: true });

      expect(jump).toHaveBeenCalledWith(3);
    });
  });
});
