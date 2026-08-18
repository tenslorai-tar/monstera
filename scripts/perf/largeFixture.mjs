// @ts-check
/**
 * Generates the large document the Stage 0 performance gate measures against.
 *
 * Not committed, by policy: a fixture past the pre-commit size guard is
 * generated deterministically at test time (invariant L15, and the guard would
 * reject it anyway). It is written straight to disk rather than assembled in
 * memory, because a generator that needs 200 MB of heap to produce a 200 MB
 * file would be competing with the thing being measured.
 *
 * ## Why a stream-heavy shape, and what it does not cover
 *
 * Content is the driver, not file size — that was measured, and it is why the
 * budgets are stated per process rather than as one whole-application ratio. An
 * image-heavy 405 MB document with 53 objects peaked at 3.71x under WASM, while
 * an object-dense 28 MB document with 127K objects peaked at 20.9x. Two shapes
 * of the same size are not interchangeable evidence.
 *
 * This generator produces the STREAM-heavy shape: few objects, large content
 * streams. It is the shape the gate names, and it is deliberately NOT the whole
 * story — `objectCount` produces the dense shape, and a budget argued only
 * against the easy shape is the stage-audit's second item.
 *
 * ## Determinism
 *
 * Byte-identical across runs and platforms: the page content is a fixed pattern
 * repeated, with no clock, no randomness and no path baked in. A cached fixture
 * is reused only when the generator that produced it is unchanged, keyed the way
 * every other cached verdict in this repository is keyed — the alternative is a
 * fixture produced by code nobody has run in weeks, which is the stale-DLL
 * problem wearing a different hat.
 */

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where generated fixtures live. Gitignored. */
export function fixtureDirectory(root = repoRoot()) {
  return join(root, 'packages', 'testing', 'fixtures', 'generated');
}

/**
 * One page's image: raw 8-bit DeviceRGB samples, no filter.
 *
 * The first version of this generator filled pages with repeated vector
 * operators instead — 5 MB of `m`/`l`/`S` per page. It produced a valid 200 MB
 * document and was the wrong fixture twice over. Rendering it took over ten
 * minutes, because the cost was millions of path operations rather than
 * anything to do with memory; and real documents of that size are not shaped
 * like that, so the number would not have described anything the application
 * will meet.
 *
 * Images are what actually makes a PDF large, and decoding one is what makes an
 * engine allocate. Uncompressed so the file size is exactly predictable and the
 * generator stays cheap — a deflate pass here would put the generator's own cost
 * into a measurement about the engine.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function imageSamples(width, height) {
  const buffer = Buffer.allocUnsafe(width * height * 3);
  // A deterministic gradient with a little structure, so the bytes are neither
  // uniform (which a future compressed variant would collapse to nothing) nor
  // random (which would not be reproducible).
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      buffer[offset] = (x * 7 + y * 3) & 0xff;
      buffer[offset + 1] = (x ^ y) & 0xff;
      buffer[offset + 2] = (x + y * 5) & 0xff;
    }
  }
  return buffer;
}

/**
 * @typedef {{ path: string, bytes: number, pages: number, sha256: string, generated: boolean }} Fixture
 */

/**
 * Writes a stream-heavy PDF of approximately `targetBytes`.
 *
 * @param {{ targetBytes?: number, pages?: number, name?: string, root?: string }} [options]
 * @returns {Fixture}
 */
export function buildLargeFixture(options = {}) {
  const root = options.root ?? repoRoot();
  const targetBytes = options.targetBytes ?? 200 * 1024 ** 2;
  const pages = options.pages ?? 40;
  const name = options.name ?? `perf-image-${String(Math.round(targetBytes / 1024 ** 2))}mb.pdf`;

  const directory = fixtureDirectory(root);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  const stamp = `${path}.generator.json`;

  // The generator's own bytes decide whether a cached fixture still counts. A
  // fixture kept because it is merely the right SIZE is a fixture produced by
  // code nobody has run since.
  const generatorDigest = createHash('sha256')
    .update(readFileSync(join(HERE, 'largeFixture.mjs')))
    .update(`${String(targetBytes)}:${String(pages)}`)
    .digest('hex');

  if (existsSync(path) && existsSync(stamp)) {
    /** @type {{ generator?: string, sha256?: string }} */
    const previous = JSON.parse(readFileSync(stamp, 'utf8'));
    if (previous.generator === generatorDigest && typeof previous.sha256 === 'string') {
      return { path, bytes: statSync(path).size, pages, sha256: previous.sha256, generated: false };
    }
  }

  // Square-ish images sized so `pages` of them land on the target. Rounded to a
  // multiple of 4 so rows stay tidy for any future stride-sensitive reader.
  const perPageBytes = Math.floor(targetBytes / pages);
  const side = Math.max(64, Math.floor(Math.sqrt(perPageBytes / 3) / 4) * 4);
  const imageWidth = side;
  const imageHeight = side;
  const samples = imageSamples(imageWidth, imageHeight);

  /** @type {number[]} */
  const offsets = [];
  let position = 0;
  const digest = createHash('sha256');
  const handle = openSync(path, 'w');

  /** @param {Buffer | string} chunk */
  const emit = (chunk) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk;
    writeSync(handle, buffer);
    digest.update(buffer);
    position += buffer.length;
  };

  /** @param {number} id */
  const startObject = (id) => {
    offsets[id] = position;
    emit(`${String(id)} 0 obj\n`);
  };

  try {
    emit('%PDF-1.7\n%âãÏÓ\n');

    // 1 catalog, 2 page tree; then each page takes three objects: the page, its
    // content stream, and its image XObject.
    const firstPage = 3;
    const pageIds = Array.from({ length: pages }, (_unused, index) => firstPage + index * 3);

    startObject(1);
    emit('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    startObject(2);
    emit(
      `<< /Type /Pages /Count ${String(pages)} /Kids [${pageIds
        .map((id) => `${String(id)} 0 R`)
        .join(' ')}] >>\nendobj\n`,
    );

    for (const id of pageIds) {
      const contentsId = id + 1;
      const imageId = id + 2;

      startObject(id);
      emit(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /XObject << /Im0 ${String(imageId)} 0 R >> >> ` +
          `/Contents ${String(contentsId)} 0 R >>\nendobj\n`,
      );

      // Draws the image across the whole page, so rendering must decode it.
      const content = 'q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n';
      startObject(contentsId);
      emit(`<< /Length ${String(content.length)} >>\nstream\n${content}endstream\nendobj\n`);

      startObject(imageId);
      emit(
        `<< /Type /XObject /Subtype /Image /Width ${String(imageWidth)} ` +
          `/Height ${String(imageHeight)} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
          `/Length ${String(samples.length)} >>\nstream\n`,
      );
      emit(samples);
      emit('\nendstream\nendobj\n');
    }

    const highest = firstPage + pages * 3;
    const xref = position;
    emit(`xref\n0 ${String(highest)}\n`);
    emit('0000000000 65535 f \n');
    for (let id = 1; id < highest; id += 1) {
      const offset = offsets[id];
      // Every id in the table must have been written. A zero here would produce
      // a file that opens and then fails somewhere far away.
      if (offset === undefined) throw new Error(`largeFixture: object ${String(id)} was never written`);
      emit(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    emit(`trailer\n<< /Size ${String(highest)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`);
  } finally {
    closeSync(handle);
  }

  const sha256 = digest.digest('hex');
  writeFileSync(stamp, `${JSON.stringify({ generator: generatorDigest, sha256, bytes: position }, null, 2)}\n`, 'utf8');
  return { path, bytes: position, pages, sha256, generated: true };
}
