// @ts-check
/**
 * Which JavaScript modules the application can load: the closure of its entry over the module graph (decision E).
 *
 * ## Why the graph decides, and never a file name
 *
 * The package used to take every module a `dist/` held, less those NAMED as tests (`*.test.js` and its siblings). A
 * test helper named otherwise was shipped: `engineHostFake.js`, the Win32 surfaces two test files fake a host with, sat
 * in the owner's 0.1.6.0 beside the shell. So were the harnesses the proofs drive. Nothing about those files is wrong in
 * `dist/` — the proofs run them from there — and a naming rule would only move the failure to the next helper somebody
 * names naturally. Whether a module ships is a fact about the program: can the application reach it?
 *
 * ## Three kinds of edge, all read from the module's own text
 *
 * - an IMPORT — static, `export … from`, or `import()` with a literal specifier — relative to the file, or into a
 *   workspace package through that package's own `exports` map (B3a: the map is the authority Node resolves by);
 * - a RESOLVE — `require.resolve('x')` or `createRequire(…).resolve('x')`, through either receiver or a name bound to
 *   `createRequire(…)` — followed exactly as an import of `x` is, because Node resolves it to the same file and THROWS
 *   when that file is absent, whether or not anything then loads it. The shell finds the reader's directory this way
 *   (`readerHostSurface.ts`): `@monstera/nodemode`'s entry is types only and erased to `export {}`, the desktop
 *   imports it with `import type` alone, and so the entry was reached by nothing while the shell's first act on
 *   starting was to resolve it. 0.1.7.0 shipped without it and did not start;
 * - a FILE NAMED BY LITERAL — `'preload.cjs'`, `'readerWorker.js'`, the host entry table — because that is how the
 *   shell starts a preload, a worker and every contained host: by path, which no import names. Every string literal
 *   ending `.js`, `.mjs` or `.cjs` in a reached module reaches each candidate with that file name.
 *
 * A module reached by ANY of the three is then read like the entry, so a worker started by path has its own imports
followed — the proof holds that with a by-path module that imports a sibling nothing else names.

A path COMPUTED without a literal would be invisible, and the module it names would be left out of the package. So
 * the caller names modules the application is known to load by path, and the closure REFUSES to answer when one of
 * them is not in it — the positive control, run every time, because a closure that could see nothing would otherwise
 * report a very small package.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';

/**
 * @typedef {{
 *   readonly entry: string,
 *   readonly roots: readonly string[],
 *   readonly packageDir: (name: string) => string | null,
 *   readonly mustReach: readonly string[],
 *   readonly ts: typeof import('typescript'),
 * }} ClosureInput
 */

/**
 * The modules the application is known to load by path — the closure's positive control. The host entries are read
 * from the built table the shell starts them from (`ENGINE_HOST_ENTRY_FILE`), so a host added there is controlled
 * here without an edit; the preload and the reader's worker are each named by one literal in the shell.
 *
 * @param {string} desktopDist the desktop package's built `dist/`
 * @returns {Promise<string[]>}
 */
export async function modulesLoadedByPath(desktopDist) {
  const programs = join(desktopDist, 'engineHostPrograms.js');
  if (!existsSync(programs)) throw new Error(`${programs} is not built, so the host entries cannot be read.`);
  /** @type {{ ENGINE_HOST_ENTRY_FILE: Record<string, string> }} */
  const table = await import(`file://${resolve(programs).replaceAll('\\', '/')}`);
  const hosts = Object.values(table.ENGINE_HOST_ENTRY_FILE);
  if (hosts.length === 0) throw new Error('ENGINE_HOST_ENTRY_FILE names no host: an empty table is a broken read.');
  return [...hosts, 'preload.cjs', 'readerWorker.js'];
}

/** A module file, by extension. */
const MODULE = /\.(?:m?js|cjs)$/u;

/**
 * Every module file under the roots — the candidates the closure chooses from. The renderer's bundle is not a
 * candidate: it is loaded by its HTML page, which no module imports, and is shipped whole.
 *
 * @param {readonly string[]} roots
 * @returns {string[]}
 */
export function candidateModules(roots) {
  /** @type {string[]} */
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !MODULE.test(entry.name)) continue;
      const path = join(entry.parentPath, entry.name);
      if (relative(root, path).split(sep)[0] === 'renderer') continue;
      found.push(resolve(path));
    }
  }
  return found;
}

/**
 * Every module specifier a JavaScript file names literally: its imports, read by the compiler's own scanner
 * (`ts.preProcessFile`: static and dynamic imports and `require` calls, never the inside of a string), and its RESOLVES.
 *
 * ONE reader for both questions asked of a module's text — what the package must hold (`moduleClosure`) and whether
 * what it names is there (`packageMsix.mjs`' resolution check). They were two: the check read resolves through a
 * pattern and the closure did not read them at all, so the check asked about the reader's package and the closure
 * left its entry out (B3a).
 *
 * A resolve is a call of `.resolve` on `require`, on `createRequire(…)` itself, or on a name this file binds to
 * `createRequire(…)`, with a string literal first; `Promise.resolve('x')` is none of those. A receiver passed in from
 * elsewhere, or a specifier built at run time, is out of reach — which is why the packager also STARTS what it built.
 *
 * @param {string} text
 * @param {typeof import('typescript')} ts
 * @returns {string[]}
 */
