// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { BlockFormatting } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BlockCommit } from '../commands/documentCommands.js';
import { NO_BLOCK_FACES } from '../commands/documentCommands.js';
import { pointOf } from '../editorKit/dom.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import type { TextBlock } from '../textBlock.js';
import type { PageBlocks } from './editing.js';
import { EditTextLayer } from './EditTextLayer.js';

/**
 * The rebuilt editor's gestures on a block's BOX (ADR-0271 section 3): its handles and keys, its removal, Escape inside
 * an input method's composition, and a write that rejects. Each is observed where it leaves the editor — the one
 * `onCommit` a finish sends, and the formatting's `place` in it — because the placement shown on screen is a CSS
 * transform the writer never reads.
 */

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
/** One block 228 points wide (72 to 300) and 14 tall, on an upright page at zoom 1: a screen pixel is a point. */
const BLOCK: TextBlock = {
  box: box(72, 686, 300, 700),
  lines: [{ runs: [{ index: 1, text: 'Garden club', style: STYLE }], box: box(72, 686, 300, 700), soft: false, baseline: 689 }],
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
};
const BLOCKS: PageBlocks = {
  version: asDocVersion(3),
  blocks: [BLOCK],
  truncated: false,
  unaddressable: 0,
  rewrite: 'objects',
};
const GEOMETRY = { crop: [0, 0, 612, 792] as const, rotation: 0, zoom: 1 };

/** The element, or a failure naming what was missing. */
function must<T>(found: T | null | undefined, what: string): T {
  if (found === null || found === undefined) throw new Error(`no ${what}`);
  return found;
}

beforeAll(() => {
  activateCatalogue('en', EN);
});
afterEach(() => {
  cleanup();
});

