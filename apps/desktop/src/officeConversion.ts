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
 * pages holding every row. Where the cap is set was not found. So the heaviest reading is 1.6x under
 * this limit and 1.7x under the time, and a larger workbook loses rows rather than exceeding either.
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

/** x2t's instructions for one conversion to PDF, as ADR-0120 measured them. */
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
export function createOfficeSource(platform: ConverterPlatform, report: ShellFailureSink): OfficeSource {
  const failed = (failure: ConversionFailure): OfficeConversionFailedError => {
    const error = new OfficeConversionFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  return async (format, file) => {
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
    return { output: converted.output, discard: converted.discard };
  };
}
