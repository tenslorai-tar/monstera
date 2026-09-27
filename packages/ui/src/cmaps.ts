/**
 * PDF.js's predefined CMaps, from the bundle and never from a fetch (the Stage 1 row owed before release; the owner's
 * 27 September list, item 9).
 *
 * ## Why text could not be decoded before this
 *
 * A PDF may set text in a font it does not embed, naming a **predefined CMap** — `UniJIS-UCS2-H`, `GBK-EUC-H` and the
 * like, mostly for Chinese, Japanese and Korean — to turn its bytes into characters. PDF.js ships those CMaps as 168
 * packed `.bcmap` files and loads one when a document names it. This renderer gave it no `cMapUrl`, and the CSP's
 * `connect-src 'none'` refuses the fetch it would have made anyway, so such text drew as nothing and searched as
 * nothing.
 *
 * ## The route that keeps the CSP: PDF.js 6's `BinaryDataFactory`, fed from the bundle
 *
 * With `useWorkerFetch: false` the worker asks the main thread for each CMap by name, and the main thread answers
 * through the factory it was given. This factory answers from the bundle: every `.bcmap` is its own lazily imported
 * chunk (`import.meta.glob`), which `script-src 'self'` allows, decoded from base64 in memory. Nothing is fetched, the
 * policy is untouched, and a document that never names a CMap loads none — about 1.5 MB on disk, paid only by the
 * documents that need a part of it.
 *
 * `cMapUrl` is still required, and must end in a slash: PDF.js refuses to ask a factory without one. It is a name, not
 * an address; nothing resolves it.
 */

/** Each CMap's chunk, keyed by the path the glob found it at. */
const BCMAPS = import.meta.glob<string>('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?inline',
  import: 'default',
});

const PREFIX = '../../../node_modules/pdfjs-dist/cmaps/';

/** The `cMapUrl` PDF.js is given: a trailing slash its check needs, and nothing a fetch could reach. */
export const BUNDLED_CMAPS = 'bundled-cmaps/';

/** How many CMaps the bundle carries, for the case that says none went missing. */
export const BUNDLED_CMAP_COUNT = Object.keys(BCMAPS).length;

/** A `data:` URL's bytes. `?inline` gives base64, and `atob` decodes it without a fetch. */
function bytesOf(dataUrl: string): Uint8Array {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return bytes;
}

/**
 * The factory PDF.js constructs and asks — `BaseBinaryDataFactory`'s shape, which it takes by duck type. It answers
 * CMaps alone: the standard fonts and the WASM decoders are not bundled (`useWasm: false`, and the standard fonts are
 * drawn by the system's), so any other kind is refused by name rather than answered with nothing.
 */
export class BundledBinaryDataFactory {
  constructor(options: { readonly cMapUrl?: string | null }) {
    // PDF.js passes its urls; the one that matters is only ever the name above, and this refuses a different one so a
    // caller that meant a real address is told rather than silently answered from the bundle.
    if (options.cMapUrl !== undefined && options.cMapUrl !== null && options.cMapUrl !== BUNDLED_CMAPS) {
      throw new Error(`The bundled CMaps answer ${BUNDLED_CMAPS}, not ${options.cMapUrl}.`);
    }
  }

  async fetch({ kind, filename }: { readonly kind: string; readonly filename: string }): Promise<Uint8Array> {
    if (kind !== 'cMapUrl') throw new Error(`Only CMaps are bundled; ${kind} ${filename} is not.`);
    const load = BCMAPS[`${PREFIX}${filename}`];
    if (load === undefined) throw new Error(`No bundled CMap is called ${filename}.`);
    return bytesOf(await load());
  }
}
