import { readFile, stat } from 'node:fs/promises';

import {
  MAX_ANNOTATION_DATA_BYTES,
  MAX_CSV_BYTES,
  MAX_FORM_DATA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_MARKDOWN_BYTES,
  MAX_OFFICE_IMPORT_BYTES,
} from '@monstera/contract';

/**
 * The reads of a file a person picked, each against its own bound, and each sized BEFORE it is read.
 *
 * `stat` costs nothing, so a 4 GB file picked by mistake is refused as a decided outcome instead of being loaded to
 * find out. That ordering is one rule, and it lives once, in {@link readWithin}. The bounds are five decisions about
 * six risks — an image is large because images are, a form-data file large enough to notice is one somebody built,
 * Markdown's and CSV's were measured on their composers (ADR-0060), the annotation bound is its own (ADR-0077), and an
 * Office file's is the converter's (ADR-0120) — so each read is a function of its own that names its bound, never one
 * helper a caller passes a number to.
 *
 * Their own module rather than functions in `entry.ts`, the composition root, which no case reaches: the image read's
 * bound lost its last case when its handler's second check was removed, with nothing left to say it held (the stage
 * audit of `de106c45..5da42ae3`, finding MMMMMMM-8). The other five had never had one.
 */

/** The two filesystem calls a bounded read makes, injected so a case can see which ran. */
export interface FileReadCalls {
  readonly stat: (path: string) => Promise<{ readonly size: number }>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
}

/** What a bounded read answers. */
export type BoundedRead =
  | { readonly kind: 'read'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large'; readonly byteLength: number }
  | { readonly kind: 'unreadable' };

const NODE_CALLS: FileReadCalls = { stat, readFile };

/**
 * Sized, then read only when within `bound`. A file that vanished or cannot be opened reads as `unreadable`: *deleted
 * since you picked it* and *permission denied* are one situation from where the person stands.
 */
async function readWithin(path: string, bound: number, calls: FileReadCalls): Promise<BoundedRead> {
  try {
    const { size } = await calls.stat(path);
    if (size > bound) return { kind: 'too-large', byteLength: size };
    return { kind: 'read', bytes: new Uint8Array(await calls.readFile(path)) };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** An image picked to insert, place or sign with. */
export function readImageFile(path: string, calls: FileReadCalls = NODE_CALLS): Promise<BoundedRead> {
  return readWithin(path, MAX_IMAGE_BYTES, calls);
}

/** A form-data file picked to import. */
export function readFormDataFile(path: string, calls: FileReadCalls = NODE_CALLS): Promise<BoundedRead> {
  return readWithin(path, MAX_FORM_DATA_BYTES, calls);
}

/** An annotation file picked to import. */
export function readAnnotationDataFile(path: string, calls: FileReadCalls = NODE_CALLS): Promise<BoundedRead> {
  return readWithin(path, MAX_ANNOTATION_DATA_BYTES, calls);
}

/** A Markdown file picked to compose. */
export function readMarkdownFile(path: string, calls: FileReadCalls = NODE_CALLS): Promise<BoundedRead> {
  return readWithin(path, MAX_MARKDOWN_BYTES, calls);
}

/** A CSV file picked to compose. */
export function readCsvFile(path: string, calls: FileReadCalls = NODE_CALLS): Promise<BoundedRead> {
  return readWithin(path, MAX_CSV_BYTES, calls);
}

/** A Word, PowerPoint or Excel file picked to convert (ADR-0120). */
export function readOfficeFile(path: string, calls: FileReadCalls = NODE_CALLS): Promise<BoundedRead> {
  return readWithin(path, MAX_OFFICE_IMPORT_BYTES, calls);
}
