import type { PDFObject } from './mupdfRaw.js';
import { bufferBytes } from './mupdfWriter.js';
import type { XObjectKind } from './textOperators.js';

/**
 * What each XObject a page's resources name is: what `textOperators.ts`' one pass is told, so a `Do` is numbered as a
 * picture or a group as PDFium numbers it (ADR-0240). Read from the page's own resources or the ones it inherits.
 */
export function xobjectKinds(leaf: PDFObject): (name: string) => XObjectKind {
  let resources = leaf.getInheritable('Resources');
  if (!resources.isNull()) resources = resources.resolve();
  // ASKED BEFORE IT IS RESOLVED: a page naming no `/XObject` answers a null object, and resolving one throws.
  const listed = resources.isDictionary() ? resources.get('XObject') : null;
  const xobjects = listed?.isNull() === false ? listed.resolve() : null;
  return (name) => {
    if (xobjects?.isDictionary() !== true) return undefined;
    const subtype = xobjects.get(name).resolve().get('Subtype');
    if (!subtype.isName()) return undefined;
    return subtype.asName() === 'Image' ? 'image' : subtype.asName() === 'Form' ? 'form' : undefined;
  };
}

/**
 * A page's content streams, each decoded, read through their INDIRECT references — the one place the kernel reads them
 * from a MuPDF page (`layers.ts` imports a page as a layer through it, ADR-0176's writer edits through it), and
 * `textOperators.ts`' `joinedContent` the one place they are joined.
 *
 * Measured 2026-09-14 (ADR-0064): `readStream` loads through the object number, and called on `.resolve()`'s result it
 * throws `object is not a stream` — the resolved value is the stream's dictionary and no longer names the object. So
 * the resolve is used only to ask whether `/Contents` is an array.
 */
export function pageContentStreams(leaf: PDFObject): readonly Uint8Array[] {
  const reference = leaf.get('Contents');
  if (reference.isNull()) return [];
  const resolved = reference.resolve();
  return resolved.isArray()
    ? Array.from({ length: resolved.length }, (_, at) => bufferBytes(resolved.get(at).readStream()))
    : [bufferBytes(reference.readStream())];
}
