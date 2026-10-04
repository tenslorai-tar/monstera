import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  type EditableObject,
  type ObjectPick,
  carryPick,
  objectAt,
  placeCommand,
  recolourCommand,
  removeCommand,
  shownBy,
} from './objectEditing.js';

const TEXT: EditableObject = { source: 'content', index: 0, kind: 'text', box: { x0: 40, y0: 730, x1: 300, y1: 750 }, fill: { red: 0, green: 0, blue: 0, alpha: 255 } };
const RULE: EditableObject = { source: 'content', index: 1, kind: 'path', box: { x0: 40, y0: 700, x1: 560, y1: 700 }, fill: { red: 0, green: 0, blue: 0, alpha: 255 } };
const PHOTO: EditableObject = { source: 'content', index: 2, kind: 'image', box: { x0: 40, y0: 400, x1: 280, y1: 580 }, fill: null };
/** A picture placed with Comment › Image, over the photo's corner: the same point names both. */
const PLACED: EditableObject = { source: 'stamp', index: 0, kind: 'picture', box: { x0: 200, y0: 500, x1: 400, y1: 650 }, fill: null };
const PAGE = [TEXT, RULE, PHOTO, PLACED];

const V3 = asDocVersion(3);
const pick = (object: EditableObject): ObjectPick => ({ page: 1, version: V3, object });

describe('which objects each filter outlines (ADR-0153 Decision 2)', () => {
  it('Images is the page’s images AND the pictures a person placed; Text and Shapes are neither', () => {
    expect(PAGE.filter((object) => shownBy('images', object))).toStrictEqual([PHOTO, PLACED]);
    expect(PAGE.filter((object) => shownBy('text', object))).toStrictEqual([TEXT]);
    expect(PAGE.filter((object) => shownBy('shapes', object))).toStrictEqual([RULE]);
    expect(PAGE.filter((object) => shownBy('all', object))).toStrictEqual(PAGE);
  });
});

describe('the object a press names', () => {
  it('is the TOPMOST under the point: a placed picture over a photo, since stamps are drawn over the page', () => {
    expect(objectAt(PAGE, 'all', { x: 250, y: 550 })).toBe(PLACED);
    // CONTROL: outside the stamp, the same photo is what the point names.
    expect(objectAt(PAGE, 'all', { x: 100, y: 450 })).toBe(PHOTO);
  });

  it('is only one the filter outlines, so Text never picks the picture lying over the words', () => {
    expect(objectAt(PAGE, 'text', { x: 250, y: 550 })).toBeUndefined();
    expect(objectAt(PAGE, 'text', { x: 100, y: 740 })).toBe(TEXT);
  });

  it('is nothing on blank paper', () => {
    expect(objectAt(PAGE, 'all', { x: 580, y: 100 })).toBeUndefined();
  });
});

describe('the command a drag or a handle builds', () => {
  it('moves PAGE CONTENT by the corners’ difference, at scale one', () => {
    expect(placeCommand(pick(PHOTO), { x0: 60, y0: 380, x1: 300, y1: 560 })).toStrictEqual({
      kind: 'placePageObject',
      page: 1,
      index: 2,
      moveBy: { x: 20, y: -20 },
      scaleBy: { x: 1, y: 1 },
      version: V3,
    });
  });

  it('resizes page content about its own lower-left corner, which is how placeObject applies it', () => {
    // Half as wide and twice as tall, the lower-left fixed: the move is zero, which a scale about the page's origin
    // would not give — the case the arithmetic would get wrong.
    expect(placeCommand(pick(PHOTO), { x0: 40, y0: 400, x1: 160, y1: 760 })).toMatchObject({
      moveBy: { x: 0, y: 0 },
      scaleBy: { x: 0.5, y: 2 },
    });
  });

  it('keeps the scale at one on an axis with no extent: a rule one line thin has no height to multiply', () => {
    expect(placeCommand(pick(RULE), { x0: 40, y0: 690, x1: 300, y1: 690 })).toMatchObject({
      moveBy: { x: 0, y: -10 },
      scaleBy: { x: 0.5, y: 1 },
    });
  });

  it('places a PICTURE the person placed through the annotation command, by its own walk', () => {
    expect(placeCommand(pick(PLACED), { x0: 220, y0: 480, x1: 420, y1: 630 })).toStrictEqual({
      kind: 'placeAnnotation',
      page: 1,
      placements: [{ index: 0, rect: { x0: 220, y0: 480, x1: 420, y1: 630 } }],
      version: V3,
    });
  });

  it('sends NOTHING for a box that did not change, so a click on the selection bumps no version', () => {
    expect(placeCommand(pick(PHOTO), PHOTO.box)).toBeUndefined();
  });
});

