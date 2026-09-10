import type { Command, CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import { declaredCommands } from './commandDeclarations.js';
import type { CommandExecution } from './commandRouting.js';
import type { ByteImage, Capture, Invert } from './engineSeam.js';
import {
  applyDeletePageObjects,
  applyPlacePageObject,
  applyRecolorPageObjects,
  captureDeletePageObjects,
  capturePlacePageObject,
  captureRecolorPageObjects,
  invertDeletePageObjects,
  invertPlacePageObject,
  invertRecolorPageObjects,
} from './pdfiumObjectEdit.js';
import {
  applyPromoteFormObjects,
  capturePromoteFormObjects,
  invertPromoteFormObjects,
} from './pdfiumPromote.js';
import {
  applyReplaceAllText,
  captureReplaceAllText,
  invertReplaceAllText,
} from './pdfiumReplaceAll.js';
import {
  applyReplaceTextObject,
  captureReplaceTextObject,
  invertReplaceTextObject,
} from './pdfiumTextEdit.js';

/**
 * The PDFium half of the routing table, and how a PDFium command is run.
 *
 * ## `pdfLibWriter.ts`'s shape, and the reason it is a separate file is stronger here
 *
 * That file exists so a byte-image writer's specs can be reached **without**
 * binding a native library, because it runs in `main`. This one exists for the
 * opposite half of the same rule: PDFium binds `pdfium.dll`, so these specs
 * must be reachable without loading **MuPDF**.
 *
 * `commandSpecs.ts` reaches `rotatePages.ts` → `mupdfWriter.ts` → the MuPDF
 * engine. A PDFium host that imported it to find its own `apply` would load the
 * other engine into the contained process that exists to hold this one —
 * invariant 25's *a breach of one engine holds the other's documents*, arriving
 * as a module graph rather than as a DACL. So the edge runs one way:
 * `commandSpecs.ts` spreads {@link pdfiumSpecs}, this module names no MuPDF
 * spec, and `import-x/no-cycle` has nothing to find.
 *
 * ## And `main` must never reach this file
 *
 * [ADR-0026](../../../docs/DECISIONS/0026-a-declaration-is-not-an-implementation.md)
 * clause 2 and `proof:kernelload`: nothing here is exported from the kernel's
 * barrel. `pdfLibWriter.ts` is imported by `composition.ts` and this is not,
 * and the difference is exactly one edge — `pdfiumTextEdit.js` →
 * `pdfiumFfi.js` → koffi.
 */

/**
 * The routing table's PDFium entries.
 *
 * Deliberately **unannotated**, for `pdfLibSpecs`' reason: a
 * `CommandSpec<'replaceTextObject'>` annotation would widen `writer` to the
 * whole union and lose the binding of `apply` to this writer's session type,
 * which is the property ADR-0009 §6 spends `WriterBinding` on. It is checked
 * where it is used — `commandSpecs.ts` spreads it into an object carrying
 * `satisfies CommandSpecs`, so a wrong `apply` shape here is a compile error
 * there.
 */
export const pdfiumSpecs = {
  replaceTextObject: {
    // SPREAD, never restated — `commandDeclarations.ts` is where a command is
    // declared and this layer adds the doing of it (ADR-0026).
    ...declaredCommands.replaceTextObject,
    apply: applyReplaceTextObject,
    capture: captureReplaceTextObject,
    // THE FIRST REACHABLE `invert` ON A BYTE-IMAGE WRITER. Every pdf-lib entry
    // carries one that no argument can be built for, `CommandPrior` being
    // `never` for each. This one is called: the entry is invertible, so undo
    // takes the inverse branch and never a checkpoint.
    invert: invertReplaceTextObject,
  },
  placePageObject: {
    ...declaredCommands.placePageObject,
    apply: applyPlacePageObject,
    capture: capturePlacePageObject,
    invert: invertPlacePageObject,
  },
  recolorPageObjects: {
    ...declaredCommands.recolorPageObjects,
    apply: applyRecolorPageObjects,
    capture: captureRecolorPageObjects,
    invert: invertRecolorPageObjects,
  },
  deletePageObjects: {
    ...declaredCommands.deletePageObjects,
    apply: applyDeletePageObjects,
    // BOTH SLOTS ARE FILLED, and neither can run. `CommandSpec` requires them
    // for every kind — leaving them out is a compile error, which is how the
    // table stays exhaustive — and `CommandPrior.deletePageObjects` is `never`,
    // so nothing can construct an argument for the invert. The capture says
    // WHY, in a sentence the bus turns into a checkpoint.
    //
    // `flattenFormFields`' shape, and this is the first PDFium command to take
    // it: the four pdf-lib entries carry the same pair for a different reason,
    // theirs being that the prior is document-scaled and this one's that the
    // prior does not exist.
    capture: captureDeletePageObjects,
    invert: invertDeletePageObjects,
  },
  replaceAllText: {
    ...declaredCommands.replaceAllText,
    apply: applyReplaceAllText,
    // TERMINAL FOR A THIRD REASON, and the capture's message is where it is
    // stated: `deletePageObjects` has no prior, `flattenFormFields`' prior is
    // unserialisable, and this one's exists and scales with the document.
    capture: captureReplaceAllText,
    invert: invertReplaceAllText,
  },
  promoteFormObjects: {
    ...declaredCommands.promoteFormObjects,
    apply: applyPromoteFormObjects,
    // TERMINAL FOR A FOURTH REASON, and it is the first one's shape reached
    // from the other end: `deletePageObjects` cannot be undone because PDFium
    // can describe an object and not rebuild one, and this cannot because
    // PDFium can take a Form XObject apart and not construct one. The pieces
    // are all still on the page; the container is what has no constructor.
    capture: capturePromoteFormObjects,
    invert: invertPromoteFormObjects,
  },
};

/** The kinds this writer routes, as a runtime set for {@link specFor}. */
type PdfiumKind = keyof typeof pdfiumSpecs;

/**
 * One PDFium `apply` **as this writer calls it**.
 *
 * Two parameters and no more, which is the seam's own shape rather than a
 * simplification: `Apply` resolves byte-image × `sources: 'one'` to `never`, so
 * no PDFium command can be handed a source; and no PDFium command declares
 * `reads`, so there is no outline slot either. `pdfLibWriter.ts` carries a
 * third parameter because `generateToc` routes there — the difference between
 * the two files is a fact about their tables, not about their writers.
 */
type PdfiumApply<K extends CommandKind> = (
  image: ByteImage,
  command: CommandOfKind<K>,
) => Promise<ByteImage>;

/**
 * One PDFium spec, narrowed to the command it was declared for.
 *
 * The correlated-union limit both sibling files carry, and it **refuses** for
 * `pdfLibWriter.ts`'s reason: this table holds one of thirty kinds, so a
 * routing mistake lands on `undefined` here rather than on a spec, and
 * `undefined.apply` is a `TypeError` naming neither the command nor the writer.
 */
function specFor(command: Command): (typeof pdfiumSpecs)[PdfiumKind] {
  const spec = (pdfiumSpecs as Partial<Record<CommandKind, (typeof pdfiumSpecs)[PdfiumKind]>>)[
    command.kind
  ];
  if (spec === undefined) {
    throw new Error(
      `${command.kind} is not routed to PDFium, so this writer has no spec for it. A command ` +
        `reaches a writer through its declaration's \`writer\` field, so this means that field ` +
        `and this table disagree.`,
    );
  }
  return spec;
}

/**
 * Executing PDFium commands **in this process**, which is the contained PDFium
 * host and never `main`.
 *
 * Named `local` for `localMupdfExecution`'s reason — there is a remote
 * counterpart, `remotePdfiumExecution`, which sends the command to the host
 * that holds the granted area. The two are one implementation per command
 * executed where the bytes are, rather than two opinions about what a command
 * means (B3a).
 *
 * **The asymmetry with `localPdfLibExecution` is worth naming**, because both
 * are byte-image executions and only one of them has a remote half. A pdf-lib
 * session is bytes and pdf-lib is JavaScript, so *where the bytes are* is
 * `main`. A PDFium session is bytes and PDFium is native, so *where the bytes
 * are* has to be somewhere invariant 20 allows a native library — which is the
 * host. Byte-image says nothing about placement; ADR-0047 says so in as many
 * words.
 */
export const localPdfiumExecution: CommandExecution<'pdfium'> = {
  // METHOD SYNTAX, so `K` is in scope for the assertion — an arrow would put
  // the cast at `CommandKind`, the whole union, which widens `capture`'s prior
  // state to a union too and stops it being assignable to `CommandPrior[K]`.
  apply<K extends CommandKind>(
    image: ByteImage,
    command: CommandOfKind<K>,
    // `never`, WHICH IS THE DECLARATION AND NOT A PLACEHOLDER, exactly as
    // `localPdfLibExecution`'s is: `Apply` resolves byte-image × `sources:
    // 'one'` to `never`, so the bus has nothing to pass here. The slot exists
    // because the bus passes positionally.
    _source?: never,
  ): Promise<ByteImage> {
    return (specFor(command).apply as PdfiumApply<K>)(image, command);
  },
  capture<K extends CommandKind>(
    image: ByteImage,
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>> {
    return (specFor(command).capture as Capture<'pdfium', K>)(image, command);
  },
  invert<K extends CommandKind>(
    image: ByteImage,
    kind: K,
    inverse: CommandPrior[K],
  ): Promise<ByteImage> {
    // The mirror-image narrowing both siblings carry: indexing over a generic
    // `kind` yields the union of specs, whose `invert` parameter is the
    // intersection of every prior-state type.
    return (specFor({ kind } as Command).invert as Invert<'pdfium', K>)(image, inverse);
  },
};
