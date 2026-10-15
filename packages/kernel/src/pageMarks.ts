import type { PageMarkKind, PageMarksRead } from '@monstera/contract';
import { MAX_STAMP_SETTINGS, pageSetOf } from '@monstera/contract/host';

import type { Apply, Capture, Invert, MupdfSession } from './engineSeam.js';
import type { PDFDocument, PDFObject } from './mupdfRaw.js';
import { withDocument } from './mupdfWriter.js';
import { STAMP_KIND_NAMES, STAMP_RECORD_KEY, type StampKind } from './pageStampDraw.js';

/**
 * Finding and removing the page stamps (ADR-0246): the watermark, the headers and footers, and the Bates numbers.
 *
 * ## What a stamp is, to this module
 *
 * One stream in a page's `/Contents`, appended after the page's own content (ADR-0235 Decision 3). It is ONE OF THREE
 * THINGS, decided by the stream alone ({@link markOf}):
 *
 * - **Monstera's**: its dictionary carries the record (`/MonsteraMark`), with the kind and the settings that drew it.
 * - **another tool's**, following the convention: its whole content is one marked-content artifact of the pagination
 *   kind, `/Artifact <</Type /Pagination /Subtype /Watermark>> BDC … EMC` or a header's, a footer's or a Bates number's.
 * - **an older Monstera's**: no record, and it names a font `PageStamps` named (`MonsteraStamp…`). Which kind it is cannot
 *   be told safely from its content, so it is counted and never removed (Decision 6).
 *
 * Anything else is the page's content. Only a whole stream of the first two is ever removed (Decision 5).
 */

/** The PDF name each kind is recorded under, read back. */
const KIND_OF_NAME: ReadonlyMap<string, StampKind> = new Map(
  (Object.entries(STAMP_KIND_NAMES) as [StampKind, string][]).map(([kind, name]) => [name, kind]),
);

/** The kind each artifact subtype belongs to: a header and a footer are one kind, as one command draws both. */
const KIND_OF_SUBTYPE: ReadonlyMap<string, StampKind> = new Map([
  ['Watermark', 'watermark'],
  ['Header', 'headerFooter'],
  ['Footer', 'headerFooter'],
  ['Bates', 'bates'],
]);

/** What one stream of a page's content is. */
export type StreamMark =
  | { readonly by: 'monstera'; readonly kind: StampKind; readonly settings: string | null }
  | { readonly by: 'other'; readonly kind: StampKind }
  /** Another tool's artifact INSIDE a stream that holds more: counted, never cut out (ADR-0246 Decision 5). */
  | { readonly by: 'inline'; readonly kinds: readonly StampKind[] }
  | { readonly by: 'older' }
  | { readonly by: 'page' };

/**
 * Whether one whole content stream is one pagination artifact and nothing else: `/Artifact <<…/Type /Pagination…
 * /Subtype /S…>> BDC`, then the drawing, then the `EMC` that closes it as the stream's last operator, with no other
 * marked section opened at the outer level. Answers the kind its subtype belongs to, or `undefined`.
 */
export function wholeArtifactKind(text: string): StampKind | undefined {
  const trimmed = text.trim();
  const open = /^\/Artifact\s*<<([^>]*)>>\s*BDC\b/u.exec(trimmed);
  if (open === null || !/\/Type\s*\/Pagination\b/u.test(open[1] ?? '') || !/\bEMC$/u.test(trimmed)) return undefined;
  const subtype = /\/Subtype\s*\/(\w+)/u.exec(open[1] ?? '')?.[1];
  const kind = subtype === undefined ? undefined : KIND_OF_SUBTYPE.get(subtype);
  if (kind === undefined) return undefined;
  // THE FIRST BDC IS CLOSED BY THE LAST EMC, and by no earlier one: depth returns to zero only at the end.
  let depth = 0;
  const operators = trimmed.replace(/\((?:\\.|[^\\)])*\)/gu, '()').match(/\b(?:BDC|BMC|EMC)\b/gu) ?? [];
  for (const [at, operator] of operators.entries()) {
    depth += operator === 'EMC' ? -1 : 1;
    if (depth === 0 && at !== operators.length - 1) return undefined;
  }
  return depth === 0 ? kind : undefined;
}

