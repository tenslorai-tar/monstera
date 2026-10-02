import { type AskFile, MAX_OFFICE_IMPORT_BYTES } from '@monstera/contract';
import {
  type AskFileListed,
  type AskWindow,
  CLAUDE_MAX_IMAGE_ENCODED_BYTES,
  CLAUDE_MAX_IMAGE_SIDE,
  type ChatImage,
  encodedLength,
  readAskWindow,
} from '@monstera/kernel';

import { LayoutTextFailedError, type LayoutTextSource } from './layoutText.js';
import { OfficeConversionFailedError, type OfficeSource, officeImportFormatOf } from './officeConversion.js';

/**
 * The files attached to a question, each read by its contained reader
 * ([ADR-0135](../../../docs/DECISIONS/0135-a-file-attached-to-an-ask-is-read-in-a-contained-process-inside-the-one-bound.md)).
 *
 * ## One file at a time, and one outcome per file
 *
 * Each file is read, windowed and dropped before the next, so `main` holds one window's worth of text plus one file's
 * bytes on the way to a converter — ADR-0088's resident bound, kept per file. Every file ends in exactly one outcome,
 * the contract's `AskFile`, and no file's failure is the question's: Decision 6.
 *
 * ## What `main` itself does to a file's bytes
 *
 * Reads its first bytes to choose a reader, hands the whole file to a contained converter, base64s a picture whose size
 * the compose host read, and decodes text as UTF-8 — Decision 4's one family read here, and the only parse.
 */

/** A file the question names: its name for the person and the model, and its path, or `null` for a handle not minted. */
export interface AttachedFile {
  readonly name: string;
  readonly path: string | null;
}

/** How this process reaches a picked file and the contained readers — each `null` where this build has none (Decision 7). */
export interface AttachmentReaders {
  /** The file's size, or `null` when it is not there to read. */
  readonly size: (path: string) => Promise<number | null>;
  /** The file's first `limit` bytes, or all of it when shorter; `null` when it went. */
  readonly read: (path: string, limit: number) => Promise<Uint8Array | null>;
  /** The contained pdftotext (ADR-0071). */
  readonly pdfText: LayoutTextSource | null;
  /** The contained x2t (ADR-0120). */
  readonly officePdf: OfficeSource | null;
  /** The compose host's `engine/image-size` (Decision 4). */
  readonly pictureSize:
    | ((bytes: Uint8Array, mediaType: ChatImage['mediaType']) => Promise<{ readonly width: number; readonly height: number } | null>)
    | null;
}

/**
 * A picker that picks nothing and no file to read: what a handler graph built for some OTHER channel is given, so it
 * needs no disk. An ask through it names every handle as not found, which is what a handle no file stands behind is.
 */
export const NO_ATTACHMENTS: { readonly pick: () => Promise<readonly string[]>; readonly readers: AttachmentReaders } = {
  pick: () => Promise.resolve([]),
  readers: {
    size: () => Promise.resolve(null),
    read: () => Promise.resolve(null),
    pdfText: null,
    officePdf: null,
    pictureSize: null,
  },
};

/** What the files gave the ask: the instruction's list, the contract's outcomes, and the pictures for the last turn. */
export interface ReadAttachments {
  readonly listed: readonly AskFileListed[];
  readonly files: readonly AskFile[];
  readonly images: readonly ChatImage[];
}

/** A file's family, chosen from its first bytes and then its extension, in that order (Decision 3). */
export type Family =
  | { readonly kind: 'pdf' }
  | { readonly kind: 'picture'; readonly mediaType: ChatImage['mediaType'] }
  | { readonly kind: 'office'; readonly format: NonNullable<ReturnType<typeof officeImportFormatOf>> }
  | { readonly kind: 'text' };

/** Bytes a signature needs: `%PDF-` is five, PNG's is eight. */
const SIGNATURE_BYTES = 8;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, at) => head[at] === byte);
}

/**
 * The family, from the bytes first: a PDF named `.docx` is a PDF. The extension only decides which contained reader is
 * asked for an Office file, which reads the format from the bytes itself (invariant 23).
 */
export function familyOf(head: Uint8Array, name: string): Family {
  if (startsWith(head, PDF)) return { kind: 'pdf' };
  if (startsWith(head, PNG)) return { kind: 'picture', mediaType: 'image/png' };
  if (startsWith(head, JPEG)) return { kind: 'picture', mediaType: 'image/jpeg' };
  const format = officeImportFormatOf(name);
  return format === null ? { kind: 'text' } : { kind: 'office', format };
}

