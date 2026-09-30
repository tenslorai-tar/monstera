import { PDFDocument } from '@cantoo/pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * A workbook cut into parts that ONLYOFFICE's `x2t` converts whole, and the parts' PDFs joined — so an Office import
 * never loses a sheet or a row in silence (the owner's decision C, 2026-09-30).
 *
 * ## The two limits this answers, both measured
 *
 * - **One sheet.** Converting `.xlsx` to PDF with no `spreadsheetLayout` parameter prints only the active sheet;
 *   with `{"spreadsheetLayout":{"ignorePrintArea":false}}` it prints every visible sheet and still honours each print
 *   area. That parameter is the converter's (`officeConversion.ts`); nothing here is needed for it.
 * - **1,500 pages.** `c_kMaxPrintPages = 1500` in ONLYOFFICE sdkjs `cell/apiDefines.js` is a compiled constant, not a
 *   setting: past it the rest of the workbook is not printed and nothing says so. A 50,000-row sheet came out as
 *   rows 1 to 38,250 on exactly 1,500 pages. So a conversion that answers exactly 1,500 pages is converted again in
 *   PARTS: a copy of the workbook in which one sheet is visible and its print area is narrowed to a block of rows.
 *   A print area of rows 30,001 to 50,000 printed exactly those rows, measured.
 *
 * ## What is edited, and what is not
 *
 * Only `xl/workbook.xml`: the sheets' `state`, `activeTab`, and the one sheet's `_xlnm.Print_Area` (ECMA-376
 * §18.2.19, §18.2.30, §18.2.5). Every other part of the package is carried as the same bytes, so formulas, styles and
 * shared strings are the workbook's own. A print area the author set is INTERSECTED with the block, never replaced, so
 * a part prints nothing the whole workbook would not have printed.
 *
 * ## What this refuses, by name
 *
 * A print area this reader cannot parse is not guessed at: the part is `unsplittable`, and the caller names the rows
 * it could not recover. Runs in the compose host, which is where a file a person picked is read (ADR-0060).
 */

/** ECMA-376 §18.18.68 ST_SheetState. */
export type SheetState = 'visible' | 'hidden' | 'veryHidden';

/** One sheet as the workbook lists it, in the workbook's order. */
export interface WorkbookSheet {
  readonly name: string;
  readonly state: SheetState;
  /** The last row holding a row element, 1-based; 0 for a sheet with none. */
  readonly lastRow: number;
}

/** The package is not a workbook this reader can use. */
export class WorkbookUnreadable extends Error {
  override readonly name = 'WorkbookUnreadable';
}

/** The sheet's print area is one this reader cannot narrow, so no part of it can be made. */
export class WorkbookUnsplittable extends Error {
  override readonly name = 'WorkbookUnsplittable';
}

/** The last row a worksheet may have (ECMA-376 §18.3.1.73: 1,048,576). */
const MAX_ROW = 1_048_576;

interface Package {
  readonly files: Record<string, Uint8Array>;
  readonly workbookPath: string;
  readonly workbook: string;
}

/** Undoes the five predefined XML entities and numeric references, which is all an attribute value can hold. */
function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/gu, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[entity] ?? '';
  });
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** An element's attributes by LOCAL name — a namespace prefix is the file's choice, never a meaning. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([\w.-]+:)?([\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/gu)) {
    const local = match[2];
    if (local !== undefined) found.set(local, unescapeXml(match[4] ?? match[5] ?? ''));
  }
  return found;
}

/** The package's files and its workbook part, found through the package's own relationship (ECMA-376 Part 2). */
function open(xlsx: Uint8Array): Package {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(xlsx);
  } catch (cause) {
    throw new WorkbookUnreadable('the file is not a ZIP package', { cause });
  }
  const rels = files['_rels/.rels'];
  const target =
    rels === undefined
      ? undefined
      : [...strFromU8(rels).matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/gu)]
          .map((match) => attributes(match[0]))
          .find((relation) => relation.get('Type')?.endsWith('/officeDocument') === true)
          ?.get('Target');
  const workbookPath = (target ?? 'xl/workbook.xml').replace(/^\//u, '');
  const workbook = files[workbookPath];
  if (workbook === undefined) throw new WorkbookUnreadable(`the package has no workbook at ${workbookPath}`);
  return { files, workbookPath, workbook: strFromU8(workbook) };
}

/** Each `<sheet>` element inside `<sheets>`: where its tag is, and its attributes. */
function sheetElements(workbook: string): { readonly start: number; readonly tag: string; readonly attrs: Map<string, string> }[] {
  const list = /<(?:[\w.-]+:)?sheets\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?sheets>/u.exec(workbook);
  if (list?.[1] === undefined) throw new WorkbookUnreadable('the workbook lists no sheets');
  const offset = list.index + list[0].indexOf(list[1]);
  return [...list[1].matchAll(/<(?:[\w.-]+:)?sheet\b[^>]*>/gu)].map((match) => ({
    start: offset + match.index,
    tag: match[0],
    attrs: attributes(match[0]),
  }));
}

function stateOf(attrs: Map<string, string>): SheetState {
  const state = attrs.get('state');
  return state === 'hidden' || state === 'veryHidden' ? state : 'visible';
}

