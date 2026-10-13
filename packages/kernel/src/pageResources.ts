import type { PDFDocument, PDFObject } from './mupdfRaw.js';

/**
 * The `/Resources` sub-dictionary of `kind` a page's content names things in: its own `/Resources`' or the one it
 * inherits, made where there is none. An inherited one is shared by the pages that inherit it, and a name added there is
 * one those pages' content never uses.
 *
 * The ONE answer to *where does a writer add a resource to a page* for every MuPDF writer that draws onto a page — the
 * in-place operator edit and the page stamps (ADR-0235) — so the two cannot disagree about inheritance (B3a).
 */
export function resourceDictionaryOf(document: PDFDocument, leaf: PDFObject, kind: 'Font' | 'ExtGState'): PDFObject {
  let resources = leaf.getInheritable('Resources');
  if (!resources.isNull()) resources = resources.resolve();
  if (!resources.isDictionary()) {
    resources = document.newDictionary();
    leaf.put('Resources', resources);
  }
  let named = resources.get(kind);
  if (!named.isNull()) named = named.resolve();
  if (!named.isDictionary()) {
    named = document.newDictionary();
    resources.put(kind, named);
  }
  return named;
}

/** The first name `prefix` + 1, 2, … that `dictionary` does not hold, so an added resource never shadows the page's own. */
export function freeName(dictionary: PDFObject, prefix: string): string {
  for (let at = 1; ; at += 1) {
    const name = `${prefix}${String(at)}`;
    if (dictionary.get(name).isNull()) return name;
  }
}
