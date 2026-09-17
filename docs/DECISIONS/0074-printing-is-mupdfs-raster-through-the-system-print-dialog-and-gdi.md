# ADR-0074 — Printing is MuPDF's raster, sent through the system print dialog and GDI from `main`

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §3, whose *Print & export rasterisation* row gains
  the route a print takes after the raster, and §9.17's argument for `main`'s
  baseline, which names the libraries `main` binds.
- **Corrects:** [ADR-0028](0028-main-holds-the-process-creation-binding.md), whose list of
  the libraries `main` binds was short by one on the day it was written. It carries a
  dated correction.
- **Relates:** [ADR-0022](0022-the-engine-host-is-a-process-we-create.md) (the host
  rasterises), [ADR-0035](0035-extracted-text-is-never-resident-in-main.md) (a page at a
  time).
- **Context:** D10's *print (MuPDF raster at chosen DPI to system dialog — never print the
  DOM)* (`BUILD-PROMPT.md`:504-505).

## The gap

The founding record decides the raster (MuPDF) and forbids the renderer's DOM, which is
what Electron's `webContents.print` prints. It does not say how a raster reaches a
printer, and §9.17 says `main` binds `kernel32.dll` and `advapi32.dll` *"and nothing
else"* — while every route from a raster to a printer on Windows goes through the
graphics device interface (`gdi32.dll`) and the print dialog (`comdlg32.dll`).

## Measured, 2026-09-17 (MuPDF 1.28.0; `scripts/research`-shaped scratch probe, not committed)

1. **GDI prints a MuPDF raster, page for page.** A generated two-page document, each page
   rasterised by MuPDF at 150 dpi, sent with `StretchDIBits` as a top-down 32-bit DIB into
   a device context for *Microsoft Print to PDF* (600 dpi, 5100×6600 printable), with the
   document's output named in `DOCINFOW` so no dialog was needed. The printed file had two
   pages; each rendered back at the raster's size differed from the raster sent for it by a
   mean **0.14 and 0.13** of 255, and from the other page's by **17.48 and 17.56** — the
   control that separates *printed the right page* from *printed something*.
2. **`main` binds `userenv.dll` and has since 2026-08-23.** `win32HostSurface.ts` loads it
   for the AppContainer profile, five days before ADR-0028 listed two libraries and *"nothing
   else"*.

## Decision

1. **A print is MuPDF's raster of each page, drawn by GDI into the device context the
   system print dialog returns.** `PrintDlgExW` shows the operating system's dialog —
   printer, pages, copies, the printer's own properties — and answers a device context;
   each chosen page is rasterised in the engine host at the DPI the person chose, one page
   at a time, fitted into the printable area with its aspect kept and centred, and drawn
   with `StretchDIBits` between `StartPage` and `EndPage`.
2. **`main` binds it**, in one Win32 adapter module beside the existing ones, bound on the
   first print and not at import — so the libraries join what `main` may load and not its
   baseline.
3. **§9.17 names the libraries.** `main`'s baseline binding is `kernel32.dll`,
   `advapi32.dll` and `userenv.dll`; printing adds `gdi32.dll` and `comdlg32.dll` when a
   person prints. MuPDF in `main` stays forbidden, and invariant 20 is untouched: the
   pixels come from the host.
4. **The page never passes through the renderer.** The DPI is asked in a dialog; the raster
   is main's to fetch and send.

## Rejected

- **`webContents.print`.** Prints the DOM, which the record forbids by name: what the
  person sees is PDF.js's rendering, and the print is MuPDF's.
- **Rendering the pages to a hidden window and printing that.** The DOM again, one step on.
- **A dialog of our own for printer and copies.** The record says the system dialog, which
  also owns the printer's driver settings a person expects to find there.
- **Printing a PDF through the default application's print verb.** Hands the document to
  another program to rasterise, which is not MuPDF's raster and not this build's print.

## Consequences

- §3's row and §9.17's clause are amended, the amendment log gets a line, the index a row,
  and ADR-0028 a correction.
- The feature commit measures the dialog's binding without showing it (`PD_RETURNDEFAULT`
  answers the default printer through the same structure), and prints through the same
  route to *Microsoft Print to PDF* as its instrument. Showing the dialog is a live run the
  owner is present for.