/** The layer over BLOCK with its box selected by a first press, every commit kept with its formatting. */
function opened(commit: () => Promise<BlockCommit> = () => Promise.resolve('written')) {
  const onCommit = vi.fn((_block: TextBlock, _text: string, _read: unknown, _formatting?: BlockFormatting) => commit());
  const onHolding = vi.fn();
  const view = render(
    <I18nProvider i18n={i18n}>
      <EditTextLayer
        blocks={BLOCKS}
        geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
        onCommit={onCommit}
        onHolding={onHolding}
        onLeave={vi.fn()}
        page={0}
        paperAt={() => undefined}
        blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
      />
    </I18nProvider>,
  );
  fireEvent.click(must(view.container.querySelector<HTMLElement>('[data-text-block="0"]'), 'outline'), { detail: 1 });
  const frame = () => view.container.querySelector<HTMLElement>('[data-kit-frame]');
  const surface = () => must(view.container.querySelector<HTMLElement>('[data-kit-surface]'), 'surface');
  const placer = () => must(view.container.querySelector<HTMLElement>('.m-kit-placer'), 'placer');
  const handle = (name: string) => {
    const found = must(frame()?.querySelector<HTMLElement>(`[data-handle="${name}"]`), `handle ${name}`);
    // POINTER CAPTURE IS THE BROWSER'S, which happy-dom does not keep; the drag reads only the pointer's coordinates.
    found.setPointerCapture = vi.fn();
    found.releasePointerCapture = vi.fn();
    return found;
  };
  /** A press on handle `name` and a move of (dx, dy) screen pixels, left held. */
  const press = (name: string, dx: number, dy: number) => {
    const grip = handle(name);
    act(() => {
      fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(grip, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
    });
    return grip;
  };
  /** A whole drag: pressed, moved and let go. */
  const drag = (name: string, dx: number, dy: number) => {
    const grip = press(name, dx, dy);
    act(() => {
      fireEvent.pointerUp(grip, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
    });
  };
  /** Escape on whatever holds the editor's focus: the frame for the box, the words for a caret. */
  const escape = async (on: HTMLElement = must(frame(), 'frame'), init: KeyboardEventInit = {}) => {
    await act(async () => {
      fireEvent.keyDown(on, { key: 'Escape', ...init });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const sent = () => onCommit.mock.calls.map(([, text, , formatting]) => ({ text, formatting }));
  return { view, onCommit, onHolding, frame, surface, placer, press, drag, escape, sent };
}

/** Types `text` at a model position, as the browser's input would arrive. */
function typeAt(surface: HTMLElement, text: string, at: { paragraph: number; offset: number }): void {
  surface.focus();
  const point = pointOf(surface, at);
  if (point === undefined) throw new Error('no point');
  surface.ownerDocument.getSelection()?.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
  surface.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
}

describe('placing a block by its handles and keys (ADR-0180, ADR-0271 section 3)', () => {
  it('the move grip moves the block by the drag, the screen’s y running down where the page’s runs up, sent in the one finish', async () => {
    const { drag, escape, onCommit, sent } = opened();
    drag('n', 10, -5);
    // THE DRAG WRITES NOTHING: the place leaves with the finish.
    expect(onCommit).not.toHaveBeenCalled();
    await escape();
    expect(sent()).toStrictEqual([{ text: 'Garden club', formatting: { place: { move: { x: 10, y: 5 } } } }]);
  });

  it('a corner scales the block by the share of its width the corner was dragged, the opposite corner held', async () => {
    const { drag, escape, sent } = opened();
    // 114 OF 228 POINTS out at the south-east corner is half as large again; the north-west corner stays, so no move.
    drag('se', 114, 0);
    await escape();
    expect(sent()).toStrictEqual([{ text: 'Garden club', formatting: { place: { scale: 1.5 } } }]);
  });

  it('the turn handle turns the block to the angle the pointer is at about its centre', async () => {
    const { drag, escape, sent } = opened();
    // THE HANDLE STARTS 20 BEYOND THE RIGHT EDGE, 134 from the middle of a block 228 wide; moved left over the middle and
    // up as far, it stands straight above the centre: a quarter turn counter-clockwise.
    drag('r', -134, -134);
    await escape();
    const [only] = sent();
    expect(Object.keys(only?.formatting?.place ?? {})).toStrictEqual(['rotate']);
    expect(only?.formatting?.place?.rotate).toBeCloseTo(90, 6);
  });

  it('CONTROL: with no handle touched the finish carries no place, so the cases above are the handles’', async () => {
    const { escape, sent } = opened();
    await escape();
    expect(sent()).toStrictEqual([{ text: 'Garden club', formatting: {} }]);
  });

  it('shows the placement over the words WHILE the drag is made, before any finish, and not before the drag', () => {
    const { placer, press, onCommit } = opened();
    expect(placer().dataset['placed']).toBeUndefined();
    expect(placer().style.transform.startsWith('translate(0px, 0px)')).toBe(true);
    press('n', 10, -5);
    // STILL HELD: the pointer has not been let go, and nothing is written.
    expect(placer().dataset['placed']).toBe('');
    expect(placer().style.transform.startsWith('translate(10px, -5px)')).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Alt with an arrow nudges the block a point, with Shift ten, up the page for ArrowUp, sent in the one finish', async () => {
    const { frame, escape, onCommit, sent } = opened();
    act(() => {
      fireEvent.keyDown(must(frame(), 'frame'), { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(must(frame(), 'frame'), { key: 'ArrowUp', altKey: true, shiftKey: true });
    });
    expect(onCommit).not.toHaveBeenCalled();
    await escape();
    expect(sent()).toStrictEqual([{ text: 'Garden club', formatting: { place: { move: { x: 1, y: 10 } } } }]);
  });
});

describe('removing a block from its box (ADR-0096 Decision 5)', () => {
  for (const key of ['Delete', 'Backspace']) {
    it(`${key} on the selected box removes the block: its words go, as one write of no text`, async () => {
      const { frame, onCommit, sent } = opened();
      expect(frame()?.dataset['kitMode']).toBe('box');
      await act(async () => {
        fireEvent.keyDown(must(frame(), 'frame'), { key });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(sent()).toStrictEqual([{ text: '', formatting: {} }]);
    });
  }
});

describe('Escape inside an input method’s composition (CR-COR-07)', () => {
  it('does not finish the editor while a composition is open, and does once it has closed', async () => {
    const { frame, surface, escape, onCommit, sent } = opened();
    act(() => {
      fireEvent.keyDown(must(frame(), 'frame'), { key: 'Enter' });
    });
    act(() => {
      typeAt(surface(), ' news', { paragraph: 0, offset: 11 });
    });
    // THE INPUT METHOD'S OWN ESCAPE, which cancels its candidate: the words are not finished under it.
    await escape(surface(), { isComposing: true });
    expect(onCommit).not.toHaveBeenCalled();
    expect(frame()).not.toBeNull();
    // CONTROL: the same key with the composition closed finishes, so the case above is the composition's. THE BLOCK IS ONE
    // LINE, so its changed words carry the reach it was laid out to (`oneLineReach`: alone on the page, the margin mirrored).
    await escape(surface());
    expect(sent()).toStrictEqual([{ text: 'Garden club news', formatting: { place: { reach: 540 } } }]);
  });
});

describe('a write that rejects frees the editor (CR-COR-13)', () => {
  it('a commit whose promise REJECTS keeps the words with a refusal beside them, the editor no longer busy, and Escape then puts them back', async () => {
    const { frame, surface, escape, onCommit } = opened(() => Promise.reject(new Error('the host went away')));
    act(() => {
      fireEvent.keyDown(must(frame(), 'frame'), { key: 'Enter' });
    });
    act(() => {
      typeAt(surface(), '!', { paragraph: 0, offset: 11 });
    });
    await escape(surface());
    expect(onCommit).toHaveBeenCalledTimes(1);
    // SAID AS A REFUSAL, beside the words that were typed.
    expect(frame()?.querySelector('[role="alert"]')?.textContent ?? '').not.toBe('');
    expect(surface().textContent).toBe('Garden club!');
    // THE DECISION: the editor is FREE again — not busy, and its words editable — rather than locked for good.
    expect(frame()?.getAttribute('aria-busy')).toBe('false');
    expect(surface().getAttribute('aria-readonly')).toBe('false');
    expect(must(frame()?.querySelector<HTMLButtonElement>('[data-handle="n"]'), 'move grip').disabled).toBe(false);
    // AND ESCAPE IS THE REFUSAL'S: it puts the words back, writing nothing more.
    await escape(surface());
    expect(frame()).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  /**
   * The layer open with a write that answers only when `answer` is called, so the hold while it is in flight is seen
   * (an answer in the same tick lets React batch the hold and its release into one render, and nothing is reported).
   */
  async function inFlight(answer: (settle: { resolve: (outcome: BlockCommit) => void; reject: (error: Error) => void }) => void) {
    const pending: { resolve?: (outcome: BlockCommit) => void; reject?: (error: Error) => void } = {};
    const made = opened(
      () =>
        new Promise<BlockCommit>((resolve, reject) => {
          pending.resolve = resolve;
          pending.reject = reject;
        }),
    );
    act(() => {
      fireEvent.keyDown(must(made.frame(), 'frame'), { key: 'Enter' });
    });
    act(() => {
      typeAt(made.surface(), '!', { paragraph: 0, offset: 11 });
    });
    await made.escape(made.surface());
    // HELD WHILE THE WRITE IS IN FLIGHT: the page keeps the read the editor's indices describe.
    expect(made.onHolding).toHaveBeenLastCalledWith(BLOCKS.version);
    await act(async () => {
      answer({ resolve: (outcome) => pending.resolve?.(outcome), reject: (error) => pending.reject?.(error) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(made.frame()?.querySelector('[role="alert"]')).not.toBeNull();
    return made;
  }

  it('CONTROL: a commit that resolves to a refusal lets go of the page’s read at the answer, while the editor stays', async () => {
    const { onHolding } = await inFlight(({ resolve }) => {
      resolve({ refused: { code: 'internal', incident: 'test' } });
    });
    expect(onHolding).toHaveBeenLastCalledWith(undefined);
  });

  // `EditTextLayer`'s `onCommit` set `committing` before `await onCommit(...)` and cleared it only after a RESOLVED answer,
  // so a rejection skipped the clear and the page kept holding its read until the editor closed (found writing this
  // file, 2026-10-27). A rejection now clears it and is thrown on to the editor, which says it beside the words.
  it('a commit that REJECTS lets go of the page’s read at the answer as a refusal does, while the editor stays', async () => {
    const { onHolding } = await inFlight(({ reject }) => {
      reject(new Error('the host went away'));
    });
    expect(onHolding).toHaveBeenLastCalledWith(undefined);
  });
});
