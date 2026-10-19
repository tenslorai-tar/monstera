import { asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import {
  type EditableObject,
  type ObjectPick,
  arrangeCommand,
  carryPick,
  createReadQueue,
  isBackdrop,
  pickingOrder,
  objectAt,
  placeCommand,
  recolourCommand,
  nextRead,
  relocatePick,
  removeCommand,
  shownBy,
  showsText,
  turnCommand,
} from './objectEditing.js';

/** One object nothing clips: what shows is the engine's own box, and it stands for itself alone. */
const unclipped = (object: Omit<EditableObject, 'drawn' | 'members'>): EditableObject => ({ ...object, drawn: object.box, members: [object.index] });
const TEXT = unclipped({ source: 'content', index: 0, ordinal: 0, kind: 'text', box: { x0: 40, y0: 730, x1: 300, y1: 750 }, fill: { red: 0, green: 0, blue: 0, alpha: 255 } });
const RULE = unclipped({ source: 'content', index: 1, ordinal: 0, kind: 'path', box: { x0: 40, y0: 700, x1: 560, y1: 700 }, fill: { red: 0, green: 0, blue: 0, alpha: 255 } });
const PHOTO = unclipped({ source: 'content', index: 2, ordinal: 0, kind: 'image', box: { x0: 40, y0: 400, x1: 280, y1: 580 }, fill: null });
/** A picture placed with Comment › Image, over the photo's corner: the same point names both. */
const PLACED = unclipped({ source: 'stamp', index: 0, ordinal: 0, kind: 'picture', box: { x0: 200, y0: 500, x1: 400, y1: 650 }, fill: null });
const PAGE = [TEXT, RULE, PHOTO, PLACED];
/** A US Letter page's crop box, which every object here sits on. */
const LETTER = { x0: 0, y0: 0, x1: 612, y1: 792 };

const V3 = asDocVersion(3);
/** A page whose walk holds ten objects, so an object at index 9 has none after it. */
const pick = (object: EditableObject): ObjectPick => ({ page: 1, version: V3, object, walked: 10 });

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
    expect(objectAt(PAGE, 'all', { x: 250, y: 550 }, LETTER)).toBe(PLACED);
    // CONTROL: outside the stamp, the same photo is what the point names.
    expect(objectAt(PAGE, 'all', { x: 100, y: 450 }, LETTER)).toBe(PHOTO);
  });

  it('is only one the filter outlines, so Text never picks the picture lying over the words', () => {
    expect(objectAt(PAGE, 'text', { x: 250, y: 550 }, LETTER)).toBeUndefined();
    expect(objectAt(PAGE, 'text', { x: 100, y: 740 }, LETTER)).toBe(TEXT);
  });

  it('is nothing on blank paper', () => {
    expect(objectAt(PAGE, 'all', { x: 580, y: 100 }, LETTER)).toBeUndefined();
  });

  it('finds a page-sized BACKDROP only where nothing else is, however late it is drawn (E9)', () => {
    // A FULL-PAGE FILL DRAWN LAST, as one over the whole page would be: under the old rule it named every point.
    const BACKDROP = unclipped({ source: 'content', index: 7, ordinal: 2, kind: 'path', box: { x0: 0, y0: 0, x1: 612, y1: 792 }, fill: { red: 255, green: 255, blue: 255, alpha: 255 } });
    const page = [...PAGE, BACKDROP];
    expect(isBackdrop(BACKDROP, LETTER)).toBe(true);
    expect(objectAt(page, 'all', { x: 100, y: 450 }, LETTER)).toBe(PHOTO);
    expect(objectAt(page, 'all', { x: 580, y: 100 }, LETTER)).toBe(BACKDROP);
    expect(pickingOrder(page, LETTER)[0]).toBe(BACKDROP);
    // CONTROL: the photo covers far less than nine tenths, so it keeps its place in the walk.
    expect(isBackdrop(PHOTO, LETTER)).toBe(false);
  });
});

