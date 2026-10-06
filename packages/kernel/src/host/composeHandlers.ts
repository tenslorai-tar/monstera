import type { Handlers } from '@monstera/contract';
import { cappedBoxes } from '@monstera/contract/host';

import type { FaceSource } from '../fontCatalogue.js';
import { type ComposePageSize, ComposeRefused, type ComposedSource } from '../composeOutcome.js';
import type { ImportImage } from '../imageCompose.js';
import { pictureSize } from '../pictureSize.js';
import type { ScannedSignature } from '../signatureScan.js';
import {
  WorkbookUnreadable,
  WorkbookUnsplittable,
  joinPdfs,
  pdfPageCount,
  workbookOutline,
  workbookPart,
} from '../workbookParts.js';
import { type ComposeChannels, MAX_PICTURE_SIDE } from './composeChannels.js';
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

/** How this process sets a source as PDF bytes, and where it drew a box. `composeMarkdown` and `composeCsv` in the host. */
export type SourceComposer = (source: Uint8Array, page: ComposePageSize, faces: FaceSource) => Promise<ComposedSource>;

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
  // REQUIRED, `undefined` where the document opens with none, so a caller cannot leave it out (ADR-0171's addendum).
  password: string | undefined,
) => Promise<{ readonly kind: 'optimized'; readonly bytes: number } | { readonly kind: 'unreadable' | 'missing' }>;

/**
 * How this process keeps a document's inline images through a PDFium edit (ADR-0126) — the shim in the host, a fake
 * in a proof. `optimize`'s shape: the area and two validated names, paths composed here, `missing` the transport's and
 * `unreadable` the document's. `unchanged` wrote nothing; `kept` wrote the document into `into`.
 */
export type InlineImageKeeper = (
  area: HostArea,
  from: string,
  into: string,
  scope: 'all' | number,
  // `ImageOptimizer`'s rule: required, `undefined` where the document opens with none.
  password: string | undefined,
) => Promise<
  | { readonly kind: 'kept'; readonly bytes: number; readonly converted: number; readonly left: number }
  | { readonly kind: 'unchanged'; readonly left: number }
  | { readonly kind: 'unreadable' | 'missing' }
>;

/**
 * How this process makes a scanned signature PDF a picture — `signatureFromScan` in the host, a fake in a proof. It
 * takes the bytes, since what it opens is a document in memory rather than a path.
 */
export type SignatureScanner = (pdf: Uint8Array) => ScannedSignature;