/** A sheet's part path, through the workbook's relationships. */
function sheetPath(pkg: Package, id: string | undefined): string | undefined {
  const folder = pkg.workbookPath.includes('/') ? pkg.workbookPath.slice(0, pkg.workbookPath.lastIndexOf('/') + 1) : '';
  const relsPath = `${folder}_rels/${pkg.workbookPath.slice(folder.length)}.rels`;
  const rels = pkg.files[relsPath];
  if (rels === undefined || id === undefined) return undefined;
  const target = [...strFromU8(rels).matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/gu)]
    .map((match) => attributes(match[0]))
    .find((relation) => relation.get('Id') === id)
    ?.get('Target');
  if (target === undefined) return undefined;
  return target.startsWith('/') ? target.slice(1) : `${folder}${target}`;
}

/**
 * A worksheet's last row: the largest row a `<row>` element names — and a row with no `r` is the one after the last,
 * which is how ECMA-376 §18.3.1.73 numbers a row that does not say.
 */
function lastRowOf(sheet: string): number {
  let last = 0;
  let current = 0;
  for (const match of sheet.matchAll(/<(?:[\w.-]+:)?row\b([^>]*)>/gu)) {
    const named = /\br\s*=\s*"(\d+)"/u.exec(match[1] ?? '')?.[1];
    current = named === undefined ? current + 1 : Number(named);
    if (current > last) last = current;
  }
  return Math.min(last, MAX_ROW);
}

/** Every sheet the workbook lists, in order, with its state and last row. */
export function workbookOutline(xlsx: Uint8Array): readonly WorkbookSheet[] {
  const pkg = open(xlsx);
  return sheetElements(pkg.workbook).map((element) => {
    const path = sheetPath(pkg, element.attrs.get('id'));
    const sheet = path === undefined ? undefined : pkg.files[path];
    return {
      name: element.attrs.get('name') ?? '',
      state: stateOf(element.attrs),
      lastRow: sheet === undefined ? 0 : lastRowOf(strFromU8(sheet)),
    };
  });
}

/** A sheet name as a reference writes it: always quoted, an apostrophe doubled (ECMA-376 §18.17.2.3). */
function quotedSheet(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

/**
 * One area reference narrowed to rows `from`..`to`, or `null` where they do not meet.
 * `$A$2:$B$3`, `$A:$C` (whole columns) and `$1:$5` (whole rows) are the three shapes a print area takes.
 */
function narrowArea(area: string, from: number, to: number): string | null {
  const cell = /^\$?([A-Za-z]{1,3})?\$?(\d+)?$/u;
  const [left = '', right = left] = area.split(':');
  const a = cell.exec(left);
  const b = cell.exec(right);
  if (a === null || b === null || (a[1] === undefined && a[2] === undefined)) {
    throw new WorkbookUnsplittable(`the print area ${area} is not one this reader can narrow`);
  }
  const top = Math.max(a[2] === undefined ? 1 : Number(a[2]), from);
  const bottom = Math.min(b[2] === undefined ? MAX_ROW : Number(b[2]), to);
  if (top > bottom) return null;
  if (a[1] === undefined || b[1] === undefined) return `$${String(top)}:$${String(bottom)}`;
  return `$${a[1].toUpperCase()}$${String(top)}:$${b[1].toUpperCase()}$${String(bottom)}`;
}

/**
 * A print area's references narrowed to rows `from`..`to`, joined back with the sheet named in each. A reference
 * that names another sheet, or a comma inside a quoted name, is refused rather than split wrongly.
 */
function narrowPrintArea(value: string, from: number, to: number): string | null {
  const narrowed: string[] = [];
  for (const reference of value.split(',')) {
    const bang = reference.lastIndexOf('!');
    if (bang === -1) throw new WorkbookUnsplittable(`the print area ${value} names no sheet`);
    const area = narrowArea(reference.slice(bang + 1).trim(), from, to);
    if (area !== null) narrowed.push(`${reference.slice(0, bang).trim()}!${area}`);
  }
  return narrowed.length === 0 ? null : narrowed.join(',');
}

/** An attribute set on a tag: replaced where present, added before the tag's end where not. */
function withAttribute(tag: string, name: string, value: string): string {
  const present = new RegExp(`(\\s(?:[\\w.-]+:)?${name}\\s*=\\s*)("[^"]*"|'[^']*')`, 'u');
  if (present.test(tag)) return tag.replace(present, `$1"${escapeXml(value)}"`);
  return tag.replace(/\s*(\/?)>$/u, ` ${name}="${escapeXml(value)}"$1>`);
}

function withoutAttribute(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s(?:[\\w.-]+:)?${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'u'), '');
}

/**
 * The workbook with sheet `index` its only visible sheet and, where `rows` is given, its print area narrowed to them.
 *
 * @returns the part's package, or `null` where the rows print nothing — the author's print area does not reach them
 * @throws {WorkbookUnsplittable} where the sheet's print area cannot be narrowed
 */
