// @ts-check
/**
 * Proves PDF.js takes a rotation the parsed bytes do not carry — the property
 * the view model rests on.
 *
 * ## Why this is a gate and not a note
 *
 * Finding OOOOO-1: a command's effect lives in the engine session, main's
 * canonical image is never replaced, so `document.readRange` serves the
 * pre-command bytes and a rotated page cannot reach the screen *through them*.
 * `docs/ARCHITECTURE.md` §2 names the other route — the renderer receives a view
 * model carrying page transforms — and §3.2 makes it the rule rather than a
 * workaround: *"PDF.js is never a source of truth. It renders."*
 *
 * That route works only while `page.getViewport({ rotation })` overrides what
 * the page's own `/Rotate` says. Nothing in this repository would notice if a
 * PDF.js upgrade changed it: the renderer would draw an unrotated page, the
 * kernel would hold the correct document, every existing check would stay green,
 * and the symptom would be a rotate command that silently does nothing on
 * screen. So this is the same shape as `engineSpike.mjs` (§3.2) — a behaviour an
 * upgrade must turn red rather than quietly invalidate.
 *
 * ## The page carries `/Rotate 90`, and the first draft did not
 *
 * Run against `perf-baseline.pdf`, whose page rotation is **0**, three of these
 * cases passed while separating nothing: at zero, *absolute* and *additive* are
 * the same function, and *"passing the page's own rotation"* is the same call as
 * passing nothing. The constant chosen for convenience selected exactly the
 * inputs the question cannot be answered on. So the fixture is authored here
 * with a non-zero `/Rotate`, every reading is taken against a page that
 * disagrees with the argument, and the first case is the control that says so.
 *
 * ## What this deliberately does NOT prove
 *
 * That the override reaches **pixels**. There is no canvas here. The rasterised
 * evidence is `canvasPixels.proof.mjs`, which drives the shipped renderer in
 * Chromium and counts what was drawn; this file is the API-level gate under it,
 * and the two are separate because only one of them needs a browser.
 *
 * Usage: node scripts/proofs/viewportRotation.proof.mjs
 */

import { Buffer } from 'node:buffer';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];

const CASES = [
  'CONTROL: the fixture page reports the NON-ZERO /Rotate authored into it',
  'omitting rotation gives the viewport the page own rotation asks for',
  "passing the page's OWN rotation reproduces the default viewport exactly",
  'a quarter turn from own swaps the viewport width and height',
  'a quarter turn from own changes the transform',
  'rotation REPLACES the page rotation rather than adding to it',
];

const roster = createRoster(failures, { cases: CASES.length });

/** @type {string[]} */
const recorded = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

/** The page's own `/Rotate`, in degrees. Non-zero on purpose — see the header. */
const PAGE_ROTATE = 90;

/** The page box the fixture declares, so the expected swap is not a guess. */
const MEDIA_WIDTH = 595;
const MEDIA_HEIGHT = 842;

/**
 * A one-page PDF whose page carries `/Rotate`, as bytes.
 *
 * Authored here rather than taken from `buildLargeFixture`, which emits pages
 * with no `/Rotate` at all. Offsets are computed from the assembled body, so the
 * cross-reference table cannot drift from the objects it indexes.
 *
 * @param {number} rotate
 * @returns {Uint8Array}
 */
