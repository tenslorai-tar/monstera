import type { ClientApi, Command, CommandOfKind, FailureOf } from '@monstera/contract';
import { blocksOfEdit, replacementsOf } from '@monstera/contract/host';
import type { Failure } from '@monstera/shared';

import type {
  ApplyRequest,
  CommandExecution,
  KindsRoutedTo,
  RegisteredWriter,
} from '../commandRouting.js';
import { serialiseIntoFile } from '../checkpointFile.js';
import type { CaptureResult, CommandPrior } from '../commandLog.js';
import type { ByteImage, ImageSession } from '../engineSeam.js';
import type { PageContent } from '../pageContent.js';
import { assemblePageContent } from '../pageContentAssemble.js';
import type { TextRun } from '../pdfiumFfi.js';
import {
  EditRefusedError,
  NothingToReplaceError,
  ReplaceMovesLineError,
  TextNotInPlaceError,
  TextNotWritableError,
} from '../textEditRefusals.js';
import { EngineCallFailed, EngineSessionGone, type SessionArea, priorTooLargeToRecord } from './remoteEngine.js';
import { EngineSerialiseMismatch, type SessionAreaSurface, takeAnnounced } from './remoteLifecycle.js';
import { type PdfiumChannels, pdfiumTaggedPrior } from './pdfiumChannels.js';

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
 * Puts a PDFium command's input where the host reads it with its inline images made XObjects (ADR-0126), answering
 * whether it did. `false` — nothing to keep, or nothing able to keep it — leaves the ordinary write to this adapter,
 * so the command runs either way and is never refused for holding a picture.
 *
 * It is handed the destination rather than answering bytes: the rewritten document is copied file to file into the
 * snapshot directory, so `main` never holds it beside the image it already holds (ADR-0121).
 */
export type PdfiumInputKeeper = (
  image: ImageSession,
  scope: 'all' | number,
  into: { readonly directory: string; readonly name: string },
) => Promise<boolean>;

/**
 * The key an image opens with, as a host frame carries it: the text, or `null` for none (ADR-0171's addendum). THE ONE
 * PLACE this adapter reveals a held password, so every frame below takes it from here rather than spelling the reveal.
 */
const frameKey = (image: ImageSession): string | null => image.opensWith?.reveal() ?? null;

/**
 * The pages a PDFium command regenerates — its `page`, or every page for `replaceAllText`, the one document-wide
 * PDFium command. THE ONE STATEMENT of it (ADR-0126 Decision 4): the keeper's scope is read here, and a command added
 * to the PDFium writer without a `page` is a compile error until it is answered here.
 */
export function regeneratedBy(command: CommandOfKind<KindsRoutedTo<'pdfium'>>): 'all' | number {
  return command.kind === 'replaceAllText' ? 'all' : command.page;
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
  result: { ok: true; value: T } | { ok: false; error: Failure<PdfiumWriteFailure> },
  typed: () => string = () => '',
): T {
  if (result.ok) return result.value;
  const { error } = result;
  if (error.code === 'no-such-session') throw new EngineSessionGone(channel);
  // THE SAME CLASS THE LOCAL WRITER THROWS, so main's answer to a font that
  // cannot carry the typed text does not depend on which process applied it.
  //
  // ONLY CHARACTERS THAT WERE TYPED cross on from here (ADR-0169 Decision 4). The host is hostile by invariant 25's
  // premise and its detail is bounded by the schema; this is the half the schema cannot see — that what the host named
  // is something the person wrote, which `main` knows from the command and the host cannot change.
  if (error.code === 'text-not-writable') {
    const wrote = typed();
    throw new TextNotWritableError(Array.from(error.detail.characters).filter((c) => wrote.includes(c)).join(''));
  }
  if (error.code === 'text-not-in-place') throw new TextNotInPlaceError();
  if (error.code === 'nothing-to-replace') throw new NothingToReplaceError();
  if (error.code === 'replace-moves-line') throw new ReplaceMovesLineError();
  if (error.code === 'edit-refused') {
    throw new EditRefusedError(error.detail.step, error.detail.engineError, `the PDFium host refused ${channel}`);
  }
  throw new EngineCallFailed(channel, error.code);
}

