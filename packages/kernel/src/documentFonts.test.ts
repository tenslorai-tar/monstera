import { PDFDocument, PDFName, type PDFRef } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { readDocumentFonts } from './documentFonts.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * *In this document* lists the WHOLE document's fonts (the owner's B2.8).
 *
 * ## Every font sits where a first-page reader cannot reach it but one
 *
 * Page one names one font; page two names none directly and draws a form XObject that names the second; the form's
 * default resources name the third, subset-tagged. A reader of the shown page alone answers one name, a reader of every
 * page's own resources two, so each place the walk goes is held by a name only that place supplies. The form draws itself
 * as well, so a walk that follows forms without remembering them never ends.
 */
async function documentWithFontsEverywhere(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const context = document.context;
  const font = (base: string): PDFRef =>
    context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: PDFName.of(base) }));

  const first = document.addPage([200, 200]);
  first.node.set(PDFName.of('Resources'), context.obj({ Font: context.obj({ F1: font('Helvetica') }) }));

  const formRef = context.nextRef();
  const form = context.stream('q Q', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 10, 10],
    Resources: context.obj({ Font: context.obj({ F2: font('Courier') }), XObject: context.obj({ Self: formRef }) }),
  });
  context.assign(formRef, form);

  const second = document.addPage([200, 200]);
  second.node.set(PDFName.of('Resources'), context.obj({ XObject: context.obj({ Fm: formRef }) }));

  document.catalog.set(
    PDFName.of('AcroForm'),
    context.obj({ Fields: [], DR: context.obj({ Font: context.obj({ F3: font('ABCDEF+Lato-Regular') }) }) }),
  );
  return document.save({ useObjectStreams: false });
}

describe('readDocumentFonts', () => {
  it('lists the fonts of every page, the forms they draw and the form fields, each once', async () => {
    const session = await mupdfWriter.open(await documentWithFontsEverywhere());
    try {
      const { fonts, truncated } = await readDocumentFonts(session);
      expect(fonts).toEqual([
        { name: 'Helvetica', partial: false },
        { name: 'Courier', partial: false },
        { name: 'ABCDEF+Lato-Regular', partial: true },
      ]);
      expect(truncated).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  // THE BOUND'S TWO SIDES: exactly as many names as the bound is a whole answer, one fewer room is a cut one.
  it('says it stopped only when a name was left out', async () => {
    const session = await mupdfWriter.open(await documentWithFontsEverywhere());
    try {
      const whole = await readDocumentFonts(session, 3);
      expect(whole.fonts).toHaveLength(3);
      expect(whole.truncated).toBe(false);

      const cut = await readDocumentFonts(session, 2);
      expect(cut.fonts.map((entry) => entry.name)).toEqual(['Helvetica', 'Courier']);
      expect(cut.truncated).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
