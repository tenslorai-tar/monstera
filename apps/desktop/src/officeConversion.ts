import { MAX_OFFICE_MISSING_BLOCKS, MAX_WORKBOOK_PARTS } from '@monstera/contract';

import {
  type ConversionFailure,
  type ConverterPlatform,
  type InstructedPaths,
  convertDocument,
  describeConversionFailure,
} from './converterSession.js';
import type { ConverterBounds } from './externalConverter.js';
import type { ShellFailureSink } from './shellFailure.js';

/**
 * Office import: §3's *Office document → PDF* row
 * ([ADR-0120](../../../docs/DECISIONS/0120-office-import-is-onlyoffices-x2t-contained.md)).
 *
 * ONLYOFFICE's `x2t`, run once per import through §8's seam by `converterSession.ts`, in its
 * own container, with the picked file's bytes under a fixed name.
 *
 * ## x2t is told its paths in a file, and the file names the tree RELATIVELY
 *
 * Its positional form crashed (exit 139) on the first measurement, so the seam writes an
 * instructions file. The fonts, the font cache and the themes are named relative to the tree,
 * because the seam starts every converter in its executable's directory and the cache
 * provisioning pinned names the fonts the same way (`scripts/provision/onlyoffice.mjs`) — so
 * nothing here knows where the tree is, and a tree that moved still converts with its own fonts.
 */

/**
 * The Office formats an import converts, by file extension: the three ADR-0120 measured converting
 * inside the container, and no other until it is measured.
 *
 * ITS OWN SET, not the export's `OfficeFormat` in `documentCommands.ts`, though the two hold the same
 * three today: what this build can WRITE and what x2t has been measured to READ are two facts, and a
 * format added to one says nothing about the other.
 */
export const OFFICE_IMPORT_FORMATS = ['docx', 'xlsx', 'pptx'] as const;

/** See {@link OFFICE_IMPORT_FORMATS}. */
export type OfficeImportFormat = (typeof OFFICE_IMPORT_FORMATS)[number];

/** The import format a picked path names by its extension, or `null` for any other. */
export function officeImportFormatOf(path: string): OfficeImportFormat | null {
  const extension = /\.([^.\\/]+)$/u.exec(path)?.[1]?.toLowerCase();
  return OFFICE_IMPORT_FORMATS.find((format) => format === extension) ?? null;
}

/** x2t's number for PDF as an output format, from its own format table. */
export const X2T_FORMAT_PDF = 513;

/**
 * The bounds §8 puts on this converter: ceilings against a hung or hostile conversion.
 *
 * Measured 2026-09-29 on this machine by `scripts/research/officeLive.mjs`, through this module and
 * the Win32 surfaces: a one-sentence `.docx`, `.xlsx` and `.pptx` each converted in 1.1–1.2 s with a
 * job peak of 330–352 MiB — most of it x2t's script engine starting, before any document. So a
 * gibibyte, PDF/A's ceiling, is under three times the floor, and a document of photographs rises from
 * there; two is chosen, and five minutes. A 16 MiB limit refused the same `.docx`, so the limit is
 * one x2t meets.
 *
 * Heavy documents measured 2026-09-30 on this machine by `scripts/research/converterPeaks.mjs`, the
 * same way: twelve 3000x2000 photographs in a `.docx` **352.8 MiB** in 6.1 s — barely above the
 * floor. A workbook of 10 columns: 25,000 rows **906 MiB** in 69–79 s; 50,000 rows **1,254–1,256 MiB**
 * in 127–163 s; 100,000 rows **1,285 MiB** in 174 s, measured with the limits lifted for that run.
 * It flattens because x2t 9.4.0 STOPS AT 1,500 PAGES: the 50,000-row PDF is 1,500 pages carrying rows
 * 1–38,250 and nothing after, the 100,000-row PDF is the same bytes, and the 25,000-row control is 982
 * pages holding every row. The cap is {@link X2T_MAX_PRINT_PAGES}. So the heaviest reading is 1.6x under
 * this limit and 1.7x under the time, and these bounds are PER CONVERSION: a larger workbook is converted in parts
 * (decision C), and a part that exceeds either is halved — a 100,000-row sheet of narrow cells did, below.
 */
