// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { DispatchableCommand } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { ObjectEditLayer } from './ObjectEditLayer.js';
import type { EditableObject, ObjectFilter, ObjectPick, PageObjects } from './objectEditing.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * Edit object's layer over one page (ADR-0153): the UI half of the wired pair for the object commands. Its kernel half
 * is `proof:pdfiumobject`, which drives the real library and cannot see which command a press sends; this sees the
 * command and cannot see a document.
 *
 * `SelectionLayer.test`'s geometry on purpose: a non-zero crop origin and a zoom that is not 1, so a layer passing PDF
 * numbers straight through, or measuring a drag in screen pixels, fails rather than coincides.
 */
const GEOMETRY = {
  crop: [50, 100, 250, 400] as readonly [number, number, number, number],
  rotation: 0 as const,
  zoom: 2,
};

const V5 = asDocVersion(5);
/** Lower-left (60, 350) and upper-right (100, 390) in PDF space, so its top-left lands at (20, 20) on screen. */
const PHOTO: EditableObject = { source: 'content', index: 7, kind: 'image', box: { x0: 60, y0: 350, x1: 100, y1: 390 }, fill: null };
const WORDS: EditableObject = { source: 'content', index: 2, kind: 'text', box: { x0: 60, y0: 200, x1: 200, y1: 220 }, fill: { red: 0, green: 0, blue: 0, alpha: 255 } };
/** A picture placed with Comment › Image: a stamp, index 0 of the annotation walk. */
const PLACED: EditableObject = { source: 'stamp', index: 0, kind: 'picture', box: { x0: 150, y0: 300, x1: 230, y1: 360 }, fill: null };
const OBJECTS: PageObjects = { version: V5, objects: [WORDS, PHOTO, PLACED], truncated: false };

afterEach(cleanup);

function mounted(
  options: { readonly filter?: ObjectFilter; readonly pick?: ObjectPick; readonly objects?: PageObjects } = {},
): { readonly picks: (ObjectPick | undefined)[]; readonly sent: DispatchableCommand[]; readonly left: number[]; readonly layer: HTMLElement } {
  const picks: (ObjectPick | undefined)[] = [];
  const sent: DispatchableCommand[] = [];
  const left: number[] = [];
  const view: ReactElement = (
    <Wrapped>
      <ObjectEditLayer
        filter={options.filter ?? 'all'}
        geometry={GEOMETRY}
        objects={options.objects ?? OBJECTS}
        onCommand={(command) => sent.push(command)}
        onLeave={() => left.push(1)}
        onPick={(pick) => picks.push(pick)}
        page={3}
        pick={options.pick}
      />
    </Wrapped>
  );
  render(view);
  const layer = screen.getByRole('group', { name: 'Objects on page 4' });
  // HAPPY-DOM HAS NO POINTER CAPTURE; the browser's sends every later event for the pointer to the layer, which is
  // where the cases below fire them.
  Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn(), writable: true });
  return { picks, sent, left, layer };
}

const pick = (object: EditableObject): ObjectPick => ({ page: 3, version: V5, object });

