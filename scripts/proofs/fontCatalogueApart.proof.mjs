// @ts-check
/**
 * Proves that a host's font catalogue, read apart (`fontCatalogueApart.ts`), leaves nothing of HarfBuzz behind in
 * the process that asked, and is the same catalogue the in-thread read makes (the owner's Part 7 A).
 *
 * ## Two claims, because one instrument cannot see both
 *
 * `external` memory is this isolate's: it sees what a read leaves in the asking thread, exactly, and it cannot see a
 * thread that stayed alive holding its own. So the thread's END is observed separately, by its `exit` event.
 * Resident memory sees both and was tried first; it moved by up to 9 MB over six reads apart from the allocator's
 * per-thread arenas (this container, 2026-10-13), too close to the effect to bound without guessing a margin.
 * `process.getActiveResourcesInfo()` was tried for the end and lists no worker even while one runs, so it cannot.
 *
 * ## The control is the read the hosts used to make
 *
 * `readCatalogue` in this thread keeps what harfbuzzjs allocated for every face it read: its objects are freed only by
 * a finaliser, `referenceTable` never releases the font's blob, and WebAssembly memory does not shrink. So reads in
 * this thread must grow external memory by at least the bytes they read, after a forced collection. That is the
 * instrument's positive control (checklist 4b): were it blind to the growth, "apart grew nothing" is what it would
 * report for both, and the run fails instead.
 *
 * Each reader is warmed by one read before its measurement, so what is counted is what a read KEEPS, which grows with
 * every read, and the apart reads come first, so nothing the in-thread reads leave can be counted against them.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { FONT_CATALOGUE_APART, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';

const ROOT = repoRoot();
refuseStaleBuild(ROOT, FONT_CATALOGUE_APART, 3);

// A COLLECTION ON DEMAND, without asking whoever runs this for a flag.
setFlagsFromString('--expose-gc');
/** @type {() => void} */
const collect = runInNewContext('gc');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 5 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** This isolate's external memory after the finalisers have had their turns. */
async function settled() {
  for (let turn = 0; turn < 5; turn += 1) {
    collect();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return process.memoryUsage().external;
}

const mb = (/** @type {number} */ bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

const fonts = fontsDirectory(ROOT);
const folderBytes = readdirSync(fonts)
  .filter((name) => /\.(?:ttf|otf|ttc|otc)$/iu.test(name))
  .reduce((total, name) => total + statSync(join(fonts, name)).size, 0);
if (folderBytes === 0) throw new Error(`${fonts} holds no font: run scripts/provision/fonts.mjs, or this measures nothing.`);

// LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
const { readCatalogue } = await import('../../packages/kernel/dist/fontCatalogue.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');
const folders = [{ path: fonts, origin: /** @type {const} */ ('bundled') }];
const READS = 3;

/** How each thread a read started ended: its exit code, or `alive` where it had not ended within the wait. */
/** @type {Promise<number | 'alive'>[]} */
const ends = [];
/** Every thread watched, ended by this proof before it reports, so a thread the reader left alive fails a case rather
 * than holding the run open. */
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

/** @type {import('../../packages/kernel/dist/fontCatalogue.js').Catalogue} */
let apart = readCatalogueApart(folders, watch);
const start = await settled();
for (let read = 0; read < READS; read += 1) apart = readCatalogueApart(folders, watch);
const afterApart = await settled();
/** @type {import('../../packages/kernel/dist/fontCatalogue.js').Catalogue} */
let here = readCatalogue(folders);
const beforeHere = await settled();
for (let read = 0; read < READS; read += 1) here = readCatalogue(folders);
const afterHere = await settled();

const grewApart = afterApart - start;
const grewHere = afterHere - beforeHere;
const measured = `${String(READS)} reads of ${mb(folderBytes)}: apart grew ${mb(grewApart)}, in this thread ${mb(grewHere)}`;

// HALF THE BYTES READ, which the leak clears with room: measured here 2026-10-13, three reads of the bundled 9.5 MB kept
// 28.1 MB, about one copy of every file per read, while apart kept 0.0.
check(
  'CONTROL: reading in this thread keeps at least half the bytes it read, so the instrument can see what a read leaves',
  grewHere * 2 >= READS * folderBytes,
  measured,
);
check('read apart, the asking thread keeps a tenth or less of what the in-thread read keeps', grewApart * 10 <= grewHere, measured);

/** @param {import('../../packages/kernel/dist/fontCatalogue.js').Catalogue} catalogue */
const described = (catalogue) =>
  JSON.stringify(catalogue.faces.map((face) => [face.id, face.family, face.weight, face.italic, face.embedding, face.weights, [...face.unicodes]]));
check(
  'the catalogue read apart is the one read in this thread, face by face and code point by code point',
  apart.faces.length > 0 && described(apart) === described(here),
  `${String(apart.faces.length)} faces apart, ${String(here.faces.length)} here`,
);

// A READ THAT THROWS IN THE THREAD answers, and the reader throws its message. A folder that is not there is no such
// read: the catalogue names it unreadable and answers. A folder that is not an object makes the catalogue's own loop
// throw reading its path, which no folder on disk can stand in for.
{
  let message = '';
  try {
    readCatalogueApart(
      [/** @type {import('../../packages/kernel/dist/fontCatalogue.js').FontFolder} */ (/** @type {unknown} */ (null))],
      watch,
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    "a read that throws in the thread is answered, and the reader throws the thread's own message rather than waiting",
    message.startsWith('the font catalogue thread could not read') && /path/iu.test(message),
    message,
  );
}

// LAST, so every read above is counted: the measured ones, the warm one, and the one that threw.
const ended = await Promise.all(ends);
await Promise.all(threads.map((thread) => thread.terminate()));
check(
  'every thread a read started has ended, the one that threw included, so what it held went with it',
  ended.length === READS + 2 && ended.every((code) => code !== 'alive'),
  JSON.stringify(ended),
);

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} font catalogue case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : `${roster.format('font catalogue case')}\n  ${measured}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
