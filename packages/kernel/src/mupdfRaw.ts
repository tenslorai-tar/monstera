import koffi, { type KoffiFunc } from 'koffi';

/**
 * The MuPDF native boundary: `monstera_mupdf.dll`, bound with koffi
 * ([ADR-0010](../../../docs/DECISIONS/0010-native-mupdf-through-an-ffi-shim.md),
 * [ADR-0087](../../../docs/DECISIONS/0087-optimize-is-mupdfs-native-image-rewriter-in-the-compose-host.md)).
 *
 * ## What it binds, and what it does not
 *
 * The exports Optimize calls and no more: a context, open, the image rewriter, the compacted
 * save, close. The document pipeline still reaches MuPDF through the WASM package, and moving it
 * here is the separate, unbuilt migration `docs/ARCHITECTURE.md` §3 records — a binding that grew
 * ahead of a caller would be a surface nothing exercises.
 *
 * ## Every call that can fail answers an int, and the message comes from the context
 *
 * The shim's rule (`native/mupdf-shim/README.md`): each `fz_try` lives inside one exported
 * function, so nothing unwinds through koffi's frames, and what crosses is `MZ_OK` or `MZ_ERR`
 * plus `mz_last_error`. So a failure here is a thrown {@link MupdfNativeError} carrying MuPDF's own
 * words, never a return value a caller could forget to read.
 *
 * ## It is told where the library is; it never decides
 *
 * `pdfiumFfi.ts`' rule: `scripts/provision/mupdf.mjs` owns where the DLL lives, and a second
 * resolver is the B3a defect. The host is started with the path and binds it once.
 *
 * ## Only the compose host imports this module
 *
 * Loading it loads a native library, which `main` never does (invariant 20); the kernel's barrel
 * does not re-export it, so `proof:kernelload` keeps holding for the barrel `main` imports.
 */

/** A native function as koffi hands it back, typed at this boundary rather than trusted. */
type Native = (...args: unknown[]) => unknown;

/** Narrows koffi's declared function to {@link Native}; both are callables over unknowns. */
function native(bound: KoffiFunc<Native>): Native {
  return bound;
}

/** MuPDF refused, in its own words. */
export class MupdfNativeError extends Error {
  constructor(
    readonly step: string,
    said: string,
  ) {
    super(`MuPDF could not ${step}: ${said}`);
    this.name = 'MupdfNativeError';
  }
}

/**
 * MuPDF could not OPEN the document — a fact about the document, such as its encryption, where
 * every later step's failure is a fault. A class of its own, so a caller tells the two apart by
 * type rather than by the wording of a step.
 */
export class MupdfOpenRefused extends MupdfNativeError {
  constructor(said: string) {
    super('open the document', said);
    this.name = 'MupdfOpenRefused';
  }
}

/** One setting of the image rewriter, in the shim's three integers. */
export interface ImageRewrite {
  /** JPEG quality for images stored lossy, 1 to 100. */
  readonly quality: number;
  /** Colour and grey images drawn above this many dpi are subsampled; 0 leaves resolution alone. */
  readonly over: number;
  /** The dpi they are subsampled to; below `over`, or 0 when `over` is. */
  readonly to: number;
}

interface Bound {
  readonly init: Native;
  readonly drop: Native;
  readonly lastError: Native;
  readonly open: Native;
  readonly close: Native;
  readonly rewriteImages: Native;
  readonly saveCompacted: Native;
}

/**
 * The bound library, or `undefined` before {@link openMupdfShim} has run. Module state for
 * `pdfiumFfi.ts`' reason: a process loads one copy of a DLL, so two bindings would be a fiction.
 */
let bound: Bound | undefined;

/**
 * Binds `monstera_mupdf.dll`. Idempotent.
 *
 * @param libraryPath the absolute path the caller resolved
 */
export function openMupdfShim(libraryPath: string): void {
  if (bound !== undefined) return;
  const library = koffi.load(libraryPath);
  bound = {
    init: native(library.func('int mz_init(_Out_ void **out)')),
    drop: native(library.func('void mz_drop(void *c)')),
    lastError: native(library.func('const char *mz_last_error(void *c)')),
    open: native(library.func('int mz_open(void *c, const char *path, _Out_ void **out)')),
    close: native(library.func('int mz_close(void *c, void *d)')),
    rewriteImages: native(library.func('int mz_rewrite_images(void *c, void *d, int quality, int over, int to)')),
    saveCompacted: native(library.func('int mz_save_compacted(void *c, void *d, const char *path)')),
  };
}

/**
 * Rewrites the images of the PDF at `input` and writes the result, compacted, to `output`.
 *
 * Both are paths inside the directories this process was granted; the caller composed them from
 * names it validated, and this function opens nothing else. A context per call, dropped in
 * `finally`, so a failure leaves no MuPDF state behind for the next document.
 *
 * @throws {MupdfNativeError} where MuPDF refused a step, with its message
 */
export function rewriteImages(input: string, output: string, setting: ImageRewrite): void {
  const api = bound;
  if (api === undefined) throw new Error('the MuPDF shim is not bound in this process; openMupdfShim was not called');

  const context: unknown[] = [null];
  if (api.init(context) !== 0) throw new MupdfNativeError('create a context', 'mz_init failed');
  const c = context[0];
  const said = (): string => String(api.lastError(c));
  try {
    const document: unknown[] = [null];
    if (api.open(c, input, document) !== 0) throw new MupdfOpenRefused(said());
    const d = document[0];
    try {
      if (api.rewriteImages(c, d, setting.quality, setting.over, setting.to) !== 0) {
        throw new MupdfNativeError('rewrite the images', said());
      }
      if (api.saveCompacted(c, d, output) !== 0) throw new MupdfNativeError('save the copy', said());
    } finally {
      api.close(c, d);
    }
  } finally {
    api.drop(c);
  }
}
