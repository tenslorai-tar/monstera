import { type DispatchableCommand, type ListedObject, blockEditOf } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { overlayTransform } from './annotations/annotationSpace.js';
import {
  type EditableObject,
  type ObjectPick,
  type PageObjects,
  arrangeCommand,
  carryPick,
  createReadQueue,
  liftedLook,
  nextRead,
  objectAt,
  placeCommand,
  recolourCommand,
  refreshPick,
  removeCommand,
  resizedBy,
  settled,
  shownBy,
  showsText,
} from './objectEditing.js';

/**
 * Edit object's model
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)):
 * which object a press names, and which writer's command each change is. The commands' effects on a document are the
 * kernel's cases (`drawnObjectEdit.test.ts`, `editObjectText.test.ts`, `proof:editobject`).
 */

const V3 = asDocVersion(3);
const V4 = asDocVersion(4);
const PAGE = { x0: 0, y0: 0, x1: 600, y1: 800 };

const SHAPE: EditableObject = {
  source: 'drawn',
  index: 4,
  kind: 'path',
  ordinal: 1,
  box: { x0: 100, y0: 100, x1: 200, y1: 150 },
  drawn: { x0: 100, y0: 100, x1: 200, y1: 150 },
  fill: { r: 10, g: 20, b: 30 },
};
/** A picture placed larger than its window: (0, 0) to (300, 300) drawn, (100, 100) to (200, 200) shows. */
const CLIPPED: EditableObject = {
  source: 'drawn',
  index: 6,
  kind: 'image',
  ordinal: 0,
  box: { x0: 100, y0: 100, x1: 200, y1: 200 },
  drawn: { x0: 0, y0: 0, x1: 300, y1: 300 },
  fill: null,
};
const BLOCK: EditableObject = {
  source: 'text',
  kind: 'text',
  index: 1,
  indices: [1, 2],
  box: { x0: 120, y0: 120, x1: 180, y1: 140 },
  block: { lines: [[1], [2]], soft: [true, false], text: 'Two lines' },
  fill: { r: 0, g: 0, b: 0 },
};
const STAMP: EditableObject = { source: 'stamp', kind: 'picture', index: 0, box: { x0: 400, y0: 400, x1: 500, y1: 450 } };
const BACKDROP: EditableObject = {
  source: 'drawn',
  index: 0,
  kind: 'path',
  ordinal: 0,
  box: { x0: 0, y0: 0, x1: 600, y1: 800 },
  drawn: { x0: 0, y0: 0, x1: 600, y1: 800 },
  fill: { r: 255, g: 255, b: 255 },
};

/** PDFium's listing of the page: the backdrop, the block's two runs, the shape over them, the picture. */
const LISTED: ListedObject[] = [
  { index: 0, kind: 'path', box: { left: 0, bottom: 0, right: 600, top: 800 } },
  { index: 1, kind: 'text', box: { left: 120, bottom: 130, right: 180, top: 140 } },
  { index: 2, kind: 'text', box: { left: 120, bottom: 120, right: 170, top: 130 } },
  { index: 3, kind: 'path', box: { left: 500, bottom: 500, right: 550, top: 550 } },
  { index: 4, kind: 'path', box: { left: 100, bottom: 100, right: 200, top: 150 } },
  { index: 5, kind: 'image', box: { left: 700, bottom: 700, right: 710, top: 710 } },
];

const pick = (object: EditableObject): ObjectPick => ({ page: 2, version: V3, object, listed: LISTED });

/** A command a case needs built, failing the case where none was. */
function built(command: DispatchableCommand | undefined): DispatchableCommand {
  if (command === undefined) throw new Error('no command was built');
  return command;
}

describe('the filters', () => {
  it('outline the kinds each names, Images including a placed picture', () => {
    const all = [BLOCK, SHAPE, CLIPPED, STAMP];
    expect(all.filter((object) => shownBy('images', object))).toStrictEqual([CLIPPED, STAMP]);
    expect(all.filter((object) => shownBy('shapes', object))).toStrictEqual([SHAPE]);
    expect(all.filter((object) => shownBy('text', object))).toStrictEqual([BLOCK]);
    expect(all.filter((object) => shownBy('all', object))).toStrictEqual(all);
    // ONLY THE FILTERS THAT SHOW TEXT pay for the block read.
    expect([showsText('all'), showsText('text'), showsText('images'), showsText('shapes')]).toStrictEqual([true, true, false, false]);
  });
});