/** Every failure the PDFium host's three write channels can answer. */
type PdfiumWriteFailure =
  | FailureOf<PdfiumChannels, 'engine/apply'>
  | FailureOf<PdfiumChannels, 'engine/capture'>
  | FailureOf<PdfiumChannels, 'engine/invert'>;

/**
 * What the person typed into a PDFium command: the text a `text-not-writable` refusal's characters must come from.
 * Exhaustive over the kinds routed here, so a command that writes text and is routed to PDFium without an answer here
 * is a compile error rather than a refusal that names nothing.
 */
export function typedBy(command: CommandOfKind<KindsRoutedTo<'pdfium'>>): string {
  switch (command.kind) {
    case 'replaceTextObject':
      return replacementsOf(command)
        .map((replacement) => replacement.text)
        .join('');
    case 'editTextBlock':
      return blocksOfEdit(command)
        .map((block) => block.text)
        .join('');
    case 'replaceTextAt':
    case 'replaceAllText':
      return command.replace;
    case 'placePageObject':
    case 'recolorPageObjects':
    case 'deletePageObjects':
    case 'promoteFormObjects':
      return '';
  }
}

export function remotePdfiumExecution(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
  keep?: PdfiumInputKeeper,
): CommandExecution<'pdfium'> {
  /**
   * Puts `image` where the host reads, runs `call` with the name, and removes
   * it — whatever `call` did.
   *
   * **The `finally` is the whole of the lifetime**, which is
   * `remoteMupdfExecution`'s `withAsset` rule on the document itself rather
   * than on a command's asset. A file that outlives the call is one nothing
   * holds a name for, in a directory that is not swept until the host ends.
   *
   * `regenerates` names the pages a WRITE is about to regenerate, and only a write passes it: a read regenerates
   * nothing, so it pays nothing for the keeper (ADR-0126).
   */
  const withImage = async <T>(
    image: ImageSession,
    call: (from: string, area: SessionArea, session: string, password: string | null) => Promise<T>,
    regenerates?: 'all' | number,
  ): Promise<T> => {
    const { session, area } = held();
    const from = transfer.mintName();
    const placed =
      regenerates !== undefined && keep !== undefined
        ? await keep(image, regenerates, { directory: area.snapshotDirectory, name: from })
        : false;
    if (!placed) await transfer.writeSnapshot(area, from, image.bytes);
    try {
      return await call(from, area, session, frameKey(image));
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
    image: ImageSession,
    regenerates: 'all' | number,
    send: (from: string, into: string, session: string, password: string | null) => Promise<{ bytes: number }>,
  ): Promise<ByteImage> =>
    withImage(
      image,
      async (from, area, session, password) => {
        const into = transfer.mintName();
        const answer = await send(from, into, session, password);
        return takeAnnounced(transfer, area, into, answer.bytes);
      },
      regenerates,
    );

  return {
    // NEITHER `sources` NOR `reads` IS NAMED, for `pdfiumSpecs.ts`' reason: no
    // PDFium command can be handed a source, and none declares `reads`. The
    // remote half is where that mattered most — a value that never crossed the
    // pipe fails in the host rather than at the call (ADR-0069). The channel's
    // `sources` is written empty, which is that fact on the wire.
    apply: async <K extends KindsRoutedTo<'pdfium'>>({
      session: image,
      command,
    }: ApplyRequest<'pdfium', K>): Promise<ByteImage> =>
      wrote(image, regeneratedBy(command), async (from, into, session, password) =>
        answered(
          'engine/apply',
          await client['engine/apply']({ session, command, sources: [], from, password, into }),
          // ASKED ONLY OF A REFUSAL that names characters: decoding a block edit's wire form costs nothing a success
          // should pay.
          () => typedBy(command),
        ),
      ),

    capture: async <K extends KindsRoutedTo<'pdfium'>>(
      image: ImageSession,
      command: CommandOfKind<K>,
    ): Promise<CaptureResult<CommandPrior[K]>> =>
      withImage(image, async (from, _area, session, password) => {
        const result = await client['engine/capture']({ session, command, from, password });
        const answer = priorTooLargeToRecord(result) ?? answered('engine/capture', result);
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
        // AND THE ASSERTION IS BACK, exactly as the note above predicted. It
        // said *the second PDFium command will require it*, and three arrived
        // on 2026-09-10: the tag and `K` are correlated through the comparison
        // two lines up, which is a narrowing the checker cannot follow, so the
        // union no longer collapses to a single member.
        //
        // What makes the cast honest is the check above it rather than this
        // comment: a prior tagged for another kind has already thrown.
        return { captured: true, prior: answer.value.prior as CommandPrior[K] };
      }),

    invert: async <K extends KindsRoutedTo<'pdfium'>>(
      image: ImageSession,
      kind: K,
      inverse: CommandPrior[K],
    ): Promise<ByteImage> =>
      // THE PAGE A PRIOR RESTORES, read through the same tagged prior the host is sent: every PDFium prior carries
      // the page its command touched, and restoring it regenerates that page as the command did.
      wrote(image, pdfiumTaggedPrior(kind, inverse).prior.page, async (from, into, session, password) =>
        answered(
          'engine/invert',
          await client['engine/invert']({
            session,
            // THROUGH `pdfiumTaggedPrior` SINCE 2026-09-10, which is the day
            // this comment's own prediction came true. It said *this compiles
            // because the union has one member, and the second PDFium command
            // is what will need `taggedPrior`'s equivalent*; three commands
            // arrived and it did.
            //
            // A CALL AND NOT A CAST, for the reason that constructor's own note
            // gives: `{ kind, prior }` widens its two fields independently and
            // the correlation is invisible to the checker, so the claim is
            // stated once where a future caller inherits it rather than copied
            // as a cast whose reasoning lives in someone else's comment.
            inverse: pdfiumTaggedPrior(kind, inverse),
            from,
            password,
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
 * `pdfLibWriter`'s, for exactly its reason: a byte-image writer's session
 * **holds** the image (with the key it opens with, which a checkpoint does not
 * need: it is restored through the document's own sessions, which hold it), so
 * producing the session's bytes is reading the argument. The
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
  keep?: PdfiumInputKeeper,
): RegisteredWriter<'pdfium'> {
  const serialise = (session: ImageSession): Promise<ByteImage> => Promise.resolve(session.bytes);
  return {
    serialise,
    // THE SESSION IS BYTES IN `main` for a byte-image writer, so a checkpoint writes them (ADR-0121).
    serialiseInto: serialiseIntoFile(serialise),
    ...remotePdfiumExecution(client, held, transfer, keep),
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
 * by run; turning that into blocks is `textLines.ts`' job in main, which is
 * where ADR-0049's rule about where a grouping's output may go — the in-place
 * editor and nothing else, since ADR-0096 — can be read off one module.
 */
export function remotePdfiumTextRuns(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): (image: ImageSession, page: number) => Promise<{
  readonly runs: readonly TextRun[];
  readonly truncated: boolean;
  readonly unaddressable: number;
}> {
  return async (image, page) => {
    const { session, area } = held();
    const from = transfer.mintName();
    await transfer.writeSnapshot(area, from, image.bytes);
    try {
      return answered(
        'engine/text-runs',
        await client['engine/text-runs']({ session, from, password: frameKey(image), page }),
      );
    } finally {
      await transfer.removeSnapshot(area, from);
    }
  };
}

/**
 * One page rasterised, over the boundary.
 *
 * ## It uses `wrote`'s shape, not `withImage`'s, and the difference is a FILE
 *
 * The two readers beside it answer on the pipe. This one's answer is a page of
 * pixels, so the host writes it into the granted output directory and this takes
 * it back out — the same round trip a byte-image command's result makes, which
 * is why the input write, the output read and the cleanup are the ones already
 * written rather than a second arrangement of them.
 *
 * ## The byte count is CHECKED against the size that was asked for
 *
 * A raster of `width * height * 4` bytes is the only correct answer, and a file
 * shorter than that is a partial write that would decode as an image with a
 * torn bottom edge rather than as a failure. `EngineSerialiseMismatch` is what
 * the byte-image path raises for the same disagreement.
 */
export function remotePdfiumRenderPage(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): (
  image: ImageSession,
  page: number,
  width: number,
  height: number,
  withoutText: boolean,
) => Promise<{ readonly width: number; readonly height: number; readonly bgra: Uint8Array }> {
  return async (image, page, width, height, withoutText) => {
    const { session, area } = held();
    const from = transfer.mintName();
    const into = transfer.mintName();
    await transfer.writeSnapshot(area, from, image.bytes);
    try {
      const answer = answered(
        'engine/render-page',
        await client['engine/render-page']({ session, from, password: frameKey(image), into, page, width, height, withoutText }),
      );
      // THE SIZE IS KNOWN BEFORE THE HOST ANSWERS, so a count that is not the raster's is refused before anything is
      // read, and the read is held to the raster's own size.
      const expected = width * height * 4;
      if (answer.bytes !== expected) throw new EngineSerialiseMismatch(expected, answer.bytes);
      const bgra = await takeAnnounced(transfer, area, into, expected);
      return { width, height, bgra };
    } finally {
      await transfer.removeSnapshot(area, from);
    }
  };
}

/**
 * One page's objects, over the boundary.
 *
 * {@link remotePdfiumTextRuns}' sibling on the other read, and a **query**
 * rather than a member of the writer for its reason: nothing in `CommandBus`
 * reads it.
 *
 * Written out rather than sharing that function's body with a channel name
 * parameter. The two differ in the shape of what comes back, and a helper
 * generic over the channel would have to be generic over its answer too — which
 * is a type parameter standing where a reader wants to see which call is made.
 */
export function remotePdfiumPageObjects(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): (image: ImageSession, page: number) => Promise<{
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
}> {
  return async (image, page) => {
    const { session, area } = held();
    const from = transfer.mintName();
    await transfer.writeSnapshot(area, from, image.bytes);
    try {
      return answered(
        'engine/page-objects',
        await client['engine/page-objects']({ session, from, password: frameKey(image), page }),
      );
    } finally {
      await transfer.removeSnapshot(area, from);
    }
  };
}

/**
 * One page's own content, over the boundary ([ADR-0210](../../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * `remotePdfiumRenderPage`'s round trip with a metadata answer beside the file: the image is written, the channel is called
 * naming where to put the pictures, the pictures are taken back at exactly the count the host announced, and both files go.
 * `assemblePageContent` then checks every claim the host made about those bytes before anything is sliced.
 */
export function remotePdfiumPageContent(
  client: ClientApi<PdfiumChannels>,
  held: () => PdfiumArea,
  transfer: PdfiumTransfer,
): (image: ImageSession, page: number) => Promise<PageContent> {
  return async (image, page) => {
    const { session, area } = held();
    const from = transfer.mintName();
    const into = transfer.mintName();
    await transfer.writeSnapshot(area, from, image.bytes);
    try {
      const answer = answered(
        'engine/page-content',
        await client['engine/page-content']({ session, from, password: frameKey(image), into, page }),
      );
      const blob = await takeAnnounced(transfer, area, into, answer.imageBytes);
      const { imageBytes: _imageBytes, ...content } = answer;
      return assemblePageContent(content, blob);
    } finally {
      await transfer.removeSnapshot(area, from);
    }
  };
}
