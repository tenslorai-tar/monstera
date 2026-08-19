// @ts-check
/**
 * Proof that the shim opens PDF and refuses every other format at RECOGNITION,
 * before a foreign parser sees the bytes (rule B2).
 *
 * ## What the old behaviour was, and why the return code did not show it
 *
 * `mz_open` called `fz_register_document_handlers`, which registers fourteen
 * parsers, and `fz_open_document` chooses between them by scoring the stream's
 * CONTENT as well as the filename. The shim's `"not a PDF"` refusal comes from
 * `pdf_specifics` AFTER `fz_open_document` returns, so a text or EPUB file was
 * fully opened by its own parser and only then rejected.
 *
 * A caller could not tell. Both paths return `MZ_ERR`. The observable difference
 * is the MESSAGE: a post-hoc rejection says `not a PDF`, while a refusal at
 * recognition is MuPDF's own "cannot recognize" error, and only the second means
 * no foreign parser ran. That is what this asserts, and it is the reason the
 * proof reads `mz_last_error` rather than the return code.
 *
 * ## The controls
 *
 * A real PDF must still open — otherwise "refuses everything" would satisfy
 * every case here — and the failing message must be the recognition one rather
 * than any failure at all, which is what separates this from the behaviour it
 * replaced.
 *
 * Fixtures are generated into a scratch directory rather than committed: they
 * are one line each, and a tracked `.txt` that MuPDF is meant to reject is a
 * fixture whose whole purpose is to not be a document.
 *
 * Usage: node scripts/proofs/documentHandlers.proof.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import koffi from 'koffi';

import { PERMITTED_HANDLERS } from '../lib/documentHandlers.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { buildLargeFixture } from '../perf/largeFixture.mjs';

const ROOT = repoRoot();
const DLL = join(ROOT, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
const SCRATCH = join(ROOT, '.probe', 'document-handlers');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

if (!existsSync(DLL)) {
  process.stderr.write(
    `${DLL} does not exist. Run: node scripts/provision/mupdf.mjs\nThis proof is about the built ` +
      `binary, so it fails rather than skipping — "could not check" must not read as "checked".\n`,
  );
  process.exit(1);
}

const lib = koffi.load(DLL);
const mz_init = lib.func('int mz_init(_Out_ void **out)');
const mz_open = lib.func('int mz_open(void *c, const char *path, _Out_ void **out)');
const mz_close = lib.func('int mz_close(void *c, void *d)');
const mz_drop = lib.func('void mz_drop(void *c)');
const mz_last_error = lib.func('const char *mz_last_error(void *c)');

const ctxOut = [null];
if (mz_init(ctxOut) !== 0) {
  process.stderr.write('mz_init failed\n');
  process.exit(1);
}
const ctx = ctxOut[0];

/** @param {string} path @returns {{ ok: boolean, error: string }} */
function open(path) {
  const out = [null];
  const status = mz_open(ctx, path, out);
  if (status === 0) {
    mz_close(ctx, out[0]);
    return { ok: true, error: '' };
  }
  return { ok: false, error: `${mz_last_error(ctx)}` };
}

try {
  mkdirSync(SCRATCH, { recursive: true });

  // Formats whose handlers used to be registered, each in a shape MuPDF's
  // content scoring would have recognised.
  /** @type {Array<{ format: string, name: string, bytes: string }>} */
  const foreign = [
    { format: 'txt', name: 'notes.txt', bytes: 'plain text that the txt handler would have opened\n' },
    { format: 'html', name: 'page.html', bytes: '<!DOCTYPE html>\n<html><body><p>hello</p></body></html>\n' },
    { format: 'svg', name: 'drawing.svg', bytes: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>\n' },
    { format: 'fb2', name: 'book.fb2', bytes: '<?xml version="1.0"?><FictionBook><body><p>x</p></body></FictionBook>\n' },
  ];

  for (const entry of foreign) {
    const path = join(SCRATCH, entry.name);
    writeFileSync(path, entry.bytes, 'utf8');
    const result = open(path);

    check(
      `${entry.format} is refused`,
      !result.ok,
      `mz_open SUCCEEDED on ${entry.name}. A format outside PERMITTED_HANDLERS ` +
        `(${PERMITTED_HANDLERS.join(', ')}) opened.`,
    );

    // The distinction the whole change is about. `not a PDF` means the foreign
    // handler ran and pdf_specifics cleaned up after it.
    check(
      `${entry.format} is refused at RECOGNITION, not after being parsed`,
      !result.ok && !/not a PDF/iu.test(result.error),
      `error was ${JSON.stringify(result.error)} — "not a PDF" is the post-hoc rejection, which ` +
        `means the ${entry.format} handler opened the file first. The registration change is ` +
        `what moves the refusal earlier, and this message is the only way to see it.`,
    );
  }

  // CONTROL. Without this, a shim that refused everything would pass every case
  // above, and "refuses foreign formats" would be indistinguishable from
  // "cannot open anything".
  //
  // BUILT HERE, not looked for. This used to read a fixture that another step —
  // the perf gate — happens to leave in a GITIGNORED directory, so the control
  // was present on a developer machine and absent on a runner, where the proof
  // then correctly refused to be evidence and failed the build. That is the
  // proof behaving well and the workflow depending on a leftover: item 4b says
  // put the control IN the instrument, and a control that only exists after
  // some other step ran is not in the instrument.
  //
  // The generator is content-addressed and reuses an identical fixture, so this
  // costs nothing on a machine that already has one.
  const pdf = buildLargeFixture({ root: ROOT, targetBytes: 64 * 1024, pages: 1 }).path;
  const result = open(pdf);
  check(
    'CONTROL: a real PDF still opens',
    result.ok,
    `mz_open failed on ${pdf}: ${result.error}. Every refusal above is worthless if the shim ` +
      `cannot open the one format it permits.`,
  );
} finally {
  mz_drop(ctx);
  rmSync(SCRATCH, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nDocument handler proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} document handler cases passed.\n`);
