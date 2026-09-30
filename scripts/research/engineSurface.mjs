// @ts-check
/**
 * How much of the kernel's MuPDF surface is still off the native engine — the reading the migration of
 * [ADR-0124](../../docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md) was measured
 * against, and the one that says it is finished.
 *
 * ## The question, twice
 *
 * Before the migration this counted the members of MuPDF's WASM object model the kernel calls — 140 on 2026-09-30,
 * against 26 shim exports — because an adapter over `monstera_mupdf.dll` had to expose them. ADR-0124 moved that
 * object model onto the DLL (MuPDF's own `mupdf.ts`, carried in `mupdfRaw.ts`), so the question splits:
 *
 * 1. **Does any kernel module still reach the WASM engine?** A module importing the bare specifier `mupdf` does.
 *    The members those modules call are the migration's remaining size; zero is finished.
 * 2. **Does the native engine answer everything the kernel calls?** Every member the kernel calls must be declared
 *    by `mupdfRaw.ts`' classes, and every `_wasm_*` export the object model calls must be in the built DLL's own
 *    signature table — read from the DLL, which is the artefact, not from the source that should have built it.
 *
 * ## Its own controls
 *
 * This is a search, and a search reports *found nothing* for every way it can be broken (`CLAUDE.md` item 4b):
 *
 * - the declaration parse must find `loadPage`, and must NOT admit an invented name (resolution, item 4a);
 * - the call-site scan must see a kernel module calling `loadPage`, which the kernel certainly does;
 * - the DLL's table must contain `wasm_load_page`, and must not contain an invented export.
 *
 * Where the DLL is not built the second half is reported as not verified, never as clean.
 *
 *   npm run proof:enginesurface
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { shimLibraryPath } from '../provision/mupdf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(root, 'packages', 'kernel', 'src');
const RAW = join(SRC, 'mupdfRaw.ts');

/**
 * Names JavaScript itself provides, which a call site may spell for reasons that have nothing to do with MuPDF.
 * Excluded so a `Map`'s `.get()` and a `PDFObject`'s `.get()` are not counted as the same reading — which makes every
 * figure below a FLOOR rather than an estimate.
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
 * The exported classes of `mupdfRaw.ts` and the members each declares, read by the compiler's own parser.
 *
 * @param {string} text
 * @returns {Map<string, Set<string>>}
 */
function declaredMembers(text) {
  const source = ts.createSourceFile(RAW, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** @type {Map<string, Set<string>>} */
  const classes = new Map();
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name === undefined) continue;
    const members = new Set();
    for (const member of statement.members) {
      const name = member.name;
      if (name !== undefined && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name))) members.add(name.text);
    }
    classes.set(statement.name.text, members);
  }
  return classes;
}

const rawText = readFileSync(RAW, 'utf8');
const classes = declaredMembers(rawText);
/** @type {Map<string, string[]>} member name -> the classes declaring it */
const declaredBy = new Map();
for (const [className, members] of classes) {
  for (const member of members) declaredBy.set(member, [...(declaredBy.get(member) ?? []), className]);
}
if (!declaredBy.has('loadPage')) throw new Error('CONTROL FAILED: loadPage is not among the members parsed from mupdfRaw.ts, so the parse is blind.');
if (declaredBy.has('monsteraNotAMupdfMember')) throw new Error('CONTROL FAILED: the parse admits an invented name.');
if (classes.size < 20) throw new Error(`CONTROL FAILED: only ${String(classes.size)} classes parsed; an empty intermediate result is a broken parse.`);

/** @type {{ name: string, engine: 'wasm' | 'native', kind: 'type-only' | 'value' }[]} */
const importers = [];
for (const name of readdirSync(SRC, { recursive: true }).map(String).sort()) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name.endsWith('mupdfRaw.ts')) continue;
  const body = readFileSync(join(SRC, name), 'utf8');
  for (const [engine, specifier] of /** @type {const} */ ([['wasm', /from '(mupdf)';/u], ['native', /from '((?:\.\.?\/)+mupdfRaw\.js)';/u]])) {
    const match = specifier.exec(body);
    if (match === null) continue;
    const quoted = match[1] ?? '';
    const value = new RegExp(`^import\\s+(?!type\\b)[^;]*?from '${quoted.replace(/[.]/gu, '\\.')}';`, 'mu').test(body);
    importers.push({ name, engine, kind: value ? 'value' : 'type-only' });
  }
}

