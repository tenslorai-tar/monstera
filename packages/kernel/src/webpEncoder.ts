import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import encode, { init } from '@jsquash/webp/encode.js';
import { simd } from 'wasm-feature-detect';

/**
 * WebP bytes for an RGBA image — §3's *Page image → WebP encoding* row.
 *
 * libwebp compiled to WASM, executing wherever the rasteriser that fed it runs:
 * the engine host
 * ([ADR-0070](../../../docs/DECISIONS/0070-a-page-image-is-encoded-as-webp-by-libwebps-wasm-in-the-engine-host.md)).
 *
 * ## The WASM arrives as BYTES, never by the package's own loader
 *
 * The package's Emscripten glue locates its `.wasm` by URL and fetches it,
 * which throws `fetch failed` under Node — measured 2026-09-16 by
 * `scripts/research/webpEncode.mjs`. Emscripten's `wasmBinary` option hands
 * the glue the bytes instead, so it compiles them itself and fetches nothing;
 * the host has no network and needs none here.
 *
 * ## Which build is `wasm-feature-detect`'s answer, not ours
 *
 * The package ships a SIMD encoder and a plain one, and `encode.js` picks
 * between them with `simd()`. The bytes handed in must be the build its glue
 * then loads, so this asks the same detector rather than holding an opinion
 * about the runtime (B3a). Asking it differently would hand SIMD bytes to the
 * plain glue, or the reverse, and fail at instantiation.
 */
export async function encodeWebp(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  quality: number,
): Promise<Uint8Array> {
  await initialised();
  return new Uint8Array(await encode({ data: rgba, width, height, colorSpace: 'srgb' }, { quality }));
}

let initialising: Promise<unknown> | undefined;

/** Loads the encoder once per process; a failed load is retried by the next call. */
function initialised(): Promise<unknown> {
  initialising ??= load().catch((cause: unknown) => {
    initialising = undefined;
    throw cause;
  });
  return initialising;
}

async function load(): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const path = (await simd())
    ? require.resolve('@jsquash/webp/codec/enc/webp_enc_simd.wasm')
    : require.resolve('@jsquash/webp/codec/enc/webp_enc.wasm');
  // `wasmBinary` is an Emscripten module option the glue reads. The package's
  // declared option type cannot be named here: it refers to the DOM's
  // `WebAssembly` types, which this build's libraries do not declare, so it
  // resolves to `any` and would check nothing. The shape is written out instead.
  const options: { readonly wasmBinary: Uint8Array } = { wasmBinary: readFileSync(path) };
  return await init(options);
}
