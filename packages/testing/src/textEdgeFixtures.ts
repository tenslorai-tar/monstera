import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

/**
 * Made-up documents for text at a page's edge (the owner's list of 2026-11-17, Fixes 2 and 3). No word in them is
 * anyone's: each line says only where it is.
 */

/** A page's lines, as a statement's might run: a label and a number, every 20 points. */
const LINE_PITCH = 20;

/**
 * THE SHAPE A CONVERTER FROM HTML MAKES (Fix 2): the whole statement drawn on every page, shifted up a page each time,
 * with the page's edge hiding the rest. So each of the three pages shows its own third and carries the other two above
 * and below it, wholly off the page.
 */
export async function shiftedStatementPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const height = 842;
  const total = 3 * Math.floor((height - 80) / LINE_PITCH);
  for (let page = 0; page < 3; page += 1) {
    const sheet = document.addPage([595, height]);
    for (let line = 0; line < total; line += 1) {
      // THE WHOLE STATEMENT, each line placed as if the statement were one tall page, this page showing its own part.
      const y = height - 40 - (line - page * Math.floor((height - 80) / LINE_PITCH)) * LINE_PITCH;
      sheet.drawText(`Row ${String(line + 1)} of the statement`, { x: 72, y, size: 11, font });
      sheet.drawText(String((line + 1) * 7), { x: 480, y, size: 11, font });
    }
  }
  return document.save();
}

/**
 * A PAGE THAT OPENS WITH A BLOCK ALREADY PAST ITS FOOT (Fix 3): a paragraph whose last lines run below the page, as the
 * file was made, nobody's edit; and a paragraph wholly on the page above it.
 */
export async function openedPastPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const sheet = document.addPage([595, 842]);
  for (let line = 0; line < 4; line += 1) sheet.drawText(`A paragraph on the page, line ${String(line + 1)}`, { x: 72, y: 700 - line * 14, size: 11, font });
  for (let line = 0; line < 6; line += 1) sheet.drawText(`A paragraph past the foot, line ${String(line + 1)}`, { x: 72, y: 40 - line * 14, size: 11, font });
  return document.save();
}