describe('the reads, the page on show first (Decision 9)', () => {
  it('chooses the page on show, then the nearest', () => {
    expect(nextRead([0, 1, 2, 3, 4], 3)).toBe(3);
    expect(nextRead([0, 1, 4, 5], 3)).toBe(4);
    expect(nextRead([], 3)).toBeUndefined();
  });

  it('runs one read at a time, the page on show first, whichever page asked first', async () => {
    const order: number[] = [];
    const queue = createReadQueue(() => 2);
    const read = (page: number): Promise<number> =>
      queue(page, () => {
        order.push(page);
        return Promise.resolve(page);
      });
    // THE TOP OF THE LIST ASKS FIRST, as the pages mount; the page on show is asked third.
    await Promise.all([read(0), read(1), read(2), read(3)]);
    expect(order).toStrictEqual([2, 1, 3, 0]);
  });
});

describe('objectAt — what a press names, answered from the outlines', () => {
  it('the topmost object containing the point, a backdrop only where nothing else is', () => {
    // THE BACKDROP IS LISTED LAST, as a page drawn background-last lists it, and still loses to the shape it covers.
    const objects = [SHAPE, BACKDROP];
    expect(objectAt(objects, 'all', { x: 150, y: 120 }, PAGE)).toBe(SHAPE);
    expect(objectAt(objects, 'all', { x: 300, y: 600 }, PAGE)).toBe(BACKDROP);
    // CONTROL: under a filter that does not outline the shape, the press finds what is outlined there.
    expect(objectAt(objects, 'images', { x: 150, y: 120 }, PAGE)).toBeUndefined();
  });
});

describe('placeCommand — each object by its own writer (Decision 1)', () => {
  it('a drawn object MOVED is the drawn writer’s place, by the move alone', () => {
    expect(placeCommand(pick(SHAPE), { x0: 110, y0: 90, x1: 210, y1: 140 })).toStrictEqual({
      kind: 'editDrawnObject',
      page: 2,
      index: 4,
      object: 'path',
      ordinal: 1,
      box: { left: 100, bottom: 100, right: 200, top: 150 },
      edit: { op: 'place', moveBy: { x: 10, y: -10 }, scaleBy: { x: 1, y: 1 } },
      version: V3,
    });
  });

  it('a CLIPPED picture resized lands what SHOWS on the target, though it scales about the engine’s corner', () => {
    const target = { x0: 100, y0: 100, x1: 300, y1: 200 };
    const command = placeCommand(pick(CLIPPED), target);
    if (command?.kind !== 'editDrawnObject' || command.edit.op !== 'place') throw new Error('expected a place');
    const { moveBy, scaleBy } = command.edit;
    // THE WRAP's matrix, applied to the shown corners: p′ = s·p + drawn·(1 − s) + move, drawn's corner being (0, 0).
    const mapped = (x: number, y: number): readonly [number, number] => [scaleBy.x * x + moveBy.x, scaleBy.y * y + moveBy.y];
    expect([mapped(100, 100), mapped(200, 200)]).toStrictEqual([
      [100, 100],
      [300, 200],
    ]);
    // CONTROL: a move that ignored the clip — the shown corner's delta alone — puts the shown corner 100 points off.
    expect(scaleBy.x * 100 + (target.x0 - CLIPPED.box.x0)).not.toBe(target.x0);
  });

  it('a TEXT BLOCK is the operator writer’s, one factor about its top left and the move of its top left', () => {
    // HALF AGAIN AS WIDE, its top left moved 10 right and 5 down.
    expect(placeCommand(pick(BLOCK), { x0: 130, y0: 105, x1: 220, y1: 135 })).toStrictEqual({
      kind: 'editTextOperators',
      page: 2,
      ...blockEditOf([{ lines: [[1], [2]], soft: [true, false], text: 'Two lines', place: { move: { x: 10, y: -5 }, scale: 1.5 } }]),
      fit: 'reflow',
      version: V3,
    });
  });

  it('a PLACED PICTURE is the annotation writer’s, and a box that did not move sends nothing', () => {
    expect(placeCommand(pick(STAMP), { x0: 410, y0: 400, x1: 510, y1: 450 })).toStrictEqual({
      kind: 'placeAnnotation',
      page: 2,
      placements: [{ index: 0, rect: { x0: 410, y0: 400, x1: 510, y1: 450 } }],
      version: V3,
    });
    expect(placeCommand(pick(SHAPE), SHAPE.box)).toBeUndefined();
  });
});

