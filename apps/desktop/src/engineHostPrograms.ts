/**
 * Which program an engine host runs, and which principal it runs as.
 *
 * ## Why this is its own module, and it is not tidiness
 *
 * `engineHostPlatform.ts` binds Win32 through `koffi` at module scope, so
 * nothing in it can be reached from a `vitest` case on any platform. Everything
 * here is a string and a list of strings, and every one of them is a decision:
 * the entry file that becomes an argument to `CreateProcessW`, the extra
 * argument PDFium's host cannot start without, and — the one that matters most —
 * **the AppContainer profile moniker each host runs under**.
 *
 * ## THE MONIKERS DIFFER, AND THAT IS THE WHOLE OF THE SEPARATION
 *
 * [ADR-0048](../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)'s
 * correction of 2026-09-09: `hostSessionDirectoryDacl` grants a SID **derived
 * from the profile moniker**, so two hosts started from one moniker are one
 * principal — and each would hold read on every granted directory the other was
 * handed. That is invariant 25(d) failing between two of our own processes, and
 * nothing about it would show up as an error.
 *
 * The general form the ADR states: *the separation is in the principal, never in
 * the process count.* A second host is not contained from the first by being a
 * second process; it is contained by being a second SID. So the two names below
 * are the mechanism, and the case that asserts they differ is the only thing
 * standing between this file and a silent merge — a copy-paste that gave PDFium
 * `monstera-engine-host` would start, serve, and pass every other check.
 *
 * ## The library path is in the TYPE, not in a check
 *
 * A PDFium host started with no `pdfium.dll` path dies in `argumentsFrom`
 * (`pdfiumHostEntry.ts`) with a diagnostic nobody reads, because a host that
 * cannot start has no pipe to report on. {@link EngineHostProgram} is a
 * discriminated union carrying the path on the one member that needs it, so the
 * illegal state is unrepresentable rather than refused (B5).
 */

/** The engines a contained host is built around. */
export type EngineHostKind = 'mupdf' | 'pdfium';

/**
 * One host's program: which engine, and what that engine needs to start.
 *
 * The union rather than an optional field, for this file's header: `pdfium`
 * without a library path is a state the type refuses to express.
 */
export type EngineHostProgram =
  | { readonly kind: 'mupdf' }
  | {
      readonly kind: 'pdfium';
      /**
       * The absolute path to `pdfium.dll`.
       *
       * Resolved by whoever knows where a provisioned binary is and passed down
       * — never searched for here. `packages/kernel/src/pdfiumFfi.ts` states the
       * rule this obeys: `scripts/provision/pdfium.mjs` owns that answer and a
       * second resolver is the B3a defect this project has paid for three times.
       */
      readonly libraryPath: string;
    };

/**
 * The AppContainer profile each engine's host runs under.
 *
 * A `Record` over the kind, so an engine added to {@link EngineHostKind} is a
 * compile error here rather than a host that silently inherits a neighbour's
 * principal. See this file's header for why that inheritance is the failure
 * worth making unrepresentable.
 */
export const ENGINE_HOST_CONTAINER: Record<EngineHostKind, string> = {
  mupdf: 'monstera-engine-host',
  // NOT A SUFFIX OF THE ABOVE, and not derived from it. `DeriveAppContainerSid`
  // hashes the moniker, so any two distinct strings give two distinct SIDs and
  // the value here only has to be different — but a name built as
  // `${MUPDF}-pdfium` would put the two one edit away from collapsing, which is
  // exactly the edit nothing downstream can see.
  pdfium: 'monstera-pdfium-host',
};

/**
 * The entry script each engine's host executes, as a file name inside the
 * kernel's built `host/` directory.
 *
 * A name rather than a path, because the directory is resolved through the
 * package (`hostEntryPath`) and this file may not know a build layout.
 */
export const ENGINE_HOST_ENTRY_FILE: Record<EngineHostKind, string> = {
  mupdf: 'hostEntry.js',
  pdfium: 'pdfiumHostEntry.js',
};

/**
 * The command line one host is created with, after the executable.
 *
 * ## The order is the host's own, read from its entry rather than agreed
 *
 * Both entries read `process.argv.slice(2)`, which in Node mode is everything
 * after the script — so the pipe name is first for both and the library path is
 * PDFium's second. `pdfiumHostEntry.ts`'s `argumentsFrom` refuses either being
 * absent; this is the side that supplies them, and the two are written against
 * each other rather than against a convention.
 */
export function hostCommandArguments(
  program: EngineHostProgram,
  entryPath: string,
  pipeName: string,
): readonly string[] {
  if (program.kind === 'pdfium') return [entryPath, pipeName, program.libraryPath];
  return [entryPath, pipeName];
}
