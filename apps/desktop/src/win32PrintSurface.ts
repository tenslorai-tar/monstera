import koffi from 'koffi';

import {
  type DecodedRaster,
  type PrintChoice,
  type PrintDestination,
  type PrintJob,
  PrintFailedError,
  chosenPages,
  fittedOnPaper,
} from './printing.js';

/**
 * The Win32 calls behind {@link PrintDestination}, bound with koffi
 * ([ADR-0074](../../../docs/DECISIONS/0074-printing-is-mupdfs-raster-through-the-system-print-dialog-and-gdi.md)).
 * B7's sanctioned exception, one typed adapter module per native boundary, beside
 * `win32HostSurface.ts`, `win32PipeSurface.ts` and `win32DirectorySurface.ts`.
 *
 * ## The dialog runs on `main`'s thread, and that pauses `main`'s event loop
 *
 * `PrintDlgExW` is modal: it runs its own message loop until the person answers, so
 * windows keep painting and nothing in `main`'s JavaScript runs meanwhile —
 * Electron's own synchronous dialogs behave the same way. On a worker thread it
 * would not pause `main`, and it would be a dialog created on a thread that did not
 * initialise the COM apartment the property sheet expects, which is not a state
 * this module can measure without the dialog in front of a person.
 *
 * ## Nothing is bound at import time
 *
 * For `win32DirectorySurface.ts`' reason: importing this file must work on every
 * platform the tree is typechecked on, and `gdi32.dll` and `comdlg32.dll` are loaded
 * only when a person prints (§9.17).
 */

/** `PRINTDLGEX.Flags`: answer a device context; the driver does copies and collation; no selection or current page. */
const PD_PAGENUMS = 0x2;
const PD_NOSELECTION = 0x4;
const PD_RETURNDC = 0x100;
const PD_RETURNDEFAULT = 0x400;
const PD_USEDEVMODECOPIESANDCOLLATE = 0x40000;
const PD_NOCURRENTPAGE = 0x800000;
const START_PAGE_GENERAL = 0xffffffff;
const PD_RESULT_PRINT = 1;
/** How many ranges a person may type into the dialog. */
const MAX_PAGE_RANGES = 64;

const HORZRES = 8;
const VERTRES = 10;
const HALFTONE = 4;
const DIB_RGB_COLORS = 0;
const SRCCOPY = 0x00cc0020;

/** `PRINTDLGEXW`, as koffi reads and writes it back: pointers and handles are opaque. */
interface PrintDialog {
  lStructSize: number;
  hwndOwner: bigint;
  hDevMode: unknown;
  hDevNames: unknown;
  hDC: unknown;
  Flags: number;
  Flags2: number;
  ExclusionFlags: number;
  nPageRanges: number;
  nMaxPageRanges: number;
  lpPageRanges: unknown;
  nMinPage: number;
  nMaxPage: number;
  nCopies: number;
  hInstance: unknown;
  lpPrintTemplateName: unknown;
  lpCallback: unknown;
  nPropertyPages: number;
  lphPropertyPages: unknown;
  nStartPage: number;
  dwResultAction: number;
}

interface PrintBindings {
  readonly printDialog: (dialog: PrintDialog) => number;
  readonly globalFree: (memory: unknown) => unknown;
  readonly deleteDc: (dc: unknown) => boolean;
  readonly startDoc: (dc: unknown, info: Record<string, unknown>) => number;
  readonly startPage: (dc: unknown) => number;
  readonly endPage: (dc: unknown) => number;
  readonly endDoc: (dc: unknown) => number;
  readonly abortDoc: (dc: unknown) => number;
  readonly deviceCaps: (dc: unknown, index: number) => number;
  readonly setStretchMode: (dc: unknown, mode: number) => number;
  readonly stretchBits: (
    dc: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    bits: Uint8Array,
    header: Record<string, unknown>,
    usage: number,
    operation: number,
  ) => number;
}

/** Registered under process-global names, so once — named for this module, for `win32DirectorySurface.ts`' reason. */
let structsRegistered = false;

