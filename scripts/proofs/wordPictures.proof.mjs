// @ts-check
/**
 * The Word export carries the page's pictures, read back by readers that are not the writer's
 * ([ADR-0072](../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md)'s amendment
 * of 2026-10-01).
 *
 * ## The failure this closes
 *
 * Until 2026-10-01 the Word export carried no picture in any mode: the page's reading reported how many there were
 * and nothing else. The owner's list, item 4: inline in reading order when the text reflows, at its box in the exact
 * layout, none in text mode.
 *
 * ## What each case runs
 *
 * A generated page — two columns, a picture between the left column's two paragraphs, the same picture turned 90° in
 * the right column, a PNG whose right quarter is transparent — opened by the built native engine and exported by the
 * built composer the MuPDF host runs, `composeWordDocument`, in each mode.
 *
 * ## The second readers
 *
 * - **The package** is read by a zip reader written in this file over `node:zlib` — the central directory walked by
 *   hand — never by `fflate`, which wrote it. A writer and reader that share a library agree about its mistakes.
 * - **The pictures** are decoded by `sharp` (libvips), never by the MuPDF that drew them, and each colour sampled is
 *   one only that quadrant has.
 *
 * ## Its controls
 *
 * - **The zip reader finds the package's content types**, so an empty listing is a broken reader and never a clean
 *   package (audit item 4b).
 * - **Text mode carries no picture** from the same page, so the pictures the other modes carry come from the picture
 *   read rather than from something every export writes.
 * - **Every drawing names a relationship and every relationship a part the package holds** — the dangling reference
 *   that makes Word call a file damaged is what the composer refuses to write.
 *
 * Usage: node scripts/proofs/wordPictures.proof.mjs [--require-engine]
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { WORD_PICTURES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { ABOVE, BELOW, picturedPage } from '../lib/wordPictureFixture.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engine');

const CASES = [
  'CONTROL: the zip reader written here, not fflate, lists the package and finds its content types',
  'RICH: the picture sits between the two paragraphs it sits between on the page',
  'RICH: decoded by libvips, the picture is its own pixels — each quadrant its colour',
  'RICH: and its transparent band is transparent, so the soft mask was carried',
  'RICH: a picture turned 90° on the page arrives turned, not as the image stores it',
  'LAYOUT: the picture is anchored at its box — 50 × 132 pt from the page corner, 200 × 100 pt',
  'CONTROL: TEXT mode carries no picture from the same page',
  'every drawing names a relationship, and every relationship a part the package holds',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });
if (CASES.length !== 8) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 8`);

/** @param {number} index @param {boolean} held @param {string} detail */
function check(index, held, detail) {
  const mark = roster.mark();
  const name = CASES[index] ?? '';
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

// ---- the second zip reader ----

/**
 * Every entry of a zip archive, by name, read from its central directory with `node:zlib`.
 *
 * The central directory rather than the local headers, because a streamed writer puts the sizes in a data descriptor
 * after each entry and leaves the local header's at zero.
 *
 * @param {Buffer} zip
 * @returns {Map<string, Buffer>}
 */
function readZip(zip) {
  let end = -1;
  for (let at = zip.length - 22; at >= 0; at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('no end-of-central-directory record: not a zip');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  /** @type {Map<string, Buffer>} */
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`central directory entry ${String(index)} is not one`);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataAt, dataAt + compressed);
    entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// ---- the run ----

/** @param {any} sharp @param {Buffer} png */
async function sampler(sharp, png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  /** @param {number} fx @param {number} fy */
  return (fx, fy) => {
    const x = Math.min(info.width - 1, Math.floor(info.width * fx));
    const y = Math.min(info.height - 1, Math.floor(info.height * fy));
    const at = (y * info.width + x) * 4;
    return [...data.subarray(at, at + 4)].join('/');
  };
}

/** @param {any} kernel @param {any} session @param {'text' | 'layout' | 'rich'} mode */
async function exported(kernel, session, mode) {
  const { chunks } = kernel.composeWordDocument(session, mode);
  /** @type {Uint8Array[]} */
  const parts = [];
  for await (const part of chunks) parts.push(part);
  const entries = readZip(Buffer.concat(parts));
  return { entries, xml: entries.get('word/document.xml')?.toString('utf8') ?? '' };
}

/** @param {any} sharp */
async function run(sharp) {
  /** @type {any} */
  const kernel = await import(pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', 'wordPictures.js')).href);
  /** @type {any} */
  const { mupdfWriter } = await import(pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', 'mupdfWriter.js')).href);
  const session = await mupdfWriter.open(await picturedPage());
  try {
    const rich = await exported(kernel, session, 'rich');
    check(
      0,
      rich.entries.has('[Content_Types].xml') && rich.entries.has('word/document.xml'),
      `the reader listed ${JSON.stringify([...rich.entries.keys()])}`,
    );

    const above = rich.xml.indexOf(ABOVE);
    const drawing = rich.xml.indexOf('<w:drawing>');
    const below = rich.xml.indexOf(BELOW);
    check(1, above >= 0 && drawing > above && below > drawing, `above at ${String(above)}, first drawing at ${String(drawing)}, below at ${String(below)}`);

    const upright = await sampler(sharp, rich.entries.get('word/media/image1.png') ?? Buffer.alloc(0));
    const quadrants = [upright(0.1, 0.1), upright(0.6, 0.1), upright(0.1, 0.9)];
    check(2, quadrants.join(' ') === '255/0/0/255 0/0/255/255 0/255/0/255', `top-left, top-right, bottom-left read ${quadrants.join(' ')}`);
    const band = upright(0.95, 0.5);
    check(3, band.endsWith('/0'), `the transparent band reads ${band}`);

    const turned = await sampler(sharp, rich.entries.get('word/media/image2.png') ?? Buffer.alloc(0));
    const turnedReads = [turned(0.5, 0.05), turned(0.1, 0.9), turned(0.9, 0.9)];
    check(
      4,
      turnedReads[0]?.endsWith('/0') === true && turnedReads[1] === '255/0/0/255' && turnedReads[2] === '0/255/0/255',
      `top, bottom-left, bottom-right read ${turnedReads.join(' ')}; turned anticlockwise the band is on top, red bottom-left, green right`,
    );

    const layout = await exported(kernel, session, 'layout');
    const anchored =
      '<wp:positionH relativeFrom="page"><wp:posOffset>635000</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>1676400</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="2540000" cy="1270000"/>';
    check(5, layout.xml.includes(anchored), `no anchor at 635000, 1676400 with extent 2540000 × 1270000 in: ${layout.xml.match(/<wp:anchor[^>]*>.{0,400}/u)?.[0] ?? '(no anchor)'}`);

    const text = await exported(kernel, session, 'text');
    const textMedia = [...text.entries.keys()].filter((name) => name.startsWith('word/media/'));
    check(6, text.xml.includes(ABOVE) && !text.xml.includes('<w:drawing>') && textMedia.length === 0, `text mode holds ${String(textMedia.length)} picture part(s)`);

    const dangling = [];
    for (const { entries, xml } of [rich, layout]) {
      const relationships = entries.get('word/_rels/document.xml.rels')?.toString('utf8') ?? '';
      const embedded = [...xml.matchAll(/r:embed="([^"]+)"/gu)].map((match) => match[1] ?? '');
      for (const id of embedded) {
        const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`, 'u').exec(relationships)?.[1];
        if (target === undefined || !entries.has(`word/${target}`)) dangling.push(`${id} -> ${target ?? '(no relationship)'}`);
      }
      if (embedded.length !== 2) dangling.push(`${String(embedded.length)} drawings where the page has 2 pictures`);
    }
    check(7, dangling.length === 0, dangling.join('; '));
  } finally {
    await mupdfWriter.close(session);
  }

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} Word picture case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('Word picture case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

// THE ENTRY IS LAST, so every constant above is initialised before the first case reads one.
if (bindNativeEngine(ROOT) === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'the Word export’s pictures',
    why:
      `${String(CASES.length)} case(s) need the native engine:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      'The MuPDF shim is not built. Run `npm run provision:mupdf`.',
    flag: '--require-engine',
  });
} else {
  // THE BUILT COMPOSER IS THE SUBJECT, so a stale one would export yesterday's package under today's name.
  refuseStaleBuild(ROOT, WORD_PICTURES, 4);
  /** @type {any} */
  const sharp = createRequire(join(ROOT, 'package.json'))('sharp');
  await run(sharp);
}
