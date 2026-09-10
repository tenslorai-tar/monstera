import type { Handlers } from '@monstera/contract';

import type { CommandExecution } from '../commandRouting.js';
import type { ByteImage } from '../engineSeam.js';
import type { ContainmentProbePaths, ContainmentReport } from './containment.js';
import type { HostArea, HostFilesystem, HostSessions } from './engineHandlers.js';
import {
  ENGINE_TEXT_OBJECTS_MAX,
  type PdfiumChannels,
  pdfiumTaggedPrior,
} from './pdfiumChannels.js';

/**
 * The PDFium host's handlers.
 *
 * ## Why this is a second module and NOT a second copy
 *
 * `docs/ARCHITECTURE.md` §3 requires *one host body, parameterised by engine*,
 * and the body is one: `startEngineHost` takes a channel map and its handlers
 * and knows neither. What could not be shared is exactly this file, and the
 * reason is the seam's own asymmetry rather than a failure to abstract.
 *
 * `CommandExecution<W>.apply` returns `Promise<void>` for a live-session writer
 * and `Promise<ByteImage>` for a byte-image one. So `engine/apply` is:
 *
 * - MuPDF — look the session up, call `apply` against the parse the host is
 *   holding, answer nothing;
 * - PDFium — look the AREA up, read the image out of it, call `apply` on those
 *   bytes, write what comes back into it, answer a count.
 *
 * Those are not one implementation with a branch. `engine/probe-containment` is
 * the only handler that is literally identical, and a shared module holding one
 * function would be an abstraction with a copy on either side of it.
 *
 * ## Every call opens the document, and that is ADR-0047's shape
 *
 * This host holds no parse between commands
 * ([ADR-0047](../../../../docs/DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)),
 * so `capture`, `apply`, `invert` and the one read each name the file their
 * image is in and each pay one `FPDF_LoadMemDocument` — 0.1–3.5 ms across every
 * cell `proof:editcost` builds, against a `FPDFPage_GenerateContent` that is the
 * whole cost of an edit. That measurement is what made the shape affordable, and
 * it is stated here because the alternative to knowing it is rediscovering it.
 *
 * ## A NAME arrives, never a place
 *
 * `from` and `into` are file names inside the two directories this session's
 * area granted. Nothing on this wire lets a caller name a directory, which is
 * `engine/open`'s `snapshotName` shape and the property ADR-0048 Decision 2
 * refuses to spend.
 *
 * ## And nothing here validates a path
 *
 * `engine/open`'s rule, unchanged: main composed those directories and wrote
 * their DACLs, and this process reaches them because it was **granted** them. A
 * policy re-derived here would be a second opinion about a question the ACE
 * already answers (B3a).
 */

/**
 * A page's text runs, and whether the walk was cut short.
 *
 * Injected rather than imported for the reason every surface in this package
 * is: `packages/kernel` is the host **body**, and a handler proof must be able
 * to drive this channel without `pdfium.dll`.
 *
 * The truncation flag comes back from the reader rather than being computed
 * here, because only the walk knows there was more — `engine/annotations`' rule
 * on a second engine.
 */
export type HostTextRunsReader = (
  image: ByteImage,
  page: number,
) => Promise<{
  readonly runs: readonly {
    readonly index: number;
    readonly text: string;
    readonly bottom: number;
    readonly top: number;
  }[];
  readonly truncated: boolean;
}>;

/**
 * A page's objects, and whether the walk was cut short.
 *
 * {@link HostTextRunsReader}'s shape on the other read, injected for its reason:
 * a handler proof must be able to drive this channel without `pdfium.dll`.
 */
export type HostPageObjectsReader = (
  image: ByteImage,
  page: number,
) => Promise<{
  readonly objects: readonly {
    readonly index: number;
    readonly kind: 'unknown' | 'text' | 'path' | 'image' | 'shading' | 'form';
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
    readonly top: number;
    readonly fill: {
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    } | null;
  }[];
  readonly truncated: boolean;
}>;

/** What the PDFium host's handlers are built from. */
export interface PdfiumHandlerParts {
  /** The granted areas this host holds. Byte-image, so areas and no parses. */
  readonly areas: HostSessions<HostArea>;
  /** How this process runs a command. `localPdfiumExecution` in the host. */
  readonly execution: CommandExecution<'pdfium'>;
  /** How this process reads and writes inside the directories it was granted. */
  readonly files: HostFilesystem;
  /** How this process attempts the two paths ADR-0023 §5's check names. */
  readonly probe: (paths: ContainmentProbePaths) => Promise<ContainmentReport>;
  /** How this process reads a page's text runs. `engine/text-runs`. */
  readonly textRuns: HostTextRunsReader;
  /** How this process reads a page's objects. `engine/page-objects`. */
  readonly pageObjects: HostPageObjectsReader;
}

