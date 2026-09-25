// @ts-check
/**
 * The child of `composeHostLive.mjs`: a real shell importing Markdown through the
 * real compose host.
 *
 * ## Why a separate process, and why here
 *
 * `hostRecoveryHost.mjs`' reasons, unchanged: `createEngineHostPlatform` refuses any
 * process that is not the Electron binary, so this runs under `electron.exe` with
 * `ELECTRON_RUN_AS_NODE=1`, which is Node mode and therefore lives outside
 * `apps/desktop/src/` (ADR-0024). It reaches the shell by importing the built
 * artefacts by path.
 *
 * ## What it is for
 *
 * D9's Markdown row owes one run of the REAL compose host
 * ([ADR-0060](../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 * Every case in `compositionHost.test.ts` drives a fake platform, so *created in its
 * own AppContainer, contained by its own verdict, composed through its pipe* is
 * asserted there and executed nowhere. This executes it through the shipped
 * composition root, with nothing faked but the two pickers and the source read.
 *
 * ## The composed page is read back by the OTHER host
 *
 * The document that opens is given a session by the real MuPDF host, and
 * `document.pageWordCount` reads the page's words through it. So a composition that
 * wrote a file which opened and drew nothing, or drew something MuPDF cannot read,
 * reports zero words rather than a pass.
 *
 * ## The control is a refusal from the real host
 *
 * A source that is not UTF-8 must come back as `composition-refused` with
 * `not-utf8`. That answer can only come from the composer running in the host: a
 * shell that never reached a host answers `engine-unavailable` or `internal`, and a
 * shell that parsed in `main` would have no refusal to carry through the pipe.
 *
 * Usage: not directly. `node scripts/research/composeHostLive.mjs`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();

/** Where the report goes, given by the driver — a FILE, for `hostRecoveryHost.mjs`' reason. */
const REPORT_PATH = process.argv[2] ?? '';

/** The Markdown source, and the word count MuPDF must find on the composed page. */
const SOURCE = '# Compose host\n\nThe real host wrote this page.\n';
const SOURCE_WORDS = 8;

/** The CSV source, and its six fields, each one word on the composed table. */
const CSV_SOURCE = 'name,qty\nApples,3\nPears,12\n';
const CSV_WORDS = 6;

/**
 * A baseline JPEG's start-of-image, start-of-frame and end, built from its size.
 *
 * `embedJpg` reads the frame header for the size and carries the rest as the image's
 * stream, so this is a real page of a stated size with no picture data to vet (B10).
 *
 * @param {number} width @param {number} height
 */
function jpegOf(width, height) {
  return Uint8Array.of(
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  );
}

/** The pictures the image import picks, each one page. */
const IMAGES = [
  { name: 'scan 1.jpg', bytes: jpegOf(300, 200) },
  { name: 'scan 2.jpg', bytes: jpegOf(100, 400) },
];

/** How long the hosts have to exit once killed. `hostRecoveryHost.mjs`' bound. */
const DEATH_BUDGET_MS = 5_000;
const POLL_MS = 250;

/**
 * This process's child process ids.
 *
 * `hostRecoveryHost.mjs`' enumeration, written out rather than imported because that
 * file runs its experiment on import. It is harness cleanup, not a mechanism the
 * product depends on.
 *
 * @returns {number[]}
 */
