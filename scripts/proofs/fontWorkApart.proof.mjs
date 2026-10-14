// @ts-check
/**
 * Proves ADR-0239's two remaining paths: an edit's face program (`faceProgramApart.ts`) and a Markdown or CSV
 * composition (`composeApart.ts`), each made in a thread that ends, leave nothing of HarfBuzz behind in the process
 * that asked, give the same answer the in-thread work gives, and keep a composer's refusal a refusal and its fault a
 * fault across the thread.
 *
 * ## The instrument and its control are the catalogue proof's
 *
 * `external` memory is this isolate's, after forced collections; the threads' END is observed by their `exit` event,
 * which that memory cannot see (`fontCatalogueApart.proof.mjs` records why resident memory and the active resources
 * were not used). The control is the same work in this thread: `faceProgram` reads the face's whole file through
 * HarfBuzz, whose `referenceTable` keeps the blob and whose WebAssembly memory never shrinks, so uses here must grow
 * external memory by at least half the bytes they read. Were the instrument blind, "apart grew nothing" is what it
 * would report for both, and the run fails instead (checklist 4b).
 *
 * Each path is warmed by one use before its measurement, and the apart uses come first, so nothing the in-thread uses
 * leave is counted against them.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { FONT_WORK_APART, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';

const ROOT = repoRoot();
refuseStaleBuild(ROOT, FONT_WORK_APART, 9);

setFlagsFromString('--expose-gc');
/** @type {() => void} */
const collect = runInNewContext('gc');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

