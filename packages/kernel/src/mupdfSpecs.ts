import type { Command, CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import { declaredCommands } from './commandDeclarations.js';
import type { ApplyRequest, CommandExecution, KindsRoutedTo } from './commandRouting.js';
import type { Capture, Invert, MupdfSession } from './engineSeam.js';
import {
  applyImportPageAsLayer,
  applySetLayerVisibility,
  captureImportPageAsLayer,
  invertImportPageAsLayer,
  captureSetLayerVisibility,
  invertSetLayerVisibility,
} from './layers.js';
import {
  applyDeletePages,
  applyDuplicatePage,
  applyMovePage,
  captureDeletePages,
  captureDuplicatePage,
  captureMovePage,
  invertDeletePages,
  invertDuplicatePage,
  invertMovePage,
  applySwapPages,
  captureSwapPages,
  invertSwapPages,
  applyInsertBlankPage,
  captureInsertBlankPage,
  invertInsertBlankPage,
} from './pageOrder.js';
import {
  applyAddAnnotation,
  applyPlaceAnnotation,
  applyPlaceImage,
  applyRemoveAnnotation,
  captureAddAnnotation,
  capturePlaceAnnotation,
  capturePlaceImage,
  captureRemoveAnnotation,
  captureStyleAnnotation,
  invertAddAnnotation,
  invertPlaceAnnotation,
  invertPlaceImage,
  invertRemoveAnnotation,
  invertStyleAnnotation,
  applyStyleAnnotation,
} from './pageAnnotations.js';
import {
  applyImportFormData,
  captureImportFormData,
  invertImportFormData,
} from './formData.js';
import {
  applyImportAnnotations,
  captureImportAnnotations,
  invertImportAnnotations,
} from './annotationInterchange.js';
import {
  applyDeleteFormFields,
  applyFillFormField,
  applyFlattenFormFields,
  captureDeleteFormFields,
  captureFillFormField,
  captureFlattenFormFields,
  invertDeleteFormFields,
  invertFillFormField,
  invertFlattenFormFields,
} from './formFields.js';
import {
  applySetDocumentProtection,
  captureSetDocumentProtection,
  invertSetDocumentProtection,
} from './documentProtection.js';
import {
  applyApplyRedactions,
  applyMarkMatchesForRedaction,
  captureApplyRedactions,
  captureMarkMatchesForRedaction,
  invertApplyRedactions,
  invertMarkMatchesForRedaction,
} from './pageRedact.js';
import {
  applySanitizeDocument,
  captureSanitizeDocument,
  invertSanitizeDocument,
} from './documentSanitize.js';
import { applyAddLink, captureAddLink, invertAddLink } from './pageLinks.js';
import { applyCropPages, captureCropPages, invertCropPages } from './pageCrop.js';
import {
  applyMergeDocument,
  applyReplacePage,
  captureMergeDocument,
  captureReplacePage,
  invertMergeDocument,
  invertReplacePage,
} from './pageMerge.js';
import { applyDeskewPages, captureDeskewPages, invertDeskewPages } from './pageDeskew.js';
import { applyEnhancePages, captureEnhancePages, invertEnhancePages } from './pageEnhance.js';
import { applyStraightenScans, captureStraightenScans, invertStraightenScans } from './pageScan.js';
import { applyResizePages, captureResizePages, invertResizePages } from './pageResize.js';
import {
  applySetPageTransition,
  captureSetPageTransition,
  invertSetPageTransition,
} from './pageTransition.js';
import { applyRotatePages, captureRotatePages, invertRotatePages } from './rotatePages.js';

/**
 * MuPDF's commands: what each one does, and executing them in this process.
 *
 * ## Its own module, for `pdfiumSpecs.ts`' reason
 *
 * `commandSpecs.ts` is the exhaustive view over `CommandKind` and spreads every writer's
 * table, so importing it loads every writer's library. The contained MuPDF host executes
 * MuPDF's commands and no other writer's, and it took `localMupdfExecution` from there
 * until 2026-09-19 — loading pdf-lib, the signing writer and PDFium's specs into a process
 * that never calls them. Measured the same day in a fresh Node process: `commandSpecs.js`
 * +72.6 MB of resident set against `mupdfWriter.js` +52.7 MB. With the contract's package
 * root (see `@monstera/contract/host`) that was the ~35 MB the host's fixed cost gained
 * between 2026-09-01 and 2026-09-18, which crossed §9.17's `base 128 MB` on CI at
 * `55216b4`.
 *
 * So the table lives here and `commandSpecs.ts` spreads it like the other three; the host
 * imports this file, and `proof:hostload` fails when the host's graph reaches another
 * writer's table.
 */
export const mupdfSpecs = {
  rotatePages: {
    // SPREAD, never restated. `commandDeclarations.ts` is where a command is
    // declared; this layer adds the doing of it. Retyping `kind`, `writer` or
    // either axis here would make this a second declaration, which is the one
    // thing the split must not become (ADR-0026, and B3's own rule about a
    // second table).
    ...declaredCommands.rotatePages,
    // Bound to `mupdf` by WriterBinding, so this must take a MupdfSession and
    // return void. Handing it a byte-image writer's apply does not compile.
    apply: applyRotatePages,
    // Run BEFORE apply, in one code path, never by a handler (ADR-0009,
    // 2026-08-19). It reports own-state or states why it could not, and the bus
    // answers the second with a checkpoint. Since ADR-0023 Decision 10 the bus
    // reaches it through the registered writer rather than through this table —
    // *when* it runs is still the bus's, which is the half §4 is about.
    capture: captureRotatePages,
    // Takes the prior state and nothing else — see `Invert`. An inverse that
    // could see the command could compute a reversing rotation, which is the
    // one implementation §3 forbids.
    invert: invertRotatePages,
  },
  setLayerVisibility: {
    ...declaredCommands.setLayerVisibility,
    apply: applySetLayerVisibility,
    capture: captureSetLayerVisibility,
    invert: invertSetLayerVisibility,
  },
  movePage: {
    ...declaredCommands.movePage,
    apply: applyMovePage,
    capture: captureMovePage,
    invert: invertMovePage,
  },
  deletePages: {
    ...declaredCommands.deletePages,
    apply: applyDeletePages,
    capture: captureDeletePages,
    // UNREACHABLE BY THE TYPE and required by this table's shape. See
    // `invertDeletePages` — `CommandPrior['deletePages']` is `never`, so
    // nothing can build an argument for it.
    invert: invertDeletePages,
  },
  duplicatePage: {
    ...declaredCommands.duplicatePage,
    apply: applyDuplicatePage,
    capture: captureDuplicatePage,
    invert: invertDuplicatePage,
  },
  swapPages: {
    ...declaredCommands.swapPages,
    apply: applySwapPages,
    capture: captureSwapPages,
    invert: invertSwapPages,
  },
  insertBlankPage: {
    ...declaredCommands.insertBlankPage,
    apply: applyInsertBlankPage,
    capture: captureInsertBlankPage,
    invert: invertInsertBlankPage,
  },
  cropPages: {
    ...declaredCommands.cropPages,
    apply: applyCropPages,
    capture: captureCropPages,
    invert: invertCropPages,
  },
  setPageTransition: {
    ...declaredCommands.setPageTransition,
    apply: applySetPageTransition,
    capture: captureSetPageTransition,
    invert: invertSetPageTransition,
  },
  resizePages: {
    ...declaredCommands.resizePages,
    apply: applyResizePages,
    capture: captureResizePages,
    invert: invertResizePages,
  },
  deskewPages: {
    ...declaredCommands.deskewPages,
    apply: applyDeskewPages,
    capture: captureDeskewPages,
    invert: invertDeskewPages,
  },
  // THE FIRST COMMAND THAT REWRITES AN IMAGE rather than a page attribute or a
  // content stream. Its writer is MuPDF for the same reason `deskewPages`' is: the
  // engine that can decode the image is the engine that is about to write it.
  enhancePages: {
    ...declaredCommands.enhancePages,
    apply: applyEnhancePages,
    capture: captureEnhancePages,
    invert: invertEnhancePages,
  },
  // THE SECOND COMMAND THAT REWRITES AN IMAGE, and it takes the first one's write:
  // `pageScan.ts` re-encodes through `pageEnhance.ts`' `writeGreyJpeg`.
  straightenScans: {
    ...declaredCommands.straightenScans,
    apply: applyStraightenScans,
    capture: captureStraightenScans,
    invert: invertStraightenScans,
  },
  // THE FIRST `sources: 'one'` ENTRY. The spread carries that axis in, and
  // `WriterBinding`'s cross product is what makes `apply` here obliged to be
  // the three-parameter shape — a two-parameter one would also satisfy it, by
  // the bivariance ADR-0040's correction records, which is why the guard is
  // `pageMerge.test.ts` rather than this line.
  mergeDocument: {
    ...declaredCommands.mergeDocument,
    apply: applyMergeDocument,
    capture: captureMergeDocument,
    invert: invertMergeDocument,
  },
  replacePage: {
    ...declaredCommands.replacePage,
    apply: applyReplacePage,
    capture: captureReplacePage,
    invert: invertReplacePage,
  },
  // IN `layers.ts`, not beside the merge it resembles: the command writes `/OCProperties`,
  // and that module is its one writer (ADR-0064).
  importPageAsLayer: {
    ...declaredCommands.importPageAsLayer,
    apply: applyImportPageAsLayer,
    capture: captureImportPageAsLayer,
    invert: invertImportPageAsLayer,
  },
  addAnnotation: {
    ...declaredCommands.addAnnotation,
    apply: applyAddAnnotation,
    capture: captureAddAnnotation,
    // UNREACHABLE BY THE TYPE and required by this table's shape, for
    // `invertDeletePages`' reason.
    invert: invertAddAnnotation,
  },
  removeAnnotation: {
    // THE SPREAD CARRIES `targets: 'annotation'` IN, and nothing here reads it.
    // That is the axis working: the declaration is what the bus branches on
    // before it reaches this table, so a spec that named existing state and a
    // spec that did not are the same shape at this point. `sources` needed a
    // type parameter because it changes what an apply is handed; this one does
    // not change the apply at all.
    ...declaredCommands.removeAnnotation,
    apply: applyRemoveAnnotation,
    capture: captureRemoveAnnotation,
    invert: invertRemoveAnnotation,
  },
  placeAnnotation: {
    ...declaredCommands.placeAnnotation,
    apply: applyPlaceAnnotation,
    capture: capturePlaceAnnotation,
    invert: invertPlaceAnnotation,
  },
  placeImage: {
    // THE SPREAD CARRIES `asset: 'bytes'` IN, and nothing here reads it — the
    // same shape `removeAnnotation`'s comment describes for `targets`. This
    // apply is handed the whole command, bytes included; what the axis governs
    // happens in the transport, two modules away, and a spec that carried an
    // asset and one that did not are the same shape at this point.
    ...declaredCommands.placeImage,
    apply: applyPlaceImage,
    capture: capturePlaceImage,
    invert: invertPlaceImage,
  },
  styleAnnotation: {
    ...declaredCommands.styleAnnotation,
    apply: applyStyleAnnotation,
    capture: captureStyleAnnotation,
    invert: invertStyleAnnotation,
  },
  addLink: {
    ...declaredCommands.addLink,
    apply: applyAddLink,
    capture: captureAddLink,
    invert: invertAddLink,
  },
  fillFormField: {
    // THE SPREAD CARRIES `targets: 'field'` IN, and nothing here reads it — the
    // same shape `removeAnnotation`'s comment describes for the axis's first
    // member. What differs is `invertible: true`, which this table does read:
    // `invert` is reachable here where every annotation neighbour's throws.
    ...declaredCommands.fillFormField,
    apply: applyFillFormField,
    capture: captureFillFormField,
    invert: invertFillFormField,
  },
  deleteFormFields: {
    ...declaredCommands.deleteFormFields,
    apply: applyDeleteFormFields,
    capture: captureDeleteFormFields,
    invert: invertDeleteFormFields,
  },
  flattenFormFields: {
    ...declaredCommands.flattenFormFields,
    apply: applyFlattenFormFields,
    capture: captureFlattenFormFields,
    invert: invertFlattenFormFields,
  },
  setDocumentProtection: {
    ...declaredCommands.setDocumentProtection,
    apply: applySetDocumentProtection,
    capture: captureSetDocumentProtection,
    invert: invertSetDocumentProtection,
  },
  applyRedactions: {
    ...declaredCommands.applyRedactions,
    apply: applyApplyRedactions,
    capture: captureApplyRedactions,
    invert: invertApplyRedactions,
  },
  markMatchesForRedaction: {
    ...declaredCommands.markMatchesForRedaction,
    apply: applyMarkMatchesForRedaction,
    capture: captureMarkMatchesForRedaction,
    invert: invertMarkMatchesForRedaction,
  },
  sanitizeDocument: {
    ...declaredCommands.sanitizeDocument,
    apply: applySanitizeDocument,
    capture: captureSanitizeDocument,
    invert: invertSanitizeDocument,
  },
  importFormData: {
    ...declaredCommands.importFormData,
    apply: applyImportFormData,
    capture: captureImportFormData,
    invert: invertImportFormData,
  },
  importAnnotations: {
    ...declaredCommands.importAnnotations,
    apply: applyImportAnnotations,
    capture: captureImportAnnotations,
    invert: invertImportAnnotations,
  },
};

/** A command kind this table executes. */
type MupdfKind = keyof typeof mupdfSpecs;

/**
 * One spec, narrowed to the command it was declared for.
 *
 * ## The correlated-union limit, and why the answer is not a switch
 *
 * `mupdfSpecs[command.kind].apply(session, command)` resolves the indexed access over the
 * whole union, so the parameter type becomes the INTERSECTION of every member's — and two
 * commands with different `kind` literals intersect to `never`. The lookup is correct and
 * the checker cannot see that the index and the argument came from the same value.
 *
 * A switch would be a second routing place, which is the thing the table exists to
 * prevent, so the correlation is asserted **once**, here. It is sound by construction:
 * `spec` is looked up by `command.kind` and `command` is that same value.
 *
 * **It refuses a kind this table does not hold**, `pdfiumSpecs.ts`' `specFor` exactly: a
 * command reaches a writer through its declaration's `writer` field, so a miss means that
 * field and this table disagree, and the message says so rather than failing on an
 * `undefined` apply.
 */
function specFor(command: Command): (typeof mupdfSpecs)[MupdfKind] {
  const spec = (mupdfSpecs as Partial<Record<CommandKind, (typeof mupdfSpecs)[MupdfKind]>>)[
    command.kind
  ];
  if (spec === undefined) {
    throw new Error(
      `${command.kind} is not routed to MuPDF, so this writer has no spec for it. A command ` +
        `reaches a writer through its declaration's \`writer\` field, so this means that field ` +
        `and this table disagree.`,
    );
  }
  return spec;
}

/**
 * One MuPDF `apply` **as this execution calls it**, rather than as its spec
 * declares it.
 *
 * `pdfLibWriter.ts`' `PdfLibApply` on the other writer, and the difference
 * between the two is the seam's own asymmetry rather than a divergence: a
 * byte-image `Apply` has **no** source parameter at all — `Apply` resolves
 * byte-image × `sources: 'one'` to `never` — so that one's third parameter is
 * its outline, and this one's is its source.
 *
 * Optional here because one spec in this table declares `sources: 'one'`. A
 * two-parameter implementation is assignable and ignores what it is passed, which
 * is the bivariance ADR-0040's correction records; the guard that `mergeDocument`
 * actually reads its source is `packages/kernel/src/pageMerge.test.ts`.
 */
type MupdfApply<K extends CommandKind> = (
  session: MupdfSession,
  command: CommandOfKind<K>,
  source?: MupdfSession,
) => Promise<void>;

/**
 * Executing MuPDF commands **in this process** — the contained MuPDF host, and main's
 * tests.
 *
 * Every member is a lookup in {@link mupdfSpecs} and a call. There is no second table
 * and no switch — §6's routing does the dispatch.
 */
export const localMupdfExecution: CommandExecution<'mupdf'> = {
  // METHOD SYNTAX, so `K` is in scope for the assertion. An arrow would put the
  // cast at `CommandKind` — the whole union — which widens `capture`'s prior
  // state to a union too and stops being assignable to `CommandPrior[K]`. The
  // narrowing has to name the instantiation it is claiming.
  apply<K extends KindsRoutedTo<'mupdf'>>({
    session,
    command,
    // DESTRUCTURED RATHER THAN NAMED WHOLE, and `reads` is deliberately absent
    // from this list: that is a fact about MuPDF rather than an omission.
    // `reads: 'outline'` is pdf-lib's, because ADR-0040's extension exists
    // precisely for a writer with no session to read an outline through, and a
    // MuPDF apply that wanted one already holds the session `readDestinations`
    // takes. Under ADR-0069 the request still CARRIES the field — what it
    // cannot do is arrive without one.
    source,
  }: ApplyRequest<'mupdf', K>): Promise<void> {
    // THE CAST NAMES THE `sources: 'one'` INSTANTIATION, which is the widest of
    // the two shapes this table holds, and the call passes `source` through
    // whatever the command declared. `pdfLibWriter.ts` explains why this is not
    // a guard: an apply that ignores the argument satisfies the signature, so
    // what makes a merge actually use its source is `pageMerge.test.ts`.
    //
    // THE CAST NAMES AN OPTIONAL THIRD PARAMETER, for `pdfLibWriter.ts`'
    // reason: narrowing `source` from `MupdfSession | undefined` needs either
    // `as MupdfSession` or `source!`, and lint bans both —
    // `non-nullable-type-assertion-style` refuses the first and
    // `no-non-null-assertion` the second. A runtime guard would be worse than
    // either, turning a state the declaration table makes unreachable into a
    // refusal.
    //
    // So this writer's view of an apply is *may be handed a source*, which is
    // true of every spec here, and the obligation stays where the knowledge is:
    // the bus reads `spec.sources` and refuses by name when the map does not
    // carry the id.
    return (specFor(command).apply as MupdfApply<K>)(session, command, source);
  },
  capture<K extends CommandKind>(
    session: MupdfSession,
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>> {
    return (specFor(command).capture as Capture<'mupdf', K>)(session, command);
  },
  // `invert` LOOKS like it needs no narrowing — the kind arrives separately, so
  // there is no `command.kind` for the checker to resolve independently. It
  // needs one anyway, and for the mirror-image reason: indexing over a generic
  // `kind` gives the union of specs, whose `invert` parameter is the
  // INTERSECTION of every prior-state type. Same limit, other direction.
  invert<K extends CommandKind>(
    session: MupdfSession,
    kind: K,
    inverse: CommandPrior[K],
  ): Promise<void> {
    return (specFor({ kind } as Command).invert as Invert<'mupdf', K>)(session, inverse);
  },
};
