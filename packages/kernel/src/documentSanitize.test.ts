import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import { beforeAll, describe, expect, it } from 'vitest';

import { activeContentIn, applySanitizeDocument, captureSanitizeDocument } from './documentSanitize.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * Sanitising a document — Stage 7's sanitize/flatten row.
 *
 * ## The fixture CARRIES active content, because a clean one proves nothing
 *
 * *No JavaScript in this document* is what a correct sanitise answers and also
 * what a document that never had any answers, and also what a reader that
 * cannot recognise JavaScript answers. So the fixture is built with each thing
 * in it, the control asserts they are there, and every removal is measured
 * against that.
 *
 * ## It reads the SAVED bytes
 *
 * Deleting a key from the catalogue unlinks the object; a plain save writes it
 * back out, readable to anything walking the cross-reference table. So a case
 * that asked the live session would pass for a command that left the
 * JavaScript in the file — which is the whole of ADR-0045's measurement,
 * arriving in a second row.
 */
let plain: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 600]).drawText('Ordinary text', { font, size: 18, x: 20, y: 540 });
  plain = await document.save();
});

/** The fixture, with each thing a sanitise removes planted in it. */
async function loaded(): Promise<ByteImage> {
  const session = await mupdfWriter.open(plain);
  try {
    await withDocument(session, (document) => {
      const root = document.getTrailer().get('Root');

      const openAction = document.addObject(document.newDictionary());
      openAction.put('S', document.newName('JavaScript'));
      openAction.put('JS', 'app.alert("hello");');
      root.put('OpenAction', openAction);

      const names = document.addObject(document.newDictionary());
      const scripts = document.addObject(document.newDictionary());
      scripts.put('Names', document.newArray());
      names.put('JavaScript', scripts);
      const files = document.addObject(document.newDictionary());
      files.put('Names', document.newArray());
      names.put('EmbeddedFiles', files);
      root.put('Names', names);

      // AN ANNOTATION WITH A SUBMIT ACTION, and one with a plain link beside
      // it. The second is the control inside the fixture: a sanitise that
      // deleted every `/A` would take the link with it, and no assertion about
      // the submit action would notice.
      // THE RECT GOES ON THE OBJECT, not through `setRect`: MuPDF 1.28.0
      // answers `setRect` on a Link with *"Link annotations have no Rect
      // property"* — measured 2026-09-12, and the same shape as the Redact's
      // refusal of `setBorderWidth`. The key is in the dictionary either way;
      // what the binding refuses is its own setter.
      const page = document.loadPage(0);
      const submit = page.createAnnotation('Link');
      const submitObject = submit.getObject();
      submitObject.put('Rect', document.newArray());
      for (const value of [20, 20, 120, 40]) submitObject.get('Rect').push(value);
      const submitAction = document.addObject(document.newDictionary());
      submitAction.put('S', document.newName('SubmitForm'));
      submitObject.put('A', submitAction);
      submit.update();

      const link = page.createAnnotation('Link');
      const linkObject = link.getObject();
      linkObject.put('Rect', document.newArray());
      for (const value of [140, 20, 240, 40]) linkObject.get('Rect').push(value);
      const uri = document.addObject(document.newDictionary());
      uri.put('S', document.newName('URI'));
      uri.put('URI', 'https://example.org/');
      linkObject.put('A', uri);
      link.update();

      // A THIRD ANNOTATION THAT IS DRAWN, because the two above are not.
      // `bake` writes an annotation's APPEARANCE into the page content and
      // removes it; a `/Link` has no appearance, so baking leaves it — measured
      // 2026-09-12. Without a drawn one in the fixture, the flatten case would
      // be asserting about annotations flattening cannot reach.
      const note = page.createAnnotation('Square');
      note.setRect([260, 20, 360, 40]);
      note.update();
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** What the SAVED bytes of a session still carry. */
async function savedContent(session: MupdfSession): Promise<ReturnType<typeof activeContentIn>> {
  const bytes = await mupdfWriter.serialise(session);
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
  try {
    return activeContentIn(document);
  } finally {
    document.destroy();
  }
}

/** Whether a URI link survived, read separately from the counter. */
async function linkSurvives(session: MupdfSession): Promise<boolean> {
  const bytes = await mupdfWriter.serialise(session);
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
  try {
    // READ FROM `/Annots`, not from `getAnnotations()`, for the reason
    // `annotationObjects` records: MuPDF filters Links out of that reader, so a
    // check written through it would answer *the link is gone* for a link that
    // is in the file.
    const annots = document.loadPage(0).getObject().get('Annots');
    if (annots.isNull()) return false;
    let found = false;
    annots.forEach((value) => {
      if (!value.isDictionary()) return;
      const action = value.get('A');
      if (action.isDictionary() && String(action.get('S')) === '/URI') found = true;
    });
    return found;
  } finally {
    document.destroy();
  }
}

describe('sanitizeDocument', () => {
  it('CONTROL: the fixture carries all of it before anything runs', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      const before = await savedContent(session);
      expect(before.javascript).toBeGreaterThan(0);
      expect(before.embeddedFiles).toBe(1);
      expect(before.external).toBe(1);
      // THREE: two links and a drawn square. Only the square can be flattened.
      expect(before.annotations).toBe(3);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('removes JavaScript from the SAVED bytes, not just from the catalogue', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['javascript'],
      });
      expect((await savedContent(session)).javascript).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: removing JavaScript leaves the attachments and the link alone', async () => {
    // The part list is the one thing this payload decides, and a command that
    // ignored it and did everything would pass every removal case above.
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['javascript'],
      });
      const after = await savedContent(session);
      expect(after.embeddedFiles).toBe(1);
      expect(after.annotations).toBe(3);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('removes attachments', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['embedded-files'],
      });
      expect((await savedContent(session)).embeddedFiles).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('removes a SUBMIT action and KEEPS the link beside it', async () => {
    // The load-bearing case. A sanitise that deleted every `/A` would answer
    // `external: 0` exactly as correctly and take every link in the document
    // with it — which is the removal reading as success.
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['external-actions'],
      });
      expect((await savedContent(session)).external).toBe(0);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('FLATTENS a drawn annotation into the page, and leaves the links', async () => {
    // MEASURED 2026-09-12, and it is the honest reading of what flattening is:
    // `bake` writes an annotation's APPEARANCE into the content and removes it,
    // and a `/Link` has no appearance. So a flattened document still has
    // clickable links — which is right, and is why the *external actions* part
    // exists separately. Asserting `0` here would have been asserting something
    // flattening cannot do.
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: ['flatten'] });
      expect((await savedContent(session)).annotations).toBe(2);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('refuses to record prior state', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      const captured = await captureSanitizeDocument(session);
      expect(captured.captured).toBe(false);
      expect(captured.captured ? '' : captured.reason).toContain('catalogue');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
