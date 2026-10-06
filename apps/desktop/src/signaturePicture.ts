import { basename } from 'node:path';

import type { ImageRead, PickImage } from './documentCommands.js';
import { type PictureType, pictureTypeOf } from './personalLibrary.js';

/**
 * A signature picture from a file the person picks — **the one resolver** for every route that asks for one: Upload in
 * the Signature dialog and *Sign with certificate*'s picture (B3a).
 *
 * ## A PNG, a JPEG, or a scanned PDF
 *
 * The extension ROUTES, as `insertImage`'s does, and the bytes decide: a `.png` or `.jpg` is typed by its bytes with
 * the library's `pictureTypeOf`, and a `.pdf` goes to the compose host, which draws its first page, cuts it to the
 * ink and makes the paper transparent (`signatureScan.ts`). Main never parses the PDF (threat model §2); it holds the
 * PNG the host wrote, so what the dialog previews is what is placed. A file with any other extension is not read.
 */

/** How a scanned signature PDF becomes a picture: `engine/signature-from-scan` in the compose host. */
export type ScanSignature = (pdf: Uint8Array) => Promise<ScannedSignaturePicture>;

/** What the compose host made of a scanned signature PDF. */
export type ScannedSignaturePicture =
  | { readonly kind: 'drawn'; readonly png: Uint8Array }
  /** Its first page carries no ink. */
  | { readonly kind: 'blank' }
  /** It needs a password to be read. */
  | { readonly kind: 'locked' }
  | { readonly kind: 'unreadable' };

/** Where a signature picture comes from. */
export interface SignaturePictureSource {
  /** The open dialog, offering pictures and PDFs. */
  readonly pick: PickImage;
  /** The bounded read every picked picture takes. */
  readonly read: (path: string) => Promise<ImageRead>;
  /** The compose host's scan, or `null` in a graph built with no host, where a picked PDF is a fault. */
  readonly scan: ScanSignature | null;
}

/** What picking a signature picture came to. */
export type PickedSignaturePicture =
  | {
      readonly kind: 'picture';
      readonly bytes: Uint8Array;
      readonly mediaType: PictureType;
      /** The picked file's own name, never its folder. */
      readonly name: string;
      /** Where it was picked, for main's own handle to it; never sent to the renderer. */
      readonly path: string;
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'scan-blank' }
  | { readonly kind: 'scan-locked' };

/** Which way a picked file goes, by its extension, lower-cased because Windows does not care. */
function routeOf(path: string): 'picture' | 'scan' | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'picture';
  if (lower.endsWith('.pdf')) return 'scan';
  return null;
}

/** Asks for a signature picture and answers it, or why there is none. */
export async function pickSignaturePicture(source: SignaturePictureSource): Promise<PickedSignaturePicture> {
  const picked = await source.pick();
  if (picked === null) return { kind: 'cancelled' };
  const route = routeOf(picked);
  if (route === null) return { kind: 'unreadable' };
  const read = await source.read(picked);
  if (read.kind === 'too-large') return { kind: 'too-large' };
  if (read.kind === 'unreadable') return { kind: 'unreadable' };
  const name = basename(picked);

  if (route === 'picture') {
    const mediaType = pictureTypeOf(read.bytes);
    return mediaType === null
      ? { kind: 'unreadable' }
      : { kind: 'picture', bytes: read.bytes, mediaType, name, path: picked };
  }

  if (source.scan === null) throw new Error('a signature PDF was picked in a graph with no compose host to read it');
  const scanned = await source.scan(read.bytes);
  switch (scanned.kind) {
    case 'drawn':
      return { kind: 'picture', bytes: scanned.png, mediaType: 'image/png', name, path: picked };
    case 'blank':
      return { kind: 'scan-blank' };
    case 'locked':
      return { kind: 'scan-locked' };
    case 'unreadable':
      return { kind: 'unreadable' };
  }
}
