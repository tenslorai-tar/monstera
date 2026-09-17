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
 * ## The runtime ships; only the models are downloaded
 *
 * ONNX Runtime Web's three files are provisioned with the application
 * (`scripts/provision/onnxruntime.mjs`, pinned there) and the host loads them from
 * that directory — the owner's decision, ADR-0052's 2026-09-17 correction, so the
 * feature's code never arrives from a CDN at run time. This manifest names them
 * and holds no URL for them. The models stay on demand: 67 MB at the smallest.
 * ([ADR-0052](../../../docs/DECISIONS/0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)).
 *
 * ## Every URL is IMMUTABLE
 *
 * A HuggingFace **revision sha**, never `main`. A digest pinned against a moving
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
 * The ONNX Runtime's three files, by name, in the provisioned runtime directory.
 *
 * `api` is the API and the WASM backend; `factory` and `binary` are the Emscripten
 * factory and its WASM. The *threaded* build is the one the package ships for the
 * CPU backend and it runs single-threaded here — measured 2026-09-11,
 * `numThreads > 1` fails in Node because the threaded build fetches its worker
 * through a URL the file scheme does not satisfy, which is recorded as unmeasured
 * headroom rather than worked around. The digests are the provisioner's;
 * `scripts/proofs/ocrHandwriting.proof.mjs` holds these names equal to the files it
 * provisions, on every run, because neither side may import the other.
 */
export const RUNTIME_FILES = {
  api: 'ort.wasm.min.mjs',
  factory: 'ort-wasm-simd-threaded.mjs',
  binary: 'ort-wasm-simd-threaded.wasm',
} as const;

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
 * **Both entries are needed, and the second was missing until 2026-09-17.**
 * HuggingFace answers a model's `resolve` URL with a redirect to a regional CDN
 * host under `hf.co` — read that day with a `HEAD` on the small encoder: `302` to
 * `us.aws.cdn.hf.co`. `verifiedDownload.ts` gained `*.hf.co` wildcards for exactly
 * that host on 2026-09-11 and this list never used one: it named
 * `cdn.jsdelivr.net`, which served the runtime, so every model download would have
 * been refused at the hop that delivers the bytes. The runtime no longer downloads.
 */
export const HANDWRITING_HOSTS: readonly string[] = ['huggingface.co', '*.hf.co'];

/** Every file one size downloads — its encoder, decoder and tokenizer. */
export function artefactsFor(size: TrocrSize): readonly HandwritingArtefact[] {
  const model = HANDWRITING_MODELS[size];
  return [model.encoder, model.decoder, model.tokenizer];
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
