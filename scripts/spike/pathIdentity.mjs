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

/** @type {Array<{ label: string, path: string }>} */
const forms = [
  { label: 'local drive letter', path: `C:\\${relative}` },
  { label: 'UNC admin share', path: `\\\\localhost\\C$\\${relative}` },
  { label: 'mapped network drive', path: `${letter}:\\${relative}` },
  { label: 'extended-length local', path: `\\\\?\\C:\\${relative}` },
  { label: 'extended-length UNC', path: `\\\\?\\UNC\\localhost\\C$\\${relative}` },
];

/** @type {Array<{ label: string, path: string, resolved: string, id: string }>} */
const results = [];
for (const form of forms) {
  try {
    const resolved = await realpathNative(form.path);
    // dev+ino is reported alongside, because the hard-link case shows the two
    // answers can differ: realpath cannot fold two equally canonical names, and
    // dev+ino does. Measuring only one of them would have settled the wrong
    // question.
    const s = statSync(form.path);
    results.push({ ...form, resolved, id: `${s.dev}:${s.ino}` });
  } catch (error) {
    const message = `ERROR ${error instanceof Error ? error.message : String(error)}`;
    results.push({ ...form, resolved: message, id: message });
  }
}

for (const result of results) {
  process.stdout.write(
    `${result.label.padEnd(24)} ${result.path}\n` +
      `${' '.repeat(24)} realpath -> ${result.resolved}\n` +
      `${' '.repeat(24)} dev:ino  -> ${result.id}\n\n`,
  );
}

const usable = results.filter((r) => !r.resolved.startsWith('ERROR'));
const distinct = [...new Set(usable.map((r) => r.resolved.toLowerCase()))];
const distinctIds = [...new Set(usable.map((r) => r.id))];

process.stdout.write(
  `${usable.length} form(s) resolved.\n` +
    `  realpath.native: ${distinct.length} distinct\n` +
    distinct.map((d) => `    ${d}\n`).join('') +
    `  dev:ino:         ${distinctIds.length} distinct\n` +
    distinctIds.map((d) => `    ${d}\n`).join(''),
);

// POSITIVE CONTROL. Fewer than two resolvable forms cannot answer the question,
// and the first run of this script proved why it has to be stated: with every
// form erroring, `distinct.length` was 0, which is not greater than 1, so it
// printed UNIFIES. A comparison instrument that reports agreement when it
// compared nothing is the 4b failure in a script written to avoid it.
if (usable.length < 2) {
  process.stderr.write(
    `\nMEASURED NOTHING. ${usable.length} form(s) resolved, so no two forms were compared and\n` +
      `neither answer is supported. Check the file exists and that the UNC/mapped forms are\n` +
      `reachable on this machine before reading anything above.\n`,
  );
  process.exit(1);
}

if (distinct.length > 1) {
  process.stdout.write(
    `\nDOES NOT UNIFY. Each distinct value above is a separate DocId under an identity\n` +
      `scheme that keys on realpath.native alone — two command logs for one file.\n`,
  );
} else {
  process.stdout.write(`\nUNIFIES. Every form folds to one identity.\n`);
}
