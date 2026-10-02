import { MAX_OFFICE_IMPORT_BYTES } from '@monstera/contract';
import { describe, expect, it, vi } from 'vitest';

import {
  type AttachedFile,
  type AttachmentReaders,
  classifyAttachments,
  familyOf,
  readAttachments as readClassified,
  textSourcesIn,
} from './askAttachments.js';
import { LayoutTextFailedError } from './layoutText.js';
import { OfficeConversionFailedError } from './officeConversion.js';

/** Both passes, as the ask runs them: each file's family, then each read. */
async function readAttachments(attached: readonly AttachedFile[], readers: AttachmentReaders, share: number, canSee: boolean) {
  return readClassified(await classifyAttachments(attached, readers), readers, share, canSee);
}

/**
 * Files attached to a question (ADR-0135): one fixture per family — text, picture, PDF, Office and unreadable — through
 * the readers `main` is handed, each contained reader a fake that records what it was given. The live readers are
 * crossed only on Windows, where their containment is; what this proves is which reader each file reaches, what goes
 * to the model, and that no file's failure is the question's.
 */

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A PDF's first bytes: enough for the family, which is all `main` reads of one. */
const PDF_BYTES = encode('%PDF-1.7\n% the rest is the converter’s to read');
/** A PNG's signature, and bytes `main` never decodes. */
const PNG_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4);
/** A JPEG's start-of-image. */
const JPEG_BYTES = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8);
/** An Office file is a zip: its family comes from the extension, since the signature is every zip's. */
const DOCX_BYTES = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9);
/** Bytes that are not UTF-8 text: a lone continuation byte and a NUL. */
const BINARY_BYTES = Uint8Array.of(0x80, 0x00, 0xfe, 0xff);

/** pdftotext's output: each page followed by a form feed, one chunk each, as a stream answers them. */
async function* pages(...texts: string[]): AsyncIterable<Uint8Array> {
  for (const text of texts) yield await Promise.resolve(encode(`${text}\f`));
}

/** Readers over an in-memory disk, every contained reader present and recording its input. */
function readersOver(disk: Record<string, Uint8Array>, overrides: Partial<AttachmentReaders> = {}) {
  const pdfText = vi.fn((pdf: Uint8Array) => {
    void pdf;
    return Promise.resolve(pages('First page words.', 'Second page words.'));
  });
  const officePdf = vi.fn((format: string, file: Uint8Array) => {
    void format;
    void file;
    return Promise.resolve({ output: pages('%PDF-converted'), discard: () => undefined, missing: [] });
  });
  const pictureSize = vi.fn((bytes: Uint8Array, mediaType: string) => {
    void bytes;
    void mediaType;
    return Promise.resolve({ width: 1200, height: 900 });
  });
  const readers: AttachmentReaders = {
    size: (path) => Promise.resolve(disk[path]?.byteLength ?? null),
    read: (path, limit) => Promise.resolve(disk[path]?.slice(0, limit) ?? null),
    pdfText,
    officePdf,
    pictureSize,
    ...overrides,
  };
  return { readers, pdfText, officePdf, pictureSize };
}

describe('the family of an attached file (Decision 3)', () => {
  it('reads the bytes FIRST: a PDF named .docx is a PDF, and a picture named .txt is a picture', () => {
    expect(familyOf(PDF_BYTES, 'report.docx')).toStrictEqual({ kind: 'pdf' });
    expect(familyOf(JPEG_BYTES, 'notes.txt')).toStrictEqual({ kind: 'picture', mediaType: 'image/jpeg' });
    expect(familyOf(PNG_BYTES, 'a')).toStrictEqual({ kind: 'picture', mediaType: 'image/png' });
  });

  it('then the extension, for Office, and anything else is a text candidate', () => {
    expect(familyOf(DOCX_BYTES, 'Budget.XLSX')).toStrictEqual({ kind: 'office', format: 'xlsx' });
    expect(familyOf(DOCX_BYTES, 'archive.zip')).toStrictEqual({ kind: 'text' });
  });

  it('counts TEXT SOURCES for the share: every file but a picture, and a file not found is none', async () => {
    const disk = { '/a.pdf': PDF_BYTES, '/b.png': PNG_BYTES, '/c.txt': encode('c'), '/d.docx': DOCX_BYTES };
    const { readers } = readersOver(disk);
    const classified = await classifyAttachments(
      [...Object.keys(disk).map((path) => ({ name: path.slice(1), path })), { name: 'forged', path: null }],
      readers,
    );
    expect(textSourcesIn(classified)).toBe(3);
  });
});

