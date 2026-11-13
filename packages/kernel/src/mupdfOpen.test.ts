import { PDFDocument as PdfLibDocument, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import { lockedPageTree } from './lockedPageTreeFixture.js';
import { openPdfFile, pagesWithoutRepair, startxrefBroken } from './mupdfOpen.js';
import * as mupdf from './mupdfRaw.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { signatureFromScan } from './signatureScan.js';

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (character) => character.charCodeAt(0));

async function twoPages(): Promise<{ readonly bytes: Uint8Array; readonly root: string; readonly size: number }> {
  const doc = await PdfLibDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const words of ['First page words', 'Second page words']) doc.addPage([300, 200]).drawText(words, { x: 20, y: 150, size: 14, font });
  const bytes = await doc.save({ useObjectStreams: false });
  const text = new TextDecoder('latin1').decode(bytes);
  const root = /\/Root (\d+ \d+ R)/u.exec(text)?.[1];
  const size = Number(/\/Size (\d+)/u.exec(text)?.[1]);
  if (root === undefined || !Number.isFinite(size)) throw new Error('the fixture has no trailer to read');
  return { bytes, root, size };
}

/** The file with a last section appended whose /Prev is the section's own offset, as a table. */
async function selfPointingTable(): Promise<Uint8Array> {
  const { bytes, root, size } = await twoPages();
  const at = bytes.length;
  const tail = `xref\n0 1\n0000000000 65535 f \ntrailer\n<</Size ${String(size)}/Root ${root}/Prev ${String(at)}>>\nstartxref\n${String(at)}\n%%EOF\n`;
  return Uint8Array.from([...bytes, ...latin1(tail)]);
}

/** The same as an XRef stream, the shape the file that found this has: one entry, uncompressed. */
async function selfPointingStream(): Promise<Uint8Array> {
  const { bytes, root, size } = await twoPages();
  const at = bytes.length;
  // ONE FIELD WIDTH EACH, an entry saying object 0 is free.
  const entry = '\u0000\u0000\u0000';
  const tail = `${String(size)} 0 obj\n<</Type/XRef/Root ${root}/Size ${String(size + 1)}/Prev ${String(at)}/W[1 1 1]/Index[0 1]/Length 3>>\nstream\n${entry}\nendstream\nendobj\nstartxref\n${String(at)}\n%%EOF\n`;
  return Uint8Array.from([...bytes, ...latin1(tail)]);
}

/**
 * The chain as it stands, by the module's own reading (`pagesWithoutRepair`), for a file with no password. Every fixture
 * read through it is unprotected, so none of them can tell a reader that drops its password from one that keeps it: that
 * is the protected cases' job below (HHHHHHHHH-21).
 */
const pagesWithoutRecovery = (image: Uint8Array): number => pagesWithoutRepair(image, undefined);

/**
 * A PROTECTED file whose last section's /Prev names itself: the two pages encrypted by MuPDF's own writer, which keeps
 * the page dictionaries in a classic table where a rebuild finds them, then the self-pointing table appended with the
 * file's own trailer entries. Its pages are found by the rebuild, and opened only with the password.
 *
 * NOT `lockedPageTree`'s file: its page tree sits in an encrypted object stream, and with the same self-pointing tail
 * `openPdfFile` answered no pages even WITH the password (run 2026-11-14 in this file), so it could not tell a rebuild
 * that keeps the password from one that drops it. Why MuPDF's rebuild does not find it is not established here.
 */
async function protectedSelfPointing(): Promise<Uint8Array> {
  const { bytes } = await twoPages();
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf').asPDF();
  if (opened === null) throw new Error('the fixture is not a PDF');
  const file = opened.saveToBuffer('encrypt=aes-128,user-password=open-me,owner-password=own-me').asUint8Array().slice();
  opened.destroy();
  const text = new TextDecoder('latin1').decode(file);
  const trailer = /trailer\s*<<(.*?)>>\s*startxref/su.exec(text)?.[1];
  if (!trailer?.includes('/Encrypt')) throw new Error('the protected fixture has no trailer to copy');
  const at = file.length;
  const tail = `xref\n0 1\n0000000000 65535 f \ntrailer\n<<${trailer}/Prev ${String(at)}>>\nstartxref\n${String(at)}\n%%EOF\n`;
  return Uint8Array.from([...file, ...latin1(tail)]);
}

