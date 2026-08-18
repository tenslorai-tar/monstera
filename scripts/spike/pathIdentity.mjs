// @ts-check
/**
 * Measures which path forms `fs.realpath.native` folds to one identity.
 *
 * ADR-0009 makes document identity `fs.realpath.native`, and its table of
 * measured cases covers Windows case folding, 8.3 short names and the `\\?\`
 * prefix. It does **not** cover the shape an office generates constantly: the
 * same file reached as a **mapped network drive** and as its **UNC target**.
 *
 * `Z:\reports\annual.pdf` and `\\server\share\reports\annual.pdf` are one file.
 * One arrives from Recent Files, the other from a colleague's link. If they
 * resolve to two `DocId`s they get two command logs, and the second save
 * discards the first's edits.
 *
 * Whether they unify is a property of libuv's `GetFinalPathNameByHandle` call
 * and the volume-name flag it passes, which nothing in this repository has
 * established. So it is measured rather than assumed, and whichever answer comes
 * back is recorded — an unmeasured row is what the three measured ones exist to
 * shame.
 *
 * Uses `\\localhost\C$` over the loopback SMB redirector. That is a real network
 * redirector path and a real mapped drive, not a `subst` alias — `subst` creates
 * a DOS device mapping that never touches the redirector, so it would answer a
 * different question and answer it reassuringly.
 *
 * Usage:
 *   node scripts/spike/pathIdentity.mjs <drive-letter> <file-under-C>
 *   e.g. node scripts/spike/pathIdentity.mjs Z Users/x/probe.txt
 */

import { realpath, statSync } from 'node:fs';
import { promisify } from 'node:util';

// `fs.promises.realpath.native` does not exist; this is the documented route.
const realpathNative = promisify(realpath.native);

const letter = (process.argv[2] ?? '').replace(/:$/u, '');
const relative = (process.argv[3] ?? '').replaceAll('/', '\\');

if (letter === '' || relative === '') {
  process.stderr.write('usage: node scripts/spike/pathIdentity.mjs <drive-letter> <file-under-C>\n');
  process.exit(1);
}

/**
 * Each form carries the ROUTE it exercises, not just a label.
 *
 * The question is whether a redirector path folds to its local equivalent, so
 * the answer is only supported if at least one form of **each** route resolved.
 * A count cannot express that, which is finding R-2's sibling and the reason
 * this script was rewritten — see the control below.
 *
 * @type {Array<{ label: string, route: 'local' | 'redirector', path: string }>}
 */
const forms = [
  { label: 'local drive letter', route: 'local', path: `C:\\${relative}` },
  { label: 'extended-length local', route: 'local', path: `\\\\?\\C:\\${relative}` },
  { label: 'UNC admin share', route: 'redirector', path: `\\\\localhost\\C$\\${relative}` },
  {
    label: 'extended-length UNC',
    route: 'redirector',
    path: `\\\\?\\UNC\\localhost\\C$\\${relative}`,
  },
  { label: 'mapped network drive', route: 'redirector', path: `${letter}:\\${relative}` },
];

/**
 * @type {Array<{
 *   label: string, route: 'local' | 'redirector', path: string,
 *   resolved: string | null, id: string | null, error: string | null,
 * }>}
 */
