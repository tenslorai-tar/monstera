// @ts-check
/**
 * How big the MuPDF adapter migration actually is, measured before it is started.
 *
 * ## The question
 *
 * [ADR-0010](../../docs/DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)'s
 * correction of 2026-09-08 rules the reach **native, both engines, koffi**, and
 * closes by saying what it does not settle: *"how much moves and in what order.
 * Nineteen non-test kernel modules import the bare specifier `mupdf`."*
 *
 * Nineteen modules is a count of **import statements**, and an import statement
 * is not a unit of work. What has to be built is the part of MuPDF's JavaScript
 * API those modules **call**, because that is what an FFI adapter over
 * `monstera_mupdf.dll` would have to expose. The two numbers are not close, and
 * nothing in the repository held the second one.
 *
 * ## Why the import count reads low
 *
 * Fifteen of the nineteen spell `import type`. A type-only import is erased by
 * the compiler and loads nothing at runtime — those modules receive a
 * `PDFDocument` or `PDFObject` somebody else opened and operate on it. So the
 * count that reads as *nineteen places to change one line* is really *four
 * modules that load an engine, and fifteen written against the object model it
 * hands back*. Changing the engine changes the object model, so all nineteen
 * bodies move, not their first lines.
 *
 * ## Its own controls
 *
 * This is a search, and a search reports **found nothing** for every way it can
 * be broken (`CLAUDE.md` item 4b). Three controls, and it throws rather than
 * printing when any fails:
 *
 * 1. the `.d.ts` parse must find `loadPage`, which MuPDF certainly declares;
 * 2. RESOLUTION (item 4a) — the same parse must **not** admit an invented name,
 *    so *declared by MuPDF* and *any identifier at all* are distinguishable;
 * 3. the call-site scan must find a module calling `loadPage`, which the kernel
 *    certainly does.
 *
 * An empty intermediate result is a broken parse and never a small API, so a
 * class table under twenty entries throws as well.
 *
 * Run:
 *
 *   npm run proof:enginesurface
 *
 * It prints readings, never a verdict. The count falling to zero is what the
 * migration finishing looks like.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = join(root, 'node_modules', 'mupdf', 'dist', 'mupdf.d.ts');
const SRC = join(root, 'packages', 'kernel', 'src');
const SHIM = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.c');

/**
 * Names JavaScript itself provides, which a call site may spell for reasons
 * that have nothing to do with MuPDF. Excluded so a `Map`'s `.get()` and a
 * `PDFObject`'s `.get()` are not counted as the same reading — the exclusion
 * costs real MuPDF members (`get`, `put` survive only because MuPDF's are not
 * in this list), which makes every figure below a FLOOR rather than an estimate.
 */
const BUILTIN = new Set([
  'delete', 'push', 'pop', 'map', 'filter', 'find', 'slice', 'splice', 'join',
  'concat', 'indexOf', 'includes', 'forEach', 'reduce', 'sort', 'toString',
  'valueOf', 'keys', 'values', 'entries', 'add', 'clear', 'call', 'apply',
  'bind', 'then', 'catch', 'finally', 'at', 'reverse', 'some', 'every', 'flat',
  'flatMap', 'fill', 'from', 'of', 'test', 'exec', 'replace', 'split', 'trim',
  'padStart', 'padEnd', 'repeat', 'startsWith', 'endsWith', 'charAt',
  'charCodeAt', 'codePointAt', 'normalize', 'toLowerCase', 'toUpperCase',
  'toFixed', 'round', 'floor', 'ceil', 'abs', 'min', 'max', 'has', 'set',
]);

/**
 * The classes MuPDF's shipped declarations describe, and the members each one
 * declares.
 *
 * @param {string} text
 * @returns {Map<string, Set<string>>}
 */