describe('removing and recolouring, each by the writer that holds the object', () => {
  it('removes page content with PDFium’s command and a picture with the annotation one', () => {
    expect(removeCommand(pick(PHOTO))).toStrictEqual({ kind: 'deletePageObjects', page: 1, indices: [2], version: V3 });
    expect(removeCommand(pick(PLACED))).toStrictEqual({ kind: 'removeAnnotation', page: 1, indices: [0], version: V3 });
  });

  it('recolours text and shapes, and offers nothing for a picture or an image, which have no fill', () => {
    const red = { red: 200, green: 0, blue: 0, alpha: 255 };
    expect(recolourCommand(pick(RULE), red)).toStrictEqual({ kind: 'recolorPageObjects', page: 1, indices: [1], colour: red, version: V3 });
    expect(recolourCommand(pick(PHOTO), red)).toBeUndefined();
    expect(recolourCommand(pick(PLACED), red)).toBeUndefined();
  });
});

describe('the selection across a command (Decision 4)', () => {
  const V4 = asDocVersion(4);

  it('is KEPT at the new version across a move or a recolour of page content', () => {
    const placed = placeCommand(pick(PHOTO), { x0: 60, y0: 380, x1: 300, y1: 560 });
    if (placed === undefined) throw new Error('no command');
    expect(carryPick(pick(PHOTO), placed, V4)).toStrictEqual({ ...pick(PHOTO), version: V4 });
  });

  it('is DROPPED after a removal, which shifts every later index', () => {
    expect(carryPick(pick(PHOTO), removeCommand(pick(PHOTO)), V4)).toBeUndefined();
  });

  it('is kept across a placed picture’s move, and NOT across a page-content command for the same index', () => {
    const moved = placeCommand(pick(PLACED), { x0: 220, y0: 480, x1: 420, y1: 630 });
    if (moved === undefined) throw new Error('no command');
    expect(carryPick(pick(PLACED), moved, V4)).toStrictEqual({ ...pick(PLACED), version: V4 });
    // CONTROL: PDFium's walk kept is no promise about the annotation walk, though the index is the same number.
    const content = placeCommand(pick({ ...PHOTO, index: 0 }), { x0: 60, y0: 380, x1: 300, y1: 560 });
    if (content === undefined) throw new Error('no command');
    expect(carryPick(pick(PLACED), content, V4)).toBeUndefined();
  });

  it('is dropped by a command built at another version or for another page, which this pick did not build', () => {
    const placed = placeCommand({ ...pick(PHOTO), version: asDocVersion(2) }, { x0: 60, y0: 380, x1: 300, y1: 560 });
    if (placed === undefined) throw new Error('no command');
    expect(carryPick(pick(PHOTO), placed, V4)).toBeUndefined();
    const elsewhere = placeCommand({ ...pick(PHOTO), page: 5 }, { x0: 60, y0: 380, x1: 300, y1: 560 });
    if (elsewhere === undefined) throw new Error('no command');
    expect(carryPick(pick(PHOTO), elsewhere, V4)).toBeUndefined();
  });
});
