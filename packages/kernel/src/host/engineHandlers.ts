import type { Handlers } from '@monstera/contract';

import type { CommandExecution } from '../commandSpecs.js';
import type { EngineWriter, MupdfSession } from '../engineSeam.js';
import type { PageGeometryReader } from '../pageGeometry.js';
import type { Destination } from '../destinations.js';
import type { Layer } from '../layers.js';
import type { PageLink } from '../pageLinks.js';
import type { DuplicatePageGroup } from '../pageDuplicates.js';
import type { ContainmentProbePaths, ContainmentReport } from './containment.js';
import {
  ENGINE_DUPLICATE_PAGES_MAX,
  type EngineChannels,
  taggedPrior,
} from './engineChannels.js';

/**
 * Reads one page's structured text as MuPDF's own JSON.
 *
 * Injected rather than imported for {@link PageGeometryReader}'s reason: a
 * handler proof must be able to drive this channel without a parsed document,
 * and `packages/kernel` is the host body — so its proofs must not need a native
 * library to decide whether a handler is correct.
 *
 * **The JSON is not parsed here.** `parsePageText` is the one reader of that
 * format and it lives main-side, so nothing in the hostile process holds an
 * opinion about the structure MuPDF computed.
 */
export type HostPageTextReader = (session: MupdfSession, page: number) => Promise<string>;

/**
 * Reads one page's links.
 *
 * Injected for `HostPageTextReader`'s reason: the handler proof drives this
 * channel with no parsed document, and `packages/kernel` is the host body, so
 * its proofs must not need a native library to decide whether a handler is
 * correct.
 *
 * **The shape IS interpreted here**, unlike the text beside it, and the channel
 * says why: a link is three values MuPDF hands back through an API rather than
 * a format anybody owns, so there is no serialisation for a second reader to
 * disagree with.
 */
export type HostPageLinksReader = (
  session: MupdfSession,
  page: number,
) => Promise<readonly PageLink[]>;

/**
 * Reads the document's outline.
 *
 * Injected for the two readers above's reason. Takes no page: an outline is a
 * property of the document, and a per-page parameter would be a signature
 * inviting a caller to ask a question this has no answer to.
 */
export type HostDestinationsReader = (
  session: MupdfSession,
) => Promise<readonly Destination[]>;

/** Reads the document's layers. Injected for the readers above's reason. */
export type HostLayersReader = (session: MupdfSession) => Promise<readonly Layer[]>;

/**
 * Groups pages that are the same page. Injected for the readers above's reason.
 *
 * It answers the **whole** set and the bound is applied where the answer is
 * assembled, not here: a reader that clipped would have to decide what
 * *truncated* means, which is the channel's question and not a document's.
 */
export type HostDuplicatesReader = (
  session: MupdfSession,
) => Promise<readonly DuplicatePageGroup[]>;

/**
 * The engine host's side of Decision 10: it looks the spec up and calls it
 * against a session **it** holds.
 *
 * The main-side adapter in `remoteEngine.ts` sends intent; this performs the
 * same `declaredSpecs` lookup `localMupdfExecution` performs, because
 * `packages/kernel` is what the host body runs. One implementation per command,
 * executed where the session is (B3a).
 */

/**
 * One live session and where its bytes are allowed to go.
 *
 * The output directory is held **here**, against the session, rather than
 * arriving on each `serialise` call. That is the difference between a peer
 * naming a directory per request and a peer naming one at open: main states it
 * once, this process records it, and no later message can move where the bytes
 * land. A `serialise` that carried a directory would be a channel through which
 * a confused main could redirect the document's bytes on every save.
 */
export interface HostSession {
  readonly session: MupdfSession;
  /** The directory main granted this session MODIFY on. */
  readonly outputDirectory: string;
}

/** The sessions one host process holds, keyed by the id it issued. */
export interface HostSessions {
  /** What is behind an id this host issued, or `undefined`. */
  readonly lookup: (id: string) => HostSession | undefined;
  /**
   * Records a session this host just opened and returns the id it issues.
   *
   * The host mints identity (Decision 10b), so this is where an id comes from —
   * main receives it and holds a token it cannot dereference.
   */
  readonly issue: (held: HostSession) => string;
  /** Forgets an id. A later call through it gets `no-such-session`. */
  readonly forget: (id: string) => void;
}

/**
 * The filesystem this host reaches, which is only ever the two directories it
 * was handed for the session in question.
 *
 * An interface rather than `node:fs` directly, for the reason every surface in
 * this package is one: `packages/kernel` is the host **body** and its proofs
 * must not need a container, a grant or a real path to decide whether the
 * handlers are correct.
 */