export const OFFICE_BOUNDS: ConverterBounds = {
  processMemoryLimitBytes: 2 * 1024 * 1024 * 1024,
  timeoutMs: 5 * 60 * 1000,
};

/** A path as XML text: the five characters XML reserves, escaped. */
function xmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * x2t's instructions for one conversion to PDF, as ADR-0120 measured them.
 *
 * NO `spreadsheetLayout`, and that is measured rather than left out: any `spreadsheetLayout` makes x2t print every
 * visible sheet, and it also changes the layout — `ignorePrintArea: false` alone printed a two-sheet workbook ten times
 * smaller (1,028 text runs on page one against 102), and `scale: 100` would override a scale the author set. Without it
 * x2t prints the ACTIVE sheet at the author's own page setup, so a workbook's other sheets arrive as parts, each made
 * the active sheet (`workbookParts.ts`), rather than by a parameter that redraws them.
 */
export function x2tInstructions(paths: InstructedPaths): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<TaskQueueDataConvert>' +
    `<m_sFileFrom>${xmlText(paths.input)}</m_sFileFrom>` +
    `<m_sFileTo>${xmlText(paths.output)}</m_sFileTo>` +
    `<m_nFormatTo>${String(X2T_FORMAT_PDF)}</m_nFormatTo>` +
    '<m_sFontDir>fonts</m_sFontDir>' +
    '<m_sAllFontsPath>sdkjs/common/AllFonts.js</m_sAllFontsPath>' +
    '<m_sThemeDir>sdkjs/slide/themes</m_sThemeDir>' +
    `<m_sTempDir>${xmlText(paths.scratch)}</m_sTempDir>` +
    '</TaskQueueDataConvert>\n'
  );
}

/** One conversion's answer: the PDF as it is read, or its removal unread. */
export interface OfficeConversion {
  readonly output: AsyncIterable<Uint8Array>;
  /** Removes the converter's area without reading the PDF — a person who cancelled the save. */
  readonly discard: () => void;
  /** Rows of a workbook the PDF does not hold, each named — empty for every document that arrived whole. */
  readonly missing: readonly WorkbookBlock[];
}

/**
 * x2t's page cut-off: `c_kMaxPrintPages = 1500` in ONLYOFFICE sdkjs `cell/apiDefines.js`, a compiled constant with no
 * parameter that reaches it (read 2026-09-30 from sdkjs through Sourcegraph). Measured: a 50,000-row sheet came out on
 * exactly 1,500 pages holding rows 1 to 38,250, and nothing said so. A part that answers exactly this many pages may
 * have been cut, so it is halved and converted again.
 */
export const X2T_MAX_PRINT_PAGES = 1500;

/**
 * The failures a smaller part can cure: a conversion that ran out of time, or exited without a PDF — how x2t ends when it
 * reaches the job's memory limit. A converter that could not start, or an area that could not be made, is not one.
 */
const SIZE_FAILURES: ReadonlySet<ConversionFailure['stage']> = new Set(['timed-out', 'exit-code', 'exit-unreadable', 'no-output']);

/** Failed conversions one sheet may spend on halving before its failing blocks are named instead of tried. */
export const MAX_FAILED_PARTS_PER_SHEET = 8;

/**
 * Conversions one sheet may spend in all before its remaining blocks are named instead of tried — the stop for a crafted
 * sheet whose every block reaches the cut-off, which would otherwise halve to single rows: two conversions a row.
 *
 * Derived: the format's 1,048,576 rows at ONE ROW A PAGE need 700 parts of 1,500 pages, and halving from the whole sheet
 * reaches parts that small in at most 1,024 leaves and the 1,023 parts above them — 2,047 conversions. A real sheet past
 * it is one printing several pages a row, and then its later rows are NAMED, never a refusal of the workbook (JOURNAL,
 * *No document-size refusals*, table A row 12).
 */
export const MAX_CONVERSIONS_PER_SHEET = 2048;

/** A block of a sheet's rows the PDF does not hold. */
export interface WorkbookBlock {
  readonly sheet: string;
  readonly from: number;
  readonly to: number;
}