function childProcessIds() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(process.pid)}" | ` +
        `Where-Object { $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (result.error !== undefined) {
    throw new Error('could not enumerate this process’s children', { cause: result.error });
  }
  return `${result.stdout}`
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** @param {string} relative @returns {Promise<any>} */
function built(relative) {
  return import(pathToFileURL(join(ROOT, relative)).href);
}

/**
 * One call to a handler, with a throw recorded as an observation.
 *
 * @param {() => Promise<any>} call
 * @returns {Promise<any>}
 */
async function observed(call) {
  try {
    return await call();
  } catch (error) {
    return { threw: String(error?.constructor?.name ?? 'Error') };
  }
}

async function main() {
  if (REPORT_PATH === '') {
    throw new Error('composeHostLiveHost.mjs takes the path to write its report to as its one argument.');
  }
  if (!('electron' in process.versions)) {
    throw new Error(
      'composeHostLiveHost.mjs must run under the Electron binary in Node mode: ' +
        '`createEngineHostPlatform` refuses any other process.',
    );
  }

  /** @type {typeof import('../../apps/desktop/src/composition.js')} */
  const composition = await built('apps/desktop/dist/composition.js');
  /** @type {typeof import('../../apps/desktop/src/engineHostPlatform.js')} */
  const platformModule = await built('apps/desktop/dist/engineHostPlatform.js');
  /** @type {typeof import('../../apps/desktop/src/harnessComposition.js')} */
  const harnessModule = await built('apps/desktop/dist/harnessComposition.js');

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-compose-live-'));
  try {
    const sessionRoot = join(scratch, 'engine-sessions');
    mkdirSync(sessionRoot, { recursive: true });
    const platform = platformModule.createEngineHostPlatform(sessionRoot);
    if (platform === null) {
      throw new Error('createEngineHostPlatform returned null, so no contained host can exist here.');
    }
    const composePlatform = platformModule.createComposeHostPlatform(platform);
    if (composePlatform === null) {
      throw new Error('createComposeHostPlatform returned null: the compose container SID was not derived.');
    }

    // WHAT THE NEXT IMPORT READS AND WHERE IT GOES, set per call. The pickers are
    // the shell's surfaces and are fixed when the graph is built, so the two runs
    // below differ by these values rather than by two shells.
    /** @type {{ bytes: Uint8Array, destination: string }} */
    const next = { bytes: new Uint8Array(), destination: '' };

    const { handlers } = composition.createShellDependencies({
      ...harnessModule.harnessSurfaces('the compose-host live harness'),
      appInfo: { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' },
      pickMarkdown: () => Promise.resolve(join(scratch, 'notes.md')),
      readMarkdown: () => Promise.resolve({ kind: 'read', bytes: next.bytes }),
      pickCsv: () => Promise.resolve(join(scratch, 'table.csv')),
      readCsv: () => Promise.resolve({ kind: 'read', bytes: next.bytes }),
      pickImages: () => Promise.resolve(IMAGES.map((image) => join(scratch, image.name))),
      sizeImage: (/** @type {string} */ path) =>
        Promise.resolve(IMAGES.find((image) => path.endsWith(image.name))?.bytes.length ?? null),
      readImage: (/** @type {string} */ path) => {
        const image = IMAGES.find((candidate) => path.endsWith(candidate.name));
        return Promise.resolve(image === undefined ? { kind: 'unreadable' } : { kind: 'read', bytes: image.bytes });
      },
      pickDestination: () => Promise.resolve(next.destination),
      enginePlatform: platform,
      composePlatform,
    });

    next.bytes = new TextEncoder().encode(SOURCE);
    next.destination = join(scratch, 'composed.pdf');
    const composed = await observed(() => handlers['document.newFromMarkdown']({}));

    const header = existsSync(next.destination)
      ? readFileSync(next.destination).subarray(0, 5).toString('latin1')
      : null;

    /** @type {any} */
    let words = null;
    if (composed?.ok === true && composed.value?.kind === 'opened') {
      words = await observed(() =>
        handlers['document.pageWordCount']({ docId: composed.value.docId, page: 0 }),
      );
    }

    // A CSV TABLE THROUGH THE SAME HOST, on its own channel, read back the same way.
    next.bytes = new TextEncoder().encode(CSV_SOURCE);
    next.destination = join(scratch, 'composed-table.pdf');
    const csvComposed = await observed(() => handlers['document.newFromCsv']({}));
    /** @type {any} */
    let csvWords = null;
    if (csvComposed?.ok === true && csvComposed.value?.kind === 'opened') {
      csvWords = await observed(() =>
        handlers['document.pageWordCount']({ docId: csvComposed.value.docId, page: 0 }),
      );
    }

    // PICTURES THROUGH THE SAME HOST, on their own channel, counted by the MuPDF host.
    next.destination = join(scratch, 'composed-images.pdf');
    const imagesComposed = await observed(() => handlers['document.newFromImages']({}));
    /** @type {any} */
    let imagePages = null;
    if (imagesComposed?.ok === true && imagesComposed.value?.kind === 'opened') {
      imagePages = await observed(() =>
        handlers['document.viewModel']({ docId: imagesComposed.value.docId, pages: [0] }),
      );
    }

    // THE CONTROL: bytes that are not UTF-8, which only the composer can refuse.
    next.bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x0a]);
    next.destination = join(scratch, 'never-written.pdf');
    const refused = await observed(() => handlers['document.newFromMarkdown']({}));

    const report = {
      composed,
      header,
      words,
      refused,
      refusedWroteNothing: !existsSync(next.destination),
      expectedWords: SOURCE_WORDS,
      csvComposed,
      csvWords,
      expectedCsvWords: CSV_WORDS,
      imagesComposed,
      imagePages,
      expectedImagePages: IMAGES.length,
    };
    // THE REPORT FIRST, for `hostRecoveryHost.mjs`' reason: everything after it is
    // cleanup, and cleanup can fail.
    writeFileSync(REPORT_PATH, `${JSON.stringify(report)}\n`, 'utf8');

    for (const id of childProcessIds()) {
      try {
        process.kill(id);
      } catch {
        // Already gone.
      }
    }
    const startedAt = Date.now();
    while (childProcessIds().length > 0 && Date.now() - startedAt < DEATH_BUDGET_MS) {
      await sleep(POLL_MS);
    }

    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      process.stderr.write(
        `MONSTERA_COMPOSE_LIVE_LEAKED ${scratch} could not be removed: ${formatError(error)}\n`,
      );
    }

    // EXIT EXPLICITLY: the shell holds reader workers and pipes whose lifetimes are
    // the application's, so this process would not end on its own.
    process.exit(0);
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`MONSTERA_COMPOSE_LIVE_FAILED ${formatError(error)}\n`);
  process.exitCode = 1;
});
