import type { DocumentInformation, DocumentInformationFields } from '@monstera/contract';
import { MAX_DOCUMENT_INFORMATION_TEXT } from '@monstera/contract/host';

import type { CaptureResult } from './commandLog.js';
import type { Apply, MupdfSession } from './engineSeam.js';
import type * as mupdf from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { type XmpInformation, withXmpInformation, xmpInformationOf } from './xmpInformation.js';

/**
 * A document's own information, read and written
 * ([ADR-0283](../../../docs/DECISIONS/0283-document-properties-edits-the-info-dictionary-and-the-xmp-packet-together.md)).
 *
 * ## Two copies, written together
 *
 * The trailer's Info dictionary and the catalogue's XMP packet state the same six facts, and readers differ in which
 * they show. MuPDF's `setMetaData` writes the first alone. So the write here sets the Info dictionary always, making it
 * where there is none, and the packet where there is one (`xmpInformation.ts`); a document with no packet gets none,
 * since there is then no second copy to show a stale value.
 *
 * Windows' own file dates are a different thing and nothing here can reach them: this writes the document's objects.
 */

/** The Info dictionary's keys for the six, ISO 32000-1 Table 317. */
const INFO_KEYS = {
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  created: 'CreationDate',
  modified: 'ModDate',
} as const satisfies Record<keyof DocumentInformationFields, string>;

const PDF_DATE = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?/u;

/**
 * A PDF date (§7.9.4, `D:YYYYMMDDHHmmSSOHH'mm`) as ISO 8601 to the second, every omitted part its default; the offset
 * kept where it is stated and left out where it is not, since a zone the PDF did not name is not one to invent.
 * `null` for a string that is not a PDF date.
 */
export function isoOfPdfDate(text: string): string | null {
  const match = PDF_DATE.exec(text.trim());
  if (match === null) return null;
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', zulu, sign, offsetHours, offsetMinutes = '00'] = match;
  const offset = zulu !== undefined ? 'Z' : sign !== undefined && offsetHours !== undefined ? `${sign}${offsetHours}:${offsetMinutes}` : '';
  return `${year ?? ''}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

/** An ISO date as this module writes it, as a PDF date: {@link isoOfPdfDate}'s inverse. */
export function pdfDateOfIso(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))?$/u.exec(iso);
  if (match === null) throw new Error(`not a date this command carries: ${iso}`);
  const [, year, month, day, hour, minute, second, zone, sign, offsetHours, offsetMinutes] = match;
  const offset = zone === 'Z' ? 'Z' : sign !== undefined ? `${sign}${offsetHours ?? '00'}'${offsetMinutes ?? '00'}'` : '';
  return `D:${year ?? ''}${month ?? ''}${day ?? ''}${hour ?? ''}${minute ?? ''}${second ?? ''}${offset}`;
}

/** The catalogue's metadata stream, where it has one that is a stream. */
function packetObject(document: mupdf.PDFDocument): mupdf.PDFObject | null {
  const metadata = document.getTrailer().get('Root').get('Metadata');
  return metadata.isIndirect() && metadata.isStream() ? metadata : null;
}

function packetText(stream: mupdf.PDFObject): string {
  const buffer = stream.readStream();
  try {
    return new TextDecoder().decode(buffer.asUint8Array());
  } finally {
    buffer.destroy();
  }
}

function textOf(object: mupdf.PDFObject): string | null {
  return object.isString() ? object.asString() : null;
}

/** A text as the window shows it: within the contract's bound, which a crafted document may exceed. */
function bounded(text: string | null): string | null {
  return text === null ? null : text.slice(0, MAX_DOCUMENT_INFORMATION_TEXT);
}

/** The six as the document states them, XMP first and then Info (Decision 6). */
function fieldsOf(info: mupdf.PDFObject, xmp: XmpInformation | null): DocumentInformationFields {
  const fromInfo = (key: keyof DocumentInformationFields): string | null => (info.isDictionary() ? textOf(info.get(INFO_KEYS[key])) : null);
  const text = (key: 'title' | 'author' | 'subject' | 'keywords'): string => bounded(xmp?.[key] ?? fromInfo(key)) ?? '';
  const date = (key: 'created' | 'modified'): string | null => {
    const fromXmp = xmp?.[key];
    const iso = fromXmp === null || fromXmp === undefined ? null : isoOfPdfDate(pdfDateOfXmp(fromXmp));
    if (iso !== null) return iso;
    const raw = fromInfo(key);
    return raw === null ? null : isoOfPdfDate(raw);
  };
  return { title: text('title'), author: text('author'), subject: text('subject'), keywords: text('keywords'), created: date('created'), modified: date('modified') };
}

/** An XMP date (ISO 8601, any precision) as a PDF date, so one parser reads both copies. */
function pdfDateOfXmp(iso: string): string {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/u.exec(iso.trim());
  if (match === null) return '';
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', zone] = match;
  const offset = zone === undefined ? '' : zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}'${zone.slice(4)}'`;
  return `D:${year ?? ''}${month}${day}${hour}${minute}${second}${offset}`;
}