function declaredMembers(text) {
  /** @type {Map<string, Set<string>>} */
  const classes = new Map();
  let current = '';
  let depth = 0;
  for (const line of text.split(/\r?\n/)) {
    const open = /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (open !== null && depth === 0 && open[1] !== undefined) {
      current = open[1];
      classes.set(current, new Set());
    }
    if (current !== '') {
      const member = /^\s{2,}(?:readonly\s+|static\s+|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*[(<:]/.exec(line);
      const name = member?.[1];
      if (name !== undefined) classes.get(current)?.add(name);
    }
    depth += (line.match(/\{/gu) ?? []).length;
    depth -= (line.match(/\}/gu) ?? []).length;
    if (depth <= 0) {
      depth = 0;
      current = '';
    }
  }
  return classes;
}

const classes = declaredMembers(readFileSync(TYPES, 'utf8'));

/** @type {Map<string, string[]>} member name -> the classes declaring it */
const declaredBy = new Map();
for (const [className, members] of classes) {
  for (const member of members) {
    const where = declaredBy.get(member) ?? [];
    where.push(className);
    declaredBy.set(member, where);
  }
}

if (!declaredBy.has('loadPage')) {
  throw new Error('CONTROL FAILED: loadPage is not among the parsed members, so the mupdf.d.ts parse is blind and every count below would read as a clean absence.');
}
if (declaredBy.has('monsteraNotAMupdfMember')) {
  throw new Error('CONTROL FAILED: the parse admits an invented name, so it separates a declared member from any identifier at all.');
}
if (classes.size < 20) {
  throw new Error(`CONTROL FAILED: only ${String(classes.size)} classes parsed. An empty intermediate result is a broken parse, not a small API.`);
}

/** @type {{ name: string, kind: 'type-only' | 'value' }[]} */
const importers = [];
for (const name of readdirSync(SRC).sort()) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
  const body = readFileSync(join(SRC, name), 'utf8');
  if (!body.includes("from 'mupdf'")) continue;
  // A module is a runtime consumer if ANY of its mupdf imports is a value
  // import. `import type` is erased, so a file with only those loads nothing.
  const value = /^import\s+(?!type\b)[^;]*?from 'mupdf';/mu.test(body);
  importers.push({ name, kind: value ? 'value' : 'type-only' });
}

/** @type {Map<string, Set<string>>} member -> modules calling it */
const reached = new Map();
for (const { name } of importers) {
  const body = readFileSync(join(SRC, name), 'utf8');
  for (const hit of body.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/gu)) {
    const member = hit[1];
    if (member === undefined || BUILTIN.has(member) || !declaredBy.has(member)) continue;
    const where = reached.get(member) ?? new Set();
    where.add(name);
    reached.set(member, where);
  }
}

if (!reached.has('loadPage')) {
  throw new Error('CONTROL FAILED: no module was seen calling loadPage, which the kernel certainly does. The call-site scan is blind.');
}

const shim = readFileSync(SHIM, 'utf8');
const exported = [...shim.matchAll(/^MZ_EXPORT\s+[\w *]+?\**(mz_[a-z_]+)\s*\(/gmu)].map((m) => m[1] ?? '');
if (exported.length === 0) {
  throw new Error('CONTROL FAILED: the shim scan found no MZ_EXPORT symbols, and that file certainly declares some.');
}

/** Which MuPDF class each reached member belongs to, for the class table. */
/** @type {Map<string, Set<string>>} */
const byClass = new Map();
for (const member of reached.keys()) {
  for (const className of declaredBy.get(member) ?? []) {
    const members = byClass.get(className) ?? new Set();
    members.add(member);
    byClass.set(className, members);
  }
}

const values = importers.filter((i) => i.kind === 'value');
const out = process.stdout;
out.write('# The MuPDF surface the kernel reaches, against the surface the shim exports\n\n');
out.write(`  mupdf.d.ts: ${String(classes.size)} classes, ${String(declaredBy.size)} distinct declared members\n`);
out.write(`  kernel modules importing 'mupdf' (non-test): ${String(importers.length)}\n`);
out.write(`    of which LOAD an engine at runtime (a value import): ${String(values.length)}\n`);
out.write(`    of which import TYPES only, and are erased: ${String(importers.length - values.length)}\n`);
out.write(`  native shim exports: ${String(exported.length)} C functions\n\n`);

out.write('## The runtime consumers\n');
for (const { name } of values) out.write(`  ${name}\n`);
out.write('\n');

out.write(`## Distinct MuPDF members the kernel calls: ${String(reached.size)}\n`);
out.write('   Grouped by the class declaring them. The shim hands back an OPAQUE\n');
out.write('   handle and exposes no object model, so every member of a class it\n');
out.write('   does not represent has no counterpart to move onto.\n');
const ordered = [...byClass.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
for (const [className, members] of ordered) {
  out.write(`  ${className.padEnd(26)} ${String(members.size).padStart(3)}  ${[...members].sort().join(', ')}\n`);
}

out.write('\n## What the shim exports today\n');
for (const name of exported) out.write(`  ${name}\n`);
out.write('\n  A reading, not a verdict. The member count falling to zero is what\n');
out.write('  the migration finishing looks like.\n');