export function workbookPart(
  xlsx: Uint8Array,
  index: number,
  rows: { readonly from: number; readonly to: number } | null,
): Uint8Array | null {
  const pkg = open(xlsx);
  const sheets = sheetElements(pkg.workbook);
  const target = sheets[index];
  if (target === undefined) throw new WorkbookUnreadable(`the workbook has no sheet ${String(index + 1)}`);

  // FROM THE END, so each replacement leaves the offsets of the ones before it where they were.
  let workbook = pkg.workbook;
  for (let at = sheets.length - 1; at >= 0; at -= 1) {
    const element = sheets[at];
    if (element === undefined) continue;
    let tag = element.tag;
    if (at === index) tag = withoutAttribute(tag, 'state');
    else if (stateOf(element.attrs) === 'visible') tag = withAttribute(tag, 'state', 'hidden');
    workbook = workbook.slice(0, element.start) + tag + workbook.slice(element.start + element.tag.length);
  }

  // THE ACTIVE TAB IS WHAT x2t PRINTS — measured: it printed the sheet `activeTab` named even where another sheet
  // carried `tabSelected`, hidden or visible. So a part always names its sheet there, and a workbook with no
  // `bookViews` gets one before `sheets`, where ECMA-376 §18.2.27 puts it; without it x2t prints the first sheet.
  const view = /<(?:[\w.-]+:)?workbookView\b[^>]*>/u.exec(workbook);
  if (view !== null) {
    workbook = workbook.replace(view[0], withAttribute(view[0], 'activeTab', String(index)));
  } else {
    const openSheets = /<((?:[\w.-]+:)?)sheets\b/u.exec(workbook);
    if (openSheets === null) throw new WorkbookUnreadable('the workbook lists no sheets');
    const p = openSheets[1] ?? '';
    workbook =
      workbook.slice(0, openSheets.index) +
      `<${p}bookViews><${p}workbookView activeTab="${String(index)}"/></${p}bookViews>` +
      workbook.slice(openSheets.index);
  }

  if (rows !== null) {
    const definedName = new RegExp(
      `<((?:[\\w.-]+:)?)definedName\\b([^>]*)>([^<]*)</\\1definedName>`,
      'gu',
    );
    // AN OBJECT, read after the replace: `let`s set inside its callback are narrowed by the compiler to their first
    // values across the call, and the checks after it would read as dead.
    const authors = { found: false, empty: false };
    workbook = workbook.replace(definedName, (whole: string, prefix: string, attrs: string, value: string) => {
      const named = attributes(attrs);
      if (named.get('name') !== '_xlnm.Print_Area' || named.get('localSheetId') !== String(index)) return whole;
      authors.found = true;
      const narrowed = narrowPrintArea(unescapeXml(value), rows.from, rows.to);
      if (narrowed === null) {
        authors.empty = true;
        return whole;
      }
      return `<${prefix}definedName${attrs}>${escapeXml(narrowed)}</${prefix}definedName>`;
    });
    if (authors.empty) return null;
    if (!authors.found) {
      const name = quotedSheet(target.attrs.get('name') ?? '');
      const area = `<definedName name="_xlnm.Print_Area" localSheetId="${String(index)}">${escapeXml(`${name}!$${String(rows.from)}:$${String(rows.to)}`)}</definedName>`;
      const names = /<((?:[\w.-]+:)?)definedNames\b[^>]*>/u.exec(workbook);
      if (names !== null) {
        workbook = workbook.replace(names[0], `${names[0]}${area.replaceAll('definedName', `${names[1] ?? ''}definedName`)}`);
      } else {
        const closeSheets = /<\/((?:[\w.-]+:)?)sheets>/u.exec(workbook);
        if (closeSheets === null) throw new WorkbookUnreadable('the workbook lists no sheets');
        const p = closeSheets[1] ?? '';
        workbook = workbook.replace(
          closeSheets[0],
          `${closeSheets[0]}<${p}definedNames>${area.replaceAll('definedName', `${p}definedName`)}</${p}definedNames>`,
        );
      }
    }
  }

  return zipSync({ ...pkg.files, [pkg.workbookPath]: strToU8(workbook) });
}

/** A PDF's page count, or `null` where it cannot be read. */
export async function pdfPageCount(pdf: Uint8Array): Promise<number | null> {
  try {
    return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
  } catch {
    // UNREADABLE IS AN ANSWER the caller names, not a fault: the bytes are a converter's output.
    return null;
  }
}

/**
 * The PDFs, in order, as one — and each one's page count; where one cannot be read, which.
 *
 * TAKEN AS THEY ARE READ, so a caller that reads each part when it is asked for holds the joined document and one part,
 * never every part at once.
 */
export async function joinPdfs(
  pdfs: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<{ readonly pdf: Uint8Array; readonly pages: readonly number[] } | { readonly unreadable: number }> {
  const joined = await PDFDocument.create();
  const pages: number[] = [];
  let item = -1;
  for await (const bytes of pdfs) {
    item += 1;
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch {
      return { unreadable: item };
    }
    const copied = await joined.copyPages(source, source.getPageIndices());
    for (const page of copied) joined.addPage(page);
    pages.push(copied.length);
  }
  return { pdf: await joined.save(), pages };
}