/** What the compose host's handlers are built from. */
export interface ComposeHandlerParts {
  /** How this process reads a scanned signature, or `null` without the native library — `optimize`'s rule. */
  readonly signatureFromScan: SignatureScanner | null;
  /** How this process keeps inline images, or `null` without the native library — `optimize`'s rule. */
  readonly keepInlineImages: InlineImageKeeper | null;
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
  /**
   * The faces this process sets text in, read the first time a text source is composed. It THROWS where the host was
   * started without its fonts, which is a fault of the build and never an answer about a person's file.
   */
  readonly faces: () => FaceSource;
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
  faces,
  files,
  keepInlineImages,
  optimize,
  probe,
  signatureFromScan,
}: ComposeHandlerParts): Handlers<ComposeChannels> {
  // THE MISS IS RETURNED, NEVER THROWN — `engineHandlers.ts`' rule: a throw
  // crossing this boundary becomes `internal` with its diagnostic withheld, and a
  // missing area is a code main can act on.
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;

  /** A source main wrote into the area, or `null` where it is not there — the transport's miss, not the file's. */
  const readSource = async (held: HostArea, name: string): Promise<Uint8Array | null> => {
    try {
      return await files.readSnapshot(held.snapshotDirectory, name);
    } catch {
      return null;
    }
  };

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

      let composed: ComposedSource;
      try {
        composed = await composer(source, page, faces());
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

      const bytes = await files.writeOutput(held.outputDirectory, into, composed.pdf);
      // THE FIRST PLACES NAMED, THE REST COUNTED: a source can hold a box on every line, and the frame cannot.
      return {
        ok: true,
        value: {
          kind: 'composed',
          bytes,
          // THE ONE CAP (`cappedBoxes`), which the PDFium host's answer takes too: two would cut a list two ways.
          ...cappedBoxes({ boxed: composed.boxed, more: 0 }),
        },
      };
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
    'engine/optimize': async ({ session, from, password, into, quality, over, to }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      if (optimize === null) return { ok: true, value: { kind: 'unavailable' } };

      const answer = await optimize(held, from, into, { quality, over, to }, password ?? undefined);
      if (answer.kind !== 'optimized') {
        return answer.kind === 'missing'
          ? { ok: false, error: { code: 'asset-missing' } }
          : { ok: true, value: { kind: 'unreadable' } };
      }
      return { ok: true, value: { kind: 'optimized', bytes: answer.bytes } };
    },

    // A WORKBOOK'S OUTLINE AND PARTS (decision C, `workbookParts.ts`): a file main did not write is the transport's, a
    // package this reader cannot use is `unreadable`, and a print area it cannot narrow is `unsplittable` — each an
    // answer main names to the person, never a fault.
    'engine/workbook-outline': async ({ session, from }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      const source = await readSource(held, from);
      if (source === null) return { ok: false, error: { code: 'asset-missing' } };
      try {
        return { ok: true, value: { kind: 'outline', sheets: [...workbookOutline(source)] } };
      } catch (error) {
        if (error instanceof WorkbookUnreadable) return { ok: true, value: { kind: 'unreadable' } };
        throw error;
      }
    },

    'engine/workbook-part': async ({ session, from, into, sheet, rows }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      const source = await readSource(held, from);
      if (source === null) return { ok: false, error: { code: 'asset-missing' } };
      let part: Uint8Array | null;
      try {
        part = workbookPart(source, sheet, rows);
      } catch (error) {
        if (error instanceof WorkbookUnsplittable) return { ok: true, value: { kind: 'unsplittable' } };
        if (error instanceof WorkbookUnreadable) return { ok: true, value: { kind: 'unreadable' } };
        throw error;
      }
      if (part === null) return { ok: true, value: { kind: 'nothing' } };
      return { ok: true, value: { kind: 'written', bytes: await files.writeOutput(held.outputDirectory, into, part) } };
    },

    // A PICTURE'S SIZE (ADR-0135): the transport's miss returned as a code, a header the reader cannot use, or one
    // stating a side past what a conforming file can, answered `unreadable` — the file's, never a fault.
    'engine/image-size': async ({ session, from, mediaType }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      const source = await readSource(held, from);
      if (source === null) return { ok: false, error: { code: 'asset-missing' } };
      const size = await pictureSize(source, mediaType);
      if (size === null || size.width > MAX_PICTURE_SIDE || size.height > MAX_PICTURE_SIDE) {
        return { ok: true, value: { kind: 'unreadable' } };
      }
      return { ok: true, value: { kind: 'sized', width: size.width, height: size.height } };
    },

    // A SCANNED SIGNATURE (`signatureScan.ts`): the transport's miss returned as a code, the library's absence answered,
    // the file's own answers passed on, and the picture written into the area with its count.
    'engine/signature-from-scan': async ({ session, from, into }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      if (signatureFromScan === null) return { ok: true, value: { kind: 'unavailable' } };
      const source = await readSource(held, from);
      if (source === null) return { ok: false, error: { code: 'asset-missing' } };
      const scanned = signatureFromScan(source);
      if (scanned.kind !== 'drawn') return { ok: true, value: { kind: scanned.kind } };
      const bytes = await files.writeOutput(held.outputDirectory, into, scanned.png);
      return { ok: true, value: { kind: 'drawn', bytes, width: scanned.width, height: scanned.height } };
    },

    'engine/pdf-pages': async ({ session, from }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      const source = await readSource(held, from);
      if (source === null) return { ok: false, error: { code: 'asset-missing' } };
      const pages = await pdfPageCount(source);
      return { ok: true, value: pages === null ? { kind: 'unreadable' } : { kind: 'counted', pages } };
    },

    // EACH PART READ WHEN IT IS JOINED, not all first, so the host holds the joined document and one part at a time. A
    // part main did not write stops the reading, and what was joined before it is dropped.
    'engine/join-pdfs': async ({ session, from, into }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      // AN OBJECT, read after the join: a `let` set inside the generator is one the compiler narrows to its first value
      // across the call, and the check after it would read as dead.
      const read = { absent: false };
      async function* parts(area: HostArea): AsyncIterable<Uint8Array> {
        for (const name of from) {
          const source = await readSource(area, name);
          if (source === null) {
            read.absent = true;
            return;
          }
          yield source;
        }
      }
      const joined = await joinPdfs(parts(held));
      if (read.absent) return { ok: false, error: { code: 'asset-missing' } };
      if (!('pdf' in joined)) return { ok: true, value: { kind: 'unreadable', item: joined.unreadable } };
      return {
        ok: true,
        value: { kind: 'joined', bytes: await files.writeOutput(held.outputDirectory, into, joined.pdf), pages: [...joined.pages] },
      };
    },

    // `engine/optimize`'s three decisions, over the inline-image keeper (ADR-0126).
    'engine/keep-inline-images': async ({ session, from, password, into, scope }) => {
      const held = areas.lookup(session);
      if (held === undefined) return gone;
      if (keepInlineImages === null) return { ok: true, value: { kind: 'unavailable' } };

      const answer = await keepInlineImages(held, from, into, scope, password ?? undefined);
      switch (answer.kind) {
        case 'missing':
          return { ok: false, error: { code: 'asset-missing' } };
        case 'unreadable':
          return { ok: true, value: { kind: 'unreadable' } };
        case 'unchanged':
          return { ok: true, value: { kind: 'unchanged', left: answer.left } };
        case 'kept':
          return {
            ok: true,
            value: { kind: 'kept', bytes: answer.bytes, converted: answer.converted, left: answer.left },
          };
      }
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
      // AN IMAGE DRAWS NO TEXT, so it boxes nothing.
      return { ok: true, value: { kind: 'composed', bytes, boxed: [], more: 0 } };
    },
  };
}