function registerStructs(): void {
  if (structsRegistered) return;
  koffi.struct('MONSTERA_PRINTPAGERANGE', { nFromPage: 'uint32', nToPage: 'uint32' });
  koffi.struct('MONSTERA_PRINTDLGEXW', {
    lStructSize: 'uint32',
    // A HANDLE'S VALUE rather than a pointer: it arrives from Electron as the bytes of
    // `getNativeWindowHandle()`, a number, and is never dereferenced here.
    hwndOwner: 'uintptr_t',
    hDevMode: 'void *',
    hDevNames: 'void *',
    hDC: 'void *',
    Flags: 'uint32',
    Flags2: 'uint32',
    ExclusionFlags: 'uint32',
    nPageRanges: 'uint32',
    nMaxPageRanges: 'uint32',
    lpPageRanges: 'void *',
    nMinPage: 'uint32',
    nMaxPage: 'uint32',
    nCopies: 'uint32',
    hInstance: 'void *',
    lpPrintTemplateName: 'void *',
    lpCallback: 'void *',
    nPropertyPages: 'uint32',
    lphPropertyPages: 'void *',
    nStartPage: 'uint32',
    dwResultAction: 'uint32',
  });
  koffi.struct('MONSTERA_DOCINFOW', {
    cbSize: 'int32',
    lpszDocName: 'const char16_t *',
    lpszOutput: 'const char16_t *',
    lpszDatatype: 'const char16_t *',
    fwType: 'uint32',
  });
  koffi.struct('MONSTERA_BITMAPINFOHEADER', {
    biSize: 'uint32',
    biWidth: 'int32',
    biHeight: 'int32',
    biPlanes: 'uint16',
    biBitCount: 'uint16',
    biCompression: 'uint32',
    biSizeImage: 'uint32',
    biXPelsPerMeter: 'int32',
    biYPelsPerMeter: 'int32',
    biClrUsed: 'uint32',
    biClrImportant: 'uint32',
  });
  structsRegistered = true;
}

function bind(): PrintBindings {
  const comdlg = koffi.load('comdlg32.dll');
  const gdi = koffi.load('gdi32.dll');
  const kernel = koffi.load('kernel32.dll');
  // koffi's `func()` returns a callable assignable to any signature, so each type
  // above is an assertion written from the C prototype on the adjacent line — the
  // review mechanism `win32DirectorySurface.ts` names.
  return {
    printDialog: comdlg.func('int32 PrintDlgExW(_Inout_ MONSTERA_PRINTDLGEXW *dialog)'),
    globalFree: kernel.func('void *GlobalFree(void *memory)'),
    deleteDc: gdi.func('bool DeleteDC(void *dc)'),
    startDoc: gdi.func('int StartDocW(void *dc, const MONSTERA_DOCINFOW *info)'),
    startPage: gdi.func('int StartPage(void *dc)'),
    endPage: gdi.func('int EndPage(void *dc)'),
    endDoc: gdi.func('int EndDoc(void *dc)'),
    abortDoc: gdi.func('int AbortDoc(void *dc)'),
    deviceCaps: gdi.func('int GetDeviceCaps(void *dc, int index)'),
    setStretchMode: gdi.func('int SetStretchBltMode(void *dc, int mode)'),
    stretchBits: gdi.func(
      'int StretchDIBits(void *dc, int x, int y, int width, int height, int sourceX, int sourceY, ' +
        'int sourceWidth, int sourceHeight, const uint8_t *bits, const MONSTERA_BITMAPINFOHEADER *header, ' +
        'uint32 usage, uint32 operation)',
    ),
  };
}

/**
 * A job on the device context `dc`: each page's PNG decoded by `decode` and drawn
 * fitted into the printable area.
 *
 * Exported for the research instrument, which opens a device context for *Microsoft
 * Print to PDF* with an output file rather than through the dialog — the same drawing
 * this module ships, on a printer whose output can be read back.
 */
export function printJobOn(
  bindings: PrintBindings,
  dc: unknown,
  name: string,
  decode: (png: Uint8Array) => DecodedRaster,
  output: string | null = null,
): PrintJob {
  const started = bindings.startDoc(dc, {
    cbSize: koffi.sizeof('MONSTERA_DOCINFOW'),
    lpszDocName: name,
    lpszOutput: output,
    lpszDatatype: null,
    fwType: 0,
  });
  if (started <= 0) throw new PrintFailedError('the document', started);
  const areaWidth = bindings.deviceCaps(dc, HORZRES);
  const areaHeight = bindings.deviceCaps(dc, VERTRES);

  return {
    page: (png) => {
      const raster = decode(png);
      const placed = fittedOnPaper(raster.width, raster.height, areaWidth, areaHeight);
      const opened = bindings.startPage(dc);
      if (opened <= 0) throw new PrintFailedError('a page', opened);
      bindings.setStretchMode(dc, HALFTONE);
      // A TOP-DOWN DIB — a negative height — because the raster's first row is the
      // page's top; a positive height would print every page upside down.
      const drawn = bindings.stretchBits(
        dc,
        placed.x,
        placed.y,
        placed.width,
        placed.height,
        0,
        0,
        raster.width,
        raster.height,
        raster.bgra,
        {
          biSize: koffi.sizeof('MONSTERA_BITMAPINFOHEADER'),
          biWidth: raster.width,
          biHeight: -raster.height,
          biPlanes: 1,
          biBitCount: 32,
          biCompression: 0,
          biSizeImage: 0,
          biXPelsPerMeter: 0,
          biYPelsPerMeter: 0,
          biClrUsed: 0,
          biClrImportant: 0,
        },
        DIB_RGB_COLORS,
        SRCCOPY,
      );
      if (drawn !== raster.height) throw new PrintFailedError('a page’s picture', drawn);
      const closed = bindings.endPage(dc);
      if (closed <= 0) throw new PrintFailedError('the end of a page', closed);
    },
    finish: () => {
      const ended = bindings.endDoc(dc);
      if (ended <= 0) throw new PrintFailedError('the end of the document', ended);
    },
    abort: () => {
      bindings.abortDoc(dc);
    },
  };
}