export interface HostFilesystem {
  /** Reads the canonical image main placed in the snapshot directory. */
  readonly readSnapshot: (directory: string, name: string) => Promise<Uint8Array>;
  /** Writes serialised bytes into the output directory. Returns how many. */
  readonly writeOutput: (directory: string, name: string, bytes: Uint8Array) => Promise<number>;
}

/**
 * How this host attempts a path for ADR-0023 §5's startup check.
 *
 * Injected for the same reason {@link HostFilesystem} is, and with one addition
 * that is specific to this one: the real implementation is `probeContainment`,
 * which opens two paths for real, and a handler proof that had to supply a
 * reachable path and an unreachable one would be a proof that needs a
 * container. The surface is the whole `probeContainment` signature rather than
 * a per-path `open`, because **what the pair means is `containment.ts`'s rule**
 * and re-deriving it from two separate calls here would be a second opinion
 * about it (B3a).
 */
export type HostContainmentProbe = (paths: ContainmentProbePaths) => Promise<ContainmentReport>;

/**
 * @param sessions what this host holds. `undefined` is an OUTCOME here, not a
 *   defect: a rebuilt host holds none of the previous one's sessions, so a call
 *   arriving with an old id is ordinary and gets a declared code.
 * @param execution how this process runs a command — `localMupdfExecution` in
 *   the host, and injectable so a proof can drive both halves without a
 *   document.
 * @param probe how this process attempts the two paths §5's check names.
 *   `probeContainment` in the host.
 * @param geometry how this process reads the view model's geometry half.
 *   `readPageGeometry` in the host, and injectable for the same reason
 *   `execution` is: a handler proof must be able to drive this channel without
 *   a parsed document.
 */
