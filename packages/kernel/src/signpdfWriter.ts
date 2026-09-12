import type { Command, CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import { declaredCommands } from './commandDeclarations.js';
import type { CommandExecution, RegisteredWriter } from './commandRouting.js';
import type { Apply, ByteImage, Capture, EngineWriter, Invert } from './engineSeam.js';
import {
  applySignDocument,
  captureSignDocument,
  invertSignDocument,
} from './documentSign.js';

/**
 * `@signpdf` as a writer of record — the seam's third byte-image adapter.
 *
 * ## It was DECLARED before it existed, and this is the thing arriving
 *
 * `writerShapes` has carried `signpdf: 'byte-image'` since Stage 0, with
 * nothing behind it, because §3's matrix has named the writer since the
 * founding record. Nothing was wrong with that — a declaration ahead of its
 * first consumer is how this project keeps the seam honest — and it does mean
 * the shape was never exercised until now.
 *
 * ## `pdfLibWriter.ts`'s shape, deliberately
 *
 * A byte-image writer's `open` and `serialise` are the identity: its session IS
 * the document's bytes (ADR-0039), so there is nothing to parse and nothing to
 * release. Writing that a second way would be a second opinion about what a
 * byte-image session is; this file is the first one with the comment removed
 * rather than a variation on it.
 */
export const signpdfWriter: EngineWriter<ByteImage> = {
  open: (image) => Promise.resolve(image),
  serialise: (session) => Promise.resolve(session),
  close: () => Promise.resolve(),
};

/**
 * The signpdf half of the routing table.
 *
 * Unannotated for `pdfLibSpecs`' reason: an annotation would widen `writer` to
 * the whole union and lose the binding of `apply` to this writer's session
 * type. It is checked where it is used.
 */
export const signpdfSpecs = {
  signDocument: {
    ...declaredCommands.signDocument,
    apply: applySignDocument,
    capture: captureSignDocument,
    // UNREACHABLE BY THE TYPE and required by the table's shape:
    // `CommandPrior['signDocument']` is `never`, so nothing can build an
    // argument for it.
    invert: invertSignDocument,
  },
};

/** The one kind routed here. */
type SignpdfKind = keyof typeof signpdfSpecs;

/** Whether a kind is this writer's. */
function routedHere(kind: CommandKind): kind is SignpdfKind {
  return kind in signpdfSpecs;
}

/** The spec for a command routed here, or a named refusal. */
function specFor(command: Command): (typeof signpdfSpecs)[SignpdfKind] {
  if (!routedHere(command.kind)) {
    // A ROUTING DEFECT, not a document problem. The bus dispatches on
    // `declaredCommands[kind].writer`, so reaching here means the table and
    // this file disagree — which is the state `commandSpecs.ts`' `satisfies`
    // makes a compile error, and this is what says so if one ever slipped past.
    throw new Error(`"${command.kind}" is not routed to the signpdf writer.`);
  }
  return signpdfSpecs[command.kind];
}

/**
 * The signpdf writer's execution half.
 *
 * `localPdfLibExecution`'s shape with the pre-read parameter dropped: no
 * command routed here declares `reads`, so forwarding a slot nothing fills
 * would be a parameter with no caller.
 */
export const localSignpdfExecution: CommandExecution<'signpdf'> = {
  apply<K extends CommandKind>(image: ByteImage, command: CommandOfKind<K>): Promise<ByteImage> {
    return (specFor(command).apply as Apply<'signpdf', K>)(image, command);
  },
  capture<K extends CommandKind>(
    image: ByteImage,
    command: CommandOfKind<K>,
  ): Promise<CaptureResult<CommandPrior[K]>> {
    return (specFor(command).capture as Capture<'signpdf', K>)(image, command);
  },
  invert<K extends CommandKind>(
    image: ByteImage,
    kind: K,
    inverse: CommandPrior[K],
  ): Promise<ByteImage> {
    return (specFor({ kind } as Command).invert as Invert<'signpdf', K>)(image, inverse);
  },
};

/** The signpdf writer as the bus registers it. */
export const localSignpdfWriter: RegisteredWriter<'signpdf'> = {
  ...signpdfWriter,
  ...localSignpdfExecution,
};