describe('resizedBy — what a handle drag makes of the box', () => {
  it('scales a text block about its opposite corner by the width’s factor, keeping its proportions', () => {
    const start = { x0: 0, y0: 0, x1: 100, y1: 20 };
    // THE SOUTH-WEST CORNER dragged left and far down: the north-east corner holds, the height follows the width.
    expect(resizedBy(BLOCK, start, 'sw', [-50, 400], 2)).toStrictEqual({ x0: -50, y0: 0, x1: 100, y1: 30 });
    // CONTROL: a drawn object stretches to the pointer on both axes.
    expect(resizedBy(SHAPE, start, 'sw', [-50, 400], 2)).toStrictEqual({ x0: -50, y0: 0, x1: 100, y1: 400 });
  });
});

describe('recolour, arrange and remove', () => {
  it('a shape is recoloured by the drawn writer, a block by a colour over all its words, a picture not at all', () => {
    expect(recolourCommand(pick(SHAPE), { r: 200, g: 0, b: 0 })).toStrictEqual({
      kind: 'editDrawnObject',
      page: 2,
      index: 4,
      object: 'path',
      ordinal: 1,
      box: { left: 100, bottom: 100, right: 200, top: 150 },
      edit: { op: 'recolor', colour: { r: 200, g: 0, b: 0 } },
      version: V3,
    });
    expect(recolourCommand(pick(BLOCK), { r: 200, g: 0, b: 0 })).toStrictEqual({
      kind: 'editTextOperators',
      page: 2,
      ...blockEditOf([{ lines: [[1], [2]], soft: [true, false], text: 'Two lines', marks: [{ from: 0, to: 9, set: { colour: { r: 200, g: 0, b: 0 } } }] }]),
      fit: 'reflow',
      version: V3,
    });
    expect(recolourCommand(pick(CLIPPED), { r: 200, g: 0, b: 0 })).toBeUndefined();
    expect(recolourCommand(pick(STAMP), { r: 200, g: 0, b: 0 })).toBeUndefined();
  });

  it('an arrange goes past the nearest overlapping object that way, by the contract’s one rule', () => {
    // THE SHAPE (index 4) OVERLAPS THE BLOCK: backward from it, past the block's runs, which are text 1 of the page's.
    expect(arrangeCommand(pick(SHAPE), 'backward')).toStrictEqual({
      kind: 'editDrawnObject',
      page: 2,
      index: 4,
      object: 'path',
      ordinal: 1,
      box: { left: 100, bottom: 100, right: 200, top: 150 },
      edit: { op: 'arrange', to: 'backward', past: { kind: 'text', object: 1 } },
      version: V3,
    });
    // THE BLOCK FORWARD goes past the shape over it, the page's second path.
    expect(arrangeCommand(pick(BLOCK), 'forward')).toStrictEqual({
      kind: 'editTextOperators',
      page: 2,
      ...blockEditOf([{ lines: [[1], [2]], soft: [true, false], text: 'Two lines', place: { arrange: { to: 'forward', past: { kind: 'path', ordinal: 2 } } } }]),
      fit: 'reflow',
      version: V3,
    });
    // CONTROL: nothing overlaps the shape in front of it, and a placed picture keeps the annotations' own order.
    expect(arrangeCommand(pick(SHAPE), 'forward')).toBeUndefined();
    expect(arrangeCommand(pick(STAMP), 'backward')).toBeUndefined();
  });

  it('a removal is each writer’s own: the drawn object’s bytes, the block emptied, the annotation removed', () => {
    expect(removeCommand(pick(SHAPE))).toMatchObject({ kind: 'editDrawnObject', edit: { op: 'delete' } });
    expect(removeCommand(pick(BLOCK))).toStrictEqual({
      kind: 'editTextOperators',
      page: 2,
      ...blockEditOf([{ lines: [[1], [2]], soft: [true, false], text: '' }]),
      fit: 'reflow',
      version: V3,
    });
    expect(removeCommand(pick(STAMP))).toStrictEqual({ kind: 'removeAnnotation', page: 2, indices: [0], version: V3 });
  });
});