const results = [];
for (const form of forms) {
  try {
    const resolved = await realpathNative(form.path);
    // dev+ino is reported alongside, because the hard-link case shows the two
    // answers can differ: realpath cannot fold two equally canonical names, and
    // dev+ino does. Measuring only one of them would have settled the wrong
    // question.
    const s = statSync(form.path);
    results.push({ ...form, resolved, id: `${s.dev}:${s.ino}`, error: null });
  } catch (error) {
    // Recorded as a form that did NOT answer, with the reason. It is never
    // folded into the comparison, and it is never rendered as a row.
    results.push({
      ...form,
      resolved: null,
      id: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const answered = results.filter((r) => r.resolved !== null && r.id !== null);
const silent = results.filter((r) => r.resolved === null);

// -----------------------------------------------------------------------------
// THE CONTROL, and it is an IDENTITY rather than a COUNT.
//
// The previous version required two forms to have resolved. That floor is
// satisfied by the two EASIEST forms: on a machine with admin shares disabled —
// which is a great many Windows machines, since \\localhost\C$ is an admin share
// — every redirector form errors, `C:\…` and `\\?\C:\…` resolve, and they were
// never going to disagree. It printed UNIFIES, exit 0, having never reached the
// thing it exists to measure. Measured, not supposed.
//
// This is the same distinction DocumentService.checkWriteTarget already carries:
// "how many answers did I get" is not "which forms answered", and "could not
// look" must never render as a measurement. It is `target-absent` versus
// `sole-writer` in a different file.
//
// So the run refuses unless BOTH routes answered, and it refuses BEFORE printing
// any rows — a table of local forms under a heading about network paths is the
// trap, and ADR-0009 invites a future reader to re-run this exact script.
// -----------------------------------------------------------------------------
/**
 * Derived from `forms` rather than listed, so adding a route to the table above
 * extends the control instead of quietly escaping it.
 *
 * @type {Array<'local' | 'redirector'>}
 */
const requiredRoutes = [...new Set(forms.map((f) => f.route))];
const routesAnswered = new Set(answered.map((r) => r.route));
const missingRoutes = requiredRoutes.filter((route) => !routesAnswered.has(route));

if (missingRoutes.length > 0) {
  process.stderr.write(
    `MEASURED NOTHING about the question this script exists to answer.\n\n` +
      `No form of route(s) ${missingRoutes.join(' and ')} resolved, so no comparison spans\n` +
      `the boundary between them and NEITHER answer is supported. Nothing is printed above,\n` +
      `deliberately: a table of forms that happened to work is what makes an unreachable\n` +
      `redirector look like a measurement.\n\n` +
      `Forms that did not answer:\n` +
      silent.map((r) => `  ${r.label.padEnd(24)} ${r.path}\n${' '.repeat(26)}${r.error}\n`).join('') +
      `\n\\\\localhost\\C$ is an ADMIN SHARE. It is disabled or elevation-gated on many\n` +
      `machines, which is the ordinary reason for this failure and not an exotic one.\n`,
  );
  process.exit(1);
}

for (const result of answered) {
  process.stdout.write(
    `${result.label.padEnd(24)} ${result.path}\n` +
      `${' '.repeat(24)} realpath -> ${String(result.resolved)}\n` +
      `${' '.repeat(24)} dev:ino  -> ${String(result.id)}\n\n`,
  );
}

// Forms that did not answer are still reported, because "this machine has no
// mapped drive" is a fact about the measurement's coverage and belongs beside
// it. They are listed as absences, never as rows.
if (silent.length > 0) {
  process.stdout.write(
    `${silent.length} form(s) did NOT answer, and are excluded from the comparison:\n` +
      silent.map((r) => `  ${r.label.padEnd(24)} ${r.error ?? ''}\n`).join('') +
      `\n`,
  );
}

const distinct = [...new Set(answered.map((r) => String(r.resolved).toLowerCase()))];
const distinctIds = [...new Set(answered.map((r) => String(r.id)))];

process.stdout.write(
  `${answered.length} form(s) answered, covering both routes.\n` +
    `  realpath.native: ${distinct.length} distinct\n` +
    distinct.map((d) => `    ${d}\n`).join('') +
    `  dev:ino:         ${distinctIds.length} distinct\n` +
    distinctIds.map((d) => `    ${d}\n`).join(''),
);

if (distinct.length > 1) {
  process.stdout.write(
    `\nDOES NOT UNIFY. Each distinct value above is a separate DocId under an identity\n` +
      `scheme that keys on realpath.native alone — two command logs for one file.\n`,
  );
} else {
  process.stdout.write(`\nUNIFIES. Every form folds to one identity.\n`);
}