describe('ObjectEditLayer', () => {
  it('outlines each object WHERE IT IS on the drawn page, through the one transform', () => {
    mounted();
    const photo = screen.getByRole('button', { name: 'Image, 2 of 3' });
    // (60 − 50) × 2 across and (400 − 390) × 2 down; 40 points wide is 80 pixels at zoom 2.
    expect([photo.style.left, photo.style.top, photo.style.width, photo.style.height]).toStrictEqual(['20px', '20px', '80px', '80px']);
  });

  it('outlines only what the filter names: Images is the page’s pictures AND the one a person placed', () => {
    mounted({ filter: 'images' });
    expect(screen.getAllByRole('button').map((outline) => outline.dataset['object'])).toStrictEqual(['content:7', 'stamp:0']);
  });

  it('says so when a page holds nothing of the chosen kind, rather than showing an empty page', () => {
    mounted({ filter: 'shapes' });
    expect(screen.getByText('This page has no shapes.')).toBeDefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a press SELECTS the object, at the version its outline was read at', () => {
    const { picks } = mounted();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    expect(picks).toStrictEqual([pick(PHOTO)]);
  });

  it('a DRAG on the selected object moves it by the drag in PDF space, the page’s y the other way up', () => {
    const { sent, layer } = mounted({ pick: pick(PHOTO) });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    // 20 pixels right and 40 down at zoom 2: 10 points right and 20 points DOWN, which is −20 in PDF's y.
    expect(sent).toStrictEqual([
      { kind: 'placePageObject', page: 3, index: 7, moveBy: { x: 10, y: -20 }, scaleBy: { x: 1, y: 1 }, version: V5 },
    ]);
  });

  it('CONTROL: a press that did not travel sends nothing, so clicking the selection bumps no version', () => {
    const { sent, layer } = mounted({ pick: pick(PHOTO) });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 31, clientY: 31, pointerId: 1 });
    expect(sent).toStrictEqual([]);
  });

  it('a CORNER HANDLE resizes it, holding the opposite corner', () => {
    const { sent, layer } = mounted({ pick: pick(PHOTO) });
    const corner = layer.querySelector('[data-object-handle="se"]');
    if (corner === null) throw new Error('no handle');
    // The lower-right corner is at (100, 100) on screen; dragged to (140, 180), the box is 120 by 160 pixels from the
    // held upper-left — 60 by 80 points, half again as wide and twice as tall, its upper-left where it was.
    fireEvent.pointerDown(corner, { button: 0, clientX: 100, clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(layer, { clientX: 140, clientY: 180, pointerId: 2 });
    fireEvent.pointerUp(layer, { clientX: 140, clientY: 180, pointerId: 2 });
    expect(sent).toStrictEqual([
      { kind: 'placePageObject', page: 3, index: 7, moveBy: { x: 0, y: -40 }, scaleBy: { x: 1.5, y: 2 }, version: V5 },
    ]);
  });

  it('a PLACED PICTURE is moved by the annotation command, by its own walk’s index', () => {
    const { sent, layer } = mounted({ pick: pick(PLACED) });
    const outline = layer.querySelector('[data-object="stamp:0"]');
    if (outline === null) throw new Error('no outline');
    fireEvent.pointerDown(outline, { button: 0, clientX: 230, clientY: 120, pointerId: 3 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 120, pointerId: 3 });
    expect(sent).toStrictEqual([
      { kind: 'placeAnnotation', page: 3, placements: [{ index: 0, rect: { x0: 160, y0: 300, x1: 240, y1: 360 } }], version: V5 },
    ]);
  });

  it('a press on BLANK PAPER selects nothing, and Escape clears, then leaves the mode', () => {
    const { picks, left, layer } = mounted({ pick: pick(PHOTO) });
    fireEvent.pointerDown(layer, { button: 0, clientX: 380, clientY: 580, pointerId: 4 });
    expect(picks).toStrictEqual([undefined]);
    fireEvent.keyDown(layer, { key: 'Escape' });
    expect(picks).toStrictEqual([undefined, undefined]);
    expect(left).toStrictEqual([]);
    cleanup();
    const nothing = mounted();
    fireEvent.keyDown(nothing.layer, { key: 'Escape' });
    expect(nothing.left).toStrictEqual([1]);
  });

  it('a SECONDARY press selects the object, so the menu it opens is the object’s, and starts no drag', () => {
    const { picks, sent, layer } = mounted();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Text, 1 of 3' }), { button: 2, clientX: 30, clientY: 370, pointerId: 5 });
    fireEvent.pointerUp(layer, { clientX: 90, clientY: 370, pointerId: 5 });
    expect(picks).toStrictEqual([pick(WORDS)]);
    expect(sent).toStrictEqual([]);
  });
});