describe('the command a drag or a handle builds', () => {
  it('moves a PICTURE where it is drawn, by the corners’ difference at scale one, named by kind, place and box (ADR-0240)', () => {
    expect(placeCommand(pick(PHOTO), { x0: 60, y0: 380, x1: 300, y1: 560 })).toStrictEqual({
      kind: 'placeDrawnObject',
      page: 1,
      index: 2,
      object: 'image',
      ordinal: 0,
      box: { left: 40, bottom: 400, right: 280, top: 580 },
      moveBy: { x: 20, y: -20 },
      scaleBy: { x: 1, y: 1 },
      version: V3,
    });
  });

  it('CONTROL: TEXT keeps PDFium’s route, where its font is the writer’s question (the owner’s E1)', () => {
    expect(placeCommand(pick(TEXT), { x0: 50, y0: 730, x1: 310, y1: 750 })).toStrictEqual({
      kind: 'placePageObject',
      page: 1,
      index: 0,
      moveBy: { x: 10, y: 0 },
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

  // A MAGAZINE'S PHOTO (E3): placed 180 pt wider and 40 pt taller than the window it is clipped to. The engine's box is
  // the placement; what shows, and what a person drags, is the window.
  const CLIPPED: EditableObject = {
    source: 'content',
    index: 4,
    ordinal: 1,
    kind: 'image',
    box: { x0: 200, y0: 300, x1: 400, y1: 450 },
    drawn: { x0: 20, y0: 300, x1: 400, y1: 490 },
    members: [4],
    fill: null,
  };
  /** Where a command puts a point, as both engines apply it: scaled about the engine's corner, then moved. */
  const placed = (command: ReturnType<typeof placeCommand>, x: number, y: number): readonly [number, number] => {
    if (command?.kind !== 'placeDrawnObject') throw new Error('expected a drawn object’s placement');
    const anchor = command.box;
    return [
      x * command.scaleBy.x + anchor.left * (1 - command.scaleBy.x) + command.moveBy.x,
      y * command.scaleBy.y + anchor.bottom * (1 - command.scaleBy.y) + command.moveBy.y,
    ];
  };

  it('puts what SHOWS of a clipped picture on the target, and names it by the engine’s own box (E3)', () => {
    const target = { x0: 230, y0: 280, x1: 330, y1: 355 };
    const command = placeCommand(pick(CLIPPED), target);
    expect(command).toMatchObject({ kind: 'placeDrawnObject', index: 4, ordinal: 1, box: { left: 20, bottom: 300, right: 400, top: 490 } });
    const [x0, y0] = placed(command, CLIPPED.box.x0, CLIPPED.box.y0);
    const [x1, y1] = placed(command, CLIPPED.box.x1, CLIPPED.box.y1);
    expect([x0, y0, x1, y1].map((value) => Math.round(value * 1e6) / 1e6)).toStrictEqual([230, 280, 330, 355]);
    // CONTROL: the same resize computed as if the shown box were the engine's, applied as the engine applies it — about
    // ITS corner — leaves the window's left edge at 140, not 230. So the assertion above separates the two.
    const naive = placeCommand(pick({ ...CLIPPED, drawn: CLIPPED.box }), target);
    if (naive?.kind !== 'placeDrawnObject') throw new Error('expected a drawn object’s placement');
    expect(placed({ ...naive, box: { left: 20, bottom: 300, right: 400, top: 490 } }, CLIPPED.box.x0, CLIPPED.box.y0)[0]).toBeCloseTo(140, 6);
  });

  // A WORD WRITTEN ONE LETTER PER OBJECT (E4): objects 5, 6 and 8 make one block.
  const WORD: EditableObject = {
    source: 'content',
    index: 5,
    ordinal: 0,
    kind: 'text',
    box: { x0: 100, y0: 600, x1: 160, y1: 612 },
    drawn: { x0: 100, y0: 600, x1: 160, y1: 612 },
    members: [5, 6, 8],
    fill: { red: 0, green: 0, blue: 0, alpha: 255 },
  };

  it('moves a BLOCK as one, about the block’s own corner, naming every object in it (ADR-0242)', () => {
    expect(placeCommand(pick(WORD), { x0: 110, y0: 580, x1: 230, y1: 604 })).toStrictEqual({
      kind: 'placePageObjects',
      page: 1,
      indices: [5, 6, 8],
      box: { left: 100, bottom: 600, right: 160, top: 612 },
      moveBy: { x: 10, y: -20 },
      scaleBy: { x: 2, y: 2 },
      version: V3,
    });
    // CONTROL: one object alone keeps the single command, so the list above is the block's and not every text's.
    expect(placeCommand(pick(TEXT), { x0: 50, y0: 730, x1: 310, y1: 750 })?.kind).toBe('placePageObject');
  });

  // THE SAME WORD AS EDIT TEXT READS IT: one line of runs 5 and 8 (object 6 is a member of run 5), its words as read.
  const READ_WORD: EditableObject = { ...WORD, block: { lines: [[5, 8]], soft: [false], text: 'Word' } };

  it('places a block EDIT TEXT READ through the operator writer, its words unchanged, about the group’s box (R11)', () => {
    const command = placeCommand(pick(READ_WORD), { x0: 110, y0: 580, x1: 230, y1: 604 });
    if (command?.kind !== 'editTextOperators') throw new Error(`expected the operator writer, got ${String(command?.kind)}`);
    expect(command.page).toBe(1);
    expect(command.version).toBe(V3);
    // THE WORDS AS READ and the block's own runs: nothing is written again, only placed.
    expect(command.text).toBe('Word');
    expect(command.runs).toStrictEqual([5, 8]);
    // THE PLACEMENT placePageObjects MEANT, about the same box, so the block lands where PDFium's route put it.
    expect(command.places).toStrictEqual([
      { block: 0, about: { box: { left: 100, bottom: 600, right: 160, top: 612 }, moveBy: { x: 10, y: -20 }, scaleBy: { x: 2, y: 2 } } },
    ]);
  });

  it('the selection follows a placed block to the next read BY ITS WORDS, and is no selection until then (R11)', () => {
    const command = placeCommand(pick(READ_WORD), { x0: 110, y0: 580, x1: 230, y1: 604 });
    if (command === undefined) throw new Error('no command');
    const V4 = asDocVersion(4);
    const carried = carryPick(pick(READ_WORD), command, V4);
    expect(carried?.relocate).toStrictEqual({ text: 'Word' });
    // THE NEXT READ RENUMBERED IT: found by its words, with its new indices.
    const moved: EditableObject = { ...READ_WORD, index: 40, members: [40, 41, 42] };
    const found = relocatePick(carried, { version: V4, objects: [TEXT, moved], truncated: false, walked: 43 }, 1);
    expect(found?.object.members).toStrictEqual([40, 41, 42]);
    expect(found?.relocate).toBeUndefined();
    // CONTROL: two blocks with those words leave no selection, rather than the wrong one.
    expect(relocatePick(carried, { version: V4, objects: [moved, { ...moved, index: 50, members: [50] }], truncated: false, walked: 51 }, 1)).toBeUndefined();
  });

  it('the page ON SHOW is read first, then the nearest; and only a filter that outlines text reads the text blocks (R11)', () => {
    // PAGES 0 TO 5 laid out and asking at once, page 4 on show.
    expect(nextRead([0, 1, 2, 3, 4, 5], 4)).toBe(4);
    expect(nextRead([0, 1, 2, 3, 5], 4)).toBe(3);
    // CONTROL: in the order they asked, page 0 would have gone first.
    expect([0, 1, 2, 3, 4, 5][0]).not.toBe(nextRead([0, 1, 2, 3, 4, 5], 4));
    expect(nextRead([], 4)).toBeUndefined();
    expect(showsText('all')).toBe(true);
    expect(showsText('text')).toBe(true);
    expect(showsText('images')).toBe(false);
    expect(showsText('shapes')).toBe(false);
  });

  it('the read QUEUE runs one read at a time, and the page on show first though it asked last (R11)', async () => {
    const order: number[] = [];
    let inFlight = 0;
    let most = 0;
    const queued = createReadQueue(() => 4);
    const read = (page: number) =>
      queued(page, async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        order.push(page);
        await Promise.resolve();
        inFlight -= 1;
        return page;
      });
    // AS THE PAGE LIST ASKS: top to bottom, in one render.
    expect(await Promise.all([0, 1, 2, 3, 4, 5].map(read))).toStrictEqual([0, 1, 2, 3, 4, 5]);
    expect(order).toStrictEqual([4, 3, 5, 2, 1, 0]);
    expect(most).toBe(1);
  });

  it('removes and recolours EVERY object of a block, so no letter is left behind', () => {
    expect(removeCommand(pick(WORD))).toMatchObject({ kind: 'deletePageObjects', indices: [5, 6, 8] });
    expect(recolourCommand(pick(WORD), { red: 255, green: 0, blue: 0, alpha: 255 })).toMatchObject({ kind: 'recolorPageObjects', indices: [5, 6, 8] });
  });

  it('TURNS a clipped picture about the centre of what shows, though the engine turns about its own box’s (ADR-0243)', () => {
    const command = turnCommand(pick(CLIPPED), 90);
    if (command?.kind !== 'placeDrawnObject') throw new Error('expected a drawn object’s placement');
    expect(command.rotateBy).toBe(90);
    // AS THE ENGINE APPLIES IT: turned about its box's centre (210, 395), then moved. The window's centre (300, 375) is
    // where it was, to a millionth of a point.
    const radians = Math.PI / 2;
    const [cx, cy] = [(command.box.left + command.box.right) / 2, (command.box.bottom + command.box.top) / 2];
    const turnAt = (x: number, y: number): readonly [number, number] => [
      Math.round(((x - cx) * Math.cos(radians) - (y - cy) * Math.sin(radians) + cx + command.moveBy.x) * 1e6) / 1e6,
      Math.round(((x - cx) * Math.sin(radians) + (y - cy) * Math.cos(radians) + cy + command.moveBy.y) * 1e6) / 1e6,
    ];
    expect(turnAt(300, 375)).toStrictEqual([300, 375]);
    // CONTROL: nothing clipped turns about its own centre with no move, and a stamp is not turned at all.
    expect(turnCommand(pick(PHOTO), 90)).toMatchObject({ moveBy: { x: 0, y: 0 }, rotateBy: 90 });
    expect(turnCommand(pick(PLACED), 90)).toBeUndefined();
    expect(turnCommand(pick(PHOTO), 0)).toBeUndefined();
  });

  it('ARRANGES one object a place each way, only where a neighbour is, and never a stamp or a block (ADR-0244)', () => {
    expect(arrangeCommand(pick(PHOTO), 'forward')).toStrictEqual({ kind: 'arrangePageObject', page: 1, index: 2, toward: 'forward', version: V3 });
    expect(arrangeCommand(pick(PHOTO), 'backward')).toMatchObject({ toward: 'backward', index: 2 });
    // NO NEIGHBOUR: the first object has none behind it, and the walk's last (index 9 of ten) none in front.
    expect(arrangeCommand(pick(TEXT), 'backward')).toBeUndefined();
    expect(arrangeCommand(pick({ ...PHOTO, index: 9, members: [9] }), 'forward')).toBeUndefined();
    expect(arrangeCommand(pick(PLACED), 'forward')).toBeUndefined();
    expect(arrangeCommand(pick(WORD), 'forward')).toBeUndefined();
  });

  it('the selection FOLLOWS the object it arranged to its new place, and drops for another object’s', () => {
    const V4 = asDocVersion(4);
    const forward = arrangeCommand(pick(PHOTO), 'forward');
    if (forward === undefined) throw new Error('expected an arrangement');
    expect(carryPick(pick(PHOTO), forward, V4)).toStrictEqual({ ...pick(PHOTO), version: V4, object: { ...PHOTO, index: 3, members: [3] } });
    // CONTROL: the same command with the rule picked moves the rule's index too, so the pick drops.
    expect(carryPick(pick(RULE), forward, V4)).toBeUndefined();
  });

  it('picks a clipped picture where it shows, never in the part of its placement the window hides', () => {
    // INSIDE THE PLACEMENT, LEFT OF THE WINDOW: on the real page that is paper, or whatever is drawn there.
    expect(objectAt([CLIPPED], 'all', { x: 100, y: 400 }, LETTER)).toBeUndefined();
    expect(objectAt([CLIPPED], 'all', { x: 300, y: 400 }, LETTER)).toBe(CLIPPED);
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
