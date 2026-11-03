import { KEPT_KINDS, type KeptKind } from '@monstera/contract/host';

import type * as mupdf from './mupdfRaw.js';

/**
 * What a document holds that a person would miss, counted, and the fonts it draws with
 * ([ADR-0282](../../../docs/DECISIONS/0282-text-to-curves-saves-a-new-copy-whose-letters-are-shapes.md) Decision 4).
 *
 * ## Why a count before and after, and not the converter's word
 *
 * Measured 2026-11-01 with `scripts/research/textToCurves.mjs`: Ghostscript printed its banner and the page count alone
 * on every fixture, including the one whose three form fields it removed. So what *Convert text to curves* lost is
 * read here, from the document before and from the copy after, and {@link lostBetween} names every count that fell.
 *
 * ## Read from the object graph, each object once
 *
 * Every walk keeps the object numbers it has entered, so a crafted cycle (an outline item that is its own `/Next`, a
 * structure element that is its own kid) ends rather than spins, and an object reached twice is counted once.
 */
export interface KeptCensus {
  readonly kept: Readonly<Record<KeptKind, number>>;
  /** Font dictionaries anywhere in the file, appearance streams' included: what the copy must have none of. */
  readonly fonts: number;
}

/** A count that fell between the document and its copy, by kind. */
export interface KeptLoss {
  readonly kind: KeptKind;
  readonly before: number;
  readonly after: number;
}

/** How deep a direct (unnumbered) object is searched for a font dictionary; resources nest a few levels at most. */
const DIRECT_DEPTH = 8;

/** Walks numbered objects once each: `enter` answers `false` for one already entered. */
function visitor(): (object: mupdf.PDFObject) => boolean {
  const entered = new Set<number>();
  return (object) => {
    if (!object.isIndirect()) return true;
    const number = object.asIndirect();
    if (entered.has(number)) return false;
    entered.add(number);
    return true;
  };
}

function nameOf(object: mupdf.PDFObject, key: string): string {
  const value = object.get(key);
  return value.isName() ? value.asName() : '';
}

/** The annotations on every page: a person's marks, links, and links that still go somewhere. */
function annotationsOf(document: mupdf.PDFDocument): { marks: number; links: number; targets: number } {
  const found = { marks: 0, links: 0, targets: 0 };
  const pages = document.countPages();
  for (let page = 0; page < pages; page += 1) {
    const annots = document.findPage(page).get('Annots');
    if (!annots.isArray()) continue;
    for (let index = 0; index < annots.length; index += 1) {
      const annotation = annots.get(index);
      if (!annotation.isDictionary()) continue;
      const subtype = nameOf(annotation, 'Subtype');
      if (subtype === 'Link') {
        found.links += 1;
        if (!annotation.get('A').isNull() || !annotation.get('Dest').isNull()) found.targets += 1;
        continue;
      }
      // A WIDGET IS A FIELD'S, counted with the fields; a POPUP is the window of the comment that owns it, so the
      // comment is the mark and its window is not a second one.
      if (subtype === 'Widget' || subtype === 'Popup') continue;
      found.marks += 1;
    }
  }
  return found;
}

/** Outline items, each `/First` entered and each `/Next` followed. */
function bookmarksOf(root: mupdf.PDFObject): number {
  const enter = visitor();
  let count = 0;
  const pending: mupdf.PDFObject[] = [root.get('Outlines', 'First')];
  while (pending.length > 0) {
    let item = pending.pop();
    while (item !== undefined && item.isDictionary() && enter(item)) {
      count += 1;
      pending.push(item.get('First'));
      item = item.get('Next');
    }
  }
  return count;
}

/** Entries in the `/EmbeddedFiles` name tree: a name and its file specification each. */
function attachmentsOf(root: mupdf.PDFObject): number {
  const enter = visitor();
  let count = 0;
  const pending: mupdf.PDFObject[] = [root.get('Names', 'EmbeddedFiles')];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || !node.isDictionary() || !enter(node)) continue;
    const names = node.get('Names');
    if (names.isArray()) count += Math.floor(names.length / 2);
    const kids = node.get('Kids');
    if (kids.isArray()) for (let at = 0; at < kids.length; at += 1) pending.push(kids.get(at));
  }
  return count;
}

