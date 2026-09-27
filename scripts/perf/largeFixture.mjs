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
import { deflateSync } from 'node:zlib';

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
 * A small deterministic generator (mulberry32): the scan's noise comes from a FIXED SEED, never `Math.random`, so the
 * same seed paints the same pixels on every run.
 *
 * @param {number} seed
 * @returns {() => number} numbers in [0, 1)
 */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The scan's page: A4 at 150 dpi, 8-bit grey — what an office scanner's greyscale setting writes. */
const SCAN_PAGE = { width: 1240, height: 1754 };

/**
 * One scanned page's grey samples: paper with sensor noise, and dark bands where lines of text would be.
 *
 * **A noise TILE, not a draw per pixel**: 65,521 bytes (a prime, so no row lines up with it) drawn once from the seed
 * and read at a per-page offset. Two million draws a page for hundreds of pages would make the generator the slow part
 * of a measurement about the engine; a tile longer than deflate's 32 KB window still leaves the compressor nothing to
 * repeat, which is what makes the file scan-like rather than trivially small.
 *
 * @param {number} page
 * @param {Uint8Array} tile
 * @param {() => number} next the page's own generator, for where its lines fall
 * @returns {Buffer}
 */
function scanSamples(page, tile, next) {
  const { width, height } = SCAN_PAGE;
  const samples = Buffer.allocUnsafe(width * height);
  // LINES OF "TEXT": a band every 30 rows, 12 rows tall, broken into words of seeded length, inside the margins.
  /** @type {Array<[number, number]>[]} */
  const words = Array.from({ length: height }, () => []);
  for (let top = 150; top + 12 < height - 150; top += 30) {
    /** @type {Array<[number, number]>} */
    const line = [];
    for (let x = 120; x < width - 120; ) {
      const length = 20 + Math.floor(next() * 90);
      line.push([x, Math.min(x + length, width - 120)]);
      x += length + 12 + Math.floor(next() * 10);
    }
    for (let y = top; y < top + 12; y += 1) words[y] = line;
  }
  let offset = (page * 7919) % tile.length;
  for (let y = 0; y < height; y += 1) {
    const line = words[y] ?? [];
    let word = 0;
    for (let x = 0; x < width; x += 1) {
      while (word < line.length && (line[word]?.[1] ?? 0) <= x) word += 1;
      const inWord = word < line.length && (line[word]?.[0] ?? width) <= x;
      const noise = (tile[offset] ?? 128) - 128;
      offset = offset + 1 === tile.length ? 0 : offset + 1;
      // ±4 LEVELS OF SENSOR NOISE: measured 2026-09-27 on this generator, ±8 compressed a page to about 1.3 MB and gave
      // 163 pages for 200 MB, and ±4 gives 212 pages of about 1 MB. Deflate over noisy grey does not go much lower;
      // an office scanner's JPEG would, and this shape errs towards fewer pages, not more.
      samples[y * width + x] = Math.max(0, Math.min(255, (inWord ? 40 : 232) + (noise >> 5)));
    }
  }
  return samples;
}

/**
 * Writes a SCANNED document of at least `targetBytes` (BUILD-PROMPT.md:722, *"200 MB scan: open < 3 s, tab switch
 * instant, memory < 1.5× file size steady"*): hundreds of pages, each one Flate-compressed greyscale image, with
 * noise from a fixed seed.
 *
 * ## Why a third shape
 *
 * The stream-heavy fixture (`buildLargeFixture`) is forty uncompressed images: large, few, and free to decode. A scan is the shape
 * the founding record names and neither of the others is — many pages, each image COMPRESSED, so opening walks a long
 * page tree and showing a page inflates one. The page count is not chosen: pages are written until the file reaches
 * the target, because a compressed page's size is only known once it is compressed.
 *
 * ## What is deterministic, exactly
 *
 * The pixels: every sample comes from the seed. The compressed BYTES come from this Node's zlib, so two machines on
 * different zlib builds can write different files for the same pixels; the stamp records the file's own digest, and
 * the cache is keyed on the generator and the seed.
 *
 * @param {{ targetBytes?: number, seed?: number, name?: string, root?: string }} [options]
 * @returns {Fixture}
 */
