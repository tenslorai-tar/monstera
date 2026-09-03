export { mupdfWriter, withDocument } from './mupdfWriter.js';
export {
  applyRotatePages,
  captureRotatePages,
  invertRotatePages,
  snapRotation,
} from './rotatePages.js';
export { commandSpecs, declaredSpecs, localMupdfExecution } from './commandSpecs.js';
export { readPageGeometry } from './pageGeometry.js';
export { readPageText, type PageTextResult } from './pageText.js';
export { readPageLinks, type PageLink, type LinkBounds } from './pageLinks.js';
export { readDestinations, type Destination } from './destinations.js';
export {
  applySetLayerVisibility,
  captureSetLayerVisibility,
  invertSetLayerVisibility,
  readLayers,
  type Layer,
} from './layers.js';
export {
  applyMovePage,
  captureMovePage,
  invertMovePage,
  movePermutation,
  remapPageIndex,
  type PriorPageOrder,
} from './pageOrder.js';
export { localMupdfWriter } from './localEngine.js';

/**
 * `@monstera/kernel/engine` — everything whose import binds a native library
 * ([ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)).
 *
 * ## What this entry point is for
 *
 * `packages/kernel`'s main surface may not export a value whose module graph
 * binds native code, so that importing `@monstera/kernel` cannot load MuPDF.
 * That is invariant 20 expressed as a property of the module graph rather than
 * as a rule about where people put `import` statements — measured 2026-08-27,
 * the barrel cost **+41.7 MB** over a bare Node process against **+46.0 MB**
 * for the adapter itself, which is the barrel loading it.
 *
 * Everything here is still perfectly legitimate to import. The difference is
 * that importing it is now a **decision with a name on it**: the engine host's
 * entry says `/engine`, and there is no longer a route by which a module that
 * wanted routing metadata ends up with a native library.
 *
 * ## Why a subpath and not a rule
 *
 * The rule already existed and had failed. The same exposure reached `main`'s
 * measured baseline through `import { type X } from './documentCommands.js'`,
 * whose emitted form under `verbatimModuleSyntax` is `import {}` — a
 * side-effect import — **in a file whose own header documents that trap, one
 * commit after it was written**. A rule an author must recall while composing
 * an import is not a mechanism.
 *
 * ## Who may import this
 *
 * The process that runs the engine. Today that is the engine host
 * (`host/hostEntry.ts`, which reaches its modules by relative path from inside
 * this package) and the tests that still exercise a local engine in `main` —
 * the pre-host arrangement. **Those tests naming `/engine` is the point rather
 * than a workaround:** invariant 20 says `main` must not parse, so `main`'s own
 * tests reaching for the adapter is exactly the thing that should have to say
 * so out loud.
 *
 * ## What this file may NOT become
 *
 * A second barrel. It re-exports and declares nothing, so there is no
 * temptation to put a helper here "since it is engine-related" — the moment it
 * holds a definition, it is a module with two jobs and the next reader has to
 * work out which imports are safe.
 */
