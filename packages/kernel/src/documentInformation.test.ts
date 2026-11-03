import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from '@cantoo/pdf-lib';
import type { DocumentInformationFields } from '@monstera/contract';
import { type Element, Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { applySetDocumentInformation, isoOfPdfDate, pdfDateOfIso, readDocumentInformation } from './documentInformation.js';
import { applySanitizeDocument } from './documentSanitize.js';
import { mupdfWriter } from './mupdfWriter.js';
import { wholeFile } from './pdfLibSession.js';

/**
 * Document properties (ADR-0283), written through MuPDF, saved, and read back by two libraries that are not this
 * module: pdf-lib for the Info dictionary, happy-dom's XML parser for the packet. Each case reads the SAVED bytes.
 */

const DC = 'http://purl.org/dc/elements/1.1/';
const PDF = 'http://ns.adobe.com/pdf/1.3/';
const XMP = 'http://ns.adobe.com/xap/1.0/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

/** A packet as a producer writes one, with a property this command does not own. */
const PACKET = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${RDF}">
<rdf:Description rdf:about="" xmlns:dc="${DC}"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old title</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="${XMP}" xmp:CreatorTool="Some writer" xmp:CreateDate="2020-02-03T04:05:06Z"/>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

type Shape = 'info' | 'xmp' | 'both' | 'neither';

async function documentOf(shape: Shape): Promise<Uint8Array> {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([300, 200]).drawText('words', { x: 20, y: 150, size: 12, font: await document.embedFont(StandardFonts.Helvetica) });
  if (shape === 'info' || shape === 'both') {
    document.setTitle('Old title');
    document.setAuthor('Old author');
    document.setCreationDate(new Date(Date.UTC(2020, 1, 3, 4, 5, 6)));
  }
  if (shape === 'xmp' || shape === 'both') {
    const stream = document.context.stream(PACKET, { Type: 'Metadata', Subtype: 'XML' });
    document.catalog.set(PDFName.of('Metadata'), document.context.register(stream));
  }
  return wholeFile(document, { useObjectStreams: false });
}

const NEW: DocumentInformationFields = {
  title: 'Quarterly report — Ünïcode & <angles>',
  author: 'Lin Wei',
  subject: 'Numbers for the board',
  keywords: 'q3, money',
  created: '2025-06-07T08:09:10+02:00',
  modified: '2026-11-01T12:00:00Z',
};

/** Writes `fields` through the command, saves, and answers the saved bytes. */
async function written(bytes: Uint8Array, fields: DocumentInformationFields): Promise<Uint8Array> {
  const session = await mupdfWriter.open(bytes);
  try {
    await applySetDocumentInformation(session, { kind: 'setDocumentInformation', fields });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** The Info dictionary as pdf-lib reads it, every value as text. */
async function infoRead(bytes: Uint8Array): Promise<Record<string, string | null>> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = document.context.lookup(document.context.trailerInfo.Info);
  const text = (key: string): string | null => {
    if (!(info instanceof PDFDict)) return null;
    const value = info.lookup(PDFName.of(key));
    return value instanceof PDFString || (value !== undefined && 'decodeText' in value) ? (value as PDFString).decodeText() : null;
  };
  return { title: text('Title'), author: text('Author'), subject: text('Subject'), keywords: text('Keywords'), created: text('CreationDate'), modified: text('ModDate') };
}

/** The packet's six as an XML parser reads them, or `null` where the saved file has no packet. */
async function xmpRead(bytes: Uint8Array): Promise<Record<string, string[]> | null> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const stream = document.catalog.lookup(PDFName.of('Metadata'));
  if (!(stream instanceof PDFRawStream)) return null;
  const text = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  const parsed = new new Window().DOMParser().parseFromString(text.replace(/<\?xpacket[^>]*\?>/gu, ''), 'application/xml');
  // EVERY ELEMENT WALKED: happy-dom's `getElementsByTagNameNS` answers nothing for XML (xmpInformation.test.ts).
  const all = Array.from(parsed.getElementsByTagName('*'));
  if (!all.some((element) => element.namespaceURI === RDF && element.localName === 'RDF')) throw new Error('no rdf:RDF seen');
  const values = (ns: string, name: string): string[] => {
    const found: string[] = [];
    for (const element of all.filter((each: Element) => each.namespaceURI === ns && each.localName === name)) {
      const items = Array.from(element.getElementsByTagName('*')).filter((each) => each.namespaceURI === RDF && each.localName === 'li');
      found.push(...(items.length > 0 ? items.map((item) => item.textContent) : [element.textContent]));
    }
    return found;
  };
  return {
    title: values(DC, 'title'),
    author: values(DC, 'creator'),
    subject: values(DC, 'description'),
    keywords: values(PDF, 'Keywords'),
    created: values(XMP, 'CreateDate'),
    modified: values(XMP, 'ModifyDate'),
  };
}

/** What the window reads of the saved bytes, through the module's own read. */
async function shown(bytes: Uint8Array): Promise<Awaited<ReturnType<typeof readDocumentInformation>>> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await readDocumentInformation(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

const INFO_EXPECTED = {
  title: NEW.title,
  author: NEW.author,
  subject: NEW.subject,
  keywords: NEW.keywords,
  created: "D:20250607080910+02'00'",
  modified: 'D:20261101120000Z',
};

describe('PDF dates', () => {
  it('reads every precision the format allows, keeping a stated offset and inventing none', () => {
    expect(isoOfPdfDate("D:20250607080910+02'00'")).toBe('2025-06-07T08:09:10+02:00');
    expect(isoOfPdfDate('D:20261101120000Z')).toBe('2026-11-01T12:00:00Z');
    expect(isoOfPdfDate('D:2024')).toBe('2024-01-01T00:00:00');
    expect(isoOfPdfDate('yesterday')).toBeNull();
    expect(pdfDateOfIso('2025-06-07T08:09:10-05:30')).toBe("D:20250607080910-05'30'");
    expect(isoOfPdfDate(pdfDateOfIso('2025-06-07T08:09:10'))).toBe('2025-06-07T08:09:10');
  });
});

describe('setDocumentInformation — Info and XMP written together, read back by two other libraries', () => {
  it('BOTH: every field reaches the Info dictionary and the packet, they agree, and the packet keeps what it does not own', async () => {
    const saved = await written(await documentOf('both'), NEW);
    expect(await infoRead(saved)).toStrictEqual(INFO_EXPECTED);
    expect(await xmpRead(saved)).toStrictEqual({
      title: [NEW.title],
      author: [NEW.author],
      subject: [NEW.subject],
      keywords: [NEW.keywords],
      created: [NEW.created],
      modified: [NEW.modified],
    });
    expect((await shown(saved)).fields).toStrictEqual(NEW);
    // KEPT: a property this command does not own, in a packet MuPDF may have compressed, so read through pdf-lib.
    const document = await PDFDocument.load(saved, { updateMetadata: false });
    const stream = document.catalog.lookup(PDFName.of('Metadata'));
    expect(stream instanceof PDFRawStream && new TextDecoder().decode(decodePDFRawStream(stream).decode())).toContain('xmp:CreatorTool="Some writer"');
  });

  it('CONTROL, INFO ONLY: the Info dictionary is written and no packet is made', async () => {
    const saved = await written(await documentOf('info'), NEW);
    expect(await infoRead(saved)).toStrictEqual(INFO_EXPECTED);
    expect(await xmpRead(saved)).toBeNull();
    expect((await shown(saved)).has).toStrictEqual({ info: true, xmp: false });
  });

  it('CONTROL, XMP ONLY: the packet is written and an Info dictionary is made that agrees with it', async () => {
    const before = await shown(await documentOf('xmp'));
    expect(before.has).toStrictEqual({ info: false, xmp: true });
    expect(before.fields.title).toBe('Old title');
    const saved = await written(await documentOf('xmp'), NEW);
    expect(await infoRead(saved)).toStrictEqual(INFO_EXPECTED);
    expect((await xmpRead(saved))?.['title']).toStrictEqual([NEW.title]);
  });

  it('CONTROL, NEITHER: an Info dictionary is made, and no packet', async () => {
    const before = await shown(await documentOf('neither'));
    expect(before.has).toStrictEqual({ info: false, xmp: false });
    expect(before.fields).toStrictEqual({ title: '', author: '', subject: '', keywords: '', created: null, modified: null });
    const saved = await written(await documentOf('neither'), NEW);
    expect(await infoRead(saved)).toStrictEqual(INFO_EXPECTED);
    expect(await xmpRead(saved)).toBeNull();
  });

  it('an emptied field leaves both copies, and the others stay', async () => {
    const saved = await written(await documentOf('both'), { ...NEW, title: '', created: null });
    const info = await infoRead(saved);
    expect([info['title'], info['created'], info['author']]).toStrictEqual([null, null, NEW.author]);
    const xmp = await xmpRead(saved);
    expect([xmp?.['title'], xmp?.['created'], xmp?.['author']]).toStrictEqual([[], [], [NEW.author]]);
  });

  it('shows the read-only facts: the format, no encryption, every permission, the page count and size', async () => {
    const facts = await shown(await documentOf('info'));
    expect(facts.format).toMatch(/^PDF[- ]1\.\d$/u);
    expect(facts.encryption).toBe('None');
    expect(facts.permissions).toStrictEqual({ print: true, copy: true, edit: true, annotate: true });
    expect([facts.pageCount, facts.firstPage]).toStrictEqual([1, { width: 300, height: 200 }]);
  });
});

describe('Sanitize › Remove document information (ADR-0283 Decision 7)', () => {
  it('removes the Info dictionary and the packet, and CONTROL: another part leaves both', async () => {
    const strip = async (part: 'document-information' | 'javascript'): Promise<Uint8Array> => {
      const session = await mupdfWriter.open(await documentOf('both'));
      try {
        await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: [part] });
        return await mupdfWriter.serialise(session);
      } finally {
        await mupdfWriter.close(session);
      }
    };
    const removed = await strip('document-information');
    expect((await infoRead(removed))['title']).toBeNull();
    expect(await xmpRead(removed)).toBeNull();
    expect(new TextDecoder('latin1').decode(removed)).not.toContain('Old title');

    const kept = await strip('javascript');
    expect((await infoRead(kept))['title']).toBe('Old title');
    expect((await xmpRead(kept))?.['title']).toStrictEqual(['Old title']);
  });
});
