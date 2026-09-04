import type { Command, CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import { declaredCommands } from './commandDeclarations.js';
import type { CommandExecution, RegisteredWriter } from './commandRouting.js';
import type { Apply, ByteImage, Capture, EngineWriter, Invert } from './engineSeam.js';
import {
  applyWatermarkPages,
  captureWatermarkPages,
  invertWatermarkPages,
} from './pageWatermark.js';

/**
 * `@cantoo/pdf-lib` as a writer of record — **the first byte-image adapter**
 * ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 *
 * ## Why this is a module `main` may import, and `localEngine.ts` is not
 *
 * `localEngine.ts` assembles the MuPDF writer and lives behind
 * `@monstera/kernel/engine`, because importing it binds a native library and
 * invariant 20 says no native engine code runs in `main` (ADR-0026, measured at
 * +40.1 MB). This adapter is the mirror image: pdf-lib is pure JavaScript, so
 * there is nothing for invariant 20 to prohibit, and `main` is exactly where it
 * runs — a byte-image writer's session is the document's bytes, and `main` is
 * where those are.
 *
 * So this file is reachable from `@monstera/kernel`'s barrel, and every import
 * in it is one that barrel can already afford. **A MuPDF import added here
 * would put the native library back in `main` in one line**, which is the one
 * property a reader of this file should check before adding anything to it.
 *
 * ## The spec entries are declared here and the table is assembled elsewhere
 *
 * `commandSpecs.ts` spreads {@link pdfLibSpecs} into its own `declared` object,
 * which is what makes that table exhaustive over every `CommandKind`. So a
 * pdf-lib command is declared exactly once — here — and the mapped type over
 * the kind union still refuses a command that routes nowhere. The rule
 * `commandSpecs.ts` states about itself holds: a second table would be a second
 * declaration, and a second *view* of one table is not.
 *
 * The direction is one-way by construction. This module names no MuPDF spec and
 * `commandSpecs.ts` names these, so `import-x/no-cycle` has nothing to find.
 */

/**
 * A byte-image writer's session lifecycle, where the session **is** the image.
 *
 * All three members are the identity, and that is what `engineSeam.ts` says a
 * byte-image writer's lifecycle is: *"For a byte-image writer `TSession` is the
 * byte image and both are identity — the shape difference shows up in `Apply`,
 * not here."* This is the first adapter to make that concrete.
 *
 * `close` releases nothing because nothing was acquired. It is not a stub: a
 * `PDFDocument` is parsed inside a single `apply` and unreachable when it
 * returns, so there is no native handle, no file and no process whose lifetime
 * outlives the call. Writing a no-op here is stating that, where omitting the
 * member would have made this writer unregistrable for a reason that is not
 * true of it.
 */
export const pdfLibWriter: EngineWriter<ByteImage> = {
  open: (image) => Promise.resolve(image),
  serialise: (session) => Promise.resolve(session),
  close: () => Promise.resolve(),
};

/**
 * The pdf-lib half of the routing table.
 *
 * Deliberately **unannotated**: a `CommandSpec<'watermarkPages'>` annotation
 * would widen `writer` to the whole union and lose the binding of `apply` to
 * this writer's session type, which is the property ADR-0009 §6 spends
 * `WriterBinding` on. It is checked where it is used — `commandSpecs.ts`
 * spreads it into an object carrying `satisfies CommandSpecs`, so a wrong
 * `apply` shape here is a compile error there.
 */
export const pdfLibSpecs = {
  watermarkPages: {
    // SPREAD, never restated — `commandDeclarations.ts` is where a command is
    // declared and this layer adds the doing of it (ADR-0026).
    ...declaredCommands.watermarkPages,
    apply: applyWatermarkPages,
    capture: captureWatermarkPages,
    // UNREACHABLE BY THE TYPE and required by the table's shape, exactly as
    // `invertDeletePages` is: `CommandPrior['watermarkPages']` is `never`, so
    // nothing can build an argument for it.
    invert: invertWatermarkPages,
  },
};

/** The kinds this writer routes, as a runtime set for {@link specFor}. */
type PdfLibKind = keyof typeof pdfLibSpecs;

/**
 * One pdf-lib spec, narrowed to the command it was declared for.
 *
 * `localMupdfExecution` carries the same helper and the same one-line
 * explanation, and the limit is TypeScript's rather than either file's:
 * `pdfLibSpecs[command.kind].apply(image, command)` resolves the indexed access
 * over the whole union, so the parameter type becomes the **intersection** of
 * every member's — `never` the moment there are two commands. The lookup is
 * correct and the checker cannot see that the index and the argument came from
 * the same value.
 *
 * Asserted once, here, rather than at each of the three call sites, and sound
 * by construction: `spec` is looked up by `command.kind` and `command` is that
 * same value.
 *
 * **It also refuses**, which `localMupdfExecution`'s equivalent does not need
 * to. That one is reached only through the MuPDF writer, whose registration the
 * bus looks up from the command's own declared writer. This one is reached the
 * same way — but the table it indexes holds one of nine kinds rather than eight
 * of nine, so a routing mistake lands on `undefined` here instead of on a
 * spec, and `undefined.apply` is a `TypeError` naming neither the command nor
 * the writer. The throw names both.
 */
function specFor(command: Command): (typeof pdfLibSpecs)[PdfLibKind] {
  const spec = (pdfLibSpecs as Partial<Record<CommandKind, (typeof pdfLibSpecs)[PdfLibKind]>>)[
    command.kind
  ];
  if (spec === undefined) {
    throw new Error(
      `${command.kind} is not routed to pdf-lib, so this writer has no spec for it. A command ` +
        `reaches a writer through its declaration's \`writer\` field, so this means that field ` +
        `and this table disagree.`,
    );
  }
  return spec;
}

/**
 * Executing pdf-lib commands **in this process**, which for this writer is the
 * only process there is.
 *
 * The MuPDF equivalent is named `local` to distinguish it from the remote one
 * that sends a command to the host holding the session. There is no remote
 * counterpart here and there is not going to be one: a byte-image writer's
 * session is the bytes, so "executing where the session is" means executing
 * where the bytes are, which is `main`.
 *
 * Every member is a lookup and a call. There is no switch — §6's routing does
 * the dispatch, and a switch would be a second routing place.
 */
export const localPdfLibExecution: CommandExecution<'pdf-lib'> = {
  // METHOD SYNTAX, so `K` is in scope for the assertion — an arrow would put
  // the cast at `CommandKind`, the whole union, which widens `capture`'s prior
  // state to a union too and stops it being assignable to `CommandPrior[K]`.
  apply<K extends CommandKind>(image: ByteImage, command: CommandOfKind<K>): Promise<ByteImage> {
    return (specFor(command).apply as Apply<'pdf-lib', K>)(image, command);
  },
  capture<K extends CommandKind>(
    image: ByteImage,
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>> {
    return (specFor(command).capture as Capture<'pdf-lib', K>)(image, command);
  },
  invert<K extends CommandKind>(
    image: ByteImage,
    kind: K,
    inverse: CommandPrior[K],
  ): Promise<ByteImage> {
    // The same narrowing for the mirror-image reason `localMupdfExecution`
    // gives: indexing over a generic `kind` yields the union of specs, whose
    // `invert` parameter is the intersection of every prior-state type.
    return (specFor({ kind } as Command).invert as Invert<'pdf-lib', K>)(image, inverse);
  },
};

/**
 * The pdf-lib writer as the bus registers it.
 *
 * `localEngine.ts`'s shape, and the two halves are intersected for the same
 * reason: a registration missing either is a writer the bus cannot use. The
 * difference is where it may be imported from, which is the whole of this
 * file's header.
 */
export const localPdfLibWriter: RegisteredWriter<'pdf-lib'> = {
  ...pdfLibWriter,
  ...localPdfLibExecution,
};