/**
 * @param {'wasm' | 'native'} engine
 * @returns {Map<string, Set<string>>} member -> the modules calling it
 */
function reachedBy(engine) {
  /** @type {Map<string, Set<string>>} */
  const reached = new Map();
  for (const { name } of importers.filter((each) => each.engine === engine)) {
    const body = readFileSync(join(SRC, name), 'utf8');
    for (const hit of body.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/gu)) {
      const member = hit[1];
      if (member === undefined || BUILTIN.has(member) || !declaredBy.has(member)) continue;
      reached.set(member, new Set([...(reached.get(member) ?? []), name]));
    }
  }
  return reached;
}

const wasm = reachedBy('wasm');
const native = reachedBy('native');
if (!native.has('loadPage') && !wasm.has('loadPage')) {
  throw new Error('CONTROL FAILED: no kernel module was seen calling loadPage, which the kernel certainly does. The call-site scan is blind.');
}

/** Every `_wasm_*` export the object model calls. */
const called = new Set([...rawText.matchAll(/libmupdf\._(wasm_[A-Za-z0-9_]+)/gu)].map((m) => m[1] ?? ''));

/** @returns {Set<string> | null} the DLL's own export table, or null where no DLL is built */
function dllTable() {
  const path = shimLibraryPath(root);
  if (!existsSync(path)) return null;
  const koffi = createRequire(RAW)('koffi');
  const library = koffi.load(path);
  const count = library.func('int mzg_signature_count(void)')();
  const row = library.func('const char *mzg_signature(int i)');
  const names = new Set();
  for (let i = 0; i < count; i += 1) names.add(String(row(i)).split('|')[0]);
  return names;
}

const table = dllTable();
if (table !== null) {
  if (!table.has('wasm_load_page')) throw new Error('CONTROL FAILED: the DLL table does not list wasm_load_page, which MuPDF certainly exports.');
  if (table.has('wasm_monstera_not_an_export')) throw new Error('CONTROL FAILED: the DLL table lists an invented export.');
}
const missing = table === null ? [] : [...called].filter((name) => !table.has(name));

const out = process.stdout;
/**
 * @param {'wasm' | 'native'} engine
 * @param {'value' | 'type-only'} [kind]
 */
const count = (engine, kind) =>
  importers.filter((each) => each.engine === engine && (kind === undefined || each.kind === kind)).length;
out.write('# The MuPDF surface the kernel reaches\n\n');
out.write(`  mupdfRaw.ts: ${String(classes.size)} classes, ${String(declaredBy.size)} distinct declared members\n`);
out.write(`  kernel modules importing the WASM engine ('mupdf', non-test): ${String(count('wasm'))}\n`);
out.write(`  members of MuPDF's object model they call: ${String(wasm.size)}\n`);
out.write(`  kernel modules importing the native engine (mupdfRaw.js, non-test): ${String(count('native'))}\n`);
out.write(`    of which LOAD it (a value import): ${String(count('native', 'value'))}, TYPES only: ${String(count('native', 'type-only'))}\n`);
out.write(`  members they call: ${String(native.size)}\n`);
out.write(`  _wasm_* exports the object model calls: ${String(called.size)}\n`);
if (table === null) {
  out.write(`  the DLL's own table: NOT VERIFIED — ${shimLibraryPath(root)} is not built here\n`);
} else {
  out.write(`  the DLL's own table: ${String(table.size)} exports; called and missing: ${String(missing.length)}\n`);
  for (const name of missing) out.write(`    MISSING ${name}\n`);
}
if (wasm.size > 0) {
  out.write('\n## Members still reached through the WASM engine\n');
  for (const [member, modules] of [...wasm.entries()].sort()) out.write(`  ${member}  (${[...modules].join(', ')})\n`);
}
out.write('\n  The migration is finished when no module imports the WASM engine and nothing called is missing.\n');
process.exitCode = missing.length > 0 ? 1 : 0;