/** The bindings, for the research instrument that drives {@link printJobOn} without the dialog. */
export function win32PrintBindings(): PrintBindings {
  registerStructs();
  return bind();
}

/**
 * @param decode turns a page's PNG into pixels — Electron's `nativeImage` in the
 *   application, since the raster is this build's own and `main` holds no image codec
 * @param owner the window the dialog belongs to, as its handle's value. **Required**:
 *   `PrintDlgExW` answers `E_HANDLE` for none, measured 2026-09-17, as its documentation
 *   says it must
 * @param returnDefault answer the default printer without showing the dialog, which is
 *   how the dialog's structure is measured without a person in front of it
 */
export function createWin32PrintSurface(
  decode: (png: Uint8Array) => DecodedRaster,
  owner: () => bigint,
  returnDefault = false,
): PrintDestination {
  return {
    choose: (pageCount: number): PrintChoice | null => {
      const bindings = win32PrintBindings();
      // AN OPAQUE POINTER, typed as one: koffi declares `alloc` as answering `any`.
      const ranges: unknown = koffi.alloc('MONSTERA_PRINTPAGERANGE', MAX_PAGE_RANGES);
      const dialog: PrintDialog = {
        lStructSize: koffi.sizeof('MONSTERA_PRINTDLGEXW'),
        hwndOwner: owner(),
        hDevMode: null,
        hDevNames: null,
        hDC: null,
        Flags:
          PD_RETURNDC |
          PD_USEDEVMODECOPIESANDCOLLATE |
          PD_NOSELECTION |
          PD_NOCURRENTPAGE |
          (returnDefault ? PD_RETURNDEFAULT : 0),
        Flags2: 0,
        ExclusionFlags: 0,
        nPageRanges: 0,
        nMaxPageRanges: MAX_PAGE_RANGES,
        lpPageRanges: ranges,
        nMinPage: 1,
        nMaxPage: Math.max(1, pageCount),
        nCopies: 1,
        hInstance: null,
        lpPrintTemplateName: null,
        lpCallback: null,
        nPropertyPages: 0,
        lphPropertyPages: null,
        nStartPage: START_PAGE_GENERAL,
        dwResultAction: 0,
      };
      try {
        const result = bindings.printDialog(dialog);
        const release = (): void => {
          if (dialog.hDC !== null) bindings.deleteDc(dialog.hDC);
          if (dialog.hDevMode !== null) bindings.globalFree(dialog.hDevMode);
          if (dialog.hDevNames !== null) bindings.globalFree(dialog.hDevNames);
        };
        // THE DEFAULT PRINTER'S ANSWER carries no result action: the dialog never ran.
        const printing = returnDefault ? result === 0 && dialog.hDC !== null : result === 0 && dialog.dwResultAction === PD_RESULT_PRINT;
        if (!printing || dialog.hDC === null) {
          release();
          if (result !== 0) throw new PrintFailedError('the print dialog', result);
          return null;
        }
        const count = dialog.nPageRanges;
        const typed =
          (dialog.Flags & PD_PAGENUMS) !== 0 && count > 0
            ? (koffi.decode(ranges, 'MONSTERA_PRINTPAGERANGE', count) as { nFromPage: number; nToPage: number }[]).map(
                (range) => ({ from: range.nFromPage, to: range.nToPage }),
              )
            : null;
        const dc = dialog.hDC;
        return {
          pages: chosenPages(pageCount, typed),
          start: (name) => printJobOn(bindings, dc, name, decode),
          release,
        };
      } finally {
        koffi.free(ranges);
      }
    },
  };
}