describe('the selection across an edit (Decision 8)', () => {
  const moved = built(placeCommand(pick(SHAPE), { x0: 110, y0: 100, x1: 210, y1: 150 }));

  it('a drawn object placed stays selected at the new version, and waits for the read that gives its new box', () => {
    const carried = carryPick(pick(SHAPE), moved, V4);
    expect(carried).toMatchObject({ version: V4, readAgain: true });
    if (carried === undefined) throw new Error('dropped');
    // NO COMMAND IS BUILT from a pick that still holds the old box.
    expect(settled(carried)).toBe(false);
    const read: PageObjects = { version: V4, objects: [{ ...SHAPE, box: { x0: 110, y0: 100, x1: 210, y1: 150 } }], listed: LISTED, truncated: false };
    const fresh = refreshPick(carried, read, 2);
    expect(fresh?.object.box).toStrictEqual({ x0: 110, y0: 100, x1: 210, y1: 150 });
    expect(fresh === undefined ? undefined : settled(fresh)).toBe(true);
    // CONTROL: a read with no such object drops the pick rather than keeping the old box.
    expect(refreshPick(carried, { ...read, objects: [] }, 2)).toBeUndefined();
  });

  it('an arrange or a removal drops the selection; a block edited follows its words', () => {
    expect(carryPick(pick(SHAPE), built(arrangeCommand(pick(SHAPE), 'backward')), V4)).toBeUndefined();
    expect(carryPick(pick(SHAPE), removeCommand(pick(SHAPE)), V4)).toBeUndefined();
    expect(carryPick(pick(BLOCK), removeCommand(pick(BLOCK)), V4)).toBeUndefined();
    const recoloured = carryPick(pick(BLOCK), built(recolourCommand(pick(BLOCK), { r: 1, g: 2, b: 3 })), V4);
    expect(recoloured?.relocate).toStrictEqual({ text: 'Two lines' });
    const renumbered = { ...BLOCK, index: 7, indices: [7, 8] };
    const read: PageObjects = { version: V4, objects: [SHAPE, renumbered], listed: LISTED, truncated: false };
    expect(refreshPick(recoloured, read, 2)?.object).toBe(renumbered);
    // CONTROL: two blocks with those words are no selection, rather than a guess between them.
    expect(refreshPick(recoloured, { ...read, objects: [renumbered, { ...renumbered, index: 9 }] }, 2)).toBeUndefined();
  });

  it('CONTROL: a command sent at another version, or on another page, carries nothing', () => {
    expect(carryPick({ ...pick(SHAPE), version: V4 }, moved, asDocVersion(5))).toBeUndefined();
    expect(carryPick({ ...pick(SHAPE), page: 1 }, moved, V4)).toBeUndefined();
  });
});

describe('liftedLook — the final look held until the page draws it (Decision 9)', () => {
  const transform = overlayTransform({ crop: [0, 0, 600, 800], rotation: 0, zoom: 1 });

  it('lays the paper where the object was and its pixels where it landed', () => {
    const look = liftedLook(SHAPE, { x0: 110, y0: 100, x1: 210, y1: 150 }, 'blob:x', { backgroundColor: 'rgb(255, 255, 255)' })(transform);
    expect(look).toStrictEqual({
      parts: [
        { part: 'paper', box: { x: 100, y: 650, width: 100, height: 50 }, paint: { backgroundColor: 'rgb(255, 255, 255)' } },
        { part: 'picture', box: { x: 110, y: 650, width: 100, height: 50 }, src: 'blob:x' },
      ],
    });
  });

  it('a placed picture lays no paper: the page leaves the mark out by its index while the look stands', () => {
    const look = liftedLook(STAMP, { x0: 410, y0: 400, x1: 510, y1: 450 }, 'blob:x', { backgroundColor: 'rgb(255, 255, 255)' })(transform);
    expect(look?.parts.map((part) => part.part)).toStrictEqual(['picture']);
    expect(look?.leaves).toBe(0);
  });
});
