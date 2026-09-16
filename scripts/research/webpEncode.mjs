// @ts-check
/**
 * Does `@jsquash/webp` encode under Node, and by which loading route?
 *
 * ## The question, and why it was answered before the feature
 *
 * [ADR-0070](../../docs/DECISIONS/0070-a-page-image-is-encoded-as-webp-by-libwebps-wasm-in-the-engine-host.md)
 * puts the WebP encoder in the engine host, which runs the Electron binary in
 * Node mode. The package documents a browser: its Emscripten glue locates the
 * `.wasm` beside itself by URL. So the question is not *does it encode* — it is
 * **which of its routes works where the host runs**.
 *
 * - `default`: the package's own loader, with nothing handed in.
 * - `binary`: the package's own `.wasm` bytes read here and passed to `init` as
 *   Emscripten's `wasmBinary`, with the build (SIMD or not) chosen by
 *   `wasm-feature-detect`'s `simd()` — the detector `encode.js` itself calls.
 *
 * A third route — a compiled `WebAssembly.Module` handed to `init` — also works,
 * and is not measured here because it is not writable in this build: the
 * TypeScript libraries are ES2023 and Node's, and neither declares a
 * `WebAssembly` value. ADR-0070 records why that decides it.
 *
 * ## The output is DECODED BACK, not trusted
 *
 * Bytes coming out is the reassuring answer, and a zero-length buffer would
 * produce it. The result must carry `RIFF` and `WEBP` in its header, and the
 * package's own decoder must read it back at the size encoded, with the worst
 * channel error printed so a lossy encode is visible as lossy.
 *
 * Measured 2026-09-16 on Node 24.12.0: `default` throws `TypeError: fetch
 * failed`; `binary` initialises from `webp_enc_simd.wasm`, prints `RIFF WEBP`,
 * and decodes back at 64×48.
 *
 * Usage: node scripts/research/webpEncode.mjs default|binary
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import decode, { init as initDecode } from '@jsquash/webp/decode.js';
import encode, { init as initEncode } from '@jsquash/webp/encode.js';
import { simd } from 'wasm-feature-detect';

const route = process.argv[2];
if (route !== 'default' && route !== 'binary') {
  process.stderr.write('Usage: node scripts/research/webpEncode.mjs default|binary\n');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const width = 64;
const height = 48;
const rgba = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 4;
    rgba[at] = x * 4;
    rgba[at + 1] = y * 5;
    rgba[at + 2] = x < width / 2 ? 255 : 0;
    rgba[at + 3] = 255;
  }
}

if (route === 'binary') {
  const encoderPath = (await simd())
    ? require.resolve('@jsquash/webp/codec/enc/webp_enc_simd.wasm')
    : require.resolve('@jsquash/webp/codec/enc/webp_enc.wasm');
  // `wasmBinary` is an Emscripten module option the glue reads; the package's
  // declared option type names only `locateFile` and `instantiateWasm`, so the
  // object is widened through a variable rather than cast at the call.
  /** @type {Record<string, unknown>} */
  const encoderOptions = { wasmBinary: readFileSync(encoderPath) };
  await initEncode(encoderOptions);
  /** @type {Record<string, unknown>} */
  const decoderOptions = { wasmBinary: readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm')) };
  await initDecode(decoderOptions);
  console.log(`initialised from ${encoderPath.slice(encoderPath.lastIndexOf('codec'))}`);
}

const started = performance.now();
const encoded = new Uint8Array(await encode({ data: rgba, width, height, colorSpace: 'srgb' }, { quality: 80 }));
console.log(`route ${route}: ${String(encoded.length)} bytes in ${(performance.now() - started).toFixed(1)} ms`);

const riff = Buffer.from(encoded.subarray(0, 4)).toString('latin1');
const webp = Buffer.from(encoded.subarray(8, 12)).toString('latin1');
if (riff !== 'RIFF' || webp !== 'WEBP') {
  throw new Error(`the output is not a WebP file: header reads ${JSON.stringify(riff)} … ${JSON.stringify(webp)}`);
}

const back = await decode(encoded.buffer);
if (back.width !== width || back.height !== height) {
  throw new Error(`decoded ${String(back.width)}×${String(back.height)}, encoded ${String(width)}×${String(height)}`);
}
let worst = 0;
for (let index = 0; index < rgba.length; index += 1) {
  worst = Math.max(worst, Math.abs((rgba[index] ?? 0) - (back.data[index] ?? 0)));
}
console.log(`header ${riff} ${webp}; decoded ${String(back.width)}×${String(back.height)}; worst channel error ${String(worst)}`);
