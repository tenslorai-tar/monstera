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
 * @typedef {{ path: string, bytes: number, pages: number, objects: number, sha256: string, generated: boolean }} Fixture
 */

/**
 * The OBJECT-DENSE shape: many small objects rather than few large streams.
 *
 * This is the hard shape, and the reason it has its own generator is stage-audit
 * item 2 — "was it verified against the easy shape only". Under WASM the two
 * shapes were not remotely interchangeable: an image-heavy 405 MB document with
 * 53 objects peaked at 3.71x, while an object-dense 28 MB document with 127K
 * objects peaked at 20.9x, and a 464 MB object-dense document failed outright
 * inside the page walk without ever reaching a save.
 *
 * Those numbers were WASM's and are withdrawn — natively an object costs about
 * 45 bytes rather than 4 KB — but "withdrawn" is not "measured". Nothing had
 * measured the dense shape natively, and the fixtures that produced the original
 * figures were built in a scratch directory that no longer exists, which is the
 * evidence-outside-the-repository problem the native CI job was created for.
 *
 * Density is built from form XObjects: each page's resource dictionary names
 * many tiny XObjects and its content stream invokes every one, so a page walk
 * has to resolve and parse each. Objects that merely exist in the file would sit
 * in the xref untouched and measure nothing.
 *
 * @param {{ objects?: number, pages?: number, name?: string, root?: string }} [options]
 * @returns {Fixture}
 */
export function buildDenseFixture(options = {}) {
  const root = options.root ?? repoRoot();
  const objects = options.objects ?? 127_000;
  const pages = options.pages ?? 40;
  const perPage = Math.max(1, Math.floor(objects / pages));
  const name = options.name ?? `perf-dense-${String(Math.round(objects / 1000))}k.pdf`;

  const directory = fixtureDirectory(root);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  const stamp = `${path}.generator.json`;

  const generatorDigest = createHash('sha256')
    .update(readFileSync(join(HERE, 'largeFixture.mjs')))
    .update(`dense:${String(objects)}:${String(pages)}`)
    .digest('hex');

  if (existsSync(path) && existsSync(stamp)) {
    /** @type {{ generator?: string, sha256?: string, objects?: number }} */
    const previous = JSON.parse(readFileSync(stamp, 'utf8'));
    if (previous.generator === generatorDigest && typeof previous.sha256 === 'string') {
      return {
        path,
        bytes: statSync(path).size,
        pages,
        objects: previous.objects ?? objects,
        sha256: previous.sha256,
        generated: false,
      };
    }
  }

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

  let nextId = 3;
  try {
    emit('%PDF-1.7\n%âãÏÓ\n');

    /** @type {number[]} */
    const pageIds = [];
    /** @type {string[]} */
    const pageBodies = [];

    // Bodies are composed first so the page objects can name their XObject ids,
    // then everything is emitted in id order.
    for (let page = 0; page < pages; page += 1) {
      const pageId = nextId;
      nextId += 1;
      const contentsId = nextId;
      nextId += 1;
      const firstXObject = nextId;
      nextId += perPage;

      pageIds.push(pageId);
      pageBodies.push(`${String(pageId)}:${String(contentsId)}:${String(firstXObject)}`);
    }

    startObject(1);
    emit('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    startObject(2);
    emit(
      `<< /Type /Pages /Count ${String(pages)} /Kids [${pageIds
        .map((id) => `${String(id)} 0 R`)
        .join(' ')}] >>\nendobj\n`,
    );

    for (const body of pageBodies) {
      const [pageIdText, contentsIdText, firstText] = body.split(':');
      const pageId = Number(pageIdText);
      const contentsId = Number(contentsIdText);
      const first = Number(firstText);

      /** @type {string[]} */
      const resources = [];
      /** @type {string[]} */
      const invocations = [];
      for (let index = 0; index < perPage; index += 1) {
        resources.push(`/X${String(index)} ${String(first + index)} 0 R`);
        invocations.push(`q 1 0 0 1 ${String(index % 500)} ${String(index % 700)} cm /X${String(index)} Do Q`);
      }

      startObject(pageId);
      emit(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /XObject << ${resources.join(' ')} >> >> ` +
          `/Contents ${String(contentsId)} 0 R >>\nendobj\n`,
      );

      const content = `${invocations.join('\n')}\n`;
      startObject(contentsId);
      emit(`<< /Length ${String(content.length)} >>\nstream\n${content}endstream\nendobj\n`);

      for (let index = 0; index < perPage; index += 1) {
        // Each is a complete, valid form XObject with a real drawing operator,
        // so resolving it costs a parse rather than an early reject.
        const inner = '0 0 1 rg\n0 0 3 3 re f\n';
        startObject(first + index);
        emit(
          `<< /Type /XObject /Subtype /Form /BBox [0 0 4 4] /Resources << >> ` +
            `/Length ${String(inner.length)} >>\nstream\n${inner}endstream\nendobj\n`,
        );
      }
    }

    const highest = nextId;
    const xref = position;
    emit(`xref\n0 ${String(highest)}\n`);
    emit('0000000000 65535 f \n');
    for (let id = 1; id < highest; id += 1) {
      const offset = offsets[id];
      if (offset === undefined) throw new Error(`denseFixture: object ${String(id)} was never written`);
      emit(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    emit(`trailer\n<< /Size ${String(highest)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`);
  } finally {
    closeSync(handle);
  }

  const sha256 = digest.digest('hex');
  const actualObjects = nextId - 1;
  writeFileSync(
    stamp,
    `${JSON.stringify({ generator: generatorDigest, sha256, bytes: position, objects: actualObjects }, null, 2)}\n`,
    'utf8',
  );
  return { path, bytes: position, pages, objects: actualObjects, sha256, generated: true };
}

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
    /** @type {{ generator?: string, sha256?: string, objects?: number }} */
    const previous = JSON.parse(readFileSync(stamp, 'utf8'));
    if (previous.generator === generatorDigest && typeof previous.sha256 === 'string') {
      return {
        path,
        bytes: statSync(path).size,
        pages,
        objects: previous.objects ?? 2 + pages * 3,
        sha256: previous.sha256,
        generated: false,
      };
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
  const objects = 2 + pages * 3;
  writeFileSync(
    stamp,
    `${JSON.stringify({ generator: generatorDigest, sha256, bytes: position, objects }, null, 2)}\n`,
    'utf8',
  );
  return { path, bytes: position, pages, objects, sha256, generated: true };
}
