import type { Handlers } from '@monstera/contract';

import { type ComposePageSize, ComposeRefused } from '../composeLayout.js';
import type { ImportImage } from '../imageCompose.js';
import type { ComposeChannels } from './composeChannels.js';
import type { ContainmentProbePaths, ContainmentReport } from './containment.js';
import type { HostArea, HostFilesystem, HostSessions } from './engineHandlers.js';

/**
 * The compose host's handlers
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## The probe and the area are PDFium's handlers, line for line
 *
 * `pdfiumHandlers.ts` records that `engine/probe-containment` is the one handler
 * literally identical between hosts, and that a shared module holding one function
 * would be an abstraction with a copy on either side of it. `open` and `close` are
 * the byte-image shape — register an area, forget it — for the same reason.
 *
 * ## The composer is INJECTED
 *
 * A handler proof must be able to drive this channel without laying out a page,
 * and a composer that throws something other than a refusal must be reachable by a
 * case. So the entry hands in `composeMarkdown`, as PDFium's entry hands in its
 * readers.
 */

/** How this process sets a source as PDF bytes. `composeMarkdown` and `composeCsv` in the host. */
export type SourceComposer = (source: Uint8Array, page: ComposePageSize) => Promise<Uint8Array>;

/**
 * How this process rewrites a document's images — the shim in the host, a fake in a proof.
 *
 * It takes the AREA and two names the channel's schema already validated, and composes the paths
 * itself, because the native call opens by path. `missing` is the source not being in the area,
 * which is main's doing; `unreadable` is MuPDF refusing to open the document, which is the
 * document's. Anything else it throws is a fault.
 */
export type ImageOptimizer = (
  area: HostArea,
  from: string,
  into: string,
  setting: { readonly quality: number; readonly over: number; readonly to: number },
) => Promise<{ readonly kind: 'optimized'; readonly bytes: number } | { readonly kind: 'unreadable' | 'missing' }>;

/** What the compose host's handlers are built from. */
export interface ComposeHandlerParts {
  /**
   * How this process rewrites images, or `null` where it was started without the native library
   * — every packaged build until packaging resolves the library's path, and any run whose launcher
   * did not provision it. The channel then answers `unavailable` rather than calling into nothing.
   */
  readonly optimize: ImageOptimizer | null;
  /** The granted areas this host holds. It holds no parse, so areas and nothing else. */
  readonly areas: HostSessions<HostArea>;
  /** How this process reads and writes inside the directories it was granted. */
  readonly files: HostFilesystem;
  /** How this process attempts the two paths ADR-0023 §5's check names. */
  readonly probe: (paths: ContainmentProbePaths) => Promise<ContainmentReport>;
  /** How this process composes a Markdown source. */
  readonly composeMarkdown: SourceComposer;
  /** How this process composes a CSV source. */
  readonly composeCsv: SourceComposer;
  /** How this process makes pages from a list of images. `composeImages` in the host. */
  readonly composeImages: (images: readonly ImportImage[]) => Promise<Uint8Array>;
}

/** An image the snapshot directory does not hold, told apart from a decoder's refusal. */
class SourceMissing extends Error {}

