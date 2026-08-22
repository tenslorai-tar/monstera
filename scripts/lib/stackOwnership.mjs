// @ts-check
/**
 * Only the module that owns stack rendering may name `.stack`.
 *
 * ## The rule, and why it is a rule about OWNERS rather than about subjects
 *
 * `8130551` fixed sixteen top-level handlers that printed
 * `error instanceof Error ? error.stack : String(error)` — a form that discards
 * `cause`, and the errno in the cause was the diagnosis. It fixed them by
 * enumeration, and Y-3 stayed open on the obvious question: nothing made the
 * list of sixteen complete.
 *
 * The blocking question was taken to be *what counts as a top-level handler*,
 * and every answer to it is a definition of the compliant population — which is
 * the enumeration disease with a predicate on the front. The question is the
 * wrong one. A rule does not have to define its subjects; it has to name its
 * **owner** (B3). One component writes a property; many read it. So:
 *
 * > Only an owner of stack rendering may name `.stack`.
 *
 * Two owners, because the two sides of this repository cannot share a module:
 * `scripts/lib/reportError.mjs` renders a thrown value as text for a human and
 * walks the whole `cause` chain, and `packages/shared/src/result.ts` carries a
 * stack across a process boundary as `StructuredError`. `scripts/` is plain
 * `.mjs` and cannot import TypeScript, which is why there are two and not one.
 *
 * That list has two entries and will not grow with the codebase. A list of
 * subjects grows with every file.
 *
 * ## The prediction the rule already paid for
 *
 * `scripts/proofs/perfBudget.proof.mjs` acquired a seventeenth instance in
 * `5ce1bc3` (2026-08-21) — **one day after** `8130551` (2026-08-20) closed the
 * class by enumerating sixteen sites. `git merge-base --is-ancestor 8130551
 * 5ce1bc3` succeeds. The seventeenth arriving within a day of the sixteen being
 * fixed is the whole argument for a scan, and it is measured rather than feared.
 *
 * ## Why this asks TypeScript instead of matching text
 *
 * A textual scan for a dotted `stack` cannot tell these apart, and all four
 * occur in this repository:
 *
 * | the text | what it is |
 * |---|---|
 * | a caught Error's `stack`, read | the defect |
 * | a `StructuredError`'s `stack`, read | reading a field the owner declared — B3 says readers are fine |
 * | `shim.stackCookie` | a different property |
 * | the same read inside a `String.raw` program body | text, not code |
 *
 * Deciding those textually needs a pattern plus an exception list, and the
 * exception list is the thing this check exists to avoid. The compiler already
 * answers the question — what type is the receiver — so B3a says ask it rather
 * than write a second opinion about it. Three of the four rows then need no rule
 * at all: a comment, a template's text and a differently-named property are not
 * property accesses, so the walk never sees them. That is B5 — the false
 * positive is unrepresentable rather than filtered.
 *
 * The one thing the walk must still be told is that a **write** is not a
 * rendering. Planting a stack on a fixture error builds a value; an assignment
 * cannot discard a cause chain, because it reads none.
 *
 * ## The three controls, all of which run every time
 *
 * 1. **Positive control (item 4b).** Every owner must yield at least one
 *    Error-typed read. The owners are the one place this property is guaranteed
 *    to be named, so an owner contributing zero means the walk could not see — a
 *    wrong tsconfig, a program that failed to load, a compiler API that moved.
 *    The scan then reports BLIND and refuses rather than reporting a clean tree.
 * 2. **Root control (X-1).** Every tracked source file must be a root of some
 *    project. Fixing a classifier's pattern and leaving its root is half a fix,
 *    and both halves report "found nothing" identically. Measured 2026-08-22:
 *    197 tracked source files, 0 outside a project.
 * 3. **Unresolved is terminal.** A receiver typed `any` or `unknown` is a
 *    receiver the compiler could not decide, and *could not look* must never
 *    share an output with *looked and found nothing*. There are none today,
 *    which is exactly why the proof supplies one — a branch keyed on the
 *    presence of something has a side that never executes wherever that thing
 *    is always absent.
 *
 * Usage: node scripts/lib/stackOwnership.mjs
 */

import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filesInCommit, repoRoot } from './gitScope.mjs';
import { loadTypeScript } from './loadTypeScript.mjs';

/** @typedef {typeof import('typescript')} TypeScriptApi */

/**
 * The writer-of-record entries for stack rendering (B3). Not a list of
 * subjects — a list of the components permitted to write.
 */