export function createPdfiumHandlers({
  areas,
  execution,
  files,
  pageObjects,
  probe,
  textRuns,
}: PdfiumHandlerParts): Handlers<PdfiumChannels> {
  // THE MISS IS RETURNED, NEVER THROWN — `engineHandlers.ts`'s rule, and it is
  // the supervisor's ability to act that depends on it. A throw crossing this
  // boundary becomes `internal` with its diagnostic withheld, and Decision 9
  // has the supervisor rebuild when a session is gone, which is a decision it
  // can only take from a code it can read.
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;

  // GENERIC OVER THE CODE, so each channel's return narrows to the failures IT
  // declares — a helper returning the union of both would compile at neither
  // call site. The cause is DISCARDED rather than forwarded: it comes from a
  // native library parsing a file this design assumes is hostile, and the code
  // is what the supervisor acts on.
  const failed = <C extends string>(
    code: C,
    _cause: unknown,
  ): { readonly ok: false; readonly error: { readonly code: C } } => ({
    ok: false,
    error: { code },
  });

  /**
   * The document image this call names, out of the directory this session was
   * granted.
   *
   * Every write and the one read go through here, so no handler can reach a
   * file by a route that skips the area — and there is one place to read when
   * asking what this host may open.
   */
  const imageFor = (held: HostArea, from: string): Promise<Uint8Array> =>
    files.readSnapshot(held.snapshotDirectory, from);

  return {
    // NO try/catch, for `engineHandlers.ts`' reason: every outcome this can
    // produce is already one of `ProbeOutcome`'s four states, and a catch here
    // could only turn an observation into `internal` — collapsing *the call
    // broke* and *the probe measured nothing* into one output.
    'engine/probe-containment': async ({ positive, negative, loopbackPort }) => ({
      ok: true,
      value: await probe({ positive, negative, loopbackPort }),
    }),

    // IT REGISTERS AN AREA AND NOTHING ELSE, which is ADR-0048's withdrawn
    // Decision 3. There is no document at this moment: the area is a transfer
    // buffer whose lifetime is this host's, and *this engine cannot read this
    // document* belongs to the call that wanted the engine — because main
    // answers a failed open by poisoning the document, which is right for the
    // engine a document is read through and wrong for one only needed to edit.
    //
    // So there is nothing here that can fail, and the channel declares no
    // failure. The path is used and not validated, for `engineHandlers.ts`'
    // reason: main composed these directories and wrote their DACLs, and this
    // process reaches them because it was GRANTED them.
    'engine/open': ({ snapshotDirectory, outputDirectory }) =>
      Promise.resolve({
        ok: true,
        value: { session: areas.issue({ outputDirectory, snapshotDirectory }) },
      }),

    'engine/close': async ({ session }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      // NOTHING TO CLOSE, and the handler exists anyway. A byte-image host holds
      // no parse, so this forgets an area and releases nothing — which is
      // `pdfLibWriter.close`'s situation one process out, and it is stated
      // rather than omitted for that adapter's reason: writing the no-op says
      // *nothing was acquired*, where omitting the channel would make main's
      // lifecycle differ by engine for a reason that is not true of it.
      areas.forget(session);
      return Promise.resolve({ ok: true, value: {} });
    },

    'engine/capture': async ({ session, command, from }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      let image: Uint8Array;
      try {
        image = await imageFor(held, from);
      } catch (error) {
        // THE SAME CODE `engine/apply` USES for a missing input, because it is
        // the same fault: main wrote the image and it went, or main did not
        // write it. `asset-missing` is ours rather than the document's.
        return failed('asset-missing', error);
      }
      // NO CAST. `pdfiumCommandSchema` infers exactly the kinds routed here, so
      // the wire command is already `CommandOfKind<KindsRoutedTo<'pdfium'>>` —
      // which is `PdfiumChannelCoversEveryRoutedKind` doing its job at a call
      // site rather than only at its own declaration. `engineHandlers.ts` needs
      // one because MuPDF's wire union omits two commands' bytes; nothing here
      // is omitted, so nothing has to be asserted back.
      //
      // WRAPPED, because this engine PARSES on every call: a document it cannot
      // read is an outcome rather than a defect. See {@link refused}.
      let captured;
      try {
        captured = await execution.capture(image, command);
      } catch (error) {
        return failed('engine-refused', error);
      }
      return captured.captured
        ? // The kind is stamped from the COMMAND THIS CALL CARRIED, so the tag
          // and the prior cannot disagree at the source — `engineHandlers.ts`'
          // `taggedPrior` rule. This was written out inline while the host had
          // one kind; three arrived on 2026-09-10, the two fields started
          // widening independently, and it goes through the constructor for the
          // reason that rule gives.
          {
            ok: true,
            value: { captured: true, value: pdfiumTaggedPrior(command.kind, captured.prior) },
          }
        : { ok: true, value: { captured: false, reason: captured.reason } };
    },

    'engine/apply': async ({ session, command, from, into }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      let image: Uint8Array;
      try {
        image = await imageFor(held, from);
      } catch (error) {
        return failed('asset-missing', error);
      }
      // THE BYTES COME BACK THROUGH THE GRANTED DIRECTORY, never over the pipe.
      // This is `engine/serialise`'s job and this engine's apply in one call
      // (ADR-0048's correction), which is why the answer is a COUNT: main knows
      // where it asked for the bytes and cannot know how many arrived, and
      // comparing that against the file it reads separates "the host wrote
      // nothing" from "the read found nothing".
      //
      // NOTHING IS WRITTEN IF THE ENGINE REFUSED, which is why the write is
      // outside the `try`: a half-written output file under a name main is
      // about to read is the state `engine/apply`'s own *refuse without having
      // touched the target* rule exists to prevent, one layer out.
      let applied;
      try {
        applied = await execution.apply(image, command);
      } catch (error) {
        return failed('engine-refused', error);
      }
      const written = await files.writeOutput(held.outputDirectory, into, applied);
      return { ok: true, value: { bytes: written } };
    },

    'engine/invert': async ({ session, inverse, from, into }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      let image: Uint8Array;
      try {
        image = await imageFor(held, from);
      } catch (error) {
        return failed('asset-missing', error);
      }
      // `engine/apply`'s shape exactly, including the write staying outside the
      // `try`. An inverse that could not be applied must leave main's output
      // name unwritten, so undo refuses rather than adopting a partial file.
      let inverted;
      try {
        inverted = await execution.invert(image, inverse.kind, inverse.prior);
      } catch (error) {
        return failed('engine-refused', error);
      }
      const written = await files.writeOutput(held.outputDirectory, into, inverted);
      return { ok: true, value: { bytes: written } };
    },

    'engine/text-runs': async ({ session, from, page }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      let image: Uint8Array;
      try {
        image = await imageFor(held, from);
      } catch (error) {
        return failed('asset-missing', error);
      }
      try {
        const found = await textRuns(image, page);
        // BOUNDED WHERE THE WALK IS and forwarded rather than re-derived: a
        // handler computing `truncated` from the array's length would answer
        // *you asked for that many* every time. The slice here is belt to the
        // reader's braces — the schema's `.max` would refuse an over-long array
        // as a malformed answer, which is a violation rather than an outcome.
        return {
          ok: true,
          value: {
            runs: found.runs.slice(0, ENGINE_TEXT_OBJECTS_MAX),
            truncated: found.truncated,
          },
        };
      } catch (error) {
        // THE DOCUMENT'S FAULT rather than the host's — a page this document
        // does not have, or one PDFium cannot load. It must not reach the
        // supervisor as evidence of a sick host, because a rebuild-and-retry
        // loop driven by a request that will never succeed is the runaway
        // Decision 9a bounds.
        //
        // `engine-refused` and not a code of its own, for that same reason: the
        // axis a code separates is *is the host sick*, and a second name for
        // *no* would be two names for one decision.
        return failed('engine-refused', error);
      }
    },

    // THE SECOND READ, and it is `engine/text-runs` with a different walk —
    // written out rather than shared, because the two differ in every line that
    // matters (which reader, which bound, which field name) and what they share
    // is a `try`/`catch` around an image lookup.
    'engine/page-objects': async ({ session, from, page }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      let image: Uint8Array;
      try {
        image = await imageFor(held, from);
      } catch (error) {
        return failed('asset-missing', error);
      }
      try {
        const found = await pageObjects(image, page);
        return {
          ok: true,
          value: {
            objects: found.objects.slice(0, ENGINE_TEXT_OBJECTS_MAX),
            truncated: found.truncated,
          },
        };
      } catch (error) {
        return failed('engine-refused', error);
      }
    },
  };
}
