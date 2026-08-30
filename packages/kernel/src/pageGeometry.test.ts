import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ByteImage, MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { readPageGeometry } from './pageGeometry.js';
import { applyRotatePages } from './rotatePages.js';

/**
 * The view model's geometry half, read against a real engine.
 *
 * ## Every case here separates a WRONG reading from the right one
 *
 * The reading this produces is a small array of small numbers, and almost any
 * mistake still produces one. So the fixtures are chosen to make the two
 * plausible wrong implementations answer differently from the right one, rather
 * than to make the right one look correct:
 *
 * - a page that **inherits** its rotation separates `getInheritable` from `get`.
 *   Against a flat document those two agree on every page, which is what the
 *   host's round-trip cases use — so this axis is covered here or nowhere.
 * - a **raw `/Rotate 45`** separates the snapped reading from the raw one. Every
 *   quarter-turn fixture is a fixture on which `snapRotation` is the identity.
 *
 * Neither shape is exotic: §3's whole finding is that documents in the wild
 * carry both, and MuPDF keeps them through a round trip.
 */

/** Every page of the three-page fixture, in order. */
const ALL = [0, 1, 2];

let flat: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  flat = await document.save();
});

/** A session whose pages inherit `/Rotate` from the `/Pages` node. */
async function inheriting(value: number): Promise<MupdfSession> {
  const session = await mupdfWriter.open(flat);
  await withDocument(session, (document) => {
    document.getTrailer().get('Root').get('Pages').put('Rotate', value);
  });
  return session;
}

/** A session where one page declares a raw `/Rotate` of its own. */
async function declaring(page: number, value: number): Promise<MupdfSession> {
  const session = await mupdfWriter.open(flat);
  await withDocument(session, (document) => {
    document.loadPage(page).getObject().put('Rotate', value);
  });
  return session;
}

describe('readPageGeometry', () => {
  it('reports one rotation per page, and a flat document is all zeros', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      const geometry = await readPageGeometry(session, ALL);
      expect(geometry).toStrictEqual({ pageCount: 3, rotations: [0, 0, 0] });
      // THE ANCHOR, and it is not implied by the line above. The consumer reads
      // `rotations` positionally against what it asked for, so a shorter array
      // is a page silently drawn the wrong way up rather than an error.
      expect(geometry.rotations).toHaveLength(ALL.length);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reports the EFFECTIVE rotation, so an inherited one is not reported as zero', async () => {
    const session = await inheriting(90);
    try {
      // `get('Rotate')` answers `null` for all three of these pages — they
      // declare nothing — so an own-state reading reports `[0, 0, 0]` for a
      // document that is plainly on its side. Own-state is the INVERSE's
      // business (ADR-0009 §3); what the renderer draws is what the user sees.
      expect(await readPageGeometry(session, ALL)).toStrictEqual({
        pageCount: 3,
        rotations: [90, 90, 90],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('SNAPS a raw value the way the engine snaps it, rather than reporting it', async () => {
    const session = await declaring(1, 45);
    try {
      // MuPDF renders a raw 45 as 90 and `applyRotatePages` rotates from that
      // base, so a view model reporting 45 would put the renderer a half quarter
      // turn from the engine on every document carrying one — and it would be
      // consistently, invisibly wrong rather than broken.
      expect(await readPageGeometry(session, ALL)).toStrictEqual({
        pageCount: 3,
        rotations: [0, 90, 0],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a rotate moves the page it named and leaves the others where they were', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      await applyRotatePages(session, { kind: 'rotatePages', pages: [2], quarterTurns: 1 });

      // The unchanged entries are the half that matters. An implementation that
      // reported the last command's rotation for every page would satisfy an
      // assertion about page 2 alone, and the reading is a plausible array
      // either way.
      expect(await readPageGeometry(session, ALL)).toStrictEqual({
        pageCount: 3,
        rotations: [0, 0, 90],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('answers the pages it was NAMED, in that order, not the whole document', async () => {
    const session = await declaring(2, 90);
    try {
      // Positional alignment with the request is the whole contract, and the
      // fixture is deliberately out of order: an implementation that read the
      // document top to bottom and truncated returns `[0, 0]` here and looks
      // exactly like a document whose named pages happen to be upright.
      expect(await readPageGeometry(session, [2, 0])).toStrictEqual({
        pageCount: 3,
        rotations: [90, 0],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a page outside the document is REFUSED, not answered with an upright zero', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      // `0` is the reassuring answer, and a renderer would draw it. The refusal
      // is what makes a caller that lost track of the page count a defect
      // rather than a document that quietly appears upright.
      await expect(readPageGeometry(session, [3])).rejects.toThrow(RangeError);
      // AND THE VALIDATION IS COMPLETE BEFORE THE FIRST READ. Without the
      // separate pass, a request whose bad index comes last returns a
      // half-filled array to whoever catches nothing.
      await expect(readPageGeometry(session, [0, 99])).rejects.toThrow(RangeError);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a page that INHERITS and is then rotated reports the sum, not the turn', async () => {
    const session = await inheriting(90);
    try {
      await applyRotatePages(session, { kind: 'rotatePages', pages: [0], quarterTurns: 1 });

      // 180, not 90. `getViewport({ rotation })` REPLACES the page's rotation
      // rather than adding to it (`proof:viewportrotation`), so the number here
      // has to be where the page ended up. A model carrying the quarter turns a
      // command applied would draw this page one turn short — and would be right
      // on every document whose pages started at zero, which is every fixture
      // anyone reaches for first.
      expect(await readPageGeometry(session, ALL)).toStrictEqual({
        pageCount: 3,
        rotations: [180, 90, 90],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