/**
 * Terminal fields of the AcroForm tree: the ones a person fills. A node is terminal when it has no kids that are
 * fields themselves, a kid with no `/T` being a widget of the same field (ISO 32000-1 §12.7.3.1).
 */
function fieldsOf(root: mupdf.PDFObject): number {
  const enter = visitor();
  let count = 0;
  const pending: mupdf.PDFObject[] = [];
  const top = root.get('AcroForm', 'Fields');
  if (top.isArray()) for (let at = 0; at < top.length; at += 1) pending.push(top.get(at));
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || !node.isDictionary() || !enter(node)) continue;
    const kids = node.get('Kids');
    const fieldKids: mupdf.PDFObject[] = [];
    if (kids.isArray()) {
      for (let at = 0; at < kids.length; at += 1) {
        const kid = kids.get(at);
        if (kid.isDictionary() && !kid.get('T').isNull()) fieldKids.push(kid);
      }
    }
    if (fieldKids.length === 0) count += 1;
    else pending.push(...fieldKids);
  }
  return count;
}

/** Structure elements under `/StructTreeRoot`: dictionaries with an `/S`, marked-content references apart. */
function tagsOf(root: mupdf.PDFObject): number {
  const enter = visitor();
  let count = 0;
  const pending: mupdf.PDFObject[] = [root.get('StructTreeRoot', 'K')];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    if (node.isArray()) {
      for (let at = 0; at < node.length; at += 1) pending.push(node.get(at));
      continue;
    }
    if (!node.isDictionary() || !enter(node)) continue;
    if (!node.get('S').isNull()) count += 1;
    pending.push(node.get('K'));
  }
  return count;
}

/** Distinct optional content groups the document declares. */
function layersOf(root: mupdf.PDFObject): number {
  const groups = root.get('OCProperties', 'OCGs');
  if (!groups.isArray()) return 0;
  const enter = visitor();
  let count = 0;
  for (let at = 0; at < groups.length; at += 1) {
    const group = groups.get(at);
    if (group.isDictionary() && enter(group)) count += 1;
  }
  return count;
}

function titleOf(document: mupdf.PDFDocument): number {
  const title = document.getTrailer().get('Info', 'Title');
  return title.isString() && title.asString().trim() !== '' ? 1 : 0;
}

/** Font dictionaries inside one numbered object's direct parts, its numbered references left to their own visit. */
function directFonts(object: mupdf.PDFObject, depth: number): number {
  if (depth > DIRECT_DEPTH || (depth > 0 && object.isIndirect())) return 0;
  if (!object.isDictionary() && !object.isArray()) return 0;
  let count = object.isDictionary() && nameOf(object, 'Type') === 'Font' ? 1 : 0;
  object.forEach((value) => {
    count += directFonts(value, depth + 1);
  });
  return count;
}

/**
 * Every font dictionary in the file: each numbered object in the cross-reference table, and any font written inline
 * in one. Not only the pages' resources, because an annotation's appearance or a form XObject draws with fonts too,
 * and *no font left* is a statement about the file.
 */
export function fontsIn(document: mupdf.PDFDocument): number {
  let count = 0;
  const objects = document.countObjects();
  for (let number = 1; number < objects; number += 1) count += directFonts(document.newIndirect(number).resolve(), 0);
  return count;
}

/** The census of one document, read without changing it. */
export function keptCensusOf(document: mupdf.PDFDocument): KeptCensus {
  const root = document.getTrailer().get('Root');
  const annotations = annotationsOf(document);
  const kept: Record<KeptKind, number> = {
    pages: document.countPages(),
    marks: annotations.marks,
    links: annotations.links,
    'link-targets': annotations.targets,
    bookmarks: bookmarksOf(root),
    attachments: attachmentsOf(root),
    layers: layersOf(root),
    fields: fieldsOf(root),
    tags: tagsOf(root),
    title: titleOf(document),
  };
  return { kept, fonts: fontsIn(document) };
}

/** Every kind whose count fell from `before` to `after`, in {@link KEPT_KINDS}' order; nothing when nothing fell. */
export function lostBetween(before: KeptCensus['kept'], after: KeptCensus['kept']): readonly KeptLoss[] {
  return KEPT_KINDS.filter((kind) => after[kind] < before[kind]).map((kind) => ({ kind, before: before[kind], after: after[kind] }));
}
