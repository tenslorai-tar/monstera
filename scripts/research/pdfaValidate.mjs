// @ts-check
/**
 * Validates a PDF/A-2b export with the provisioned veraPDF, beside its own control
 * ([ADR-0075](../../docs/DECISIONS/0075-pdfa-2b-is-ghostscripts-pdfwrite-and-what-it-removes-is-reported.md)
 * Decision 5: *a research instrument runs the shipped conversion path and validates the result*).
 *
 * ## The control is the SOURCE, and it must fail
 *
 * A validator that passes everything — a wrong flavour, a profile that did not load, a runtime
 * that printed nothing parseable — reports exactly what a conformant export does. So the
 * instrument validates the unconverted source too, and refuses to report the export's verdict
 * unless the source FAILS: that is the reading which proves this run of the validator can see a
 * non-conformance at all. A source that is already PDF/A-2b cannot be a control, and the
 * instrument says so rather than guessing.
 *
 * Needs `npm run provision:verapdf`. The export comes from the application (Home › File ›
 * *Export as PDF/A…*) or from `ghostscriptContained.mjs --keep`, which runs the shipped arguments
 * inside the container.
 *
 * Usage: node scripts/research/pdfaValidate.mjs <export.pdf> <source.pdf>
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { repoRoot } from '../lib/gitScope.mjs';
import { javaPath, verapdfArguments } from '../provision/verapdf.mjs';

const ROOT = repoRoot();
const [exported, source] = process.argv.slice(2);
if (exported === undefined || source === undefined || !existsSync(exported) || !existsSync(source)) {
  process.stderr.write('Usage: node scripts/research/pdfaValidate.mjs <export.pdf> <source.pdf>\n');
  process.exit(2);
}
if (!existsSync(javaPath(ROOT))) {
  process.stderr.write('veraPDF is not provisioned: run `npm run provision:verapdf`.\n');
  process.exit(69);
}

/**
 * veraPDF's verdict on one file as PDF/A-2b, read from its machine-readable report.
 *
 * @param {string} file
 * @returns {{ compliant: boolean, failedRules: number }}
 */
function validate(file) {
  const run = spawnSync(javaPath(ROOT), verapdfArguments(ROOT, ['--flavour', '2b', '--format', 'xml', file]), {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error !== undefined) throw run.error;
  const job = /<validationReport [^>]*isCompliant="(true|false)"/u.exec(run.stdout);
  if (job === null) {
    throw new Error(`veraPDF printed no validation report for ${file} (exit ${String(run.status)}):\n${run.stderr.slice(0, 2000)}`);
  }
  const failed = /<details [^>]*failedRules="(\d+)"/u.exec(run.stdout);
  return { compliant: job[1] === 'true', failedRules: Number(failed?.[1] ?? Number.NaN) };
}

const control = validate(source);
process.stdout.write(`source  ${source}: ${control.compliant ? 'COMPLIANT' : 'not compliant'} (${String(control.failedRules)} failed rules)\n`);
if (control.compliant) {
  process.stderr.write(
    'The source is already PDF/A-2b, so it cannot show that this run of the validator finds a ' +
      'non-conformance. Nothing is reported about the export; pick a source that is not.\n',
  );
  process.exit(3);
}

const verdict = validate(exported);
process.stdout.write(`export  ${exported}: ${verdict.compliant ? 'PASS as PDF/A-2b' : 'FAIL'} (${String(verdict.failedRules)} failed rules)\n`);
process.exitCode = verdict.compliant ? 0 : 1;
