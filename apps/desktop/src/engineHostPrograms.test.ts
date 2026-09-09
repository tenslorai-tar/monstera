import { describe, expect, it } from 'vitest';

import {
  ENGINE_HOST_CONTAINER,
  ENGINE_HOST_ENTRY_FILE,
  type EngineHostKind,
  hostCommandArguments,
} from './engineHostPrograms.js';

/**
 * The two facts a second engine host owes, asserted where they can be.
 *
 * `engineHostPlatform.ts` — the only consumer — binds Win32 at module scope, so
 * no case anywhere can import it. These constants were extracted for that
 * reason: what decides whether two hosts are contained from each other is a
 * pair of strings, and a pair of strings is testable on any platform.
 *
 * ## The roster is LITERAL, and 4c decides that
 *
 * The failure feared runs both ways. An engine **arriving** without a container
 * is already a compile error, because both maps are `Record<EngineHostKind, …>`
 * — so a derived count adds nothing there. An engine's moniker **changing to
 * match another's** leaves every count identical, and a set derived from either
 * object agrees with it. So the names are written down here: this file is the
 * independent claim, and the diff that edits one of them is where a merge of two
 * principals happens deliberately or not at all.
 */
const KINDS = ['mupdf', 'pdfium'] as const satisfies readonly EngineHostKind[];

describe('the engine host programs', () => {
  it('gives each engine its OWN AppContainer profile moniker', () => {
    // THE PROPERTY ADR-0048's CORRECTION IS ABOUT. `hostSessionDirectoryDacl`
    // grants a SID derived from the moniker, so two hosts sharing one are one
    // principal and each holds read on the other's granted directories — a
    // document open in one engine, readable by the other, with nothing failing.
    const monikers = KINDS.map((kind) => ENGINE_HOST_CONTAINER[kind]);
    expect(new Set(monikers).size).toBe(monikers.length);

    // AND NEITHER IS EMPTY, which is the half the set above cannot state: two
    // empty strings collide and are caught, but ONE empty string is a distinct
    // value that would be handed to `DeriveAppContainerSidFromAppContainerName`
    // and refused at a layer with no test on it.
    for (const moniker of monikers) expect(moniker.length).toBeGreaterThan(0);
  });

  it('gives each engine its own entry script', () => {
    // The sibling property, and it separates a different mistake: two engines
    // with two containers and ONE entry file is a PDFium host running MuPDF's
    // program, which starts, connects, and answers `engine/apply` for a command
    // its channel map does not carry.
    const entries = KINDS.map((kind) => ENGINE_HOST_ENTRY_FILE[kind]);
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries).toStrictEqual(['hostEntry.js', 'pdfiumHostEntry.js']);
  });

  it('puts the pipe name first for both, and the library path second for PDFium only', () => {
    // `pdfiumHostEntry.ts`'s `argumentsFrom` reads `argv.slice(2)` as
    // `[pipeName, libraryPath]`, and `hostEntry.ts` reads the first alone. This
    // is the supplying side of that, asserted as an exact list rather than by
    // `toContain` — a writer that emitted the two PDFium arguments in the other
    // order satisfies a containment check and starts a host that binds a pipe
    // name as a library.
    expect(hostCommandArguments({ kind: 'mupdf' }, 'C:\\k\\hostEntry.js', '\\\\.\\pipe\\p')).toStrictEqual([
      'C:\\k\\hostEntry.js',
      '\\\\.\\pipe\\p',
    ]);

    expect(
      hostCommandArguments(
        { kind: 'pdfium', libraryPath: 'C:\\t\\pdfium.dll' },
        'C:\\k\\pdfiumHostEntry.js',
        '\\\\.\\pipe\\q',
      ),
    ).toStrictEqual(['C:\\k\\pdfiumHostEntry.js', '\\\\.\\pipe\\q', 'C:\\t\\pdfium.dll']);
  });

  it('gives MuPDF’s host no third argument at all', () => {
    // THE CONTROL for the case above, and it is not the same assertion twice: a
    // builder that appended a library path unconditionally would satisfy every
    // PDFium expectation there, and `hostEntry.ts` ignores what it does not
    // read — so MuPDF's host would start, work, and carry a filesystem path in
    // its command line for anything on the machine to read out of the process
    // list.
    expect(hostCommandArguments({ kind: 'mupdf' }, 'entry', 'pipe')).toHaveLength(2);
  });
});
