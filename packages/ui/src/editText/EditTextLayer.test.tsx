// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocVersion } from '@monstera/shared';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BlockCommit } from '../commands/documentCommands.js';
import { NO_BLOCK_FACES } from '../commands/documentCommands.js';
import { pointOf } from '../editorKit/dom.js';
import { formatOpenEditor } from '../editorKit/openEditor.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import type { TextBlock } from '../textBlock.js';
import type { PageBlocks } from './editing.js';
import { EditTextLayer, stackingOf } from './EditTextLayer.js';

const STYLE = { size: 11, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const BLOCK: TextBlock = {
  box: box(72, 686, 300, 700),
  lines: [{ runs: [{ index: 1, text: 'Garden club', style: STYLE }], box: box(72, 686, 300, 700), soft: false, baseline: 689 }],
  style: STYLE,
  shape: { align: 'left', firstIndent: 0 },
};
const OTHER: TextBlock = {
  ...BLOCK,
  box: box(72, 600, 300, 614),
  lines: [{ runs: [{ index: 2, text: 'Second', style: STYLE }], box: box(72, 600, 300, 614), soft: false, baseline: 603 }],
};

/** The element, or a failure naming what was missing. */
function must<T>(found: T | null | undefined, what: string): T {
  if (found === null || found === undefined) throw new Error(`no ${what}`);
  return found;
}
const BLOCKS: PageBlocks = {
  version: asDocVersion(3),
  blocks: [BLOCK, OTHER],
  truncated: false,
  rotated: 0,
  angled: { turned: 0, vertical: 0, slanted: 0, mirrored: 0 },
  unaddressable: 0,
  rewrite: 'objects',
};
const GEOMETRY = { crop: [0, 0, 612, 792] as const, rotation: 0, zoom: 1 };

beforeAll(() => {
  activateCatalogue('en', EN);
});
afterEach(() => {
  cleanup();
});

function layer(commit: (text: string, formatting: unknown) => Promise<BlockCommit> = () => Promise.resolve('written')) {
  const onCommit = vi.fn((_block: TextBlock, text: string, _read: unknown, formatting: unknown) => commit(text, formatting));
  const onLeave = vi.fn();
  const view = render(
    <I18nProvider i18n={i18n}>
      <EditTextLayer
        blocks={BLOCKS}
        geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
        onCommit={onCommit}
        onLeave={onLeave}
        page={0}
        paperAt={() => undefined}
        blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
      />
    </I18nProvider>,
  );
  const outline = (at: number) => {
    const found = view.container.querySelector<HTMLElement>(`[data-text-block="${String(at)}"]`);
    if (found === null) throw new Error(`no outline ${String(at)}`);
    return found;
  };
  const frame = () => view.container.querySelector<HTMLElement>('[data-kit-frame]');
  const surface = () => {
    const found = view.container.querySelector<HTMLElement>('[data-kit-surface]');
    if (found === null) throw new Error('no surface');
    return found;
  };
  return { view, onCommit, onLeave, outline, frame, surface };
}

/** Types `text` at a model position, as the browser's input would arrive. */
function typeAt(surface: HTMLElement, text: string, at: { paragraph: number; offset: number }): void {
  surface.focus();
  const point = pointOf(surface, at);
  if (point === undefined) throw new Error('no point');
  surface.ownerDocument.getSelection()?.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
  surface.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
}

describe('Edit text on the editor kit (ADR-0271)', () => {
  it('outlines every block, and a first press SELECTS THE BOX — a frame, no caret, the words unpainted', () => {
    const { outline, frame } = layer();
    expect(frame()).toBeNull();
    fireEvent.click(outline(0), { detail: 1 });
    expect(frame()?.dataset['kitMode']).toBe('box');
    expect(frame()?.ownerDocument.activeElement).toBe(frame());
    // OPENING CHANGES NOTHING VISIBLE: the paragraph is laid out over the page's own pixels, not drawn.
    expect(frame()?.querySelector('.m-kit__paragraph--as-drawn')).not.toBeNull();
    expect(frame()?.querySelectorAll('.m-kit-cover')).toHaveLength(0);
  });

  it('a second press inside the box puts the caret in the words; Enter does so at their end', () => {
    const { outline, frame, surface } = layer();
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      surface().dispatchEvent(new MouseEvent('mousedown', { detail: 1, bubbles: true, cancelable: true }));
    });
    expect(frame()?.dataset['kitMode']).toBe('text');
    cleanup();
    const second = layer();
    fireEvent.click(second.outline(0), { detail: 1 });
    act(() => {
      fireEvent.keyDown(must(second.frame(), 'frame'), { key: 'Enter' });
    });
    expect(second.frame()?.dataset['kitMode']).toBe('text');
    expect(second.surface().ownerDocument.activeElement).toBe(second.surface());
  });

  it('Escape WRITES what was typed, ONCE, as the existing wire', async () => {
    const { outline, frame, surface, onCommit } = layer();
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      typeAt(surface(), ' news', { paragraph: 0, offset: 11 });
    });
    // THE CHANGED PARAGRAPH IS DRAWN, over the page's paper.
    expect(frame()?.querySelector('.m-kit__paragraph--as-drawn')).toBeNull();
    await act(async () => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[1]).toBe('Garden club news');
    expect(onCommit.mock.calls[0]?.[3]).toStrictEqual({});
  });

  it('with the box selected, a format applies to the whole block and is written as a mark over all of it', async () => {
    const { outline, frame, onCommit } = layer();
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      formatOpenEditor({ kind: 'toggle', property: 'bold' });
    });
    await act(async () => {
      fireEvent.keyDown(must(frame(), 'frame'), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(onCommit.mock.calls[0]?.[3]).toStrictEqual({ marks: [{ from: 0, to: 11, set: { bold: true } }] });
  });

  it('a press OUTSIDE finishes and keeps the changes', async () => {
    const { outline, surface, onCommit } = layer();
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      typeAt(surface(), 'The ', { paragraph: 0, offset: 0 });
    });
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[1]).toBe('The Garden club');
  });

  it('a REFUSAL keeps the editor and the words with its sentence, and Escape then puts them back', async () => {
    const { outline, frame, surface, onCommit } = layer(() => Promise.resolve({ refused: { code: 'internal', incident: 'test' } }));
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      typeAt(surface(), '!', { paragraph: 0, offset: 11 });
    });
    await act(async () => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(frame()?.querySelector('[role="alert"]')).not.toBeNull();
    expect(surface().textContent).toBe('Garden club!');
    act(() => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
    });
    expect(frame()).toBeNull();
    // CONTROL: the put-back wrote nothing more.
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a page with no text offers to RECOGNISE it, and the button calls onRecognise; a page with blocks does not (ADR-0181)', () => {
    const onRecognise = vi.fn();
    const empty: PageBlocks = { ...BLOCKS, blocks: [] };
    const view = render(
      <I18nProvider i18n={i18n}>
        <EditTextLayer
          blocks={empty}
          geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
          onCommit={() => Promise.resolve('unchanged')}
          onLeave={() => undefined}
          onRecognise={onRecognise}
          page={0}
          paperAt={() => undefined}
          blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
        />
      </I18nProvider>,
    );
    const offer = must(view.container.querySelector<HTMLButtonElement>('.m-text-edit__promote'), 'recognise button');
    fireEvent.click(offer);
    expect(onRecognise).toHaveBeenCalledTimes(1);
    cleanup();
    // CONTROL: the same layer over a page WITH blocks makes no offer.
    const { view: withBlocks } = layer();
    expect(withBlocks.container.querySelector('.m-text-edit__promote')).toBeNull();
  });

  it('Escape with no block open leaves the mode', () => {
    const { view, onLeave } = layer();
    fireEvent.keyDown(must(view.container.querySelector('[data-text-edit-layer]'), 'layer'), { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('stackingOf, the outlines’ order', () => {
  /** A block with only a box, which is all the order reads. */
  const boxed = (width: number, height: number): TextBlock => ({ box: { x0: 0, y0: 0, x1: width, y1: height } }) as TextBlock;

  it('puts each outline one above the number of larger blocks, ties level, as counting every pair did', () => {
    // SIZES WITH TIES, in no order: equal areas are where a sort and a count could differ by one.
    const blocks = [boxed(10, 10), boxed(40, 5), boxed(5, 20), boxed(300, 300), boxed(10, 10), boxed(1, 1), boxed(20, 10)];
    const counted = blocks.map((block) => 1 + blocks.filter((other) => other.box.x1 * other.box.y1 > block.box.x1 * block.box.y1).length);
    expect(stackingOf(blocks)).toStrictEqual(counted);
    // CONTROL: the order is not trivially flat, so the comparison above separates something.
    expect(new Set(counted).size).toBeGreaterThan(3);
  });
});