export const STACK_OWNERS = Object.freeze([
  'scripts/lib/reportError.mjs',
  'packages/shared/src/result.ts',
]);

/** Extensions a TypeScript project can hold, and therefore that this can read. */
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;

/** What is lost if the compiler is missing, for `loadTypeScript`'s refusal. */
const WITHOUT_COMPILER =
  'the stack-ownership scan cannot tell an Error apart from a StructuredError and would ' +
  'report every reader of a declared field as a defect, or none of them.';

/**
 * An owner's own proof may name what the owner owns, and that is derived from
 * the owner's path rather than listed beside it: a file added at
 * `<owner>.proof.mjs` is covered the day it exists, and a file anywhere else
 * never is.
 *
 * @param {string} owner Repository-relative path of an owner.
 * @returns {string[]}
 */
export function ownerFamily(owner) {
  const base = owner.replace(SOURCE_EXTENSIONS, '');
  return [owner, `${base}.proof.mjs`, `${base}.proof.ts`, `${base}.test.ts`, `${base}.test.mjs`];
}

/**
 * Every TypeScript project in the repository, derived from the solution file
 * plus the root's sibling configs rather than listed.
 *
 * `tsconfig.json` is a solution (`files: []`) whose `references` name the six
 * package projects. `tsconfig.scripts.json` is deliberately NOT a reference —
 * its own header explains why — so reading references alone would miss the
 * three thousand lines of `scripts/`. A sibling `tsconfig.*.json` counts when it
 * declares an `include`, which is what separates a project from
 * `tsconfig.base.json`.
 *
 * @param {TypeScriptApi} ts
 * @param {string} root
 * @returns {string[]} Absolute paths to tsconfig files.
 */
export function projectPaths(ts, root) {
  const solutionPath = join(root, 'tsconfig.json');
  const solution = ts.readConfigFile(solutionPath, ts.sys.readFile);
  if (solution.error !== undefined) {
    throw new Error(
      `Could not read ${solutionPath}: ` +
        ts.flattenDiagnosticMessageText(solution.error.messageText, ' '),
    );
  }
  const declared = solution.config?.references;
  const references = Array.isArray(declared) ? declared : [];
  const referenced = references.map((/** @type {{ path: string }} */ entry) =>
    resolve(root, entry.path, 'tsconfig.json'),
  );
  if (referenced.length === 0) {
    // An empty intermediate result is a broken parse, not a clean input.
    throw new Error(`${solutionPath} declares no project references, so no package would be read.`);
  }

  const siblings = readdirSync(root)
    .filter((name) => /^tsconfig\..+\.json$/u.test(name))
    .map((name) => join(root, name))
    .filter((path) => {
      const config = ts.readConfigFile(path, ts.sys.readFile).config;
      return Array.isArray(config?.include) && config.include.length > 0;
    });
  if (siblings.length === 0) {
    throw new Error(
      `No sibling tsconfig at ${root} declares an include, so scripts/ would be read by nothing.`,
    );
  }

  return [...referenced, ...siblings];
}

/**
 * Whether a type's `stack` is the one `interface Error` declares.
 *
 * A subclass inherits the symbol, so the lookup on a `TypeError` still lands on
 * `Error`'s declaration. A subclass that REDECLARES the property would not,
 * which is why the base chain is walked as well.
 *
 * @param {TypeScriptApi} ts
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 * @returns {boolean}
 */
function isErrorFamily(ts, checker, type) {
  if (type.symbol?.name === 'Error') return true;
  const property = checker.getPropertyOfType(type, 'stack');
  for (const declaration of property?.declarations ?? []) {
    const container = declaration.parent;
    if (
      (ts.isInterfaceDeclaration(container) || ts.isClassDeclaration(container)) &&
      container.name?.text === 'Error'
    ) {
      return true;
    }
  }
  if (type.isClassOrInterface()) {
    for (const base of checker.getBaseTypes(type)) {
      if (isErrorFamily(ts, checker, base)) return true;
    }
  }
  return false;
}

/**
 * Classifies the receiver of a `stack` access.
 *
 * @param {TypeScriptApi} ts
 * @param {import('typescript').TypeChecker} checker
 * @param {import('typescript').Type} type
 * @returns {'error' | 'other' | 'unresolved'}
 */