/** What the stream `stream` is (see the module's note). */
export function markOf(stream: PDFObject): StreamMark {
  if (!stream.isStream()) return { by: 'page' };
  const record = stream.get(STAMP_RECORD_KEY);
  if (record.isDictionary()) {
    const kindName = record.get('Kind');
    const kind = kindName.isName() ? KIND_OF_NAME.get(kindName.asName()) : undefined;
    if (kind !== undefined) {
      const settings = record.get('Settings');
      return { by: 'monstera', kind, settings: settings.isString() ? settings.asString() : null };
    }
  }
  const text = new TextDecoder('latin1').decode(stream.readStream().asUint8Array());
  const kind = wholeArtifactKind(text);
  if (kind !== undefined) return { by: 'other', kind };
  if (/\/MonsteraStamp\w*\s+[\d.]+\s+Tf\b/u.test(text)) return { by: 'older' };
  const inline = inlineArtifactKinds(text);
  return inline.length === 0 ? { by: 'page' } : { by: 'inline', kinds: inline };
}

/** The pagination artifact kinds a stream opens anywhere in its content, for a stream that is not one whole artifact. */
function inlineArtifactKinds(text: string): StampKind[] {
  const kinds = new Set<StampKind>();
  for (const open of text.matchAll(/\/Artifact\s*<<([^>]*)>>\s*BDC\b/gu)) {
    const properties = open[1] ?? '';
    if (!/\/Type\s*\/Pagination\b/u.test(properties)) continue;
    const kind = KIND_OF_SUBTYPE.get(/\/Subtype\s*\/(\w+)/u.exec(properties)?.[1] ?? '');
    if (kind !== undefined) kinds.add(kind);
  }
  return [...kinds];
}

/** A page's content streams, in order: its `/Contents` array, or the one stream it holds. */
function streamsOf(page: PDFObject): PDFObject[] {
  const contents = page.get('Contents');
  if (contents.isArray()) return Array.from({ length: contents.length }, (_, at) => contents.get(at));
  return contents.isNull() ? [] : [contents];
}

/** One kind's marks across the document. */
export interface MarksOfKind {
  /** The zero-based pages carrying a stamp of this kind that can be edited or removed, in order. */
  readonly pages: readonly number[];
  /** The settings Monstera recorded on the first of them it wrote, or `null` where it wrote none. */
  readonly settings: string | null;
  /** How many of those pages carry another tool's stamp of this kind. */
  readonly others: number;
  /** How many pages carry another tool's stamp of this kind inside their own content, which is left (Decision 5). */
  readonly inline: number;
}

/** Every kind's marks, and the pages an older Monstera stamped without a record. */
export interface PageMarks {
  readonly watermark: MarksOfKind;
  readonly headerFooter: MarksOfKind;
  readonly bates: MarksOfKind;
  /** Pages carrying a stamp an older Monstera wrote, whose kind cannot be told (ADR-0246 Decision 6). */
  readonly older: number;
}

/** Reads where each kind's stamps are (ADR-0246 Decision 2). A read: it changes nothing. */
export function readPageMarks(document: PDFDocument): PageMarks {
  const found: Record<StampKind, { pages: number[]; settings: string | null; others: number; inline: number }> = {
    watermark: { pages: [], settings: null, others: 0, inline: 0 },
    headerFooter: { pages: [], settings: null, others: 0, inline: 0 },
    bates: { pages: [], settings: null, others: 0, inline: 0 },
  };
  let older = 0;
  const total = document.countPages();
  for (let index = 0; index < total; index += 1) {
    const kinds = new Set<StampKind>();
    const othersOn = new Set<StampKind>();
    const inlineOn = new Set<StampKind>();
    let olderHere = false;
    for (const stream of streamsOf(document.findPage(index))) {
      const mark = markOf(stream);
      if (mark.by === 'older') olderHere = true;
      if (mark.by === 'inline') for (const kind of mark.kinds) inlineOn.add(kind);
      if (mark.by !== 'monstera' && mark.by !== 'other') continue;
      kinds.add(mark.kind);
      if (mark.by === 'other') othersOn.add(mark.kind);
      if (mark.by === 'monstera' && found[mark.kind].settings === null) found[mark.kind].settings = mark.settings;
    }
    for (const kind of kinds) found[kind].pages.push(index);
    for (const kind of othersOn) found[kind].others += 1;
    for (const kind of inlineOn) found[kind].inline += 1;
    if (olderHere) older += 1;
  }
  return { ...found, older };
}

