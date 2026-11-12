// @ts-check
/**
 * What a kept font catalogue would cost a host to load, against reading the fonts: the catalogue read once as a host
 * reads it, written as JSON with each face's characters as ranges, then loaded back and rebuilt into faces five times.
 *
 *   node scripts/research/keptCatalogueCost.mjs <scratch folder>
 *
 * The file is written to the folder given, which must not be in the repository: it names the machine's font files.
 * Prints sizes and milliseconds only. Its control: the faces loaded back must equal the faces read, face by face and
 * character by character, or the load time is of a different catalogue.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';

const ROOT = repoRoot();
const scratch = process.argv[2];
if (scratch === undefined) throw new Error('usage: node scripts/research/keptCatalogueCost.mjs <scratch folder outside the repository>');
if (resolve(scratch).toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error('the scratch folder is inside the repository, and the file names the machine’s fonts');
// A LITERAL SPECIFIER per module, so the import scans can read what this loads.
const { fontFoldersOf } = await import('../../packages/kernel/dist/fontCatalogue.js');
const { readCatalogueApart } = await import('../../packages/kernel/dist/fontCatalogueApart.js');

const root = process.env['SystemRoot'] ?? process.env['windir'];
if (root === undefined) throw new Error('no SystemRoot');
const folders = fontFoldersOf(fontsDirectory(ROOT), win32.join(root, 'Fonts'));

let started = performance.now();
const read = readCatalogueApart(folders);
process.stdout.write(`read from the fonts: ${(performance.now() - started).toFixed(0)} ms, ${String(read.faces.length)} faces\n`);

/** @param {ReadonlySet<number>} set @returns {number[]} start, end pairs */
function rangesOf(set) {
  const sorted = [...set].sort((a, b) => a - b);
  /** @type {number[]} */
  const ranges = [];
  for (const code of sorted) {
    const last = ranges.length - 1;
    if (last >= 1 && ranges[last] === code - 1) ranges[last] = code;
    else ranges.push(code, code);
  }
  return ranges;
}
/** @param {readonly number[]} ranges */
function setOf(ranges) {
  const set = new Set();
  for (let at = 0; at < ranges.length; at += 2) for (let code = ranges[at] ?? 0; code <= (ranges[at + 1] ?? -1); code += 1) set.add(code);
  return set;
}

mkdirSync(scratch, { recursive: true });
const file = join(scratch, 'kept-catalogue.json');
started = performance.now();
writeFileSync(file, JSON.stringify({ faces: read.faces.map((face) => ({ ...face, unicodes: rangesOf(face.unicodes) })), unreadable: read.unreadable }));
process.stdout.write(`written: ${(performance.now() - started).toFixed(0)} ms, ${(statSync(file).size / 1048576).toFixed(1)} MiB\n`);

for (let round = 1; round <= 5; round += 1) {
  started = performance.now();
  /** @type {{ faces: (Record<string, unknown> & { unicodes: number[] })[] }} */
  const kept = JSON.parse(readFileSync(file, 'utf8'));
  const faces = kept.faces.map((face) => ({ ...face, unicodes: setOf(face.unicodes) }));
  const took = performance.now() - started;
  // THE CONTROL: the same faces, in order, carrying the same characters.
  const same =
    faces.length === read.faces.length &&
    faces.every((face, at) => {
      const original = read.faces[at];
      return original !== undefined && face['id'] === original.id && face.unicodes.size === original.unicodes.size && [...original.unicodes].every((code) => face.unicodes.has(code));
    });
  if (!same) throw new Error('the faces loaded back differ from the faces read, so the load time is of another catalogue');
  process.stdout.write(`load ${String(round)}: ${took.toFixed(0)} ms, the same ${String(faces.length)} faces\n`);
}