/** One sheet as the compose host outlines it. */
export interface WorkbookSheetOutline {
  readonly name: string;
  readonly state: 'visible' | 'hidden' | 'veryHidden';
  readonly lastRow: number;
}

/**
 * The compose host's workbook calls, as main takes them (decision C). The picked workbook and the part PDFs live in the
 * host's area under names; bytes pass through `main` only for a part workbook, the size of the file already read.
 */
export interface WorkbookComposer {
  /** Writes the bytes, or streams the PDF, into the area and answers its name there. */
  readonly put: (source: Uint8Array | AsyncIterable<Uint8Array>) => Promise<string>;
  readonly outline: (name: string) => Promise<readonly WorkbookSheetOutline[] | null>;
  readonly part: (
    name: string,
    sheet: number,
    rows: { readonly from: number; readonly to: number } | null,
  ) => Promise<{ readonly kind: 'written'; readonly bytes: Uint8Array } | { readonly kind: 'nothing' | 'unsplittable' | 'unreadable' }>;
  readonly pages: (name: string) => Promise<number | null>;
  /** The named PDFs joined in order, streamed from the area and removed once read or discarded; `null` where one is unreadable. */
  readonly join: (names: readonly string[]) => Promise<{ readonly output: AsyncIterable<Uint8Array>; readonly discard: () => void } | null>;
  readonly remove: (name: string) => Promise<void>;
}

export type OfficeSource = (format: OfficeImportFormat, file: Uint8Array) => Promise<OfficeConversion>;

/** A conversion that produced no PDF, with why — thrown, so the import answers it. */
export class OfficeConversionFailedError extends Error {
  readonly failure: ConversionFailure;

  constructor(failure: ConversionFailure) {
    super(`the Office file could not be converted to PDF: ${describeConversionFailure(failure)}`);
    this.name = 'OfficeConversionFailedError';
    this.failure = failure;
  }
}

/**
 * @param report where a failed conversion's reason goes; the import answers the renderer
 *   *could not be converted*, and x2t's own words land in the shell log
 */
