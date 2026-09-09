import type { ClientApi, Command, CommandOfKind } from '@monstera/contract';

import type { CommandExecution, KindsRoutedTo, RegisteredWriter } from '../commandRouting.js';
import type { CaptureResult, CommandPrior } from '../commandLog.js';
import type { ByteImage } from '../engineSeam.js';
import { EngineCallFailed, EngineSessionGone, type SessionArea } from './remoteEngine.js';
import { EngineSerialiseMismatch, type SessionAreaSurface } from './remoteLifecycle.js';
import type { PdfiumChannels } from './pdfiumChannels.js';

/**
 * Main's side of the PDFium host: the writer `CommandBus` routes
 * `replaceTextObject` to.
 *
 * ## What is different from `remoteMupdfExecution`, and why none of it is a copy
 *
 * That one sends a command against a **session the host is holding**, and the
 * session token is main's handle to it. This one has no such token to send:
 * `RegisteredWriter<'pdfium'>`'s members receive `WriterSession['pdfium']`,
 * which is a `ByteImage` — the document's bytes — because PDFium is a
 * byte-image writer of record
 * ([ADR-0047](../../../../docs/DECISIONS/0047-an-in-place-text-edit-is-a-byte-image-command.md)).
 *
 * So every call here does the same four things:
 *
 * 1. write the image into the granted snapshot directory under a fresh name;
 * 2. call the channel, naming that file and — for a write — one to answer into;
 * 3. read the answer back out of the granted output directory, checking the
 *    count against what arrived;
 * 4. remove both files, whatever happened.
 *
 * That is `remoteMupdfLifecycle`'s four-step dance with an input leg added, and
 * it is the answer to ADR-0047's *how do the input bytes reach the host* —
 * `adopt`'s `SnapshotWrite` route, as that ADR said the candidate was.
 *
 * ## THE AREA IS THE HOST'S, not a document's
 *
 * ADR-0048's withdrawn Decision 3: a byte-image host's `engine/open` registers a
 * granted area and parses nothing, so one area serves every document this host
 * is asked about. That is safe because **every call mints its own file names**,
 * which is `SessionAssets`' existing rule — two documents in flight write to two
 * different files in one directory and neither can see the other's name.
 *
 * It is also the only shape available: a per-document area needs a per-document
 * id, and main has nowhere to keep one. The bus hands this writer bytes, and
 * bytes carry no identity.
 *
 * ## The cost, stated rather than discovered later
 *
 * The bus calls `capture` and then `apply`, and neither may hold a file for the
 * other — a capture with no apply after it (a refusal, a closed document, a
 * dead host) would leak a name nothing holds. So an edit costs **two whole-image
 * writes and one read**, on top of the MuPDF serialise `ByteImageAccess.current`
 * performs to produce the image in the first place.
 *
 * ADR-0048 leaves *whether capture and apply share one open* open, and this is
 * that question arriving as a byte cost rather than as a parse cost. It is not
 * answered here and it is not measured; what is written down is that the shape
 * makes it askable, which is the state the ADR asked for.
 */

/** The host's area, and the token it answered with when it registered one. */
export interface PdfiumArea {
  /** The id `engine/open` minted. Main holds it and cannot dereference it. */
  readonly session: string;
  /** The two directories main created, granted and named once. */
  readonly area: SessionArea;
}

/**
 * Writing an image where the host can read it, and taking one back.
 *
 * {@link SessionAreaSurface} plus the input leg. Declared here rather than
 * widening that interface, because the two are read by different callers for
 * different reasons: a live-session adapter never writes an image into the
 * snapshot directory — ADR-0023 Decision 14 refused exactly that route for it,
 * on a measurement — and this one must.
 */
export interface PdfiumTransfer extends SessionAreaSurface {
  /** Puts an image where the host may read it, under a name {@link mintName} gave. */
  readonly writeSnapshot: (area: SessionArea, name: string, bytes: ByteImage) => Promise<void>;
  /** Removes a snapshot file. Called from a `finally`, so it must not throw on absence. */
  readonly removeSnapshot: (area: SessionArea, name: string) => Promise<void>;
}