export function buildScanFixture(options = {}) {
  const root = options.root ?? repoRoot();
  const targetBytes = options.targetBytes ?? 200 * 1024 ** 2;
  const seed = options.seed ?? 20260927;
  const name = options.name ?? `perf-scan-${String(Math.round(targetBytes / 1024 ** 2))}mb.pdf`;

  const directory = fixtureDirectory(root);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  const stamp = `${path}.generator.json`;

  const generatorDigest = createHash('sha256')
    .update(readFileSync(join(HERE, 'largeFixture.mjs')))
    .update(`scan:${String(targetBytes)}:${String(seed)}`)
    .digest('hex');

  if (existsSync(path) && existsSync(stamp)) {
    /** @type {{ generator?: string, sha256?: string, objects?: number, pages?: number }} */
    const previous = JSON.parse(readFileSync(stamp, 'utf8'));
    if (previous.generator === generatorDigest && typeof previous.sha256 === 'string' && typeof previous.pages === 'number') {
      return {
        path,
        bytes: statSync(path).size,
        pages: previous.pages,
        objects: previous.objects ?? 2 + previous.pages * 3,
        sha256: previous.sha256,
        generated: false,
      };
    }
  }

  const tileNext = seeded(seed);
  const tile = Uint8Array.from({ length: 65_521 }, () => Math.floor(tileNext() * 256));
  const layout = seeded(seed ^ 0x5eed);

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

  /** @type {number[]} */
  const pageIds = [];
  try {
    emit('%PDF-1.7\n%âãÏÓ\n');
    startObject(1);
    emit('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // PAGES UNTIL THE TARGET, each three objects from 3 up; the page tree (object 2) is written last, once the count
    // is known — an xref locates objects wherever they sit.
    for (let page = 0; pageIds.length === 0 || position < targetBytes; page += 1) {
      const id = 3 + page * 3;
      pageIds.push(id);
      const compressed = deflateSync(scanSamples(page, tile, layout), { level: 6 });

      startObject(id);
      emit(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /XObject << /Im0 ${String(id + 2)} 0 R >> >> ` +
          `/Contents ${String(id + 1)} 0 R >>\nendobj\n`,
      );
      const content = 'q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n';
      startObject(id + 1);
      emit(`<< /Length ${String(content.length)} >>\nstream\n${content}endstream\nendobj\n`);
      startObject(id + 2);
      emit(
        `<< /Type /XObject /Subtype /Image /Width ${String(SCAN_PAGE.width)} ` +
          `/Height ${String(SCAN_PAGE.height)} /ColorSpace /DeviceGray /BitsPerComponent 8 ` +
          `/Filter /FlateDecode /Length ${String(compressed.length)} >>\nstream\n`,
      );
      emit(compressed);
      emit('\nendstream\nendobj\n');
    }

    startObject(2);
    emit(
      `<< /Type /Pages /Count ${String(pageIds.length)} /Kids [${pageIds
        .map((id) => `${String(id)} 0 R`)
        .join(' ')}] >>\nendobj\n`,
    );

    const highest = 3 + pageIds.length * 3;
    const xref = position;
    emit(`xref\n0 ${String(highest)}\n`);
    emit('0000000000 65535 f \n');
    for (let id = 1; id < highest; id += 1) {
      const offset = offsets[id];
      if (offset === undefined) throw new Error(`scanFixture: object ${String(id)} was never written`);
      emit(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    emit(`trailer\n<< /Size ${String(highest)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`);
  } finally {
    closeSync(handle);
  }

  const sha256 = digest.digest('hex');
  const pages = pageIds.length;
  const objects = 2 + pages * 3;
  writeFileSync(
    stamp,
    `${JSON.stringify({ generator: generatorDigest, sha256, bytes: position, objects, pages, seed }, null, 2)}\n`,
    'utf8',
  );
  return { path, bytes: position, pages, objects, sha256, generated: true };
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
