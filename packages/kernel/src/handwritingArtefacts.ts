import type { TrocrSize } from '@monstera/contract';

/**
 * Every file the handwriting recogniser needs, where it comes from, and the
 * SHA-256 it must have — **one place, read by main and by the host**.
 *
 * ## Why the manifest is shared rather than stated twice
 *
 * Main downloads (invariant 25 gives the host no network) and the host loads. If
 * each side spelt the filenames itself, a rename would be a file main writes and
 * the host cannot find — a second opinion about what the cache contains (B3a),
 * whose symptom is the feature quietly reporting that the model is missing.
 *
 * This module holds **data and pure functions only**. It imports no engine and
 * no runtime, so main reaches it through the kernel barrel without loading
 * anything ONNX.
 *
 * ## Nothing here is bundled, and that survived being priced
 *
 * `BUILD-PROMPT.md`:806 keeps this stack out of the installer as *a 200+ MB
 * runtime serving one niche feature*. That figure is `onnxruntime-node`'s and is
 * exact; the runtime a run needs is the WASM one at 13,961,845 bytes, 6.3% of
 * it. Bundling it anyway removes **no mechanism** — the models are 67 MB at the
 * smallest, so the downloader, the digests, the cache and the clear-caches
 * control exist whatever the runtime does
 * ([ADR-0052](../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)).
 *
 * The two JavaScript files are 74,344 bytes together and are downloaded for the
 * same reason rather than vendored: shipping them means either a 142 MB
 * dependency in every `npm ci` or third-party source committed to this tree,
 * against a fetch that invariant 9 already governs — the mechanism that puts
 * Electron's own binary on this machine.
 *
 * ## Every URL is IMMUTABLE
 *
 * A HuggingFace **revision sha**, never `main`; a pinned npm version on a CDN
 * that serves the registry tarball's own files. A digest pinned against a moving
 * URL is a download that starts failing on somebody else's schedule.
 */

/** Which detokeniser a model's ids need. Measured per repository, not assumed. */
export type TokenizerFamily = 'unigram-metaspace' | 'bpe-bytelevel';

export interface HandwritingArtefact {
  /** The name this file has in the cache directory. */
  readonly file: string;
  /** An immutable HTTPS URL. */
  readonly url: string;
  /** Lowercase hex SHA-256 of the exact bytes. */
  readonly sha256: string;
  /** Exact byte length, which is also the download's ceiling. */
  readonly bytes: number;
}

/**
 * The ONNX Runtime, as three files.
 *
 * `ort.wasm.min.mjs` is the API and the WASM backend; `ort-wasm-simd-threaded`
 * is the Emscripten factory and its binary. The *threaded* build is the one the
 * package ships for the CPU backend and it runs single-threaded here — measured
 * 2026-09-11, `numThreads > 1` fails in Node because the threaded build fetches
 * its worker through a URL the file scheme does not satisfy, which is recorded
 * as unmeasured headroom rather than worked around.
 */
export const RUNTIME_ARTEFACTS: readonly HandwritingArtefact[] = [
  {
    file: 'ort.wasm.min.mjs',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort.wasm.min.mjs',
    sha256: '14a0a63ad1a0fe8127722929fd16fb26c2e5352ea221bc9034d12daf314d0b92',
    bytes: 50126,
  },
  {
    file: 'ort-wasm-simd-threaded.mjs',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort-wasm-simd-threaded.mjs',
    sha256: '5a15f1fd086b3f6c2baf1f35105b8f502653b567e165cef80028870b39748747',
    bytes: 24218,
  },
  {
    file: 'ort-wasm-simd-threaded.wasm',
    url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort-wasm-simd-threaded.wasm',
    sha256: 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d',
    bytes: 13961845,
  },
];

/** One model's files and how its ids detokenise. */
export interface HandwritingModel {
  readonly size: TrocrSize;
  readonly encoder: HandwritingArtefact;
  readonly decoder: HandwritingArtefact;
  readonly tokenizer: HandwritingArtefact;
  readonly family: TokenizerFamily;
}

const SMALL_REVISION = '2432e24d184b1d964d07ed04f5d9e21d31a59141';
const BASE_REVISION = 'e301d1c4c4d4ece88f164518eb7aee07062eaca2';

