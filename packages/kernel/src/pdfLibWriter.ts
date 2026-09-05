import type { Command, CommandKind, CommandOfKind } from '@monstera/contract';

import type { CaptureResult, CommandPrior } from './commandLog.js';
import { declaredCommands } from './commandDeclarations.js';
import type { CommandExecution, RegisteredWriter } from './commandRouting.js';
import type {
  ByteImage,
  Capture,
  EngineWriter,
  Invert,
  PreReadValue,
} from './engineSeam.js';
import {
  applySetPageBackground,
  captureSetPageBackground,
  invertSetPageBackground,
} from './pageBackground.js';
import {
  applyInsertImagePage,
  captureInsertImagePage,
  invertInsertImagePage,
} from './pageImage.js';
import { applyGenerateToc, captureGenerateToc, invertGenerateToc } from './pageToc.js';
import {
  applyBatesNumberPages,
  applyHeaderFooterPages,
  captureBatesNumberPages,
  captureHeaderFooterPages,
  invertBatesNumberPages,
  invertHeaderFooterPages,
} from './pageStamp.js';
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
  headerFooterPages: {
    ...declaredCommands.headerFooterPages,
    apply: applyHeaderFooterPages,
    capture: captureHeaderFooterPages,
    invert: invertHeaderFooterPages,
  },
  batesNumberPages: {
    ...declaredCommands.batesNumberPages,
    apply: applyBatesNumberPages,
    capture: captureBatesNumberPages,
    invert: invertBatesNumberPages,
  },
  setPageBackground: {
    ...declaredCommands.setPageBackground,
    apply: applySetPageBackground,
    capture: captureSetPageBackground,
    invert: invertSetPageBackground,
  },
  insertImagePage: {
    ...declaredCommands.insertImagePage,
    apply: applyInsertImagePage,
    capture: captureInsertImagePage,
    invert: invertInsertImagePage,
  },
  generateToc: {
    ...declaredCommands.generateToc,
    // THE FIRST THREE-PARAMETER APPLY IN THE TREE. The spread carries
    // `reads: 'outline'`, and `WriterBinding` resolves this entry's `apply` to
    // the signature that takes an outline — so a two-parameter body here would
    // still compile (ADR-0040's correction records the bivariance) and one
    // taking a source would not.
    apply: applyGenerateToc,
    capture: captureGenerateToc,
    invert: invertGenerateToc,
  },
};

/** The kinds this writer routes, as a runtime set for {@link specFor}. */
type PdfLibKind = keyof typeof pdfLibSpecs;

/**
 * One pdf-lib `apply` **as this writer calls it**, rather than as its spec
 * declares it.
 *
 * The difference is the third parameter's optionality, and it is the seam's
 * asymmetry rather than a looser copy of it. A spec declares `reads: 'outline'`
 * and gets a three-parameter `Apply`; a spec declaring `'none'` gets a
 * two-parameter one. This writer dispatches over **both** without knowing
 * which, because `specFor` looks up by a kind the checker cannot correlate with
 * the argument — so the one signature that covers the table is the one where
 * the third parameter may be absent.
 *
 * That is sound in the direction it is used: a two-parameter implementation is
 * assignable to this and ignores what it is passed, and a three-parameter one
 * is called with what the bus resolved for it. It is **not** a guard, and
 * nothing here pretends otherwise — the type cannot tell that `generateToc`'s
 * apply always receives its outline. `pageToc.test.ts` is what asserts that,
 * which is where the wired-tools rule already puts the burden.
 */
type PdfLibApply<K extends CommandKind> = (
  image: ByteImage,
  command: CommandOfKind<K>,
  reads?: PreReadValue,
) => Promise<ByteImage>;

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
  // THE ONE EXECUTION THAT FORWARDS `reads`, and it is the only one that has
  // to: `reads: 'outline'` is declared by `generateToc`, which routes here, and
  // ADR-0040's extension says why it must be pdf-lib's — §3's matrix puts TOC
  // generation on the content-composition row and outline reading on MuPDF's.
  //
  // The cast names the three-parameter instantiation rather than the default
  // one, so the call site passes what the bus resolved. It is not a claim that
  // every pdf-lib command reads an outline: an apply that ignores the argument
  // is assignable to a signature that passes it, which is the bivariance
  // ADR-0040's correction records — so the four `reads: 'none'` commands here
  // are called with `undefined` and never look.
  apply<K extends CommandKind>(
    image: ByteImage,
    command: CommandOfKind<K>,
    // `never`, WHICH IS THE DECLARATION AND NOT A PLACEHOLDER. `Apply` resolves
    // byte-image × `sources: 'one'` to `never`, so no pdf-lib command can ever
    // be handed a source — and typing the parameter `never` here says the bus
    // has nothing to pass rather than that this writer ignores what it gets.
    // The bus still passes positionally, so the slot has to exist.
    _source: never,
    reads?: PreReadValue,
  ): Promise<ByteImage> {
    // THE CAST NAMES AN OPTIONAL THIRD PARAMETER, and that spelling is the
    // whole of this line's design rather than a convenience.
    //
    // `Apply<'pdf-lib', K, 'none', 'outline'>` — the three-parameter
    // instantiation — is what the value actually is for `generateToc`, and
    // calling it needs `reads` narrowed from `PreReadValue | undefined` to
    // `PreReadValue`. Both spellings of that narrowing are banned here and both
    // bans are right: `as PreRead['outline']` is
    // `non-nullable-type-assertion-style` and `reads!` is
    // `no-non-null-assertion`. A guard would be worse than either — it would
    // turn a state the declaration table makes unreachable into a runtime
    // refusal, which is a check that cannot fail wearing a green tick.
    //
    // So the writer's view of an apply is *may be handed pre-read data*, which
    // is true of all five specs here and is exactly what `CommandExecution`
    // already says. The obligation to supply it stays where the knowledge is:
    // the bus reads `spec.reads` and resolves precisely when the declaration
    // says to.
    // THE OUTLINE IS THIRD HERE AND FOURTH ON `CommandExecution`, and that is
    // not an inconsistency — it is the byte-image branch of `Apply` having no
    // source parameter AT ALL. `Apply` resolves byte-image × `sources: 'one'`
    // to `never`, so a pdf-lib apply's third parameter is its outline, while
    // the execution interface has to carry a slot for writers that do take a
    // source. This is the one place the two shapes meet, and it is why the
    // parameter is dropped rather than forwarded.
    //
    // THIS LINE WAS WRONG FOR ONE RUN, in exactly the way the comment on
    // `CommandExecution.apply` predicts: it forwarded `(image, command,
    // undefined, reads)`, so the outline landed in a slot that does not exist
    // and `generateToc` received `undefined`. Two bus cases caught it —
    // `resolves the outline for a command that declares it, exactly once` and
    // its redo sibling — because both assert the VALUE reaching the apply
    // rather than only that a resolver was called. A case asserting the call
    // count alone would have stayed green.
    return (specFor(command).apply as PdfLibApply<K>)(image, command, reads);
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
