import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { PDFDataRangeTransport } from 'pdfjs-dist';

/**
 * The renderer's side of ARCHITECTURE §2's byte-range read
 * ([ADR-0031](../../../docs/DECISIONS/0031-the-renderer-reads-the-document-by-demand-paged-ranges.md)).
 *
 * PDF.js drives this: it asks for the byte ranges it needs and this turns each
 * ask into one `document.readRange` query. Nothing here decides what to fetch,
 * and that is the design — the parser knows which objects a page needs and the
 * renderer does not.
 */

/**
 * What a transport does when the version it is bound to has moved.
 *
 * A callback rather than an event or a thrown error. Byte offsets are meaningful
 * only inside one version, so a transport whose version moved has nothing useful
 * left to do — every answer it could give is from the wrong document. The owner
 * rebuilds it, and telling the owner is the only thing this can usefully do.
 */
export type OnVersionMoved = (moved: {
  readonly version: DocVersion;
  readonly byteLength: number;
}) => void;

/**
 * Serves PDF.js's byte-range reads from main, for one `DocVersion`.
 *
 * ## Why it aborts rather than retrying when the version moves
 *
 * The tempting behaviour is to rebind to the new version and answer. It is
 * wrong: the offsets in flight were computed from the old version's
 * cross-reference table, so answering them out of the new bytes hands the parser
 * a document assembled from two versions — the corruption ADR-0031's Decision 2
 * exists to prevent, arriving one layer up from the guard that prevents it. The
 * only correct response is to stop and let the owner build a new one.
 */
export class DocumentRangeTransport extends PDFDataRangeTransport {
  readonly #client: ContractClient;
  readonly #docId: DocId;
  readonly #version: DocVersion;
  readonly #onVersionMoved: OnVersionMoved;
  #aborted = false;

  constructor(options: {
    readonly client: ContractClient;
    readonly docId: DocId;
    readonly version: DocVersion;
    readonly byteLength: number;
    readonly onVersionMoved: OnVersionMoved;
  }) {
    // `null` initial data, and no progressive read is ever pushed. That is what
    // makes this demand-only BY CONSTRUCTION rather than by an option: with no
    // progressive data the full reader has nothing to deliver, so there is no
    // background stream of the whole document to disable. Measured — setting
    // `disableAutoFetch` and `disableStream` to false changes the byte counts
    // not at all.
    // The fourth parameter is a content-disposition filename and is omitted
    // rather than passed as null: the renderer holds no path and no name for the
    // document, which is invariant L2 rather than an oversight — and the
    // declarations type it `string | undefined`, so there is nothing to widen.
    super(options.byteLength, null, false);
    this.#client = options.client;
    this.#docId = options.docId;
    this.#version = options.version;
    this.#onVersionMoved = options.onVersionMoved;
  }

  /** Whether this transport has stopped answering. */
  get aborted(): boolean {
    return this.#aborted;
  }

  override requestDataRange(begin: number, end: number): void {
    if (this.#aborted) return;

    void this.#serve(begin, end);
  }

  override abort(): void {
    this.#aborted = true;
  }

  async #serve(begin: number, end: number): Promise<void> {
    const answer = await this.#client['document.readRange']({
      docId: this.#docId,
      version: this.#version,
      begin,
      end,
    });

    // A LATE ANSWER TO AN ABORTED TRANSPORT IS DROPPED. `abort` can land while a
    // query is in flight, and `onDataRange` on a torn-down reader throws inside
    // PDF.js — which surfaces as a parse failure on the *next* document rather
    // than as anything naming this one.
    if (this.#aborted) return;

    if (!answer.ok) {
      // The document closed underneath the view. Nothing to answer with, and
      // nothing to report as a version move either — this is not staleness, it
      // is absence, and conflating them would have the owner rebuild a transport
      // for a document that is gone.
      this.#aborted = true;
      return;
    }

    if (answer.value.kind === 'stale') {
      this.#aborted = true;
      this.#onVersionMoved({
        version: answer.value.version,
        byteLength: answer.value.byteLength,
      });
      return;
    }

    // EXACTLY ONE CALL PER RANGE. Measured: splitting a range across several
    // `onDataRange` calls throws `no PDFDataTransportStreamRangeReader instance
    // found`, because the reader completes and is deleted after the first. The
    // bound on what one call may carry is `MAX_RANGE_BYTES`, enforced at the
    // boundary, and it is why this cannot be softened by chunking here.
    this.onDataRange(begin, answer.value.bytes);
  }
}
