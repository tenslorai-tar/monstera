import { describe, expect, it } from 'vitest';

import {
  ENGINE_HOST_CONTAINER,
  ENGINE_HOST_ENTRY_FILE,
  type EngineHostKind,
  hostCommandArguments,
} from './engineHostPrograms.js';

/**
 * The facts each contained host owes, asserted where they can be.
 *
 * `engineHostPlatform.ts` — the only consumer — binds Win32 at module scope, so
 * no case anywhere can import it. These constants were extracted for that
 * reason: what decides whether two hosts are contained from each other is a
 * pair of strings, and a pair of strings is testable on any platform.
 *
 * ## The roster is LITERAL, and 4c decides that
 *
 * The failure feared runs both ways. A host **arriving** without a container
 * is already a compile error, because both maps are `Record<EngineHostKind, …>`
 * — so a derived count adds nothing there. A host's moniker **changing to
 * match another's** leaves every count identical, and a set derived from either
 * object agrees with it. So the names are written down here: this file is the
 * independent claim, and the diff that edits one of them is where a merge of two
 * principals happens deliberately or not at all.
 */
const KINDS = ['mupdf', 'pdfium', 'compose'] as const satisfies readonly EngineHostKind[];

describe('the engine host programs', () => {
  it('gives each host its OWN AppContainer profile moniker', () => {
    // THE PROPERTY ADR-0048's CORRECTION IS ABOUT. `hostSessionDirectoryDacl`
    // grants a SID derived from the moniker, so two hosts sharing one are one
    // principal and each holds read on the other's granted directories — a
    // document open in one engine, readable by the other, with nothing failing.
    // The compose host is the third (ADR-0060): a file picked for import, readable
    // by a host that holds a document's bytes, is the same failure one host over.
    const monikers = KINDS.map((kind) => ENGINE_HOST_CONTAINER[kind]);
    expect(new Set(monikers).size).toBe(monikers.length);
    expect(monikers).toStrictEqual(['monstera-engine-host', 'monstera-pdfium-host', 'monstera-compose-host']);

    // AND NONE IS EMPTY, which is the half the set above cannot state: two empty
    // strings collide and are caught, but ONE empty string is a distinct value
    // that would be handed to `DeriveAppContainerSidFromAppContainerName` and
    // refused at a layer with no test on it.
    for (const moniker of monikers) expect(moniker.length).toBeGreaterThan(0);
  });

  it('gives each host its own entry script', () => {
    // The sibling property, and it separates a different mistake: two hosts with
    // two containers and ONE entry file is one host running another's program,
    // which starts, connects, and answers channels its map does not carry.
    const entries = KINDS.map((kind) => ENGINE_HOST_ENTRY_FILE[kind]);
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries).toStrictEqual(['hostEntry.js', 'pdfiumHostEntry.js', 'composeHostEntry.js']);
  });

  it('puts the pipe name first for every host, and each engine’s library path second', () => {
    // `pdfiumHostEntry.ts`'s `argumentsFrom` and `hostEntry.ts`' `libraryPathFrom` both read `argv.slice(2)` as
    // `[pipeName, libraryPath]` — MuPDF's since its engine is the native library (ADR-0124). This
    // is the supplying side of that, asserted as an exact list rather than by
    // `toContain` — a writer that emitted the two arguments in the other
    // order satisfies a containment check and starts a host that binds a pipe
    // name as a library.
    expect(
      hostCommandArguments(
        { kind: 'mupdf', libraryPath: 'C:\\s\\monstera_mupdf.dll' },
        'C:\\k\\hostEntry.js',
        '\\\\.\\pipe\\p',
      ),
    ).toStrictEqual(['C:\\k\\hostEntry.js', '\\\\.\\pipe\\p', 'C:\\s\\monstera_mupdf.dll']);

    // THE FONTS FOURTH and THE INSTALLED FONTS FIFTH for PDFium (ADR-0173, ADR-0172 Decision 2), where
    // `pdfiumHostEntry.ts` reads them, each EMPTY where there are none — and a missing bundled folder does not move the
    // installed one.
    expect(
      hostCommandArguments(
        { kind: 'pdfium', libraryPath: 'C:\\t\\pdfium.dll', fontsPath: 'C:\\f', installedFontsPath: 'C:\\Windows\\Fonts' },
        'C:\\k\\pdfiumHostEntry.js',
        '\\\\.\\pipe\\q',
      ),
    ).toStrictEqual(['C:\\k\\pdfiumHostEntry.js', '\\\\.\\pipe\\q', 'C:\\t\\pdfium.dll', 'C:\\f', 'C:\\Windows\\Fonts']);
    expect(
      hostCommandArguments(
        { kind: 'pdfium', libraryPath: 'C:\\t\\pdfium.dll', fontsPath: null, installedFontsPath: null },
        'e.js',
        'q',
      ),
    ).toStrictEqual(['e.js', 'q', 'C:\\t\\pdfium.dll', '', '']);
    expect(
      hostCommandArguments(
        { kind: 'pdfium', libraryPath: 'C:\\t\\pdfium.dll', fontsPath: null, installedFontsPath: 'C:\\Windows\\Fonts' },
        'e.js',
        'q',
      ),
    ).toStrictEqual(['e.js', 'q', 'C:\\t\\pdfium.dll', '', 'C:\\Windows\\Fonts']);
  });

  it('gives a compose host with no shim and no fonts two EMPTY arguments, never a path', () => {
    // THE CONTROL for the cases below, and it is not the same assertion twice: a
    // builder that appended a library path unconditionally would satisfy every
    // engine expectation there, and that host would carry a filesystem path in its
    // command line for anything on the machine to read out of the process list.
    expect(
      hostCommandArguments(
        { kind: 'compose', shimPath: null, fontsPath: null, installedFontsPath: null },
        'composeHostEntry.js',
        'pipe',
      ),
    ).toStrictEqual(['composeHostEntry.js', 'pipe', '', '', '']);
  });

  it('gives the compose host the shim’s path THIRD and the fonts’ FOURTH, where it reads them (ADR-0087, ADR-0172)', () => {
    expect(
      hostCommandArguments(
        { kind: 'compose', shimPath: 'C:\\s\\monstera_mupdf.dll', fontsPath: 'C:\\f', installedFontsPath: 'C:\\W\\Fonts' },
        'composeHostEntry.js',
        'pipe',
      ),
    ).toStrictEqual(['composeHostEntry.js', 'pipe', 'C:\\s\\monstera_mupdf.dll', 'C:\\f', 'C:\\W\\Fonts']);
    // A MISSING SHIM DOES NOT MOVE THE FONTS: the entry reads `argv[4]` and `argv[5]` whatever came before.
    expect(
      hostCommandArguments(
        { kind: 'compose', shimPath: null, fontsPath: 'C:\\f', installedFontsPath: null },
        'composeHostEntry.js',
        'pipe',
      ),
    ).toStrictEqual(['composeHostEntry.js', 'pipe', '', 'C:\\f', '']);
  });
});