/** What document properties shows (ADR-0283 Decision 2): a read, nothing written. */
export function readDocumentInformation(session: MupdfSession): Promise<DocumentInformation> {
  return withDocument(session, (document) => {
    const info = document.getTrailer().get('Info');
    const stream = packetObject(document);
    const xmp = stream === null ? null : xmpInformationOf(packetText(stream));
    const pages = document.countPages();
    const bounds = pages === 0 ? null : document.loadPage(0).getBounds();
    return {
      fields: fieldsOf(info, xmp),
      has: { info: info.isDictionary(), xmp: stream !== null },
      creator: bounded(info.isDictionary() ? textOf(info.get('Creator')) : null),
      producer: bounded(info.isDictionary() ? textOf(info.get('Producer')) : null),
      format: (document.getMetaData('format') ?? '').slice(0, 64),
      encryption: (document.getMetaData('encryption') ?? 'None').slice(0, 256),
      permissions: {
        print: document.hasPermission('print'),
        copy: document.hasPermission('copy'),
        edit: document.hasPermission('edit'),
        annotate: document.hasPermission('annotate'),
      },
      pageCount: pages,
      firstPage: bounds === null ? null : { width: Math.abs(bounds[2] - bounds[0]), height: Math.abs(bounds[3] - bounds[1]) },
      permanentId: permanentIdOf(document),
    };
  });
}

/** The longest `/ID` string answered, in bytes: writers use 16; past this it is not an id anyone wrote to be one. */
const MAX_PERMANENT_ID_BYTES = 64;

/**
 * The FIRST string of the trailer's `/ID`, as lower-case hex, or `null` (ADR-0279's guard). Its bytes, never its text:
 * an id is binary, and read as text a byte that is no character would be lost. The first string is the one a writer
 * keeps across saves; the second changes with each.
 */
function permanentIdOf(document: mupdf.PDFDocument): string | null {
  const id = document.getTrailer().get('ID');
  if (!id.isArray() || id.length < 1) return null;
  const first = id.get(0);
  if (!first.isString()) return null;
  const bytes = first.asByteString();
  if (bytes.length === 0 || bytes.length > MAX_PERMANENT_ID_BYTES) return null;
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Writes the six (Decision 4): the Info dictionary always, made where there is none; the packet where there is one,
 * its other properties kept. An empty text or a `null` date removes that entry from both.
 */
export const applySetDocumentInformation: Apply<'mupdf', 'setDocumentInformation'> = (session, command) =>
  withDocument(session, (document) => {
    const { fields } = command;
    let info = document.getTrailer().get('Info');
    if (!info.isDictionary()) {
      // THE TRAILER TAKEN AFTER THE OBJECT IS MADE, as `pageRedact.ts` takes it: with the handle taken first, the put
      // was not in the session's trailer afterwards (measured 2026-11-01, `<</Size 4/Root 2 0 R>>`), so a document with
      // no Info dictionary was saved with none.
      info = document.addObject(document.newDictionary());
      document.getTrailer().put('Info', info);
    }
    for (const key of Object.keys(INFO_KEYS) as (keyof typeof INFO_KEYS)[]) {
      const value = fields[key];
      const entry = INFO_KEYS[key];
      if (value === null || value === '') info.delete(entry);
      else info.put(entry, document.newString(key === 'created' || key === 'modified' ? pdfDateOfIso(value) : value));
    }

    const stream = packetObject(document);
    if (stream !== null) {
      const written = withXmpInformation(packetText(stream), {
        title: fields.title,
        author: fields.author,
        subject: fields.subject,
        keywords: fields.keywords,
        created: fields.created,
        modified: fields.modified,
      });
      stream.writeStream(new TextEncoder().encode(written));
      stream.put('Type', document.newName('Metadata'));
      stream.put('Subtype', document.newName('XML'));
    }
  });

/** Reports that the prior state is not recorded: the packet is the document's size, so the checkpoint is the undo. */
export const captureSetDocumentInformation = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason: 'a document’s information includes its XMP packet, whose size is the document’s, so the checkpoint is the undo',
  }));

/** Refuses to invert, for {@link captureSetDocumentInformation}'s reason. */
export const invertSetDocumentInformation = (): never => {
  throw new Error('setDocumentInformation is declared non-invertible. Undo restores the checkpoint.');
};
