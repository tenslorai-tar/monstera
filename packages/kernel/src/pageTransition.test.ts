import { PDFDocument, PDFName, PDFNumber } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import type { CommandOfKind } from '@monstera/contract';

import { mupdfWriter, withDocument } from './mupdfWriter.js';
import {
  applySetPageTransition,
  captureSetPageTransition,
  invertSetPageTransition,
} from './pageTransition.js';

/**
 * Page transitions, read back through a **different library** than the one that
 * wrote — the fixture is built with pdf-lib and every reading is MuPDF's.
 *
 * ## The whole file is arranged around one indistinguishable pair
 *
 * A page carrying `/S /R` (*replace*, meaning no visible transition) and a page
 * carrying no `/Trans` at all show a reader exactly the same thing. Every
 * rendering-based assertion is therefore blind to the difference this command's
 * inverse turns on, which is why the cases below read the **dictionary** and
 * never a rendering.
 */
const PAGE_COUNT = 3;

/** Three pages, none carrying a `/Trans`. */
async function plainDocument(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < PAGE_COUNT; index += 1) document.addPage([200, 300]);
  return document.save();
}

/**
 * The same, with page 1 carrying a `/Trans` a DIFFERENT producer wrote —
 * carrying `/Dm` and `/M`, which this command never writes.
 *
 * That is the fixture the *restore the whole dictionary* property needs: with a
 * prior that holds only `/S` and `/D`, an inverse restoring just those two is
 * indistinguishable from one restoring everything.
 */
async function foreignTransition(): Promise<Uint8Array> {
  const document = await PDFDocument.load(await plainDocument());
  const page = document.getPages()[1];
  if (page === undefined) throw new Error('the fixture lost a page');
  const context = document.context;
  const trans = context.obj({});
  trans.set(PDFName.of('Type'), PDFName.of('Trans'));
  trans.set(PDFName.of('S'), PDFName.of('Wipe'));
  trans.set(PDFName.of('D'), PDFNumber.of(2));
  trans.set(PDFName.of('Dm'), PDFName.of('H'));
  trans.set(PDFName.of('M'), PDFName.of('O'));
  page.node.set(PDFName.of('Trans'), trans);
  return document.save();
}

const DISSOLVE: CommandOfKind<'setPageTransition'> = {
  kind: 'setPageTransition',
  pages: 'all',
  style: 'dissolve',
  durationSeconds: 1.5,
};

/** One page's `/Trans` entries, read with MuPDF, or `null` when there is none. */
async function transitionOn(
  bytes: Uint8Array,
  page: number,
): Promise<Readonly<Record<string, string>> | null> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) => {
      const trans = document.findPage(page).get('Trans');
      if (trans.isNull()) return null;
      const entries: Record<string, string> = {};
      trans.forEach((value, key) => {
        if (typeof key === 'string') entries[key] = value.toString();
      });
      return entries;
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/** Applies a command to a session opened on `bytes`, and returns the new bytes. */
async function afterApply(
  bytes: Uint8Array,
  command: CommandOfKind<'setPageTransition'>,
): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applySetPageTransition(session, command);
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('setPageTransition', () => {
  it('writes /S and /D onto every page the scope names', async () => {
    const after = await afterApply(await plainDocument(), DISSOLVE);

    for (let page = 0; page < PAGE_COUNT; page += 1) {
      const trans = await transitionOn(after, page);
      expect(trans?.['S']).toBe('/Dissolve');
      expect(trans?.['D']).toBe('1.5');
    }
  });

  it('writes onto only the pages a list names', async () => {
    const after = await afterApply(await plainDocument(), { ...DISSOLVE, pages: [2] });

    expect(await transitionOn(after, 0)).toBeNull();
    expect(await transitionOn(after, 1)).toBeNull();
    expect((await transitionOn(after, 2))?.['S']).toBe('/Dissolve');
  });

  it('CAPTURE RECORDS ABSENCE, and the inverse DELETES the key rather than writing /S /R', async () => {
    // THE CASE THE WHOLE MODULE EXISTS FOR. `/S /R` and no `/Trans` render
    // identically, so an inverse writing *replace* back passes every visual
    // check and leaves the document asserting a choice its producer never made.
    const original = await plainDocument();
    const session = await mupdfWriter.open(original);
    try {
      const captured = await captureSetPageTransition(session, DISSOLVE);
      expect(captured.captured).toBe(true);
      if (!captured.captured) throw new Error('the fixture has a readable /Trans on every page');

      await applySetPageTransition(session, DISSOLVE);
      expect((await transitionOn(await mupdfWriter.serialise(session), 0))?.['S']).toBe(
        '/Dissolve',
      );

      await invertSetPageTransition(session, captured.prior);
      const restored = await mupdfWriter.serialise(session);

      // NULL, not `/R`. An assertion that the transition "is gone" reading a
      // rendering would pass for either.
      expect(await transitionOn(restored, 0)).toBeNull();
      expect(await transitionOn(restored, 1)).toBeNull();
      expect(await transitionOn(restored, 2)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('restores the WHOLE prior dictionary, including entries this command never writes', async () => {
    // The inverse must put back `/Dm` and `/M`, which `apply` neither writes nor
    // knows about. An inverse restoring only `/S` and `/D` — the two fields the
    // command carries — passes the absence case above perfectly and silently
    // drops a producer's axes here.
    const original = await foreignTransition();
    const session = await mupdfWriter.open(original);
    try {
      const captured = await captureSetPageTransition(session, DISSOLVE);
      if (!captured.captured) throw new Error('the foreign /Trans is all scalars, so it captures');

      await applySetPageTransition(session, DISSOLVE);
      // AND THE DICTIONARY WAS REPLACED, not merged: a dissolve has no
      // dimension, so `/Dm` must be gone while the new style is in place.
      const stamped = await transitionOn(await mupdfWriter.serialise(session), 1);
      expect(stamped?.['S']).toBe('/Dissolve');
      expect(stamped?.['Dm']).toBeUndefined();

      await invertSetPageTransition(session, captured.prior);
      const restored = await transitionOn(await mupdfWriter.serialise(session), 1);

      expect(restored?.['S']).toBe('/Wipe');
      expect(restored?.['D']).toBe('2');
      expect(restored?.['Dm']).toBe('/H');
      expect(restored?.['M']).toBe('/O');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses a page this document does not have, and changes nothing', async () => {
    const original = await plainDocument();
    const session = await mupdfWriter.open(original);
    try {
      await expect(
        applySetPageTransition(session, { ...DISSOLVE, pages: [0, 9] }),
      ).rejects.toThrow(/Page 9 is outside this document, which has 3 page\(s\)/u);

      // EVERY PAGE IS VALIDATED BEFORE THE FIRST IS WRITTEN, and here that
      // matters more than it does for a crop: a MuPDF session is mutated in
      // place, so a partial write is a document the user is left holding.
      expect(await transitionOn(await mupdfWriter.serialise(session), 0)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the fixture carries no transition before the command runs', async () => {
    // Without this, the absence assertions above pass for a reader that cannot
    // see a `/Trans` at all — which is the same output a broken reader gives.
    const original = await plainDocument();
    for (let page = 0; page < PAGE_COUNT; page += 1) {
      expect(await transitionOn(original, page)).toBeNull();
    }
  });

  it('CONTROL: the reader really sees a /Trans that is there', async () => {
    // The other half, and it is what makes every `toBeNull()` above mean
    // something: a reader returning null unconditionally would satisfy them all.
    expect((await transitionOn(await foreignTransition(), 1))?.['S']).toBe('/Wipe');
  });
});