export function moduleSpecifiers(text, ts) {
  const named = ts.preProcessFile(text, true, true).importedFiles.map((file) => file.fileName);
  const source = ts.createSourceFile('module.js', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  /** @param {import('typescript').Node} node */
  const isCreateRequire = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createRequire';
  /** @type {Set<string>} */
  const receivers = new Set(['require']);
  /** @type {import('typescript').CallExpression[]} */
  const calls = [];
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isCreateRequire(node.initializer)) {
      receivers.add(node.name.text);
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const call of calls) {
    const callee = call.expression;
    const [first] = call.arguments;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'resolve' || first === undefined) continue;
    const receiver = callee.expression;
    const resolves = (ts.isIdentifier(receiver) && receivers.has(receiver.text)) || isCreateRequire(receiver);
    if (resolves && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) named.push(first.text);
  }
  return named;
}

/**
 * The file a workspace specifier names, through the package's `exports` map — `import`, then `default`, as Node picks
 * for an ES module importer.
 *
 * @param {string} specifier `@monstera/name` or `@monstera/name/subpath`
 * @param {(name: string) => string | null} packageDir
 * @returns {string | null} null where the specifier is not a workspace package's
 */
export function workspaceTarget(specifier, packageDir) {
  const match = /^(@monstera\/[^/]+)(\/.*)?$/u.exec(specifier);
  if (match === null) return null;
  const directory = packageDir(match[1] ?? '');
  if (directory === null) return null;
  /** @type {{ exports?: Record<string, string | Record<string, string>>, main?: string }} */
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const subpath = `.${match[2] ?? ''}`;
  const exported = manifest.exports?.[subpath];
  const target =
    typeof exported === 'string' ? exported : (exported?.['import'] ?? exported?.['default'] ?? (subpath === '.' ? manifest.main : undefined));
  if (target === undefined) throw new Error(`${specifier} is not exported by ${directory}/package.json, so the closure cannot follow it.`);
  return resolve(directory, target);
}

/**
 * The modules the application can load, from its entry — and, separately, the candidates it cannot.
 *
 * @param {ClosureInput} input
 * @returns {{ readonly reached: ReadonlySet<string>, readonly unreached: readonly string[] }}
 */
export function moduleClosure(input) {
  const candidates = candidateModules(input.roots);
  /** @type {Map<string, string[]>} */
  const byName = new Map();
  for (const path of candidates) {
    const name = basename(path);
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }

  const entry = resolve(input.entry);
  if (!candidates.includes(entry)) throw new Error(`The entry ${entry} is not among the ${String(candidates.length)} candidate modules.`);

  /** @type {Set<string>} */
  const reached = new Set();
  /** @type {string[]} */
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    const text = readFileSync(file, 'utf8');

    for (const specifier of moduleSpecifiers(text, input.ts)) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!existsSync(target)) throw new Error(`${file} imports ${specifier}, which is not there: the closure is reading a broken tree.`);
        pending.push(target);
        continue;
      }
      const target = workspaceTarget(specifier, input.packageDir);
      if (target !== null) pending.push(target);
    }

    for (const literal of stringLiterals(text, input.ts)) {
      if (!MODULE.test(literal)) continue;
      for (const path of byName.get(posix.basename(literal.replaceAll('\\', '/'))) ?? []) pending.push(path);
    }
  }

  // THE POSITIVE CONTROL: modules the application is known to load by path must be in the closure, or it could not see.
  const reachedNames = new Set([...reached].map((path) => basename(path)));
  const blind = input.mustReach.filter((name) => !reachedNames.has(name));
  if (blind.length > 0) {
    throw new Error(
      `The module closure did not reach ${blind.join(', ')}, which the application loads by path. A closure that ` +
        'cannot see a module the application loads would leave it out of the package, so it refuses to answer.',
    );
  }
  return { reached, unreached: candidates.filter((path) => !reached.has(path)).sort() };
}

/**
 * Every string literal's text in a module, read from the compiler's PARSE — so a quote inside a comment, a template or
 * a regular expression is never taken for a file name, which a bare scanner cannot promise (it cannot tell a regular
 * expression from a division without the parse).
 *
 * @param {string} text
 * @param {typeof import('typescript')} ts
 * @returns {string[]}
 */
function stringLiterals(text, ts) {
  const source = ts.createSourceFile('module.js', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  /** @type {string[]} */
  const found = [];
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