/**
 * A PDF's text, from pdftotext's output, as a window: pages split at the form feed pdftotext writes after each one.
 *
 * EVERY PAGE IS COUNTED and only the pages up to the share are KEPT, so the window can say *pages 1 to 3 of 40* while
 * `main` holds at most one share and a page of text. Once a kept page passes the share, `readAskWindow` cuts and marks
 * the window truncated — which is what makes dropping the rest safe to say nothing more about.
 */
async function pdfWindow(output: AsyncIterable<Uint8Array>, share: number, place: number): Promise<AskWindow> {
  const decoder = new TextDecoder('utf-8');
  const kept: string[] = [];
  let keptLength = 0;
  let current = '';
  let pages = 0;
  const close = (): void => {
    if (keptLength <= share) {
      kept.push(current);
      keptLength += current.length;
    }
    pages += 1;
    current = '';
  };
  for await (const chunk of output) {
    const text = decoder.decode(chunk, { stream: true });
    const parts = text.split('\f');
    for (const [at, part] of parts.entries()) {
      if (at > 0) close();
      // A PAGE PAST THE SHARE IS COUNTED AND NOT HELD.
      if (keptLength <= share) current += part;
    }
  }
  current += decoder.decode();
  // TEXT AFTER THE LAST FORM FEED is a page pdftotext did not close; nothing after it is the ordinary end.
  if (current.trim() !== '') close();
  return readAskWindow(
    kept.map((_text, page) => page),
    pages,
    (page) => Promise.resolve(kept[page] ?? ''),
    share,
    { file: place },
  );
}

/** Every chunk of a stream, joined — the converted PDF on its way to pdftotext — or `null` past `limit`. */
async function collected(output: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of output) {
    length += chunk.byteLength;
    // BREAKING OUT ENDS THE STREAM, and the converter's generator removes its area in its own `finally`.
    if (length > limit) return null;
    chunks.push(chunk);
  }
  const joined = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}

/** One attached file once its family is known — or why it could not be looked at. */
export type ClassifiedFile =
  | { readonly name: string; readonly path: string; readonly size: number; readonly family: Family }
  | { readonly name: string; readonly unread: 'not-found' };

/**
 * Each file's family, from its first bytes and name, before anything is read — so the ask can count its text sources
 * and set the share (Decision 5) before any document or file is windowed.
 */
export async function classifyAttachments(
  attached: readonly AttachedFile[],
  readers: Pick<AttachmentReaders, 'size' | 'read'>,
): Promise<readonly ClassifiedFile[]> {
  const classified: ClassifiedFile[] = [];
  for (const { name, path } of attached) {
    const size = path === null ? null : await readers.size(path);
    const head = path === null || size === null ? null : await readers.read(path, SIGNATURE_BYTES);
    classified.push(
      path === null || size === null || head === null
        ? { name, unread: 'not-found' }
        : { name, path, size, family: familyOf(head, name) },
    );
  }
  return classified;
}

/** How many of the files are TEXT SOURCES — every family but a picture, and a file not found is none (Decision 5). */
export function textSourcesIn(classified: readonly ClassifiedFile[]): number {
  return classified.filter((file) => 'family' in file && file.family.kind !== 'picture').length;
}

/**
 * Reads every attached file, in order, into one outcome each.
 *
 * @param share each text file's characters, the one number the instruction and the turn state (Decision 5)
 * @param canSee whether the model reads pictures: `false` only where its list says it cannot (ADR-0090's rule)
 */
export async function readAttachments(
  classified: readonly ClassifiedFile[],
  readers: AttachmentReaders,
  share: number,
  canSee: boolean,
): Promise<ReadAttachments> {
  const listed: AskFileListed[] = [];
  const files: AskFile[] = [];
  const images: ChatImage[] = [];
  for (const [place, file] of classified.entries()) {
    const outcome = 'unread' in file ? { unread: file.unread } : await readOne(file, place, readers, share, canSee);
    if ('window' in outcome) {
      listed.push({ name: file.name, place, window: outcome.window });
      files.push({ sent: outcome.window.sent });
    } else if ('image' in outcome) {
      listed.push({ name: file.name, place, pictured: true });
      files.push({ pictured: true });
      images.push(outcome.image);
    } else {
      listed.push({ name: file.name, place, unread: outcome.unread });
      files.push({ unread: outcome.unread });
    }
  }
  return { listed, files, images };
}