function rotatedPdf(rotate) {
  const content = '0 0 0 rg 60 60 200 300 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(MEDIA_WIDTH)} ${String(MEDIA_HEIGHT)}] ` +
      `/Rotate ${String(rotate)} /Contents 4 0 R >>`,
    `<< /Length ${String(content.length)} >>\nstream\n${content}endstream`,
  ];

  let body = '%PDF-1.7\n';
  /** @type {number[]} */
  const offsets = [];
  for (const [at, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${String(at + 1)} 0 obj\n${object}\nendobj\n`;
  }

  const startxref = body.length;
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`;
  xref += `startxref\n${String(startxref)}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body + xref, 'latin1'));
}

/**
 * @param {{ width: number, height: number, transform: number[] }} viewport
 * @returns {string}
 */
function describe(viewport) {
  return `${viewport.width.toFixed(2)}x${viewport.height.toFixed(2)} [${viewport.transform.join(', ')}]`;
}

try {
  // The legacy build is the one that runs outside a browser: the modern entry
  // reaches for `DOMMatrix` and friends at module scope.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const bytes = rotatedPdf(PAGE_ROTATE);
  const task = pdfjs.getDocument({
    data: bytes,
    // Both refused by invariant 27's policy in the shipped renderer, so the
    // parse here is the one the product performs.
    useWorkerFetch: false,
    useWasm: false,
  });
  const document = await task.promise;
  const page = await document.getPage(1);

  const own = page.rotate;
  const plain = page.getViewport({ scale: 1 });
  const echoed = page.getViewport({ scale: 1, rotation: own });
  const turned = page.getViewport({ scale: 1, rotation: (own + 90) % 360 });
  const added = page.getViewport({ scale: 1, rotation: own + 360 });

  check(
    'CONTROL: the fixture page reports the NON-ZERO /Rotate authored into it',
    // TWO CONDITIONS, and the second is the one the first draft was missing.
    // `own === PAGE_ROTATE` asks whether the parser read what was authored; it
    // is satisfied by a constant of 0, which is precisely the fixture this case
    // exists to reject. Setting PAGE_ROTATE to 0 and running is the mutation:
    // without the modulus it stays green and only a later case goes red, which
    // reads as that case being wrong rather than as the fixture being blind.
    own === PAGE_ROTATE && own % 360 !== 0,
    `the page reports /Rotate ${String(own)} against an authored ${String(PAGE_ROTATE)}.\n` +
      `      Every case below is degenerate at zero — absolute and additive are the same ` +
      `function there, and "the page's own rotation" is the same call as passing nothing. A ` +
      `parser that ignored /Rotate, or a fixture authored at 0, would make this file pass ` +
      `while measuring nothing.`,
  );

  check(
    'omitting rotation gives the viewport the page own rotation asks for',
    plain.width === MEDIA_HEIGHT && plain.height === MEDIA_WIDTH,
    `an omitted rotation gave ${describe(plain)} for a ${String(MEDIA_WIDTH)}x` +
      `${String(MEDIA_HEIGHT)} box under /Rotate ${String(own)}, which should present the box ` +
      `turned.`,
  );

  check(
    "passing the page's OWN rotation reproduces the default viewport exactly",
    plain.width === echoed.width &&
      plain.height === echoed.height &&
      plain.transform.join(',') === echoed.transform.join(','),
    `omitted gave ${describe(plain)} and rotation=${String(own)} gave ${describe(echoed)}.\n` +
      `      This is the implementation's own default observed rather than read. If they ` +
      `differ, the argument is not the same quantity as the page's rotation and the view model ` +
      `cannot carry one number for both.`,
  );

  check(
    'a quarter turn from own swaps the viewport width and height',
    turned.width === plain.height && turned.height === plain.width,
    `a quarter turn gave ${describe(turned)} against ${describe(plain)}.`,
  );

  check(
    'a quarter turn from own changes the transform',
    turned.transform.join(',') !== plain.transform.join(','),
    `the transform stayed ${plain.transform.join(', ')}. A swapped width and height with an ` +
      `unchanged transform would size the canvas correctly and draw the page the old way up, ` +
      `which is the failure a dimension check alone cannot see.`,
  );

  check(
    'rotation REPLACES the page rotation rather than adding to it',
    added.width === plain.width && added.height === plain.height,
    `own + 360 gave ${describe(added)} against ${describe(plain)}.\n` +
      `      Same angle, so an absolute override must agree; an additive one lands a quarter ` +
      `turn short of a full turn and swaps. The view model therefore has to carry the page's ` +
      `ABSOLUTE rotation, not the turns a command applied.`,
  );

  await task.destroy();

  if (recorded.length !== CASES.length || recorded.some((label, at) => label !== CASES[at])) {
    throw new Error(
      `CASES does not describe what ran.\n  declared:\n    ${CASES.join('\n    ')}\n  ran:\n    ` +
        `${recorded.join('\n    ')}`,
    );
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} viewport-rotation failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('viewport-rotation case'),
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