export function createOfficeSource(
  platform: ConverterPlatform,
  report: ShellFailureSink,
  /** The compose host's workbook calls; `null` where there is no compose host, and then a workbook's loss is logged. */
  workbooks: WorkbookComposer | null = null,
): OfficeSource {
  const failed = (failure: ConversionFailure): OfficeConversionFailedError => {
    const error = new OfficeConversionFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  const convertOnce = async (format: OfficeImportFormat, file: Uint8Array): Promise<OfficeConversion> => {
    const converted = await convertDocument(
      platform,
      file,
      {
        kind: 'instructions',
        input: `in.${format}`,
        output: 'out.pdf',
        instructions: 'x2t.xml',
        scratch: 'work',
        instructionsText: x2tInstructions,
        commandArguments: (instructions) => [instructions],
      },
      failed,
    );
    return { output: converted.output, discard: converted.discard, missing: [] };
  };
  return async (format, file) => {
    if (format !== 'xlsx') return convertOnce(format, file);
    if (workbooks === null) {
      // SAID, never silent: without the compose host the workbook converts as x2t alone does — its active sheet, to
      // 1,500 pages — and no sheet can be named, because only that host reads the file.
      report({
        event: 'converter-failed',
        detail: 'no compose host in this build: the workbook was converted as its active sheet only, and any other sheet is not in the PDF',
      });
      return convertOnce(format, file);
    }
    const converted = await convertWorkbook(workbooks, (part) => convertOnce('xlsx', part), file, failed);
    for (const block of converted.missing) {
      report({
        event: 'workbook-rows-missing',
        detail:
          `sheet "${block.sheet}", rows ${String(block.from)} to ${String(block.to)}: not converted even in smaller parts — ` +
          `past the converter's ${String(X2T_MAX_PRINT_PAGES)}-page cut-off, or failed (the converter-failed lines above say how)`,
      });
    }
    return converted;
  };
}

/**
 * The missing blocks as one run each: a block that continues the one before it on the same sheet joined to it, since two
 * halves that each reached the cut-off are one run of rows to a reader.
 */
export function namedBlocks(missing: readonly WorkbookBlock[]): readonly WorkbookBlock[] {
  const named: WorkbookBlock[] = [];
  for (const block of missing) {
    const last = named.at(-1);
    if (last?.sheet === block.sheet && last.to + 1 === block.from) {
      named[named.length - 1] = { sheet: last.sheet, from: last.from, to: block.to };
    } else {
      named.push(block);
    }
  }
  return named;
}

/**
 * The blocks as the import answers them: the first {@link MAX_OFFICE_MISSING_BLOCKS} named, and how many more there are.
 *
 * The document OPENED either way, so past the bound the person is told the count rather than the import failing — it
 * failed until 2026-10-02 (*"too many to name"*), refusing a workbook whose every other row had converted (JOURNAL, *No
 * document-size refusals*, table A row 12). Every block, named or counted, is in the shell log.
 */
export function toldBlocks(blocks: readonly WorkbookBlock[]): { readonly missing: readonly WorkbookBlock[]; readonly more: number } {
  return {
    missing: blocks.slice(0, MAX_OFFICE_MISSING_BLOCKS),
    more: Math.max(0, blocks.length - MAX_OFFICE_MISSING_BLOCKS),
  };
}

/**
 * A workbook converted sheet by sheet, and a sheet past x2t's cut-off in halves of its rows, then joined (decision C).
 *
 * x2t prints the active sheet only, at the author's own page setup (measured), so EVERY visible sheet is its own part —
 * a copy in which it is the active sheet and the only visible one. A part that answers exactly
 * {@link X2T_MAX_PRINT_PAGES} pages may have been cut, so it is halved by rows and each half converted again, in place
 * in the order. A part that cannot be halved — a print area this build cannot narrow, or one row reaching the cut-off
 * alone — is NAMED in `missing`, so the person is told which rows the PDF does not hold.
 *
 * ## A part x2t FAILS on is halved too, a bounded number of times
 *
 * Measured 2026-09-30 (`officeWorkbookLive.mjs`): x2t alone on a 100,000-row sheet of ten narrow columns exhausted the
 * 2 GiB job limit — *"RangeError: Array buffer allocation failed"*, exit 80 — and the whole import failed, in two runs
 * of three; the third came out cut instead, so that size sits at the limit. Whether rows
 * loaded or rows printed drives its peak was not separated; both shrink with a smaller part, and size is the one thing
 * this can change, so a part that times out or exits without a PDF is halved like one that reached the cut-off. That would be a loop for a workbook x2t fails on for some other
 * reason, so each sheet may spend {@link MAX_FAILED_PARTS_PER_SHEET} failed conversions; past that, its failing blocks are
 * named rather than tried. A converter that could not START is not a size, and fails the import at once.
 *
 * Nothing about the workbook's SIZE fails the import: a sheet past {@link MAX_CONVERSIONS_PER_SHEET} conversions has its
 * remaining blocks named, every block missing is kept for the answer to name or count, and the parts are joined in
 * stages ({@link joinedInStages}).
 */
async function convertWorkbook(
  workbooks: WorkbookComposer,
  convert: (part: Uint8Array) => Promise<OfficeConversion>,
  file: Uint8Array,
  failed: (failure: ConversionFailure) => OfficeConversionFailedError,
): Promise<OfficeConversion> {
  const unreadable = (detail: string): OfficeConversionFailedError => failed({ stage: 'workbook', detail });
  const placed: string[] = [];
  const done: string[] = [];
  const missing: WorkbookBlock[] = [];
  const input = await workbooks.put(file);
  placed.push(input);
  try {
    const sheets = await workbooks.outline(input);
    if (sheets === null) throw unreadable('its sheets could not be read');
    const queue = sheets.flatMap((sheet, index) =>
      sheet.state === 'visible' && sheet.lastRow > 0
        ? [{ index, name: sheet.name, lastRow: sheet.lastRow, rows: null as { from: number; to: number } | null }]
        : [],
    );
    const failedBySheet = new Map<number, number>();
    const convertedBySheet = new Map<number, number>();
    while (queue.length > 0) {
      const step = queue.shift();
      if (step === undefined) break;
      const rows = step.rows ?? { from: 1, to: step.lastRow };
      /** The block in two halves, in place in the order — or named, where one row cannot be halved. */
      const halve = (): void => {
        if (rows.from === rows.to) {
          missing.push({ sheet: step.name, ...rows });
          return;
        }
        const middle = Math.floor((rows.from + rows.to) / 2);
        queue.unshift({ ...step, rows: { from: rows.from, to: middle } }, { ...step, rows: { from: middle + 1, to: rows.to } });
      };
      const cut = await workbooks.part(input, step.index, step.rows);
      if (cut.kind !== 'written') {
        if (cut.kind === 'unreadable') throw unreadable(`sheet “${step.name}” could not be cut into a part`);
        // `nothing` is a block the author's print area does not reach — printed by nobody, so missing from nothing.
        if (cut.kind === 'unsplittable') missing.push({ sheet: step.name, ...rows });
        continue;
      }
      // A BUDGET OF THE SHEET'S IS SPENT: its remaining blocks are named without another conversion.
      if (
        (failedBySheet.get(step.index) ?? 0) >= MAX_FAILED_PARTS_PER_SHEET ||
        (convertedBySheet.get(step.index) ?? 0) >= MAX_CONVERSIONS_PER_SHEET
      ) {
        missing.push({ sheet: step.name, ...rows });
        continue;
      }
      convertedBySheet.set(step.index, (convertedBySheet.get(step.index) ?? 0) + 1);
      let converted: OfficeConversion;
      try {
        converted = await convert(cut.bytes);
      } catch (error) {
        if (!(error instanceof OfficeConversionFailedError) || !SIZE_FAILURES.has(error.failure.stage)) throw error;
        failedBySheet.set(step.index, (failedBySheet.get(step.index) ?? 0) + 1);
        halve();
        continue;
      }
      let pdf: string;
      try {
        pdf = await workbooks.put(converted.output);
      } finally {
        converted.discard();
      }
      placed.push(pdf);
      const pages = await workbooks.pages(pdf);
      if (pages === null) throw unreadable(`the PDF of sheet “${step.name}” could not be read`);
      if (pages < X2T_MAX_PRINT_PAGES) done.push(pdf);
      else halve();
    }
    const named = namedBlocks(missing);
    // NOTHING VISIBLE TO PRINT — every sheet empty or hidden: x2t's own answer for the file, as a whole conversion gives it.
    if (done.length === 0 && named.length === 0) return await convert(file);
    // NOTHING CONVERTED AND SOMETHING MISSING is a conversion that produced nothing, not an empty document with a note.
    if (done.length === 0) throw unreadable('no part of it could be converted');
    const joined = await workbooks.join(await joinedInStages(workbooks, done, placed, unreadable));
    if (joined === null) throw unreadable('its parts could not be joined');
    return { output: joined.output, discard: joined.discard, missing: named };
  } finally {
    await Promise.all(placed.map((name) => workbooks.remove(name)));
  }
}

/**
 * The parts, as at most {@link MAX_WORKBOOK_PARTS} PDFs for the last join: where there are more — a workbook of more
 * visible sheets than one join takes — each run of that many is joined and put back in the area, in order, and the runs
 * joined again. Each stage is one more read of the bytes, and two stages cover a million parts.
 *
 * A stage and not a larger join, because the join's list is a host channel's bounded params, and a workbook of 1,025
 * sheets was refused at it (JOURNAL, *No document-size refusals*, table A row 12).
 *
 * @param placed every name put into the area, which the caller removes; each stage's PDF joins it
 */
async function joinedInStages(
  workbooks: WorkbookComposer,
  parts: readonly string[],
  placed: string[],
  unreadable: (detail: string) => OfficeConversionFailedError,
): Promise<readonly string[]> {
  let names = parts;
  while (names.length > MAX_WORKBOOK_PARTS) {
    const staged: string[] = [];
    for (let at = 0; at < names.length; at += MAX_WORKBOOK_PARTS) {
      const run = await workbooks.join(names.slice(at, at + MAX_WORKBOOK_PARTS));
      if (run === null) throw unreadable('its parts could not be joined');
      let name: string;
      try {
        name = await workbooks.put(run.output);
      } finally {
        run.discard();
      }
      placed.push(name);
      staged.push(name);
    }
    names = staged;
  }
  return names;
}