/**
 * {@link readPageMarks} on a session, in the shape `document.pageMarks` answers (ADR-0246 Decision 2): each kind's pages
 * as a page set, and a settings record longer than any these commands write answered as none rather than refused.
 */
export function readPageMarksOf(session: MupdfSession): Promise<PageMarksRead> {
  return withDocument(session, (document) => {
    const marks = readPageMarks(document);
    const wire = (kind: MarksOfKind): PageMarksRead['watermark'] => ({
      pages: kind.pages.length === 0 ? null : pageSetOf(kind.pages),
      settings: kind.settings !== null && kind.settings.length <= MAX_STAMP_SETTINGS ? kind.settings : null,
      others: kind.others,
      inline: kind.inline,
    });
    return { watermark: wire(marks.watermark), headerFooter: wire(marks.headerFooter), bates: wire(marks.bates), older: marks.older };
  });
}

/**
 * Takes every removable stream of `kind` off every page (ADR-0246 Decisions 4 and 5): Monstera's, and another tool's that
 * is one whole artifact. The page's own streams, the brackets around them, an older Monstera's stamps and every other
 * kind's stay in their order. Answers how many pages lost one.
 */
export function removeMarks(document: PDFDocument, kind: StampKind): number {
  let changed = 0;
  const total = document.countPages();
  for (let index = 0; index < total; index += 1) {
    const page = document.findPage(index);
    const contents = page.get('Contents');
    if (!contents.isArray()) continue;
    const kept: PDFObject[] = [];
    let removed = false;
    for (let at = 0; at < contents.length; at += 1) {
      const stream = contents.get(at);
      const mark = markOf(stream);
      if ((mark.by === 'monstera' || mark.by === 'other') && mark.kind === kind) removed = true;
      else kept.push(stream);
    }
    if (!removed) continue;
    const list = document.newArray();
    for (const stream of kept) list.push(stream);
    page.put('Contents', list);
    changed += 1;
  }
  return changed;
}

/**
 * Capture — refuses, for the stamps' reason (ADR-0235 Decision 4): the prior state is the pages' content arrays, so undo
 * is the checkpoint the bus takes.
 */
export const captureRemovePageMarks: Capture<'mupdf', 'removePageMarks'> = (_session, _command) =>
  Promise.resolve({
    captured: false,
    reason: 'removing a stamp rewrites the content arrays of the pages it was on, whose prior state is a checkpoint',
  });

/** Invert — unreachable by the type, as the stamps' own is. */
export const invertRemovePageMarks: Invert<'mupdf', 'removePageMarks'> = (_session, _inverse) => {
  throw new Error('removePageMarks has no inverse and this is unreachable: undo restores the checkpoint the bus took.');
};

/** Removes every stamp of the command's kind. */
export const applyRemovePageMarks: Apply<'mupdf', 'removePageMarks'> = (session, command) =>
  withDocument(session, (document) => {
    removeMarks(document, command.marks satisfies PageMarkKind);
  });

/**
 * A stamp command's record of its settings: the command less its kind, its pages and whether it replaced, as JSON. What
 * Edit fills its window with; the pages come from where the stamps are.
 */
export function recordedSettings(command: { readonly kind: string; readonly pages: unknown; readonly replace?: true | undefined }): string {
  const { kind: _kind, pages: _pages, replace: _replace, ...settings } = command;
  return JSON.stringify(settings);
}
