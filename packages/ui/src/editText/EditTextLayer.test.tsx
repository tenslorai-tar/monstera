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
import { EN, TEXT_EDIT_HELD } from '../messages/en.js';
import type { TextBlock } from '../textBlock.js';
import type { PatchArea } from './AreaPatch.js';
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
    // NO FORMATTING, and the one-line block's reach (`oneLineReach`): its changed words wrap where they were laid out.
    expect(onCommit.mock.calls[0]?.[3]).toStrictEqual({ place: { reach: expect.any(Number) as number } });
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

  it('ONE WRITE PER FINISH: a format, typing and a handle drag write nothing, and the finish writes all three at once', async () => {
    const { outline, frame, surface, onCommit } = layer();
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      formatOpenEditor({ kind: 'toggle', property: 'bold' });
    });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(must(frame(), 'frame'), { key: 'Enter' });
    });
    act(() => {
      typeAt(surface(), ' news', { paragraph: 0, offset: 11 });
    });
    expect(onCommit).not.toHaveBeenCalled();
    const handle = must(frame()?.querySelector<HTMLElement>('[data-handle="e"]'), 'width handle');
    // POINTER CAPTURE IS THE BROWSER'S, which happy-dom does not keep; the drag reads only the pointer's coordinates.
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 300, clientY: 690, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 340, clientY: 690, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 360, clientY: 690, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: 360, clientY: 690, pointerId: 1 });
    });
    // THE DECISION: three changes and no write among them.
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[1]).toBe('Garden club news');
    const formatting = onCommit.mock.calls[0]?.[3] as { marks?: unknown[]; place?: { width?: number } } | undefined;
    // ALL THREE IN THE ONE COMMAND: the bold, the words and the width the handle gave.
    expect(JSON.stringify(formatting?.marks)).toContain('"bold":true');
    expect(formatting?.place?.width).toBeGreaterThan(228);
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

  it('A SIGNED DOCUMENT LEFT AS IT WAS keeps the editor and the words with its sentence, a press away asks nothing again, and Escape puts them back (ADR-0149)', async () => {
    const { outline, frame, surface, onCommit } = layer(() => Promise.resolve('held'));
    fireEvent.click(outline(0), { detail: 1 });
    act(() => {
      typeAt(surface(), '!', { paragraph: 0, offset: 11 });
    });
    await act(async () => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
      await Promise.resolve();
    });
    // THE SIGNED DOCUMENT'S OWN SENTENCE, not a refusal's: the person chose to leave the signatures verifying.
    expect(frame()?.querySelector('[role="alert"]')?.textContent).toBe(EN[TEXT_EDIT_HELD]);
    expect(surface().textContent).toBe('Garden club!');
    // A PRESS AWAY, which finishes an editor anywhere else, asks nothing again: the question is once per finish.
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(frame()).not.toBeNull();
    // AND ESCAPE PUTS THE WORDS BACK, writing nothing.
    act(() => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
    });
    expect(frame()).toBeNull();
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

  it('a written editor lets go when its AREA is drawn at the new version, and the area goes once the page is drawn there', async () => {
    const drawnAt: { finish?: () => void } = {};
    const patch = vi.fn<PatchArea>(
      (_after, area) =>
        new Promise((resolve) => {
          drawnAt.finish = () => {
            resolve({ version: asDocVersion(4), at: area });
          };
        }),
    );
    const props = (drawn: number) => (
      <I18nProvider i18n={i18n}>
        <EditTextLayer
          blocks={BLOCKS}
          drawn={asDocVersion(drawn)}
          geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
          onCommit={() => Promise.resolve('written')}
          onLeave={vi.fn()}
          page={0}
          paperAt={() => undefined}
          patch={patch}
          blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
        />
      </I18nProvider>
    );
    const view = render(props(3));
    const frame = () => view.container.querySelector<HTMLElement>('[data-kit-frame]');
    fireEvent.click(must(view.container.querySelector<HTMLElement>('[data-text-block="0"]'), 'outline'), { detail: 1 });
    act(() => {
      typeAt(must(view.container.querySelector<HTMLElement>('[data-kit-surface]'), 'surface'), '!', { paragraph: 0, offset: 11 });
    });
    await act(async () => {
      fireEvent.keyDown(must(view.container.querySelector<HTMLElement>('[data-kit-surface]'), 'surface'), { key: 'Escape' });
      await Promise.resolve();
    });
    // ASKED FOR THE AREA OVER THE READ IT WAS MADE AT, holding the block as placed (72, 92 to 300, 106 at zoom 1).
    expect(patch).toHaveBeenCalledTimes(1);
    const [after, area] = patch.mock.calls[0] ?? [];
    expect(after).toBe(BLOCKS.version);
    expect(area !== undefined && area.left <= 72 && area.top <= 92 && area.left + area.width >= 300 && area.top + area.height >= 106).toBe(true);
    // CONTROL: until it is drawn, the written editor stays over the words.
    expect(frame()).not.toBeNull();
    await act(async () => {
      drawnAt.finish?.();
      await Promise.resolve();
    });
    // THE DECISION: the editor let go, and the patch shows in the same render.
    expect(frame()).toBeNull();
    expect(view.container.querySelector('[data-kit-patch="drawn"]')).not.toBeNull();
    view.rerender(props(4));
    expect(view.container.querySelector('[data-kit-patch]')).toBeNull();
  });

  it.each([
    ['REFUSES', () => Promise.reject(new Error('the area could not be drawn'))],
    ['has NO NEWER VIEW to draw from', () => Promise.resolve(undefined)],
  ] as const)('where the area draw %s, the written editor WAITS for the page’s own read at the new version (the owner’s decision, ADR-0271)', async (_how, answer) => {
    const patch = vi.fn<PatchArea>(answer);
    const props = (blocks: PageBlocks) => (
      <I18nProvider i18n={i18n}>
        <EditTextLayer
          blockFaces={() => Promise.resolve(NO_BLOCK_FACES)}
          blocks={blocks}
          drawn={blocks.version}
          geometry={{ ...GEOMETRY, crop: [...GEOMETRY.crop] }}
          onCommit={() => Promise.resolve('written')}
          onLeave={vi.fn()}
          page={0}
          paperAt={() => undefined}
          patch={patch}
        />
      </I18nProvider>
    );
    const view = render(props(BLOCKS));
    const frame = () => view.container.querySelector<HTMLElement>('[data-kit-frame]');
    const surface = () => must(view.container.querySelector<HTMLElement>('[data-kit-surface]'), 'surface');
    fireEvent.click(must(view.container.querySelector<HTMLElement>('[data-text-block="0"]'), 'outline'), { detail: 1 });
    act(() => {
      typeAt(surface(), '!', { paragraph: 0, offset: 11 });
    });
    await act(async () => {
      fireEvent.keyDown(surface(), { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
    });
    // THE DRAW WAS ASKED FOR AND CAME TO NOTHING, and the editor holds the written words over the page meanwhile.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(frame()).not.toBeNull();
    expect(surface().textContent).toBe('Garden club!');
    expect(view.container.querySelector('[data-kit-patch="drawn"]')).toBeNull();
    // THE PAGE'S OWN READ AT THE NEW VERSION, as `EditTextPage` hands it down once the page is drawn from it: now it lets go.
    await act(async () => {
      view.rerender(props({ ...BLOCKS, version: asDocVersion(4) }));
      await Promise.resolve();
    });
    expect(frame()).toBeNull();
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
