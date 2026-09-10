export {
  openPdfium,
  pdfiumIsOpen,
  pdfiumWriter,
  pageCount,
  countObjects,
  pageText,
  pageObjects,
  placeObject,
  renderPageBitmap,
  objectMatrix,
  removeObjects,
  replaceTextObjects,
  setObjectFills,
  setObjectMatrix,
  textObjectIndices,
  textObjectText,
  textRuns,
  type ObjectFill,
  type ObjectMatrix,
  type ObjectPlacement,
  type PageBitmap,
  type PageObject,
  type PageObjectKind,
  type TextReplacement,
  type TextRun,
} from './pdfiumFfi.js';
export {
  applyReplaceTextObject,
  captureReplaceTextObject,
  invertReplaceTextObject,
  type PriorTextObjects,
} from './pdfiumTextEdit.js';
export {
  applyDeletePageObjects,
  applyPlacePageObject,
  applyRecolorPageObjects,
  captureDeletePageObjects,
  capturePlacePageObject,
  captureRecolorPageObjects,
  invertDeletePageObjects,
  invertPlacePageObject,
  invertRecolorPageObjects,
  type PriorFills,
  type PriorPlacement,
} from './pdfiumObjectEdit.js';
export {
  applyReplaceAllText,
  captureReplaceAllText,
  invertReplaceAllText,
} from './pdfiumReplaceAll.js';
export { localPdfiumExecution, pdfiumSpecs } from './pdfiumSpecs.js';

/**
 * `@monstera/kernel/pdfium` — everything whose import binds **PDFium**.
 *
 * ## A third entry point, and the reason is the same one the second host has
 *
 * `@monstera/kernel/engine` is *everything whose import binds a native library*
 * ([ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)),
 * and that description was written when there was one. Putting PDFium behind it
 * would make *bind a native library* mean **bind both**, so a process that
 * needs one engine would load the other — which is the module-graph form of the
 * thing [ADR-0048](../../../docs/DECISIONS/0048-what-a-second-engine-host-owes-and-what-it-holds.md)'s
 * correction of 2026-09-09 refuses at the AppContainer: *the separation is in
 * the principal, never in the process count*. Here it is in the specifier,
 * never in the fact that both are "native".
 *
 * So the rule generalises rather than widening: **one entry point per engine**,
 * and importing either is a decision with that engine's name on it.
 *
 * ## What this does NOT yet buy, stated so it is not read as more than it is
 *
 * `commandSpecs.ts` is exhaustive over `CommandKind` by construction — that is
 * §6's mechanism — so it names every writer's `apply`, and its graph therefore
 * reaches this module. The MuPDF host imports `localMupdfExecution` from that
 * table, so **the MuPDF host's module graph currently loads `pdfiumFfi.ts` and
 * therefore koffi.** No `pdfium.dll` is loaded — `openPdfium` is an explicit
 * call and nothing in that host makes it — but the graph crosses, and this
 * entry point does not on its own uncross it.
 *
 * What uncrosses it is moving MuPDF's spec entries into their own module beside
 * `pdfLibSpecs` and `pdfiumSpecs`, leaving `commandSpecs.ts` as the assembly
 * point nothing imports at run time. It is named here rather than left for
 * someone to discover, because a subpath that looks like separation while the
 * graph still crosses is exactly the shape that reads as covered.
 *
 * **This paragraph said *that is the next unit* and it was not**, which is
 * recorded rather than quietly edited because a claim about what happens next
 * is one a reader takes as a plan. The PDFium host went first, on the reading
 * that the crossing is a cleanliness debt and not a containment one: koffi is in
 * `node_modules` and the MuPDF host is Node, so binding it grants that process
 * nothing it did not already have, and no `pdfium.dll` is loaded because
 * `openPdfium` is an explicit call that host never makes. **The trigger is
 * therefore a measurement rather than a mood** — the first time the MuPDF
 * host's startup or resident size is held to a budget, this edge is in it, and
 * `proof:kernelload`'s PDFium cases are what would show the graph if it ever
 * reached `main`.
 *
 * ## Who may import this
 *
 * The PDFium host, and the proofs that drive PDFium against the real library.
 * Not `main`: `proof:kernelload` asserts the barrel reaches neither engine
 * adapter.
 *
 * ## What this file may NOT become
 *
 * A second barrel — `engine.ts`'s rule, and it applies here for its reason. It
 * re-exports and declares nothing, so there is no temptation to put a helper
 * here "since it is PDFium-related"; the moment it holds a definition it is a
 * module with two jobs.
 */