type OneOutcome =
  | { readonly window: AskWindow }
  | { readonly image: ChatImage }
  | { readonly unread: Extract<AskFile, { unread: unknown }>['unread'] };

async function readOne(
  { path, size, family }: Extract<ClassifiedFile, { family: Family }>,
  place: number,
  readers: AttachmentReaders,
  share: number,
  canSee: boolean,
): Promise<OneOutcome> {
  if (family.kind === 'text') return textOf(path, size, readers, share, place);

  if (family.kind === 'picture') {
    if (readers.pictureSize === null) return { unread: 'cannot-read-here' };
    if (!canSee) return { unread: 'cannot-see' };
    // THE BYTE LIMIT FIRST, from the size alone: a picture past it is named without being read.
    if (encodedLength(size) > CLAUDE_MAX_IMAGE_ENCODED_BYTES) return { unread: 'too-large' };
    const bytes = await readers.read(path, size);
    if (bytes === null) return { unread: 'not-found' };
    const pixels = await readers.pictureSize(bytes, family.mediaType);
    if (pixels === null) return { unread: 'unreadable' };
    if (pixels.width > CLAUDE_MAX_IMAGE_SIDE || pixels.height > CLAUDE_MAX_IMAGE_SIDE) return { unread: 'too-large' };
    return {
      image: {
        mediaType: family.mediaType,
        base64: Buffer.from(bytes).toString('base64'),
        label: `File ${String(place + 1)}:`,
      },
    };
  }

  // A PDF AND AN OFFICE FILE both end at pdftotext, so neither is read without it.
  if (readers.pdfText === null) return { unread: 'cannot-read-here' };
  if (family.kind === 'office' && readers.officePdf === null) return { unread: 'cannot-read-here' };
  // MAIN'S TRANSIENT COPY on its way into a converter's area: the Office import's own ceiling and reason.
  if (size > MAX_OFFICE_IMPORT_BYTES) return { unread: 'too-large' };
  const bytes = await readers.read(path, size);
  if (bytes === null) return { unread: 'not-found' };

  let pdf: Uint8Array = bytes;
  if (family.kind === 'office' && readers.officePdf !== null) {
    let converted;
    try {
      converted = await readers.officePdf(family.format, bytes);
    } catch (error) {
      // ONLY THE CONVERTER'S REFUSAL IS THE FILE'S — the Office import's rule; its reason is in the shell log.
      if (error instanceof OfficeConversionFailedError) return { unread: 'unreadable' };
      throw error;
    }
    const joined = await collected(converted.output, MAX_OFFICE_IMPORT_BYTES);
    if (joined === null) return { unread: 'too-large' };
    pdf = joined;
  }

  try {
    return { window: await pdfWindow(await readers.pdfText(pdf), share, place) };
  } catch (error) {
    if (error instanceof LayoutTextFailedError) return { unread: 'unreadable' };
    throw error;
  }
}

/**
 * A text file: at most four bytes for every character of the share, since UTF-8 spends at most four on one, decoded
 * strictly. The decoder STREAMS when the read stopped short of the end, so a character split by the read is held back
 * rather than refused. Bytes that are not UTF-8, or carry a NUL, are not text this build reads.
 */
async function textOf(path: string, size: number, readers: AttachmentReaders, share: number, place: number): Promise<OneOutcome> {
  const limit = Math.min(size, share * 4 + 4);
  const bytes = await readers.read(path, limit);
  if (bytes === null) return { unread: 'not-found' };
  const whole = bytes.byteLength >= size;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: !whole });
  } catch (error) {
    // THE DECODER'S REFUSAL is a fact about the file; it throws a TypeError for bytes that are not UTF-8 and for
    // nothing else, so anything else is a defect and propagates.
    if (error instanceof TypeError) return { unread: 'not-supported' };
    throw error;
  }
  if (text.includes('\u0000')) return { unread: 'not-supported' };
  const window = await readAskWindow([0], 1, () => Promise.resolve(text), share, { file: place });
  // A FILE READ ONLY IN PART was cut whether or not the part filled the share.
  return { window: whole ? window : { text: window.text, sent: { ...window.sent, truncated: true } } };
}
