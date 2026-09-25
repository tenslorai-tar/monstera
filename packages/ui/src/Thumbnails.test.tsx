// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
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
const rasterised: [number, number | { readonly fitWidth: number }][] = [];
/** The signal each draw was handed, in order — what a superseded draw is cancelled through. */
const signals: AbortSignal[] = [];
/** The rotation each rasterisation was handed, in the same order. */
const drawnAt: (number | undefined)[] = [];

vi.mock('./renderPage.js', async (importOriginal) => ({
  // THE REAL MODULE UNDER THE STUB, so `RenderCancelledError` is the class callers test against.
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: (
    _document: unknown,
    pdfjsPage: number,
    _canvas: unknown,
    scale: number | { readonly fitWidth: number },
    rotation: number | undefined,
    signal: AbortSignal,
  ) => {
    rasterised.push([pdfjsPage, scale]);
    drawnAt.push(rotation);
    signals.push(signal);
    // A 600 × 800 page, fitted the way the real one fits it: from its own width.
    const factor = typeof scale === 'number' ? scale : scale.fitWidth / 600;
    return Promise.resolve({ width: 600 * factor, height: 800 * factor });
  },
}));

const DOC = asDocId('00000000-0000-4000-8000-0000000000ee');
const VERSION = asDocVersion(1);

/**
 * A client whose view model answers `turns[version]` for every page asked.
 *
 * Keyed by VERSION because the defect has two halves: a strip that never asks
 * draws the page's stored `/Rotate`, and a strip that asks once draws the
 * rotation the page had before the last command.
 */
function clientAnswering(turns: Readonly<Record<number, number>>): {
  readonly client: ContractClient;
  readonly asked: unknown[];
} {
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.viewModel') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    const pages = (params as { pages: readonly number[] }).pages;
    const version = latestVersion;
    return Promise.resolve(
      ok({ version, pageCount: 4, rotations: pages.map(() => turns[version] ?? 0) }),
    );
  });
  return { client, asked };
}

/** The version the double answers as, moved by a case that bumps the document. */
let latestVersion = VERSION;

/** The props every strip needs to read the model, for cases not about it. */
function reads(): { client: ContractClient; docId: typeof DOC; version: typeof VERSION } {
  return { client: clientAnswering({}).client, docId: DOC, version: VERSION };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  rasterised.length = 0;
  drawnAt.length = 0;
  signals.length = 0;
  latestVersion = VERSION;
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

describe('Thumbnails as the Organize grid (ADR-0104)', () => {
  /** A grid whose selection is held here, as the document store holds it, so a gesture's result is visible. */
  function grid(selected: readonly number[] = []) {
    const calls = { select: [] as (readonly number[])[], open: [] as number[], remove: [] as (readonly number[])[], jump: [] as number[], swap: 0 };
    const { container, rerender } = render(
      <Wrapped>
        <Thumbnails
          {...reads()}
          view={view()}
          pageCount={4}
          current={0}
          onJump={(page) => calls.jump.push(page)}
          onSwap={() => {
            calls.swap += 1;
          }}
          grid={{
            width: 110,
            selected,
            onSelect: (pages) => calls.select.push(pages),
            onOpen: (page) => calls.open.push(page),
            onDelete: (pages) => calls.remove.push(pages),
          }}
        />
      </Wrapped>,
    );
    const card = (page: number): HTMLElement => {
      const found = container.querySelector<HTMLElement>(`[data-thumb-page="${String(page)}"]`);
      if (found === null) throw new Error(`no card for page ${String(page)}`);
      return found;
    };
    return { calls, card, container, rerender };
  }

  it('a click SELECTS the page and does not jump; Ctrl+click toggles; Shift+click extends from the last click', () => {
    const { calls, card } = grid([2]);
    fireEvent.click(card(1));
    // THE ANCHOR is page 1 now, so Shift+click on 3 takes 1 to 3 — and swaps nothing, which Shift means in the strip.
    fireEvent.click(card(3), { shiftKey: true });
    fireEvent.click(card(2), { ctrlKey: true });
    fireEvent.click(card(0), { ctrlKey: true });
    expect(calls.select).toStrictEqual([[1], [1, 2, 3], [], [2, 0]]);
    expect(calls.jump).toStrictEqual([]);
    expect(calls.swap).toBe(0);
  });

  it('draws the ticked pages as ticked, and announces each card’s state', () => {
    const { container } = grid([1, 3]);
    const cards = [...container.querySelectorAll('button')];
    expect(cards.map((button) => button.getAttribute('aria-pressed'))).toStrictEqual(['false', 'true', 'false', 'true']);
    expect(cards.map((button) => button.classList.contains('is-selected'))).toStrictEqual([false, true, false, true]);
  });

  it('Enter and a double-click OPEN a page; Delete removes the ticked ones, or the focused one with none ticked', () => {
    const ticked = grid([0, 2]);
    fireEvent.keyDown(ticked.card(1), { key: 'Enter' });
    fireEvent.doubleClick(ticked.card(3));
    fireEvent.keyDown(ticked.card(1), { key: 'Delete' });
    expect(ticked.calls.open).toStrictEqual([1, 3]);
    expect(ticked.calls.remove).toStrictEqual([[0, 2]]);
    // ENTER DOES NOT ALSO SELECT: it is prevented, so the button's own click does not follow it.
    expect(ticked.calls.select).toStrictEqual([]);
  });

  it('CONTROL: the side strip — no grid — jumps on click, swaps on Shift+click, and Delete does nothing', () => {
    const jumps: number[] = [];
    let swaps = 0;
    const { container } = render(
      <Wrapped>
        <Thumbnails
          {...reads()}
          view={view()}
          pageCount={4}
          current={0}
          onJump={(page) => jumps.push(page)}
          onSwap={() => {
            swaps += 1;
          }}
        />
      </Wrapped>,
    );
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2] as Element);
    fireEvent.click(buttons[3] as Element, { shiftKey: true });
    fireEvent.keyDown(buttons[1] as Element, { key: 'Delete' });
    expect(jumps).toStrictEqual([2]);
    expect(swaps).toBe(1);
    expect([...buttons].map((button) => button.getAttribute('aria-pressed'))).toStrictEqual([null, null, null, null]);
  });
});

