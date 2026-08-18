// @ts-check
/**
 * Proof that invariant 23's enforcement can actually catch a violation
 * (rule B2, and the search-instrument rule beside stage audit 4a).
 *
 * Both halves of this check are searches, so both fail toward "found nothing":
 * a broken derivation yields an empty banned set, and a broken scan finds no
 * uses of it. Either way the build stays green and the invariant is unguarded.
 * So each half gets a case that must locate something known-present, and the
 * violation case plants a real one.
 *
 * Usage: node scripts/proofs/pathDispatch.proof.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { mupdfSourcePath } from '../provision/mupdf.mjs';
import { deriveFormatDispatchers, shippedUsesOfDispatchers } from '../security/pathDispatch.mjs';

const ROOT = repoRoot();
const SOURCE = mupdfSourcePath(ROOT);
const SHIM_PROJECT = join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

if (!existsSync(join(SOURCE, 'source', 'fitz', 'writer.c'))) {
  passed.push('SKIPPED: MuPDF source not provisioned — nothing was derived or checked here');
} else {
  const { dispatchers, seeds } = deriveFormatDispatchers(SOURCE, SHIM_PROJECT);

  check(
    'the derivation is seeded from MuPDF\'s own extension matcher',
    seeds.length > 0 && seeds.every((seed) => seed.endsWith('::is_extension')),
    `seeds: ${seeds.join(', ') || '(none)'} — is_extension is static to writer.c, so every ` +
      `filename-driven selection in the engine passes through it. An empty seed set would make ` +
      `the banned list empty, which reads as "nothing dispatches on a filename".`,
  );

  check(
    'fz_new_document_writer is derived as a dispatcher',
    dispatchers.includes('fz_new_document_writer'),
    `derived: ${dispatchers.join(', ') || '(none)'} — this is the function that starts Tesseract ` +
      `from a path ending .ocr, so a derivation that misses it guards nothing that matters`,
  );

  check(
    'its three siblings are derived too, rather than only the instance',
    ['fz_new_document_writer_with_output', 'fz_new_document_writer_with_buffer', 'fz_new_buffer_from_page_with_format'].every(
      (name) => dispatchers.includes(name),
    ),
    `derived: ${dispatchers.join(', ')} — banning one and leaving its siblings is the classic ` +
      `half-fix, which is why the set is derived rather than listed`,
  );

  // RESOLUTION: the set must exclude functions that take a path and do NOT
  // dispatch on it. Without this the "derivation" could be "anything taking a
  // const char *" and every case above would still pass.
  for (const innocent of ['fz_open_document', 'pdf_save_document', 'fz_new_pdf_writer']) {
    check(
      `RESOLUTION: ${innocent} is NOT a dispatcher despite taking a path`,
      !dispatchers.includes(innocent),
      `derived: ${dispatchers.join(', ')} — ${innocent} takes a filename and does not let it ` +
        `choose an implementation. A rule that banned every path-taking function would ban the ` +
        `shim's own save path, and would be switched off within a week.`,
    );
  }

  check(
    'no shipped file names a dispatcher',
    shippedUsesOfDispatchers(dispatchers, ROOT).length === 0,
    shippedUsesOfDispatchers(dispatchers, ROOT)
      .map((use) => `${use.file}: ${use.symbol}`)
      .join('\n      '),
  );

  // CONTROL for the scan half: it must find something that IS there.
  check(
    'CONTROL: the scan finds a symbol the shim demonstrably calls',
    shippedUsesOfDispatchers(['pdf_save_document'], ROOT).length > 0,
    'the scan reports nothing even for pdf_save_document, which mz_save calls directly — so its ' +
      'silence about dispatchers is silence about everything, and the check is decorative',
  );

  // CONTROL for the whole thing: a planted violation must be caught. Written
  // under native/ so it is inside the scanned scope, and staged so the commit
  // scope sees it — the scan reads the index, not the working tree.
  {
    const planted = join(ROOT, 'native', 'mupdf-shim', '__dispatch_probe__.c');
    try {
      mkdirSync(join(ROOT, 'native', 'mupdf-shim'), { recursive: true });
      writeFileSync(
        planted,
        'MZ_EXPORT int mz_probe(fz_context *ctx, const char *path)\n' +
          '{\n\treturn fz_new_document_writer(ctx, path, NULL, NULL) == NULL;\n}\n',
        'utf8',
      );

      const { execFileSync } = await import('node:child_process');
      execFileSync('git', ['add', '--intent-to-add', planted], { cwd: ROOT });

      const caught = shippedUsesOfDispatchers(dispatchers, ROOT);
      check(
        'CONTROL: a planted call to fz_new_document_writer is caught',
        caught.some((use) => use.file.includes('__dispatch_probe__')),
        `found ${caught.map((use) => `${use.file}:${use.symbol}`).join(', ') || 'nothing'} — if a ` +
          `real violation is not reported, the passing result above means only that the scan ` +
          `never looks`,
      );

      execFileSync('git', ['rm', '--cached', '--force', '--quiet', planted], { cwd: ROOT });
    } finally {
      rmSync(planted, { force: true });
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\nPath-dispatch proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} path-dispatch cases passed.\n`);