/**
 * Turns a declared failure into a named throw.
 *
 * `remoteEngine.ts`'s `answered`, and it is written again rather than shared
 * because the two do not agree about the codes. `no-such-session` is the one
 * the supervisor rebuilds for, so it maps to the same class; `engine-refused`
 * is this wire's own and must NOT become an `EngineSessionGone`, because the
 * supervisor's answer to that is a rebuild and this one is a document the
 * engine will refuse just as firmly next time — Decision 9a's runaway, driven
 * by a request that cannot succeed.
 */
function answered<T>(
  channel: string,
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (result.ok) return result.value;
  if (result.error.code === 'no-such-session') throw new EngineSessionGone(channel);
  throw new EngineCallFailed(channel, result.error.code);
}

export function remotePdfiumExecution(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): CommandExecution<'pdfium'> {
  /**
   * Puts `image` where the host reads, runs `call` with the name, and removes
   * it — whatever `call` did.
   *
   * **The `finally` is the whole of the lifetime**, which is
   * `remoteMupdfExecution`'s `withAsset` rule on the document itself rather
   * than on a command's asset. A file that outlives the call is one nothing
   * holds a name for, in a directory that is not swept until the host ends.
   */
  const withImage = async <T>(
    image: ByteImage,
    call: (from: string, area: SessionArea, session: string) => Promise<T>,
  ): Promise<T> => {
    const { session, area } = held();
    const from = transfer.mintName();
    await transfer.writeSnapshot(area, from, image);
    try {
      return await call(from, area, session);
    } finally {
      await transfer.removeSnapshot(area, from);
    }
  };

  /**
   * The write half: mint an output name, send, read the answer back, check the
   * count.
   *
   * Shared by `apply` and `invert` because those two are the same four steps
   * with a different message in the middle — and sharing it is what stops the
   * count check being written once and forgotten once. The check is not
   * ceremony: the host answers a number and main reads a file, so *the host
   * wrote nothing* and *the read found nothing* are otherwise the same empty
   * buffer.
   */
  const wrote = (
    image: ByteImage,
    send: (from: string, into: string, session: string) => Promise<{ bytes: number }>,
  ): Promise<ByteImage> =>
    withImage(image, async (from, area, session) => {
      const into = transfer.mintName();
      const answer = await send(from, into, session);
      const bytes = await transfer.takeOutput(area, into);
      if (bytes.length !== answer.bytes) {
        throw new EngineSerialiseMismatch(answer.bytes, bytes.length);
      }
      return bytes;
    });

  return {
    apply: async <K extends KindsRoutedTo<'pdfium'>>(
      image: ByteImage,
      command: CommandOfKind<K>,
    ): Promise<ByteImage> =>
      wrote(image, async (from, into, session) =>
        answered('engine/apply', await client['engine/apply']({ session, command, from, into })),
      ),

    capture: async <K extends KindsRoutedTo<'pdfium'>>(
      image: ByteImage,
      command: CommandOfKind<K>,
    ): Promise<CaptureResult<CommandPrior[K]>> =>
      withImage(image, async (from, _area, session) => {
        const answer = answered(
          'engine/capture',
          await client['engine/capture']({ session, command, from }),
        );
        if (!answer.captured) return { captured: false, reason: answer.reason };
        // THE TAG IS CHECKED, AND TODAY THE BOUNDARY GETS THERE FIRST — which
        // is measured rather than assumed: `pdfiumPriorSchema` is a
        // discriminated union of one, so a wrongly-tagged answer is a malformed
        // envelope and `createClient` throws before this line runs.
        //
        // It is written anyway, and that is the opposite call from the one made
        // for `replaceTextObjects`' partial-write guard, where an unobservable
        // check kept its code and lost its case. The difference is the
        // TRIGGER. That one's effect is unobservable because of a mechanism
        // that will not change; this one becomes reachable the moment a second
        // command routes to PDFium — which is a row in this stage — and
        // `remoteMupdfExecution` records what happened when its own version of
        // this line was deferred instead: it had to be written under the
        // pressure of the change that made it reachable. Writing it now costs
        // nothing and removes that day.
        //
        // Prior state of the wrong shape builds an inverse that restores
        // something nobody captured, which is why it is worth either layer.
        //
        // READ THROUGH A WIDENING, which is `remoteMupdfExecution`'s own line
        // and its reason unchanged: `CommandOfKind<K>` is
        // `Extract<Command, { kind: K }>`, a conditional that stays deferred
        // while `K` is generic, so `kind` is unreadable through it. Every
        // `Command` carries one, so this restates the constraint rather than
        // escaping it.
        const { kind } = command as Command;
        if (answer.value.kind !== kind) {
          throw new EngineCallFailed(
            'engine/capture',
            `answered prior state tagged "${answer.value.kind}" for a "${kind}" command`,
          );
        }
        // NO ASSERTION, AND THAT IS TEMPORARY. `remoteMupdfExecution` needs one
        // here — the tag and `K` are correlated through a comparison the checker
        // cannot follow — and with one kind routed to PDFium the union collapses
        // to a single member and the value is already `CommandPrior[K]`. Lint
        // reports a cast as unnecessary, correctly. The second PDFium command
        // will require it back, which is the compiler asking at the right
        // moment rather than a cast sitting here claiming to do work.
        return { captured: true, prior: answer.value.prior };
      }),

    invert: async <K extends KindsRoutedTo<'pdfium'>>(
      image: ByteImage,
      kind: K,
      inverse: CommandPrior[K],
    ): Promise<ByteImage> =>
      wrote(image, async (from, into, session) =>
        answered(
          'engine/invert',
          await client['engine/invert']({
            session,
            // NO CAST, AND `remoteMupdfExecution` RECORDS WHY THAT ENDS. Its
            // own line said *no cast* while `mupdf` routed one kind, and stopped
            // being true with the second: `{ kind, prior }` widens its two
            // fields independently, and TypeScript cannot see that they came
            // from one `K`. The same sentence applies here in advance — this
            // compiles because the union has one member, and the second PDFium
            // command is what will need `taggedPrior`'s equivalent.
            inverse: { kind, prior: inverse },
            from,
            into,
          }),
        ),
      ),
  };
}

