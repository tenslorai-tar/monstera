// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type DispatchableCommand, blockEditOf } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { overlayTransform } from './annotations/annotationSpace.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { type HeldEdit, ObjectEditLayer } from './ObjectEditLayer.js';
import type { EditableObject, ObjectFilter, ObjectPick, PageObjects } from './objectEditing.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * Edit object's layer over one page
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)):
 * the UI half of the wired pair for every gesture on the page. The kernel half is `drawnObjectEdit.test.ts`,
 * `editObjectText.test.ts` and `proof:editobject`, which run the commands on real documents and cannot see which command
 * a press sends; this sees the command and cannot see a document.
 *
 * A non-zero crop origin and a zoom that is not 1, so a layer passing PDF numbers straight through, or measuring a drag
 * in screen pixels, fails rather than coincides.
 */
const GEOMETRY = {
  crop: [50, 100, 250, 400] as readonly [number, number, number, number],
  rotation: 0 as const,
  zoom: 2,
};

const V5 = asDocVersion(5);
/** Lower-left (60, 350) and upper-right (100, 390) in PDF space, so its top-left lands at (20, 20) on screen. */
const PHOTO: EditableObject = {
  source: 'drawn',
  index: 7,
  ordinal: 0,
  kind: 'image',
  box: { x0: 60, y0: 350, x1: 100, y1: 390 },
  drawn: { x0: 60, y0: 350, x1: 100, y1: 390 },
  fill: null,
};
/** The photo's box as the command carries it. */
const PHOTO_BOX = { left: 60, bottom: 350, right: 100, top: 390 };
/** A block of two runs, (60, 200) to (200, 220): on screen (20, 360) to (300, 400). */
const WORDS: EditableObject = {
  source: 'text',
  kind: 'text',
  index: 2,
  indices: [2, 3],
  box: { x0: 60, y0: 200, x1: 200, y1: 220 },
  block: { lines: [[2, 3]], soft: [false], text: 'Garden party' },
  fill: { r: 0, g: 0, b: 0 },
};
/** A picture placed with Comment › Image: a stamp, index 0 of the annotation walk. */
const PLACED: EditableObject = { source: 'stamp', kind: 'picture', index: 0, box: { x0: 150, y0: 300, x1: 230, y1: 360 } };
const OBJECTS: PageObjects = { version: V5, objects: [WORDS, PHOTO, PLACED], listed: [], truncated: false };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mounted(
  options: {
    readonly filter?: ObjectFilter;
    readonly pick?: ObjectPick;
    readonly objects?: PageObjects | undefined;
    readonly finding?: boolean;
    readonly pictureOf?: (box: { x0: number; y0: number; x1: number; y1: number }) => HTMLCanvasElement | undefined;
    readonly paperAt?: (x: number, y: number) => string | undefined;
  } = {},
): {
  readonly picks: (ObjectPick | undefined)[];
  readonly sent: DispatchableCommand[];
  readonly held: (HeldEdit | undefined)[];
  readonly left: number[];
  readonly layer: HTMLElement;
} {
  const picks: (ObjectPick | undefined)[] = [];
  const sent: DispatchableCommand[] = [];
  const held: (HeldEdit | undefined)[] = [];
  const left: number[] = [];
  render(
    <Wrapped>
      <ObjectEditLayer
        filter={options.filter ?? 'all'}
        finding={options.finding ?? false}
        geometry={GEOMETRY}
        objects={'objects' in options ? options.objects : OBJECTS}
        onCommand={(command, look) => {
          sent.push(command);
          held.push(look);
        }}
        onLeave={() => left.push(1)}
        onPick={(pick) => picks.push(pick)}
        page={3}
        paperAt={options.paperAt}
        pick={options.pick}
        pictureOf={options.pictureOf}
      />
    </Wrapped>,
  );
  const layer = screen.getByRole('group', { name: 'Objects on page 4' });
  // HAPPY-DOM HAS NO POINTER CAPTURE; the browser's sends every later event for the pointer to the layer, which is
  // where the cases below fire them.
  Object.defineProperty(layer, 'setPointerCapture', { value: vi.fn(), writable: true });
  return { picks, sent, held, left, layer };
}

const pick = (object: EditableObject): ObjectPick => ({ page: 3, version: V5, object, listed: [] });

/** A canvas whose encoder answers at once, as a drawn page's copy does. */
function encodable(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'toBlob', {
    value: (done: (blob: Blob | null) => void) => {
      done(new Blob(['pixels']));
    },
  });
  return canvas;
}

