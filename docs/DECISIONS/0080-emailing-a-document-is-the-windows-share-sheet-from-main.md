# ADR-0080 — Emailing a document is the Windows Share sheet, reached from `main` through WinRT

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §9.17, whose argument for `main`'s baseline names the
  libraries `main` binds: sharing adds `combase.dll` when a person emails a document.
- **Relates:** [ADR-0074](0074-printing-is-mupdfs-raster-through-the-system-print-dialog-and-gdi.md)
  (the same shape: a Win32 surface in `main`, bound on first use).
- **Context:** D10's *email document* (`BUILD-PROMPT.md`:504), and the owner's answer Q13
  (recorded 2026-09-14): *email via the Windows Share sheet; first find whether it needs package
  identity unpackaged — if so, an event trigger on the row; no substitute design.*

## The gap

The founding record says *email document* and nothing about the route. The owner chose the Share
sheet. Electron offers a share menu on macOS only, so on Windows the sheet is WinRT's
`DataTransferManager`, reached from a desktop window through `IDataTransferManagerInterop` — and
§9.17 says `main` binds `kernel32.dll`, `advapi32.dll`, `userenv.dll`, and `gdi32.dll` and
`comdlg32.dll` when a person prints, and nothing else. WinRT's activation and string functions are
`combase.dll`'s.

## Measured, 2026-09-17 (Electron 43.4.1 main, unpackaged; scratch probes, no UI shown)

1. **No package identity is needed to reach the sheet's manager.** `RoGetActivationFactory` for
   `IDataTransferManagerInterop` and `GetForWindow` on a hidden `BrowserWindow`'s handle both
   answered `S_OK` with an object. **Control:** the same call on a null window handle answered
   `0x80070578` (invalid window handle) and no object. So Q13's identity condition does not fire in
   development; whether a packaged build behaves the same is the packaging row's to read.
2. **A koffi-implemented delegate registers.** `add_DataRequested` with a COM object built from four
   `koffi.register` callbacks answered `S_OK` and a token, and `remove_DataRequested` took it back.
   The delegate's interface ID, computed from its WinRT signature, is
   `ec6f9cc8-46d0-5e0e-b4d2-7d7773ae37a0` — the value the Windows SDK 10.0.26100 header declares —
   and the same computation reproduces `IIterable<String>`'s published ID.
3. **The handler's own calls work, read back through a second path.** On a `DataPackage` the probe
   activated: `put_Title` and `SetStorageItems` with a folder's item list (queried to
   `IIterable<IStorageItem>`, `bb8b8418-…` from the same header), then `GetView` →
   `GetStorageItemsAsync` answered one item named as the file. **Control:** a package given no items
   answered `0x8004006A` to the same read. Asynchronous results were polled through `IAsyncInfo`,
   so no completion delegate is needed.
4. **Every vtable slot is the header's.** Read from `winrt/windows.applicationmodel.datatransfer.h`
   and `winrt/windows.storage.h` in SDK 10.0.26100, not recalled.

What was **not** measured: `ShowShareUIForWindow` and the operating system raising `DataRequested`,
because both put the sheet in front of a person. That is the row's live run, with the owner present.

## Decision

1. **Email is sharing the document as a file.** `main` writes the document's current bytes, named as
   the document is, into a folder of its own under the application's temporary directory, and offers
   that folder's one item to the Share sheet with the document's name as the title. The person picks
   the mail application in the sheet.
2. **`main` binds it**, in one Win32 adapter module beside the print surface, bound on the first
   share and not at import: `combase.dll` joins what `main` may load and not its baseline.
3. **The data is ready before the sheet opens.** The item list is resolved first, so the
   `DataRequested` handler does only synchronous work — set the title, set the items — inside the
   deadline the sheet gives it.
4. **Asynchronous WinRT results are polled**, not awaited through completion delegates: one delegate
   type is implemented (the event handler), not three.

## Rejected

- **Simple MAPI** (`MAPISendMailW`). Reaches the registered MAPI client, which on this machine is
  classic Outlook with no profile, and not the new Outlook the mail handler names. Not the owner's
  route.
- **A `mailto:` link.** Carries no attachment, so it does not email the document.
- **A helper executable or a PowerShell script for the WinRT calls.** A second process to reach an
  API `main` can bind, and a script is text a path could rewrite.
- **Implementing `IIterable<IStorageItem>` ourselves.** A folder's item list already is one.

## Consequences

- §9.17's clause is amended, the amendment log gets a line, and the index a row.
- The feature commit proves the data path headless with the control above, through the shipped
  surface; the sheet itself is the owner-present live run.