export function createComposeHandlers({
  areas,
  composeCsv,
  composeImages,
  composeMarkdown,
  files,
  optimize,
  probe,
}: ComposeHandlerParts): Handlers<ComposeChannels> {
  // THE MISS IS RETURNED, NEVER THROWN — `engineHandlers.ts`' rule: a throw
  // crossing this boundary becomes `internal` with its diagnostic withheld, and a
  // missing area is a code main can act on.
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;

  /**
   * One compose handler, for whichever composer a channel names.
   *
   * ONE BODY, because what differs between formats is the parser and nothing else:
   * the area lookup, the source read, which throw is an answer and which is a fault,
   * and the write are the same decisions, and two copies of them would be two
   * opinions about when a person's file is at fault.
   */
  const composeWith =
    (composer: SourceComposer): Handlers<ComposeChannels>['engine/compose-markdown'] =>
    async ({ session, from, into, page }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;

      let source: Uint8Array;
      try {
        source = await files.readSnapshot(held.snapshotDirectory, from);
      } catch {
        // OURS, NOT THE FILE'S: main wrote the source and it went, or main did
        // not write it. A person's file cannot produce this code.
        return { ok: false, error: { code: 'asset-missing' } };
      }

      let pdf: Uint8Array;
      try {
        pdf = await composer(source, page);
      } catch (error) {
        // ONLY A NAMED REFUSAL IS AN ANSWER. Anything else is a defect in this
        // build, and it propagates so the body reports `internal` rather than
        // dressing a fault up as a fact about the person's file.
        if (error instanceof ComposeRefused) {
          return {
            ok: true,
            value: { kind: 'refused', reason: error.reason, line: error.line, item: error.item },
          };
        }
        throw error;
      }

      const bytes = await files.writeOutput(held.outputDirectory, into, pdf);
      return { ok: true, value: { kind: 'composed', bytes } };
    };

  return {
    // NO try/catch, for `pdfiumHandlers.ts`' reason: every outcome is already one
    // of `ProbeOutcome`'s states, and a catch could only turn an observation into
    // `internal`.
    'engine/probe-containment': async ({ positive, negative, loopbackPort }) => ({
      ok: true,
      value: await probe({ positive, negative, loopbackPort }),
    }),

    // AN AREA AND NOTHING ELSE, `pdfiumHandlers.ts`' open: there is no document at
    // this moment, so there is nothing that can fail.
    'engine/open': ({ snapshotDirectory, outputDirectory }) =>
      Promise.resolve({
        ok: true,
        value: { session: areas.issue({ outputDirectory, snapshotDirectory }) },
      }),

    'engine/close': ({ session }) => {
      if (areas.lookup(session) === undefined) return Promise.resolve(gone);
      areas.forget(session);
      return Promise.resolve({ ok: true, value: {} });
    },

    'engine/compose-markdown': composeWith(composeMarkdown),
    'engine/compose-csv': composeWith(composeCsv),

    // `composeWith`'s three decisions, with the native rewriter as the composer: the source's
    // absence is the transport's, MuPDF refusing the document is an answer, and anything else
    // propagates as a fault. The count is the file the rewriter wrote, which main compares with
    // the file it streams.
    'engine/optimize': async ({ session, from, into, quality, over, to }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      if (optimize === null) return { ok: true, value: { kind: 'unavailable' } };

      const answer = await optimize(held, from, into, { quality, over, to });
      if (answer.kind !== 'optimized') {
        return answer.kind === 'missing'
          ? { ok: false, error: { code: 'asset-missing' } }
          : { ok: true, value: { kind: 'unreadable' } };
      }
      return { ok: true, value: { kind: 'optimized', bytes: answer.bytes } };
    },

    // `composeWith`'s decisions over a list: a missing source is the transport's, a
    // named refusal is an answer, and anything else propagates as a fault. Each image
    // is read when the composer reaches it, so the host holds one picked file at once.
    'engine/compose-images': async ({ session, images, into }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;

      let pdf: Uint8Array;
      try {
        pdf = await composeImages(
          images.map(({ from, mediaType }) => ({
            mediaType,
            read: () =>
              files.readSnapshot(held.snapshotDirectory, from).catch((error: unknown) => {
                throw new SourceMissing(`the image ${from} is not in the area`, { cause: error });
              }),
          })),
        );
      } catch (error) {
        if (error instanceof SourceMissing) return { ok: false, error: { code: 'asset-missing' } };
        if (error instanceof ComposeRefused) {
          return {
            ok: true,
            value: { kind: 'refused', reason: error.reason, line: error.line, item: error.item },
          };
        }
        throw error;
      }

      const bytes = await files.writeOutput(held.outputDirectory, into, pdf);
      return { ok: true, value: { kind: 'composed', bytes } };
    },
  };
}