async function settled() {
  for (let turn = 0; turn < 5; turn += 1) {
    collect();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return process.memoryUsage().external;
}

const mb = (/** @type {number} */ bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
const { faceProgram } = await import('../../packages/kernel/dist/faceProgram.js');
const { faceProgramApart } = await import('../../packages/kernel/dist/faceProgramApart.js');
const { composerApart } = await import('../../packages/kernel/dist/composeApart.js');
const { composeMarkdown } = await import('../../packages/kernel/dist/markdownCompose.js');
const { faceSourceOf, readCatalogue } = await import('../../packages/kernel/dist/fontCatalogue.js');
const { ComposeRefused } = await import('../../packages/kernel/dist/composeOutcome.js');

const fonts = fontsDirectory(ROOT);
// THE LARGEST BUNDLED FACE, so a use reads as many bytes as the folder offers in one file.
const largest = readdirSync(fonts)
  .filter((name) => /\.(?:ttf|otf)$/iu.test(name))
  .map((name) => ({ path: join(fonts, name), size: statSync(join(fonts, name)).size }))
  .sort((a, b) => b.size - a.size)[0];
if (largest === undefined) throw new Error(`${fonts} holds no font: run scripts/provision/fonts.mjs, or this measures nothing.`);

/** A subset request over the largest face, its file read fresh each time, as an edit reads it. */
const request = () =>
  /** @type {import('../../packages/kernel/dist/faceProgram.js').FaceProgramRequest} */ ({
    kind: 'subset',
    whole: new Uint8Array(readFileSync(largest.path)),
    faceIndex: 0,
    variable: false,
    weight: 400,
    unicodes: [0x2190, 0x2191, 0x2192, 0x2193],
    wholeAllowed: false,
  });

/** @type {Promise<number | 'alive'>[]} */
const ends = [];
/** @type {import('node:worker_threads').Worker[]} */
const threads = [];
/** @param {import('node:worker_threads').Worker} thread */
const watch = (thread) => {
  threads.push(thread);
  ends.push(
    new Promise((resolve) => {
      const wait = setTimeout(() => {
        resolve('alive');
      }, 5000);
      thread.once('exit', (code) => {
        clearTimeout(wait);
        resolve(code);
      });
    }),
  );
};

const USES = 8;
let apart = faceProgramApart(request(), watch);
const start = await settled();
for (let use = 0; use < USES; use += 1) apart = faceProgramApart(request(), watch);
const afterApart = await settled();
let here = faceProgram(request());
const beforeHere = await settled();
for (let use = 0; use < USES; use += 1) here = faceProgram(request());
const afterHere = await settled();

const grewApart = afterApart - start;
const grewHere = afterHere - beforeHere;
const measured = `${String(USES)} face programs over ${mb(largest.size)}: apart grew ${mb(grewApart)}, in this thread ${mb(grewHere)}`;

check(
  'CONTROL: face programs made in this thread keep at least half the bytes they read, so the instrument can see it',
  grewHere * 2 >= USES * largest.size,
  measured,
);
check('made apart, the asking thread keeps a tenth or less of what the in-thread work keeps', grewApart * 10 <= grewHere, measured);
check(
  'the face program made apart is the one made in this thread, byte for byte',
  apart !== null && here !== null && apart.length > 0 && Buffer.from(apart).equals(Buffer.from(here)),
  `${String(apart?.length)} bytes apart, ${String(here?.length)} here`,
);

// THE CALLER'S FILE IS MOVED, not copied: its buffer is transferred, so after the call it is detached. A copy would
// double what crosses for an 18 MB face.
{
  const moved = request();
  faceProgramApart(moved, watch);
  check('the face’s whole file is moved to the thread, not copied', moved.whole.byteLength === 0, `${String(moved.whole.byteLength)} bytes left behind`);
}

// A COMPOSITION APART is the one composed here. The catalogue is read once and shared, as the host shares it.
const faces = faceSourceOf([{ path: fonts, origin: /** @type {const} */ ('bundled') }], readCatalogue);
const page = { width: 595, height: 842 };
const markdown = new TextEncoder().encode('# A heading\n\nA paragraph with *emphasis* and → an arrow.\n');
const composeApart = composerApart('markdown');
const composedApart = await composeApart(markdown, page, faces, 'Carlito');
const composedHere = await composeMarkdown(markdown, page, faces, 'Carlito');
check(
  'a Markdown file composed apart is the one composed in this thread',
  composedApart.pdf.length > 0 && Buffer.from(composedApart.pdf).equals(Buffer.from(composedHere.pdf)) &&
    JSON.stringify([composedApart.boxed, composedApart.skipped]) === JSON.stringify([composedHere.boxed, composedHere.skipped]),
  `${String(composedApart.pdf.length)} bytes apart, ${String(composedHere.pdf.length)} here`,
);

// A REFUSAL CROSSES AS A REFUSAL, the same class the composer threw, so the handler answers the person's file by name.
// A source that is not UTF-8 is the one every composer refuses.
{
  /** @type {unknown} */
  let thrown;
  try {
    await composeApart(new Uint8Array([0xff, 0xfe, 0xfd]), page, faces, 'Carlito');
  } catch (error) {
    thrown = error;
  }
  check(
    "a composer's refusal crosses the thread as the same ComposeRefused, with its reason",
    thrown instanceof ComposeRefused && thrown.reason === 'not-utf8',
    String(thrown),
  );
}

// AND A FAULT STAYS A FAULT: a face whose file is not there throws in the thread, which is a defect in this build and
// never an answer about the person's file. The control for the case above: were every failure turned into a refusal,
// that case would pass and this one would not.
{
  /** @type {unknown} */
  let thrown;
  const gone = { faces: faces.faces.map((face) => ({ ...face, path: join(fonts, 'not-there.ttf') })), read: faces.read };
  try {
    await composeApart(markdown, page, gone, 'Carlito');
  } catch (error) {
    thrown = error;
  }
  check(
    "CONTROL: a composer's fault crosses as a failure, never as a refusal",
    thrown instanceof Error && !(thrown instanceof ComposeRefused) && thrown.message.startsWith('a composition failed in its thread'),
    String(thrown),
  );
}

const ended = await Promise.all(ends);
await Promise.all(threads.map((thread) => thread.terminate()));
check(
  'every face program thread has ended, so what it held went with it',
  ended.length === USES + 2 && ended.every((code) => code !== 'alive'),
  JSON.stringify(ended),
);

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} font work case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : `${roster.format('font work case')}\n  ${measured}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