describe('Thumbnails', () => {
  it('renders a control per page, named by the number a person reads', () => {
    const { container } = render(
      <Wrapped>
        <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={vi.fn()} />
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
        <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={jump} />
      </Wrapped>,
    );

    container.querySelectorAll('button')[2]?.click();
    expect(jump).toHaveBeenCalledWith(2);
  });

  it('marks the page the reader is on, and marks only that one', () => {
    const { container } = render(
      <Wrapped>
        <Thumbnails {...reads()} view={view()} pageCount={4} current={2} onJump={vi.fn()} />
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

  it('draws only what is visible, and at a scale that fits the column', async () => {
    render(
      <Wrapped>
        <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    // Nothing draws before the view model answers for the page — the rotation
    // cases below are why.
    expect(rasterised).toStrictEqual([]);
    await settle();

    // ONE PAGE, not four. A strip that rasterised its whole document at open is
    // the cost lazy rendering exists to prevent, and with four pages the
    // difference is visible in this list.
    expect(new Set(rasterised.map(([page]) => page))).toStrictEqual(new Set([1]));
    // ONE DRAW, ASKED TO FIT THE COLUMN — the width comes from the page's own viewport inside
    // `renderPage`. It drew at scale 1 and then again, and the first pass is what a superseded
    // draw left on the canvas after every command (2026-09-18); a second entry here is that.
    expect(rasterised).toStrictEqual([[1, { fitWidth: 96 }]]);
  });

  it('THUMBNAIL SIZE: draws at the size’s width and lays the strip in its columns, and a new size REDRAWS', async () => {
    const theView = view();
    const strip = (size: 'small' | 'large'): ReactElement => (
      <Wrapped>
        <Thumbnails {...reads()} view={theView} pageCount={4} current={0} onJump={vi.fn()} size={size} />
      </Wrapped>
    );
    const { container, rerender } = render(strip('large'));
    await settle();

    const nav = container.querySelector<HTMLElement>('.m-thumbnails');
    expect(nav?.style.getPropertyValue('--m-thumb-columns')).toBe('1');
    expect(nav?.style.getPropertyValue('--m-thumb-width')).toBe('160px');
    expect(rasterised).toStrictEqual([[1, { fitWidth: 160 }]]);

    rerender(strip('small'));
    await settle();

    // DRAWN AGAIN at the new width, not the large picture squeezed: a stretched canvas is a blurred one.
    expect(nav?.style.getPropertyValue('--m-thumb-columns')).toBe('3');
    expect(rasterised.at(-1)).toStrictEqual([1, { fitWidth: 60 }]);
  });

  it('CANCELS the earlier draw when the view is replaced, so the redraw can have the canvas', async () => {
    // A command replaces the view; PDF.js refuses a render on a canvas an earlier one still holds,
    // and cancelling through the signal is what releases it. The call made is the assertion — an
    // end state cannot show it, because a stub draws nothing and holds no canvas.
    const { rerender } = render(
      <Wrapped>
        <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(signals).toHaveLength(1);
    // CONTROL: a draw nothing replaced is not cancelled.
    expect(signals[0]?.aborted).toBe(false);

    rerender(
      <Wrapped>
        <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('draws NOTHING before the parser is open', () => {
    // The control for the case above: `[1]` is only meaningful if a strip with
    // no view produces `[]` rather than the same list for a different reason.
    render(
      <Wrapped>
        <Thumbnails {...reads()} view={undefined} pageCount={4} current={0} onJump={vi.fn()} />
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
          <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={vi.fn()} onMove={move} />
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
          <Thumbnails {...reads()} view={view()} pageCount={4} current={0} onJump={vi.fn()} />
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
          <Thumbnails {...reads()} view={view()} pageCount={4} current={1} onJump={jump} onSwap={swap} />
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
          <Thumbnails {...reads()} view={view()} pageCount={4} current={1} onJump={jump} />
        </Wrapped>,
      );
      const third = [...container.querySelectorAll('button')][3];
      if (third === undefined) throw new Error('the strip has no thumbnail 3');

      fireEvent.click(third, { shiftKey: true });

      expect(jump).toHaveBeenCalledWith(3);
    });
  });

  describe('rotation', () => {
    it('DRAWS AT THE VIEW MODEL’S ROTATION, not at the rotation the file opened with', async () => {
      // THE DEFECT, found in a live run: a page rotated in the document showed
      // turned in the spine and upright in this strip. The strip handed the
      // rasteriser no rotation, so PDF.js drew the page's stored `/Rotate` —
      // which is the rotation the document was OPENED at, not the one it has.
      const { client, asked } = clientAnswering({ 1: 90 });
      render(
        <Wrapped>
          <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} client={client} docId={DOC} version={VERSION} />
        </Wrapped>,
      );
      await settle();

      // The model was asked for the page the strip draws, and only that one (L11).
      expect(asked).toStrictEqual([{ docId: DOC, pages: [0] }]);
      expect(drawnAt.length).toBeGreaterThan(0);
      expect(drawnAt.every((turns) => turns === 90)).toBe(true);
    });

    it('RE-READS when the version moves, so a rotate after opening is drawn', async () => {
      // The second half of the defect: a strip that asked once would draw the
      // page at the rotation it had BEFORE the command, which is the same
      // symptom one command later.
      const { client } = clientAnswering({ 1: 0, 2: 180 });
      const held = view();
      const { rerender } = render(
        <Wrapped>
          <Thumbnails view={held} pageCount={4} current={0} onJump={vi.fn()} client={client} docId={DOC} version={VERSION} />
        </Wrapped>,
      );
      await settle();
      expect(drawnAt.at(-1)).toBe(0);

      latestVersion = asDocVersion(2);
      rerender(
        <Wrapped>
          <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} client={client} docId={DOC} version={latestVersion} />
        </Wrapped>,
      );
      await settle();
      expect(drawnAt.at(-1)).toBe(180);
    });

    it('CONTROL: a model from ANOTHER version is not drawn with', async () => {
      // A command can bump the version while the read is in flight. The page
      // still draws — at its own `/Rotate`, which is what the renderer then
      // knows — and never at a rotation that belongs to other bytes.
      const { client } = clientAnswering({ 1: 90, 7: 270 });
      latestVersion = asDocVersion(7);
      render(
        <Wrapped>
          <Thumbnails view={view()} pageCount={4} current={0} onJump={vi.fn()} client={client} docId={DOC} version={VERSION} />
        </Wrapped>,
      );
      await settle();

      expect(drawnAt.length).toBeGreaterThan(0);
      expect(drawnAt.every((turns) => turns === undefined)).toBe(true);
    });
  });
});