describe('reading attached files (ADR-0135)', () => {
  const SHARE = 50_000;

  it('TEXT is decoded and windowed as File n, one page of one', async () => {
    const { readers } = readersOver({ '/notes.txt': encode('The meeting is on Tuesday.') });
    const read = await readAttachments([{ name: 'notes.txt', path: '/notes.txt' }], readers, SHARE, true);
    expect(read.files).toMatchObject([{ sent: { firstPage: 0, lastPage: 0, pageCount: 1, truncated: false } }]);
    const listed = read.listed[0];
    expect(listed !== undefined && 'window' in listed && listed.window.text).toContain('[File 1 page 1]\nThe meeting is on Tuesday.');
    expect(read.images).toStrictEqual([]);
  });

  it('a PICTURE is sized by the compose host and its bytes go UNCHANGED, after the words File n:', async () => {
    const { readers, pictureSize } = readersOver({ '/a.txt': encode('x'), '/receipt.jpg': JPEG_BYTES });
    const read = await readAttachments(
      [
        { name: 'a.txt', path: '/a.txt' },
        { name: 'receipt.jpg', path: '/receipt.jpg' },
      ],
      readers,
      SHARE,
      true,
    );
    expect(pictureSize).toHaveBeenCalledWith(JPEG_BYTES, 'image/jpeg');
    expect(read.files[1]).toStrictEqual({ pictured: true });
    // THE SECOND FILE, so the label is its place and not "File 1" by coincidence.
    expect(read.images).toStrictEqual([
      { mediaType: 'image/jpeg', base64: Buffer.from(JPEG_BYTES).toString('base64'), label: 'File 2:' },
    ]);
  });

  it('a PDF goes to pdftotext and its pages are split at the form feed, marked with the file', async () => {
    const { readers, pdfText } = readersOver({ '/contract.pdf': PDF_BYTES });
    const read = await readAttachments([{ name: 'contract.pdf', path: '/contract.pdf' }], readers, SHARE, true);
    expect(pdfText).toHaveBeenCalledWith(PDF_BYTES);
    const listed = read.listed[0];
    const text = listed !== undefined && 'window' in listed ? listed.window.text : '';
    expect(text).toContain('[File 1 page 1]\nFirst page words.');
    expect(text).toContain('[File 1 page 2]\nSecond page words.');
    expect(read.files[0]).toMatchObject({ sent: { firstPage: 0, lastPage: 1, pageCount: 2, truncated: false } });
  });

  it('an OFFICE file goes to x2t by its extension, then its PDF to pdftotext', async () => {
    const { readers, officePdf, pdfText } = readersOver({ '/plan.docx': DOCX_BYTES });
    const read = await readAttachments([{ name: 'plan.docx', path: '/plan.docx' }], readers, SHARE, true);
    expect(officePdf).toHaveBeenCalledWith('docx', DOCX_BYTES);
    // WHAT x2t WROTE is what pdftotext reads — never the zip.
    expect(new TextDecoder().decode(pdfText.mock.calls[0]?.[0])).toBe('%PDF-converted\f');
    expect(read.files[0]).toMatchObject({ sent: { pageCount: 2 } });
  });

  it('UNREADABLE files are NAMED with their reason and the rest still go: bytes that are not text, a converter’s refusal', async () => {
    const { readers } = readersOver(
      { '/blob.bin': BINARY_BYTES, '/broken.pdf': PDF_BYTES, '/broken.docx': DOCX_BYTES, '/ok.txt': encode('fine') },
      {
        pdfText: () => Promise.reject(new LayoutTextFailedError({ stage: 'no-output', said: null })),
        officePdf: () => Promise.reject(new OfficeConversionFailedError({ stage: 'no-output', said: null })),
      },
    );
    const read = await readAttachments(
      [
        { name: 'blob.bin', path: '/blob.bin' },
        { name: 'broken.pdf', path: '/broken.pdf' },
        { name: 'broken.docx', path: '/broken.docx' },
        { name: 'ok.txt', path: '/ok.txt' },
      ],
      readers,
      SHARE,
      true,
    );
    expect(read.files.slice(0, 3)).toStrictEqual([{ unread: 'not-supported' }, { unread: 'unreadable' }, { unread: 'unreadable' }]);
    expect(read.files[3]).toMatchObject({ sent: { pageCount: 1 } });
    expect(read.listed.slice(0, 3).map((each) => ('unread' in each ? each.name : ''))).toStrictEqual(['blob.bin', 'broken.pdf', 'broken.docx']);
  });

  it('a converter that FAULTS rather than refuses is not dressed up as the file’s', async () => {
    const { readers } = readersOver({ '/a.pdf': PDF_BYTES }, { pdfText: () => Promise.reject(new Error('a defect')) });
    await expect(readAttachments([{ name: 'a.pdf', path: '/a.pdf' }], readers, SHARE, true)).rejects.toThrow('a defect');
  });

  it('with NO contained reader here, a PDF, an Office file and a picture are named — and CONTROL: text is still read', async () => {
    const { readers } = readersOver(
      { '/a.pdf': PDF_BYTES, '/b.docx': DOCX_BYTES, '/c.png': PNG_BYTES, '/d.txt': encode('words') },
      { pdfText: null, officePdf: null, pictureSize: null },
    );
    const read = await readAttachments(
      ['/a.pdf', '/b.docx', '/c.png', '/d.txt'].map((path) => ({ name: path.slice(1), path })),
      readers,
      SHARE,
      true,
    );
    expect(read.files.slice(0, 3)).toStrictEqual([
      { unread: 'cannot-read-here' },
      { unread: 'cannot-read-here' },
      { unread: 'cannot-read-here' },
    ]);
    expect(read.files[3]).toMatchObject({ sent: { pageCount: 1 } });
  });

  it('a picture for a model that CANNOT SEE is named and never read; past 8000 px it is too large', async () => {
    const { readers, pictureSize } = readersOver({ '/c.png': PNG_BYTES });
    expect((await readAttachments([{ name: 'c.png', path: '/c.png' }], readers, SHARE, false)).files).toStrictEqual([
      { unread: 'cannot-see' },
    ]);
    expect(pictureSize).not.toHaveBeenCalled();

    const huge = readersOver({ '/c.png': PNG_BYTES }, { pictureSize: () => Promise.resolve({ width: 8001, height: 10 }) });
    expect((await readAttachments([{ name: 'c.png', path: '/c.png' }], huge.readers, SHARE, true)).files).toStrictEqual([
      { unread: 'too-large' },
    ]);
    // CONTROL: exactly the limit is sent.
    const edge = readersOver({ '/c.png': PNG_BYTES }, { pictureSize: () => Promise.resolve({ width: 8000, height: 8000 }) });
    expect((await readAttachments([{ name: 'c.png', path: '/c.png' }], edge.readers, SHARE, true)).files).toStrictEqual([
      { pictured: true },
    ]);
  });

  it('a handle main never minted, or a file that went, is NOT FOUND; a PDF past the copy’s ceiling is too large, unread', async () => {
    const { readers, pdfText } = readersOver({}, { size: (path) => Promise.resolve(path === '/big.pdf' ? MAX_OFFICE_IMPORT_BYTES + 1 : null) });
    const big = { ...readers, read: (path: string, limit: number) => Promise.resolve(path === '/big.pdf' && limit <= 8 ? PDF_BYTES.slice(0, limit) : null) };
    const read = await readAttachments(
      [
        { name: 'forged', path: null },
        { name: 'gone.txt', path: '/gone.txt' },
        { name: 'big.pdf', path: '/big.pdf' },
      ],
      big,
      SHARE,
      true,
    );
    expect(read.files).toStrictEqual([{ unread: 'not-found' }, { unread: 'not-found' }, { unread: 'too-large' }]);
    expect(pdfText).not.toHaveBeenCalled();
  });

  it('HOLDS TO THE SHARE: a long PDF counts every page, keeps what fits, and says it stopped', async () => {
    const long = Array.from({ length: 40 }, (_, at) => `Page ${String(at + 1)} `.repeat(30));
    const { readers } = readersOver({ '/long.pdf': PDF_BYTES }, { pdfText: () => Promise.resolve(pages(...long)) });
    const read = await readAttachments([{ name: 'long.pdf', path: '/long.pdf' }], readers, 1_000, true);
    const sent = read.files[0];
    expect(sent).toMatchObject({ sent: { firstPage: 0, pageCount: 40, truncated: true } });
    expect(sent !== undefined && 'sent' in sent && sent.sent.characters).toBeLessThanOrEqual(1_000);
  });

  it('a text file read only IN PART is cut, and its read stopped at four bytes a character of the share', async () => {
    const reads: number[] = [];
    const disk = { '/big.txt': encode('a'.repeat(10_000)) };
    const { readers } = readersOver(disk);
    const counting = {
      ...readers,
      read: (path: string, limit: number) => {
        reads.push(limit);
        return readers.read(path, limit);
      },
    };
    const read = await readAttachments([{ name: 'big.txt', path: '/big.txt' }], counting, 100, true);
    expect(reads).toStrictEqual([8, 404]);
    expect(read.files[0]).toMatchObject({ sent: { truncated: true } });
  });
});