/** `https://huggingface.co/<repo>/resolve/<revision>/<path>` — never a branch. */
function huggingFace(repo: string, revision: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${path}`;
}

/**
 * The two models, quantised.
 *
 * **`small` is what a first run gets**: 67 MB against 339, and its encoder is a
 * quarter of the other's. `base` stays available because the founding record
 * names both sizes and puts the choice in settings.
 *
 * ## Where the digests came from, and the difference between the two sets
 *
 * `small`'s were **computed from the bytes** on 2026-09-11, and they matched
 * HuggingFace's own published LFS `oid` for both ONNX files exactly. `base`'s
 * ONNX digests are that published `oid` and no run has hashed those bytes here —
 * 339 MB fetched to compute a figure the API already states, where the first
 * real download is what tests it and fails loudly if the two disagree. The
 * distinction is written down rather than smoothed over: one set is measured and
 * one is the registry's claim, validated twice by the set that is both.
 *
 * The tokenizers are ordinary git blobs rather than LFS, so both were hashed
 * here.
 */
export const HANDWRITING_MODELS: Readonly<Record<TrocrSize, HandwritingModel>> = {
  small: {
    size: 'small',
    encoder: {
      file: 'small-encoder.onnx',
      url: huggingFace(
        'Xenova/trocr-small-handwritten',
        SMALL_REVISION,
        'onnx/encoder_model_quantized.onnx',
      ),
      sha256: '2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03',
      bytes: 23082942,
    },
    decoder: {
      file: 'small-decoder.onnx',
      url: huggingFace(
        'Xenova/trocr-small-handwritten',
        SMALL_REVISION,
        'onnx/decoder_model_quantized.onnx',
      ),
      sha256: '40166e4f975b3cecd24bb422db80eb06912777c8e8a56ab44f6bd771ec5df553',
      bytes: 40159904,
    },
    tokenizer: {
      file: 'small-tokenizer.json',
      url: huggingFace('Xenova/trocr-small-handwritten', SMALL_REVISION, 'tokenizer.json'),
      sha256: '68bcb5468c854362a615f3d2ff6a5e4091a85f4c8198993ed9a30afe0b143737',
      bytes: 4494727,
    },
    family: 'unigram-metaspace',
  },
  base: {
    size: 'base',
    encoder: {
      file: 'base-encoder.onnx',
      url: huggingFace(
        'Xenova/trocr-base-handwritten',
        BASE_REVISION,
        'onnx/encoder_model_quantized.onnx',
      ),
      sha256: '8689f7a6122816789922e2e4f1063646ab69396ad0d1144437bba95dcbab5c86',
      bytes: 88082928,
    },
    decoder: {
      file: 'base-decoder.onnx',
      url: huggingFace(
        'Xenova/trocr-base-handwritten',
        BASE_REVISION,
        'onnx/decoder_model_quantized.onnx',
      ),
      sha256: '83ead15ae5a4a2875d58a86116254e5a1e93daf2cc47387ae8faca39d72795a5',
      bytes: 248853923,
    },
    tokenizer: {
      file: 'base-tokenizer.json',
      url: huggingFace('Xenova/trocr-base-handwritten', BASE_REVISION, 'tokenizer.json'),
      sha256: '2f1a555a1ee93656b4e6f67aa75d492a843c225e5ef754bae24c36bd85851cd7',
      bytes: 2108614,
    },
    family: 'bpe-bytelevel',
  },
};

/**
 * Every host a handwriting download may touch, on the first request and on every
 * redirect hop.
 *
 * Two entries and both are needed: HuggingFace answers a `resolve` URL with a
 * redirect to its CDN, so a list naming only the first would refuse every model
 * download at the hop that delivers the bytes.
 */
export const HANDWRITING_HOSTS: readonly string[] = ['huggingface.co', 'cdn.jsdelivr.net'];

/** Every artefact one size needs, runtime included, in no particular order. */
export function artefactsFor(size: TrocrSize): readonly HandwritingArtefact[] {
  const model = HANDWRITING_MODELS[size];
  return [...RUNTIME_ARTEFACTS, model.encoder, model.decoder, model.tokenizer];
}

/**
 * What one size costs to fetch, for a surface that has to ask before spending it.
 *
 * A reader agreeing to a download is agreeing to a number, and the honest number
 * is what is **missing** rather than the total — which is why the caller passes
 * the artefacts it still needs rather than a size.
 */
export function totalBytes(artefacts: readonly HandwritingArtefact[]): number {
  return artefacts.reduce((sum, artefact) => sum + artefact.bytes, 0);
}