export function classifyReceiver(ts, checker, type) {
  const nonNullable = checker.getNonNullableType(type);
  const constituents = nonNullable.isUnion() ? nonNullable.types : [nonNullable];
  /** @type {'error' | 'other' | 'unresolved'} */
  let verdict = 'other';
  for (const part of constituents) {
    // `any` and `unknown` are the compiler saying it could not decide. That is
    // not the same answer as "this is not an Error", and must not share its
    // output.
    if ((part.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return 'unresolved';
    if (isErrorFamily(ts, checker, part)) verdict = 'error';
  }
  return verdict;
}

/**
 * @typedef {object} StackAccess
 * @property {string} file Repository-relative, forward slashes.
 * @property {number} line 1-indexed.
 * @property {'read' | 'write'} kind
 * @property {'error' | 'other' | 'unresolved'} receiver
 * @property {boolean} owned Whether the file is an owner or an owner's proof.
 * @property {string} text The source text of the access, for the report.
 */

/**
 * @param {TypeScriptApi} ts
 * @param {import('typescript').Node} node
 * @returns {'read' | 'write'} Whether this access is the left side of a plain assignment.
 */
function accessKind(ts, node) {
  const parent = node.parent;
  return ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ? 'write'
    : 'read';
}

/**
 * Walks one source file for every way `stack` can be named on a value.
 *
 * Destructuring is included because binding the property renders exactly as
 * reading it does and is not a property access — leaving it out would make the
 * check avoidable by rewriting the line, which is a guard with a documented
 * way round it.
 *
 * @param {TypeScriptApi} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {import('typescript').TypeChecker} checker
 * @param {(node: import('typescript').Node, receiver: import('typescript').Type, kind: 'read' | 'write') => void} found
 * @returns {void}
 */
export function walkStackAccesses(ts, sourceFile, checker, found) {
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'stack') {
      found(node, checker.getTypeAtLocation(node.expression), accessKind(ts, node));
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'stack'
    ) {
      found(node, checker.getTypeAtLocation(node.expression), accessKind(ts, node));
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const named = node.propertyName ?? node.name;
      if (ts.isIdentifier(named) && named.text === 'stack') {
        const holder = node.parent.parent;
        const source =
          ts.isVariableDeclaration(holder) && holder.initializer !== undefined
            ? holder.initializer
            : holder;
        found(node, checker.getTypeAtLocation(source), 'read');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * @typedef {object} ScanResult
 * @property {string} root
 * @property {string[]} projects Repository-relative tsconfig paths, in read order.
 * @property {StackAccess[]} accesses Every named `stack`, whatever its verdict.
 * @property {StackAccess[]} findings Error-typed reads outside an owner.
 * @property {StackAccess[]} unresolved Receivers the compiler could not decide.
 * @property {string[]} uncovered Tracked source files in no project.
 * @property {Record<string, number>} witnesses Owner path to its Error-typed reads.
 * @property {boolean} blind Whether a control failed, making silence worthless.
 */

/**
 * `owners` exists so the proof can feed this a repository of its own shape. The
 * shipped entry point never passes it, and one case asserts the real list
 * against the real tree — a fixture that supplies its own owners proves the
 * mechanism and says nothing about whether the two shipped paths are right.
 *
 * @param {{ root?: string, owners?: readonly string[] }} [options]
 * @returns {Promise<ScanResult>}
 */
export async function scan(options = {}) {
  const ts = await loadTypeScript(WITHOUT_COMPILER);
  const root = options.root ?? repoRoot();
  const owners = options.owners ?? STACK_OWNERS;
  const projects = projectPaths(ts, root);
  /** @type {StackAccess[]} */
  const accesses = [];
  /** @type {Set<string>} */
  const covered = new Set();
  const owned = new Set(owners.flatMap((owner) => ownerFamily(owner)));

  for (const projectPath of projects) {
    const config = ts.readConfigFile(projectPath, ts.sys.readFile);
    if (config.error !== undefined) {
      throw new Error(
        `Could not read ${projectPath}: ` +
          ts.flattenDiagnosticMessageText(config.error.messageText, ' '),
      );
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(projectPath));
    if (parsed.fileNames.length === 0) {
      throw new Error(`${relative(root, projectPath)} matched no files, so it would report nothing.`);
    }
    const roots = new Set(parsed.fileNames.map((name) => resolve(name)));
    for (const name of roots) covered.add(name);

    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: { ...parsed.options, noEmit: true },
      // Spread rather than assigned: under `exactOptionalPropertyTypes` a
      // project with no references would otherwise pass an explicit `undefined`
      // where the compiler's own type says the key must be absent.
      ...(parsed.projectReferences === undefined
        ? {}
        : { projectReferences: parsed.projectReferences }),
    });
    const checker = program.getTypeChecker();

    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      // A referenced project's sources appear in this program too. Attributing
      // them here would report the same access once per project that reaches it.
      if (!roots.has(resolve(sourceFile.fileName))) continue;
      const file = relative(root, sourceFile.fileName).replace(/\\/gu, '/');
      walkStackAccesses(ts, sourceFile, checker, (node, receiverType, kind) => {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        accesses.push({
          file,
          line: line + 1,
          kind,
          receiver: kind === 'write' ? 'other' : classifyReceiver(ts, checker, receiverType),
          owned: owned.has(file),
          text: node.getText(sourceFile).replace(/\s+/gu, ' ').slice(0, 80),
        });
      });
    }
  }

  const tracked = filesInCommit({ cwd: root }).filter((path) => SOURCE_EXTENSIONS.test(path));
  if (tracked.length === 0) {
    throw new Error('No tracked source files were found, so the root control would pass vacuously.');
  }
  const uncovered = tracked.filter((path) => !covered.has(resolve(root, path)));

  /** @type {Record<string, number>} */
  const witnesses = {};
  for (const owner of owners) {
    witnesses[owner] = accesses.filter(
      (access) => access.file === owner && access.kind === 'read' && access.receiver === 'error',
    ).length;
  }

  const findings = accesses.filter(
    (access) => access.receiver === 'error' && access.kind === 'read' && !access.owned,
  );
  const unresolved = accesses.filter((access) => access.receiver === 'unresolved');
  const blind = Object.values(witnesses).some((count) => count === 0) || uncovered.length > 0;

  return {
    root,
    projects: projects.map((path) => relative(root, path).replace(/\\/gu, '/')),
    accesses,
    findings,
    unresolved,
    uncovered,
    witnesses,
    blind,
  };
}

/**
 * @param {StackAccess} access
 * @returns {string}
 */
function describe(access) {
  return `    ${access.file}:${String(access.line)}  ${access.text}`;
}

/**
 * @param {ScanResult} result
 * @returns {string}
 */
export function report(result) {
  const lines = [
    `Stack-rendering ownership — ${String(result.projects.length)} projects, ` +
      `${String(result.accesses.length)} names of the property`,
  ];

  for (const [owner, count] of Object.entries(result.witnesses)) {
    lines.push(
      `  positive control: ${owner} — ${String(count)} Error-typed read${count === 1 ? '' : 's'}` +
        (count === 0 ? '   <-- BLIND' : ''),
    );
  }
  lines.push(
    `  root control: ${String(result.uncovered.length)} tracked source file(s) in no project`,
  );
  for (const path of result.uncovered) lines.push(`    ${path}`);
  lines.push('');

  if (result.blind) {
    lines.push(
      'REFUSING TO REPORT. A control failed, so "no findings" here would mean "could not look".',
      '',
    );
    return lines.join('\n');
  }

  if (result.unresolved.length > 0) {
    lines.push(
      `UNRESOLVED (${String(result.unresolved.length)}) — the compiler could not decide the`,
      'receiver, which is not the same answer as "not an Error". Type the receiver, or',
      'route it through an owner.',
      ...result.unresolved.map(describe),
      '',
    );
  }

  if (result.findings.length > 0) {
    lines.push(
      `FINDINGS (${String(result.findings.length)}) — an Error's stack is read outside an owner.`,
      '',
      "Rendering a thrown value here discards its `cause`, and the cause's errno is",
      'usually the diagnosis. Call the owner for this side instead:',
      '',
      '  scripts/          formatError, from scripts/lib/reportError.mjs',
      '  packages/, apps/  toStructuredError, from @monstera/shared',
      '',
      ...result.findings.map(describe),
      '',
    );
  }

  if (result.findings.length === 0 && result.unresolved.length === 0) {
    lines.push(
      `  ok  ${String(result.accesses.length)} names of the property, none of them an Error's`,
      '      stack read outside an owner',
      '  ok  and both owners were located, so that result means something',
      '',
    );
  }
  return lines.join('\n');
}

/**
 * @returns {Promise<number>} Process exit code.
 */
export async function main() {
  const result = await scan();
  process.stdout.write(report(result));
  if (result.blind) return 2;
  return result.findings.length + result.unresolved.length === 0 ? 0 : 1;
}

/* c8 ignore start */
// `resolve(argv[1]) === fileURLToPath(import.meta.url)` is the form six other
// entry points here use. A hand-built `file://` prefix is wrong on Windows and a
// suffix match is a looser question than the one being asked.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
/* c8 ignore stop */
