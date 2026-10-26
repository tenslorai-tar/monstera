// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { pointOf, positionOf } from './dom.js';
import { EditorSurface } from './EditorSurface.js';
import { type Model, type Paragraph, type RunStyle, caret, modelText } from './model.js';
import type { Look } from './paint.js';
import { createEditorStore } from './store.js';

const BODY: RunStyle = {
  face: 'Body',
  size: 10,
  colour: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  rise: 'none',
  lift: 0,
  spacing: 0,
  highlight: null,
};
const BOLD: RunStyle = { ...BODY, bold: true };
const SET = { align: 'left', lineSpacing: 1, spaceBefore: 0, spaceAfter: 0, firstIndent: 0, leftIndent: 0 } as const;
const FIRST: Paragraph = { ...SET, runs: [{ text: 'A ', style: BODY }, { text: 'bold', style: BOLD }, { text: ' word', style: BODY }] };
const SECOND: Paragraph = { ...SET, runs: [{ text: 'Second line', style: BODY }] };
const MODEL: Model = { paragraphs: [FIRST, SECOND] };
const LOOK: Look = { zoom: 2, pitch: 12, faceCss: (style) => `"${style.face}"` };

function surface(drawn?: { paragraphs: readonly Paragraph[]; wraps: readonly (readonly number[])[] }) {
  const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 0 }) });
  const view = render(<EditorSurface drawn={drawn} editable label="Words" look={LOOK} store={store} />);
  const root = view.container.querySelector<HTMLElement>('[data-kit-surface]');
  if (root === null) throw new Error('no surface');
  return { store, root, view };
}

/** Sends the input a browser sends for a key, with the browser's selection put at `at` first. */
function input(root: HTMLElement, inputType: string, data: string | null, at: { paragraph: number; offset: number }): InputEvent {
  root.focus();
  const point = pointOf(root, at);
  if (point === undefined) throw new Error('no point');
  root.ownerDocument.getSelection()?.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
  const event = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
  root.dispatchEvent(event);
  return event;
}

describe('the kit’s editable surface', () => {
  it('draws a paragraph per element and a run per span, in the run’s style at the zoom', () => {
    const { root } = surface();
    const paragraphs = root.querySelectorAll('[data-kit-paragraph]');
    expect(paragraphs).toHaveLength(2);
    const spans = paragraphs[0]?.querySelectorAll('span') ?? [];
    expect(Array.from(spans, (span) => span.textContent)).toStrictEqual(['A ', 'bold', ' word']);
    expect((spans[1] as HTMLElement | undefined)?.style.fontWeight).toBe('700');
    expect((spans[1] as HTMLElement | undefined)?.style.fontSize).toBe('20px');
  });

  it('maps a model position to the browser’s point and back, at a run’s end standing in the run before it', () => {
    const { root } = surface();
    const point = pointOf(root, { paragraph: 0, offset: 6 });
    expect(point?.node.textContent).toBe('bold');
    expect(point === undefined ? undefined : positionOf(root, point.node, point.offset)).toStrictEqual({ paragraph: 0, offset: 6 });
    expect(positionOf(root, root, 2)).toStrictEqual({ paragraph: 1, offset: 11 });
  });

  it('cancels every input and makes it in the model: typing takes the style of the letter before it', () => {
    const { root, store } = surface();
    let event: InputEvent | undefined;
    act(() => {
      event = input(root, 'insertText', 'er', { paragraph: 0, offset: 6 });
    });
    expect(event?.defaultPrevented).toBe(true);
    expect(modelText(store.get().model)).toBe('A bolder word\nSecond line');
    // DRAWN FROM THE MODEL: the typed letters are in the bold span.
    expect(root.querySelectorAll('[data-kit-paragraph]')[0]?.querySelectorAll('span')[1]?.textContent).toBe('bolder');
    act(() => {
      input(root, 'insertParagraph', null, { paragraph: 1, offset: 6 });
    });
    expect(modelText(store.get().model)).toBe('A bolder word\nSecond\n line');
    act(() => {
      input(root, 'deleteContentBackward', null, { paragraph: 2, offset: 0 });
    });
    expect(modelText(store.get().model)).toBe('A bolder word\nSecond line');
  });

  it('keeps an unchanged paragraph’s element, and draws again only the one that changed', () => {
    const { root } = surface();
    const [first, second] = Array.from(root.querySelectorAll('[data-kit-paragraph]'));
    act(() => {
      input(root, 'insertText', 'X', { paragraph: 0, offset: 1 });
    });
    const [firstAfter, secondAfter] = Array.from(root.querySelectorAll('[data-kit-paragraph]'));
    expect(secondAfter).toBe(second);
    expect(firstAfter).not.toBe(first);
  });

  it('draws a new look (the faces arrived, the zoom moved) on THE SAME NODES, so a press in flight keeps its target', () => {
    // THE CONTROL is the surface before this: a new look built every paragraph again, and a press landing as the fonts
    // loaded hit a detached node, was judged outside the editor and finished it (`restyleParagraph`).
    const store = createEditorStore({ model: MODEL, selection: caret({ paragraph: 0, offset: 0 }) });
    const view = render(<EditorSurface editable label="Words" look={LOOK} store={store} />);
    const before = Array.from(view.container.querySelectorAll('[data-kit-paragraph]'));
    const span = before[0]?.querySelectorAll('span')[1];
    view.rerender(<EditorSurface editable label="Words" look={{ ...LOOK, zoom: 3 }} store={store} />);
    const after = Array.from(view.container.querySelectorAll('[data-kit-paragraph]'));
    expect(after).toStrictEqual(before);
    expect(after[0]?.querySelectorAll('span')[1]).toBe(span);
    expect((span as HTMLElement | undefined)?.style.fontSize).toBe('30px');
  });

  it('lays a paragraph still as drawn at the drawing’s breaks, unpainted, and paints it once it changes', () => {
    const { root } = surface({ paragraphs: MODEL.paragraphs, wraps: [[2], []] });
    const first = root.querySelectorAll('[data-kit-paragraph]')[0];
    expect(first?.classList.contains('m-kit__paragraph--as-drawn')).toBe(true);
    expect(first?.querySelectorAll('br[data-kit-wrap]')).toHaveLength(1);
    act(() => {
      input(root, 'insertText', 'X', { paragraph: 0, offset: 1 });
    });
    const changed = root.querySelectorAll('[data-kit-paragraph]')[0];
    expect(changed?.classList.contains('m-kit__paragraph--as-drawn')).toBe(false);
    expect(changed?.querySelectorAll('br[data-kit-wrap]')).toHaveLength(0);
  });

  it('undoes and redoes by its own history, not the browser’s', () => {
    const { root, store } = surface();
    act(() => {
      input(root, 'insertText', 'Big ', { paragraph: 1, offset: 0 });
    });
    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(modelText(store.get().model)).toBe('A bold word\nSecond line');
    act(() => {
      root.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(modelText(store.get().model)).toBe('A bold word\nBig Second line');
  });
});