/** Lets the encoder's answer, and the send after it, run. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ObjectEditLayer', () => {
  it('outlines each object WHERE IT IS on the drawn page, through the one transform', () => {
    mounted();
    const photo = screen.getByRole('button', { name: 'Image, 2 of 3' });
    // (60 − 50) × 2 across and (400 − 390) × 2 down; 40 points wide is 80 pixels at zoom 2.
    expect([photo.style.left, photo.style.top, photo.style.width, photo.style.height]).toStrictEqual(['20px', '20px', '80px', '80px']);
  });

  it('outlines only what the filter names: Images is the page’s pictures AND the one a person placed', () => {
    mounted({ filter: 'images' });
    expect(screen.getAllByRole('button').map((outline) => outline.dataset['object'])).toStrictEqual(['drawn:7', 'stamp:0']);
  });

  it('says FINDING OBJECTS while the page is read, and not once it has been (Decision 9)', () => {
    mounted({ objects: undefined, finding: true });
    expect(screen.getByText('Finding objects…')).toBeDefined();
    cleanup();
    // CONTROL: the same layer with its objects read says nothing of the kind, and a refused read is not a read in flight.
    mounted();
    expect(screen.queryByText('Finding objects…')).toBeNull();
    cleanup();
    mounted({ objects: undefined, finding: false });
    expect(screen.queryByText('Finding objects…')).toBeNull();
  });

  it('says so when a page holds nothing of the chosen kind, rather than showing an empty page', () => {
    mounted({ filter: 'shapes' });
    expect(screen.getByText('This page has no shapes.')).toBeDefined();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a press SELECTS the object at the version its outline was read at, with no trip to the helper', () => {
    const { picks, sent } = mounted();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    expect(picks).toStrictEqual([pick(PHOTO)]);
    expect(sent).toStrictEqual([]);
  });

  it('a DRAG moves a drawn object by `editDrawnObject`, by the drag in PDF space, the page’s y the other way up', () => {
    const { sent, held, layer } = mounted({ pick: pick(PHOTO) });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    // 20 pixels right and 40 down at zoom 2: 10 points right and 20 points DOWN, which is −20 in PDF's y.
    expect(sent).toStrictEqual([
      {
        kind: 'editDrawnObject',
        page: 3,
        index: 7,
        object: 'image',
        ordinal: 0,
        box: PHOTO_BOX,
        edit: { op: 'place', moveBy: { x: 10, y: -20 }, scaleBy: { x: 1, y: 1 } },
        version: V5,
      },
    ]);
    // NOTHING LIFTED, nothing held: no page was drawn to copy.
    expect(held).toStrictEqual([undefined]);
  });

  it('CONTROL: a press that did not travel sends nothing, so clicking the selection bumps no version', () => {
    const { sent, layer } = mounted({ pick: pick(PHOTO) });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 31, clientY: 31, pointerId: 1 });
    expect(sent).toStrictEqual([]);
  });

  it('a drag shows the object LIFTED: the paper over where it was, its own pixels where the drag puts it (Decision 9)', () => {
    const asked: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const { layer } = mounted({
      pick: pick(PHOTO),
      pictureOf: (box) => {
        asked.push(box);
        return encodable();
      },
      paperAt: () => 'rgb(250, 250, 240)',
    });
    const lifted = (): HTMLElement | null => layer.querySelector('[data-object-lifted]');
    const paper = (): HTMLElement | null => layer.querySelector('[data-object-left]');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    // THE PHOTO'S OWN BOX, in the window's pixels: the layer is at the window's corner under happy-dom.
    expect(asked).toStrictEqual([{ x0: 20, y0: 20, x1: 100, y1: 100 }]);
    // CONTROL: nothing is shown before the pointer travels, so a press that only selects covers nothing.
    expect([lifted(), paper()]).toStrictEqual([null, null]);
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    expect([lifted()?.style.left, lifted()?.style.top, lifted()?.style.width, lifted()?.style.height]).toStrictEqual(['40px', '60px', '80px', '80px']);
    expect([paper()?.style.left, paper()?.style.top, paper()?.style.backgroundColor]).toStrictEqual(['20px', '20px', 'rgb(250, 250, 240)']);
    fireEvent.pointerUp(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    // GONE WITH THE DRAG: what stands until the page draws the result is the held look, below.
    expect([lifted(), paper()]).toStrictEqual([null, null]);
  });

  it('the release HOLDS the final look — paper where it was, its pixels where it landed — and sends with it', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:lifted');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { sent, held, layer } = mounted({ pick: pick(PHOTO), pictureOf: () => encodable(), paperAt: () => 'rgb(250, 250, 240)' });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image, 2 of 3' }), { button: 0, clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(layer, { clientX: 50, clientY: 70, pointerId: 1 });
    await settle();
    expect(sent).toHaveLength(1);
    const look = held[0]?.look(overlayTransform(GEOMETRY));
    expect(look?.parts).toStrictEqual([
      { part: 'paper', box: { x: 20, y: 20, width: 80, height: 80 }, paint: { backgroundColor: 'rgb(250, 250, 240)' } },
      { part: 'picture', box: { x: 40, y: 60, width: 80, height: 80 }, src: 'blob:lifted' },
    ]);
    // THE ADDRESS IS LET GO when the look leaves, and not before.
    expect(revoked).not.toHaveBeenCalled();
    held[0]?.dropped();
    expect(revoked).toHaveBeenCalledWith('blob:lifted');
  });

  it('a corner HANDLE resizes a drawn object, holding the opposite corner; a SIDE one way only', () => {
    const { sent, layer } = mounted({ pick: pick(PHOTO) });
    expect([...layer.querySelectorAll('[data-object-handle]')].map((handle) => handle.getAttribute('data-object-handle'))).toStrictEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
    const corner = layer.querySelector('[data-object-handle="se"]');
    const east = layer.querySelector('[data-object-handle="e"]');
    if (corner === null || east === null) throw new Error('no handle');
    // The lower-right corner is at (100, 100) on screen; dragged to (140, 180), the box is 120 by 160 pixels from the
    // held upper-left — 60 by 80 points, half again as wide and twice as tall, its upper-left where it was.
    fireEvent.pointerDown(corner, { button: 0, clientX: 100, clientY: 100, pointerId: 2 });
    fireEvent.pointerMove(layer, { clientX: 140, clientY: 180, pointerId: 2 });
    fireEvent.pointerUp(layer, { clientX: 140, clientY: 180, pointerId: 2 });
    // THE RIGHT SIDE'S MIDDLE is at (100, 60): only the width follows the pointer's (140, 200).
    fireEvent.pointerDown(east, { button: 0, clientX: 100, clientY: 60, pointerId: 3 });
    fireEvent.pointerMove(layer, { clientX: 140, clientY: 200, pointerId: 3 });
    fireEvent.pointerUp(layer, { clientX: 140, clientY: 200, pointerId: 3 });
    const placed = (moveBy: { x: number; y: number }, scaleBy: { x: number; y: number }): DispatchableCommand => ({
      kind: 'editDrawnObject',
      page: 3,
      index: 7,
      object: 'image',
      ordinal: 0,
      box: PHOTO_BOX,
      edit: { op: 'place', moveBy, scaleBy },
      version: V5,
    });
    expect(sent).toStrictEqual([placed({ x: 0, y: -40 }, { x: 1.5, y: 2 }), placed({ x: 0, y: 0 }, { x: 1.5, y: 1 })]);
  });

  it('a TEXT BLOCK has corner handles only, and a corner scales it by one factor through the operator writer', () => {
    const { sent, layer } = mounted({ pick: pick(WORDS) });
    expect([...layer.querySelectorAll('[data-object-handle]')].map((handle) => handle.getAttribute('data-object-handle'))).toStrictEqual([
      'nw',
      'ne',
      'se',
      'sw',
    ]);
    const corner = layer.querySelector('[data-object-handle="se"]');
    if (corner === null) throw new Error('no handle');
    // THE LOWER-RIGHT CORNER is at (300, 400). Dragged to (440, 999), the width asks one and a half; the pointer's
    // height asks far more and is not what is sent — the block keeps its proportions, its top-left where it was.
    fireEvent.pointerDown(corner, { button: 0, clientX: 300, clientY: 400, pointerId: 4 });
    fireEvent.pointerMove(layer, { clientX: 440, clientY: 999, pointerId: 4 });
    fireEvent.pointerUp(layer, { clientX: 440, clientY: 999, pointerId: 4 });
    expect(sent).toStrictEqual([
      {
        kind: 'editTextOperators',
        page: 3,
        ...blockEditOf([{ lines: [[2, 3]], soft: [false], text: 'Garden party', place: { scale: 1.5 } }]),
        fit: 'reflow',
        version: V5,
      },
    ]);
  });

  it('a PLACED PICTURE is moved by the annotation command, by its own walk’s index', () => {
    const { sent, layer } = mounted({ pick: pick(PLACED) });
    const outline = layer.querySelector('[data-object="stamp:0"]');
    if (outline === null) throw new Error('no outline');
    fireEvent.pointerDown(outline, { button: 0, clientX: 230, clientY: 120, pointerId: 3 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 120, pointerId: 3 });
    expect(sent).toStrictEqual([{ kind: 'placeAnnotation', page: 3, placements: [{ index: 0, rect: { x0: 160, y0: 300, x1: 240, y1: 360 } }], version: V5 }]);
  });

  it('CONTROL: a placed picture lifted lays NO paper, since the page draws it without itself while its look stands', () => {
    const { layer } = mounted({ pick: pick(PLACED), pictureOf: () => encodable(), paperAt: () => 'rgb(255, 255, 255)' });
    const outline = layer.querySelector('[data-object="stamp:0"]');
    if (outline === null) throw new Error('no outline');
    fireEvent.pointerDown(outline, { button: 0, clientX: 230, clientY: 120, pointerId: 3 });
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 120, pointerId: 3 });
    expect(layer.querySelector('[data-object-lifted]')).not.toBeNull();
    expect(layer.querySelector('[data-object-left]')).toBeNull();
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
