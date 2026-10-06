/**
 * What a print needs from the platform, named with no Win32 anything
 * ([ADR-0074](../../../docs/DECISIONS/0074-printing-is-mupdfs-raster-through-the-system-print-dialog-and-gdi.md)).
 *
 * `DocumentCommands.print` asks the operating system's print dialog which pages go
 * where, then hands each chosen page's MuPDF raster to the job one page at a time.
 * The Win32 half is `win32PrintSurface.ts`; a case here injects its own.
 */

/** A decoded raster: `width × height` pixels, four bytes each, blue-green-red-unused, top row first. */
export interface DecodedRaster {
  readonly width: number;
  readonly height: number;
  readonly bgra: Uint8Array;
}

/** One print in progress on the printer the person chose. */
export interface PrintJob {
  /** Draws one page's PNG raster, fitted to the printable area with its aspect kept and centred. */
  readonly page: (png: Uint8Array) => void;
  /** Ends the document, so the printer receives it. */
  readonly finish: () => void;
  /** Abandons the document, so the printer receives nothing. */
  readonly abort: () => void;
}

/** What the print dialog answered. */
export interface PrintChoice {
  /** The zero-based pages the person chose, in order. */
  readonly pages: readonly number[];
  /** Starts the document on the chosen printer, under `name`. */
  readonly start: (name: string) => PrintJob;
  /** Releases the printer, whether or not a document was started. */
  readonly release: () => void;
}

/** The system print dialog, or null where there is none. */
export interface PrintDestination {
  /**
   * Shows the dialog for a document of `pageCount` pages, its own *Pages* starting on `start` (zero-based, the
   * application's page row; ADR-0161 Decision 3); null when it is dismissed.
   */
  readonly choose: (pageCount: number, start: readonly number[]) => PrintChoice | null;
}

/**
 * What the system dialog is told about the pages, from the application's choice (ADR-0161 Decision 3).
 *
 * - `all`: every page was chosen, so the dialog starts on *All*.
 * - `ranges`: its own *Pages*, one-based and inclusive as it shows them, which it then answers.
 * - `fixed`: more runs than the dialog can hold, so it offers no page choice of its own, and these pages print.
 */
export type PrintStart =
  | { readonly kind: 'all' }
  | { readonly kind: 'ranges'; readonly ranges: readonly { readonly from: number; readonly to: number }[] }
  | { readonly kind: 'fixed'; readonly pages: readonly number[] };

/** The {@link PrintStart} for a choice of zero-based pages in a document of `pageCount`, given the dialog's limit. */
export function printStart(pageCount: number, start: readonly number[], maxRanges: number): PrintStart {
  const pages = [...new Set(start)].filter((page) => page >= 0 && page < pageCount).sort((one, two) => one - two);
  if (pages.length === 0 || pages.length === pageCount) return { kind: 'all' };
  const ranges: { from: number; to: number }[] = [];
  for (const page of pages) {
    const last = ranges.at(-1);
    if (last?.to === page) last.to = page + 1;
    else ranges.push({ from: page + 1, to: page + 1 });
  }
  return ranges.length > maxRanges ? { kind: 'fixed', pages } : { kind: 'ranges', ranges };
}

/** Raised when the printer refuses a step of a document; the document was abandoned. */
export class PrintFailedError extends Error {
  constructor(step: string, code: number) {
    super(`the printer refused ${step} (code ${String(code)}), so the document was abandoned`);
    this.name = 'PrintFailedError';
  }
}

/**
 * The zero-based pages a dialog's page ranges name, in order, each once, inside the
 * document — or every page when the person chose all of them.
 *
 * **Ranges are one-based and inclusive**, as the dialog shows them, and a person
 * can type overlapping or reversed ones; a range past the document's end is cut to
 * it rather than refused, since the dialog was told the page count.
 */
export function chosenPages(
  pageCount: number,
  ranges: readonly { readonly from: number; readonly to: number }[] | null,
): readonly number[] {
  if (ranges === null) return Array.from({ length: pageCount }, (_unused, page) => page);
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const range of ranges) {
    const first = Math.max(1, Math.min(range.from, range.to));
    const last = Math.min(pageCount, Math.max(range.from, range.to));
    for (let page = first; page <= last; page += 1) {
      if (seen.has(page)) continue;
      seen.add(page);
      pages.push(page - 1);
    }
  }
  return pages;
}

/** Where a raster of `width × height` goes on a printable area of `areaWidth × areaHeight`: fitted, aspect kept, centred. */
export function fittedOnPaper(
  width: number,
  height: number,
  areaWidth: number,
  areaHeight: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const scale = Math.min(areaWidth / width, areaHeight / height);
  const fittedWidth = Math.max(1, Math.round(width * scale));
  const fittedHeight = Math.max(1, Math.round(height * scale));
  return {
    x: Math.round((areaWidth - fittedWidth) / 2),
    y: Math.round((areaHeight - fittedHeight) / 2),
    width: fittedWidth,
    height: fittedHeight,
  };
}