describe.each([
  ['an XRef stream', selfPointingStream],
  ['a table', selfPointingTable],
])('a last cross-reference section whose /Prev names itself, as %s', (_shape, fixture) => {
  it('MuPDF alone reads no pages from it, which is what this file is for', async () => {
    // CONTROL: the fault as it comes. If MuPDF ever follows such a chain itself, this goes red and the recovery can go.
    expect(pagesWithoutRecovery(await fixture())).toBe(0);
  });

  it('opens with its pages and its words, through the writer every document opens by', async () => {
    const session = await mupdfWriter.open(await fixture());
    try {
      const words = await withDocument(session, (document) => {
        expect(document.countPages()).toBe(2);
        return document.loadPage(1).toStructuredText().asText();
      });
      expect(words).toContain('Second page words');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('survives a save and a reopen', async () => {
    const session = await mupdfWriter.open(await fixture());
    let saved: Uint8Array;
    try {
      saved = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
    // THE SAVED FILE READS WITHOUT ANY RECOVERY: the chain it carries is MuPDF's own.
    expect(pagesWithoutRecovery(saved)).toBe(2);
  });

  it('is drawn by the other reader that takes a file as it is', async () => {
    expect(signatureFromScan(await fixture()).kind).not.toBe('unreadable');
  });
});

describe('a chain read as it stands (pagesWithoutRepair), the appended save’s check', () => {
  it('A PROTECTED FILE whose page tree is in an encrypted object stream reads its pages WITH its password', () => {
    const file = lockedPageTree('open-me', 'own-me');
    expect(pagesWithoutRepair(file, 'open-me')).toBe(1);
    // WHY THE PASSWORD IS PASSED: without it the same file reads no pages, which is what refused every save of one.
    expect(pagesWithoutRepair(file, undefined)).toBe(0);
    // AND A WRONG ONE IS NOT TAKEN AS A READING.
    expect(pagesWithoutRepair(file, 'wrong')).toBe(0);
  });

  it('CONTROL: a broken chain still reads no pages, a password given or not, where the rebuild would hide it', async () => {
    const broken = await selfPointingStream();
    expect(pagesWithoutRepair(broken, 'any')).toBe(0);
    expect(pagesWithoutRepair(broken, undefined)).toBe(0);
    const rebuilt = openPdfFile(broken, undefined).document;
    try {
      expect(rebuilt.countPages()).toBe(2);
    } finally {
      rebuilt.destroy();
    }
  });
});

describe('the recovery of a PROTECTED file (HHHHHHHHH-21)', () => {
  it('a protected file whose chain names itself is rebuilt WITH its password, and reads its pages', async () => {
    const file = await protectedSelfPointing();
    // CONTROL: as its chain stands it reads no pages even with the password, so what reads them is the rebuild.
    expect(pagesWithoutRepair(file, 'open-me')).toBe(0);
    const { document, access } = openPdfFile(file, 'open-me');
    try {
      expect(access).toBeGreaterThan(0);
      expect(document.countPages()).toBe(2);
      expect(document instanceof mupdf.PDFDocument && document.wasRepaired()).toBe(true);
    } finally {
      document.destroy();
    }
  });
});

describe('what the recovery leaves alone', () => {
  it('a sound file is opened from its own bytes, its chain intact', async () => {
    const { bytes } = await twoPages();
    const { document } = openPdfFile(bytes, undefined);
    try {
      expect(document.countPages()).toBe(2);
      // A REBUILD WOULD SAY SO, and would cost the file its incremental save.
      expect(document instanceof mupdf.PDFDocument && document.wasRepaired()).toBe(false);
    } finally {
      document.destroy();
    }
  });

  it('the broken file is opened from a rebuild, and says so', async () => {
    const { document } = openPdfFile(await selfPointingStream(), undefined);
    try {
      expect(document instanceof mupdf.PDFDocument && document.wasRepaired()).toBe(true);
    } finally {
      document.destroy();
    }
  });

  it('the rebuild is asked of a copy: the bytes it was given are unchanged', async () => {
    const image = await selfPointingStream();
    const before = Uint8Array.from(image);
    const document = openPdfFile(image, undefined).document;
    document.destroy();
    expect(image).toStrictEqual(before);
  });

  it('only the LAST startxref is broken, keeping the file its length', () => {
    const image = latin1('a startxref\n11\n%%EOF\nb startxref\n2345\n%%EOF\n');
    const broken = startxrefBroken(image);
    expect(new TextDecoder('latin1').decode(broken ?? new Uint8Array())).toBe('a startxref\n11\n%%EOF\nb startxref\n0000\n%%EOF\n');
    expect(startxrefBroken(latin1('no such keyword here'))).toBeNull();
  });
});