export function createEngineHandlers(
  sessions: HostSessions,
  execution: CommandExecution<'mupdf'>,
  writer: EngineWriter<MupdfSession>,
  files: HostFilesystem,
  probe: HostContainmentProbe,
  geometry: PageGeometryReader,
  pageText: HostPageTextReader,
  pageLinks: HostPageLinksReader,
  destinations: HostDestinationsReader,
  layers: HostLayersReader,
  duplicates: HostDuplicatesReader,
): Handlers<EngineChannels> {
  // THE MISS IS RETURNED, NEVER THROWN, and that is the load-bearing choice in
  // this file. A throw crossing this boundary becomes `internal` with its
  // diagnostic withheld — and the supervisor cannot act on `internal`.
  // Decision 9 has it rebuild when a session is gone, which is a decision it can
  // only take from a code it can read.
  //
  // Written out three times rather than behind a helper: a helper returning
  // "either a session or a failure" needs a discriminator over a BRANDED token,
  // which is a type-level trick standing where three plain lines say it.
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;

  /**
   * A DOCUMENT's failure, returned rather than thrown, for the reason above and
   * one more that is specific to these two codes.
   *
   * A throw here becomes `internal`, and the supervisor answers `internal` by
   * treating the host as unhealthy. A file that will never parse would then be
   * answered with a rebuild, and the next attempt would fail the same way —
   * which is Decision 9a's runaway with a hostile input at the centre of it.
   *
   * The detail is **discarded**, not forwarded. It comes from a native library
   * parsing a file this design assumes is hostile, and a diagnostic string is
   * one of the things such a library emits from data it was given. The code is
   * what the supervisor acts on; the string would only ever be rendered.
   */
  // GENERIC OVER THE CODE, so each channel's return narrows to the failures IT
  // declares. A helper returning the union of both would compile at neither
  // call site — which is the contract's per-channel failure list doing its job,
  // and worth keeping rather than widening away.
  const failed = <C extends string>(
    code: C,
    _cause: unknown,
  ): { readonly ok: false; readonly error: { readonly code: C } } => ({
    ok: false,
    error: { code },
  });

  return {
    // NO try/catch, and that is deliberate rather than an omission. Every
    // outcome this can produce is already one of `ProbeOutcome`'s four states —
    // `probePath` catches its own opens and turns a throw into `refused`,
    // `absent` or `error`. A catch here could only turn an observation into
    // `internal`, whose diagnostic is withheld, and main's verdict for "the
    // call broke" and "the probe measured nothing" would become one output.
    // That is the exact collapse `unreadable` exists to prevent.
    'engine/probe-containment': async ({ positive, negative, loopbackPort }) => ({
      ok: true,
      value: await probe({ positive, negative, loopbackPort }),
    }),

    'engine/open': async ({ snapshotDirectory, snapshotName, outputDirectory }) => {
      // THE PATH IS USED, NOT VALIDATED, and that is the design rather than an
      // omission. Main composed these directories and wrote their DACLs; this
      // process reaches them because it was GRANTED them, and would reach
      // nothing by being told a name it was not. Re-deriving a policy here
      // would be a second opinion about a question the ACE already answers.
      let image: Uint8Array;
      try {
        image = await files.readSnapshot(snapshotDirectory, snapshotName);
      } catch (error) {
        return failed('open-failed', error);
      }

      let session: MupdfSession;
      try {
        session = await writer.open(image);
      } catch (error) {
        return failed('open-failed', error);
      }
      // ISSUED ONLY AFTER THE OPEN SUCCEEDED. An id handed out for a session
      // that does not exist is one main would run commands against, and every
      // one of those would fail as `no-such-session` — which the supervisor
      // reads as a dead host and answers with a rebuild.
      return { ok: true, value: { session: sessions.issue({ session, outputDirectory }) } };
    },

    'engine/serialise': async ({ session, into }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      try {
        const bytes = await writer.serialise(held.session);
        const written = await files.writeOutput(held.outputDirectory, into, bytes);
        return { ok: true, value: { bytes: written } };
      } catch (error) {
        return failed('serialise-failed', error);
      }
    },

    'engine/close': async ({ session }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      // FORGOTTEN BEFORE THE CLOSE, so a second call cannot reach the adapter's
      // own double-close path — `mupdfWriter.close` removes from its map before
      // destroying for the same reason, and two guards at two layers is what
      // stops a freed native document being destroyed twice.
      sessions.forget(session);
      await writer.close(held.session);
      return { ok: true, value: {} };
    },

    'engine/page-geometry': async ({ session, pages }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      // NO try/catch, for the reason `engine/apply` has none: a read of a page
      // tree the adapter already parsed either works or is a defect — including
      // an index outside the document, which is a caller that has lost track of
      // the page count rather than a state to report.
      return { ok: true, value: await geometry(held.session, pages) };
    },

    'engine/page-text': async ({ session, page }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      // NO try/catch, for `engine/page-geometry`'s reason: a text read of a
      // document the adapter already parsed either works or is a defect,
      // including a page index outside it.
      //
      // THE JSON IS PASSED THROUGH UNPARSED. Parsing here would put a second
      // reader of MuPDF's format in the hostile process and re-serialise a
      // shape this build invented; `parsePageText` main-side is the one reader
      // (§3.2), and the schema's size bound is what makes the string safe to
      // carry rather than trust.
      return { ok: true, value: { json: await pageText(held.session, page) } };
    },

    'engine/page-links': async ({ session, page }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      // NO try/catch, for the reader above's reason: a link read of a document
      // the adapter already parsed either works or is a defect, including a
      // page index outside it.
      return { ok: true, value: { links: [...(await pageLinks(held.session, page))] } };
    },

    'engine/destinations': async ({ session }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      return { ok: true, value: { destinations: [...(await destinations(held.session))] } };
    },

    'engine/layers': async ({ session }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      return { ok: true, value: { layers: [...(await layers(held.session))] } };
    },

    'engine/duplicate-pages': async ({ session }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      const groups = await duplicates(held.session);

      // BOUNDED BY PAGES, not by groups, and the difference is the document
      // that produces the worst case: one blank page repeated ten thousand
      // times is ONE group of ten thousand entries, which a group count does
      // not see at all. Whole groups are kept or dropped, because half a group
      // is a list of pages that are duplicates of something not in it.
      const kept: { pages: number[] }[] = [];
      let pages = 0;
      let truncated = false;
      for (const group of groups) {
        if (pages + group.pages.length > ENGINE_DUPLICATE_PAGES_MAX) {
          truncated = true;
          break;
        }
        kept.push({ pages: [...group.pages] });
        pages += group.pages.length;
      }
      return { ok: true, value: { groups: kept, truncated } };
    },

    'engine/apply': async ({ session, command }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      await execution.apply(held.session, command);
      return { ok: true, value: {} };
    },

    'engine/capture': async ({ session, command }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      const captured = await execution.capture(held.session, command);
      return captured.captured
        ? // The kind is stamped from the COMMAND THIS CALL CARRIED, so the tag
          // and the prior state cannot disagree at the source. What it buys is
          // on the other side: main refuses an answer whose tag is not the one
          // it asked for, and that check needs a tag to check.
          { ok: true, value: { captured: true, value: taggedPrior(command.kind, captured.prior) } }
        : { ok: true, value: { captured: false, reason: captured.reason } };
    },

    'engine/invert': async ({ session, inverse }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      await execution.invert(held.session, inverse.kind, inverse.prior);
      return { ok: true, value: {} };
    },
  };
}
