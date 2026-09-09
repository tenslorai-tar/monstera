// @ts-check
/**
 * Which text and page-object entry points the pinned PDFium actually exports.
 *
 * ## Why this exists rather than a list in a document
 *
 * [ADR-0034](../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md)'s
 * route 2 for an engine that cannot answer a question is *"a recorded engine
 * gap — name what was checked and what is missing, in an ADR, so the matrix
 * stays truthful"*. **What was checked** has to be a command somebody can re-run,
 * not a sentence: a claim that an API does not exist is a search, and a search's
 * silence is its most convincing failure mode (audit item 4b).
 *
 * So this reads the DLL's own export table — `peExports.mjs`, the same parser
 * `proof:pdfiumbinary` uses — and prints every name in the three families a
 * grouping could plausibly live in. A reader can see the whole set rather than
 * taking *"there is no such call"* on trust.
 *
 * ## Its positive control is the print itself
 *
 * A pattern that matched nothing would print three empty groups, which is
 * exactly what a broken parse produces. The totals are printed beside the
 * groups for that reason: `FPDFText_` is populous in every build, so a zero
 * there is a broken instrument rather than an absent API, and the reader can
 * tell the two apart without running anything else.
 *
 * Usage: node scripts/research/pdfiumTextExports.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { peExports } from '../lib/peExports.mjs';
import { formatError } from '../lib/reportError.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The families a line grouping over page objects could live in. */
const FAMILIES = ['FPDFText_', 'FPDFTextObj_', 'FPDFPageObj_'];

try {
  const library = pdfiumLibrary(REPO_ROOT);
  const names = peExports(readFileSync(library));

  process.stdout.write(
    `# PDFium ${PDFIUM_VERSION} — text and page-object exports\n\n` +
      `  library: ${library}\n` +
      `  total exports: ${String(names.length)}\n\n`,
  );

  for (const family of FAMILIES) {
    const found = names.filter((name) => name.startsWith(family)).sort();
    process.stdout.write(`## ${family} — ${String(found.length)}\n\n`);
    for (const name of found) process.stdout.write(`  ${name}\n`);
    process.stdout.write('\n');
  }

  process.stdout.write(
    `The question this was run to answer: does any of these group PAGE OBJECTS?\n` +
      `Read the FPDFText_ family as operating on a TEXT PAGE — a flat sequence of\n` +
      `characters — and the FPDFPageObj_ family as operating on one object at a time.\n`,
  );
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