/**
 * The PDFium writer as the bus registers it.
 *
 * ## `serialise` IS THE IDENTITY, and makes no call at all
 *
 * `pdfLibWriter`'s, for exactly its reason: a byte-image writer's session **is**
 * the image, so producing the session's bytes is producing the argument. The
 * host has no `engine/serialise` to ask — a host holding no parse has nothing
 * to hand back, which is ADR-0048's correction — and this member is where that
 * absence stops being visible to the bus.
 *
 * It is what `CommandBus` calls on the terminal branch, when prior state could
 * not be recorded. So a PDFium command whose capture refuses still takes a
 * checkpoint, and that checkpoint costs one reference assignment.
 */
export function remotePdfiumWriter(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): RegisteredWriter<'pdfium'> {
  return {
    serialise: (session) => Promise.resolve(session),
    ...remotePdfiumExecution(client, held, transfer),
  };
}

/**
 * One page's text runs, over the boundary.
 *
 * `remoteMupdfGeometry`'s sibling on the second engine, and a **query** rather
 * than a member of the writer: nothing in `CommandBus` reads it, so putting it
 * on the registration would widen the one type whose membership rule is *the
 * bus calls this* (ADR-0030 Decision 1).
 *
 * It takes the document's bytes because that is what a byte-image engine is
 * asked things about, and it pays the same input write every call here does.
 *
 * **It does not group them.** What comes back is the engine's own reading, run
 * by run; turning that into visual lines is `textLines.ts`' job in main, which
 * is where ADR-0049's rule about where a grouping's output may go can be read
 * off one module.
 */
export function remotePdfiumTextRuns(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): (image: ByteImage, page: number) => Promise<{
  readonly runs: readonly {
    readonly index: number;
    readonly text: string;
    readonly bottom: number;
    readonly top: number;
  }[];
  readonly truncated: boolean;
}> {
  return async (image, page) => {
    const { session, area } = held();
    const from = transfer.mintName();
    await transfer.writeSnapshot(area, from, image);
    try {
      return answered(
        'engine/text-runs',
        await client['engine/text-runs']({ session, from, page }),
      );
    } finally {
      await transfer.removeSnapshot(area, from);
    }
  };
}
