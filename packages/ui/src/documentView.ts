import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// `?url` rather than a bare specifier: Vite emits the worker as its own asset
// and gives back a relative URL, which is what a `file://` document needs. A
// bare import would inline the whole parser into the main bundle and run it on
// the UI thread.
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

import { DocumentRangeTransport, type OnVersionMoved } from './documentTransport.js';

/**
 * One open document, as the renderer sees it.
 *
 * PDF.js is **presentation only** (invariant L4). Nothing here is a source of
 * truth about the document: the annotation and form models come from the
 * kernel, and what this owns is a parser pointed at bytes main serves.
 *
 * ## The worker starts under invariant 27's policy — measured, not assumed
 *
 * The pinned CSP is `default-src 'none'` with no `worker-src`, and `worker-src`
 * falls back through `child-src` to `default-src`, so the expectation was that
 * Chromium would refuse one. It does not: measured 2026-08-29 on Electron
 * 43.4.1 against a `file://` document under the exact pinned policy, a module
 * worker started and posted a message. The reading separates because the same
 * probe under `worker-src 'none'` — everything else identical — got an error
 * instead. No amendment is owed, and the alternative it avoids is real: PDF.js
 * falls back to parsing on the UI thread when it cannot have a worker, which
 * would freeze the window for the whole of a large document's parse.
 */

/**
 * The worker's URL, set once for the process.
 *
 * A module-level assignment rather than an exported `configure()` a caller must
 * remember: PDF.js reads this global when a document is opened, so a caller who
 * forgot would get the silent fallback above rather than an error. This module
 * is the only thing that opens a document, so it is the one writer (B3).
 */
GlobalWorkerOptions.workerSrc = workerUrl;

export interface DocumentView {
  /** The parser's handle. Presentation only. */
  readonly document: PDFDocumentProxy;
  /** The version the bytes behind it belong to. */
  readonly version: DocVersion;
  /**
   * Tears down the parser, its worker and the transport.
   *
   * Idempotent, because a view is closed both by the document closing and by a
   * version moving underneath it, and those can race.
   */
  close(): Promise<void>;
}

/**
 * Opens a document for viewing, reading its bytes on demand from main.
 *
 * @param onVersionMoved Called when a command bumped the version underneath this
 *   view. The caller reopens; this view is already aborted and is not reusable,
 *   because its byte offsets belong to a document that no longer exists.
 */
export async function openDocumentView(options: {
  readonly client: ContractClient;
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
  readonly onVersionMoved: OnVersionMoved;
}): Promise<DocumentView> {
  const transport = new DocumentRangeTransport(options);

  const task = getDocument({
    range: transport,
    // ICC colour management is unavailable under this CSP and that is settled:
    // `qcms` arrives by a synchronous XHR, which `connect-src 'none'` refuses
    // before WebAssembly is ever reached. `useWorkerFetch: false` closes the
    // path one step earlier, and PDF.js falls back by `/Alternate` or `/N`.
    useWorkerFetch: false,
    // Measured refused in the window AND in a worker under this policy, so the
    // shipped `*_nowasm_fallback.js` decoders are what run.
    useWasm: false,
    // No `isEvalSupported: false`: this version's `DocumentInitParameters` has
    // no such field, and asking for it is redundant anyway — `proof:rendererpolicy`
    // reads back a `script-src` violation for `new Function`, so the policy
    // already refuses what the option would have declined.
  });

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    transport.abort();
    await task.destroy();
  };

  try {
    const document = await task.promise;
    return { document, version: options.version, close };
  } catch (cause) {
    // The task owns a worker whether or not it produced a document, so a failed
    // open that did not destroy it leaks one per attempt — and a leaked worker
    // is invisible until the machine is out of them.
    await close();
    throw cause;
  }
}
