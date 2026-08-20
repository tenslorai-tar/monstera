// @ts-check
/**
 * Derives what the preload imports, and checks it against invariant 1.
 *
 * ## What this exists to make provable without running Electron
 *
 * Invariant 1: *"Renderer sandbox on; preload uses only `contextBridge`,
 * `ipcRenderer` and `webUtils`."* Everything a preload can do wrong, it does by
 * importing something else — `fs`, `path`, `child_process`, Electron's `app` —
 * and exposing a shred of it across the bridge.
 *
 * Every workflow installs Electron with `--ignore-scripts`, so `electron.d.ts`
 * arrives and **no binary does**. A test that launched a window and inspected
 * the exposed object is therefore not available here, and a structural test that
 * asserted on the arguments passed to `contextBridge` would prove the call was
 * made rather than that the exposure is confined — a flag SET, not a flag
 * ENFORCED, which is the distinction invariant 25 already refuses.
 *
 * The import set is different: it is a property of the source, it is exactly
 * what invariant 1 constrains, and it can be derived from syntax. So this is the
 * half of the preload that can be proven today, and the sandbox half is owed by
 * the window.
 *
 * ## A PARSE, not a text scan, for the same reason as the Electron surface
 *
 * A comment mentioning `require('fs')` is not an import, and a text scan cannot
 * tell them apart. Worse in the other direction: `import { app } from 'electron'`
 * split across lines by a formatter is invisible to a line-scoped pattern — the
 * window axis of item 4b, which has now bitten this repository four times.
 *
 * ## The allowlist is READ, never restated
 *
 * The three permitted names come from `docs/ARCHITECTURE.md` §9 invariant 1
 * itself, parsed out of its backticks. That is ADR-0012's rule applied to a
 * different kind of value: the memory budgets are read from §9.17 rather than
 * defined as constants *so the number a human reads is the number the build
 * enforces*. A constant here would be a second opinion about an invariant the
 * document owns — B3a — and the two would agree until someone amended one.
 *
 * Amending the invariant therefore changes what this permits, in the same
 * commit, with no second edit to remember.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTypeScript } from '../lib/loadTypeScript.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the invariant that governs this lives. */
export const ARCHITECTURE = join(REPO_ROOT, 'docs', 'ARCHITECTURE.md');

/** The preload this checks. */
export const PRELOAD = join(REPO_ROOT, 'apps', 'desktop', 'src', 'preload.ts');

/**
 * The names invariant 1 permits, read out of the invariant.
 *
 * Matches the line beginning `1. ` in the numbered invariant list and takes
 * every backticked identifier on it. Deliberately narrow: a looser match would
 * pick up backticks from neighbouring invariants and quietly widen what the
 * preload may import, which is the failure direction that matters.
 *
 * @param {string} [text] the document, for fixtures; defaults to the tracked one
 * @returns {string[]}
 */
export function permittedImports(text = readFileSync(ARCHITECTURE, 'utf8')) {
  const line = text.split(/\r?\n/u).find((candidate) => /^1\.\s+Renderer sandbox/u.test(candidate));
  if (line === undefined) {
    // A BROKEN LOOKUP, not an empty allowlist. An empty one would forbid every
    // import and read as a failing preload, which points the next reader at the
    // wrong file entirely — and a permissive fallback would be worse.
    throw new Error(
      `Invariant 1 was not found in ${ARCHITECTURE}. Its line must begin "1. Renderer sandbox". ` +
        `The allowlist is READ from the invariant so the document a human amends is the one the ` +
        `build enforces; a parse that cannot find it must say so rather than yield a set.`,
    );
  }

  const names = [...line.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/gu)].map((match) => match[1] ?? '');
  if (names.length === 0) {
    throw new Error(
      `Invariant 1 was found but names no backticked APIs:\n  ${line}\nAn empty allowlist is a ` +
        `broken parse, not a preload that may import nothing.`,
    );
  }
  return names;
}

/**
 * Every import in a source file, derived from its syntax.
 *
 * @param {{ path: string, describe: string }} input
 * @returns {Promise<{ imports: { module: string, names: string[] }[], describe: string }>}
 */
export async function readImports({ path, describe }) {
  const ts = await loadTypeScript(
    `the preload's imports cannot be DERIVED. A text scan cannot tell an import from a comment ` +
      `that mentions one, and cannot see an import a formatter wrapped across lines.`,
  );

  const program = ts.createProgram({
    rootNames: [path],
    options: { noLib: true, noResolve: true, skipLibCheck: true },
  });
  const source = program.getSourceFile(path);
  if (source === undefined) {
    throw new Error(`${path} exists but the compiler produced no source file for it.`);
  }

  const syntactic = program.getSyntacticDiagnostics(source);
  if (syntactic.length > 0) {
    // A file that will not parse yields no imports, which reads exactly like a
    // preload that imports nothing — the reassuring answer (item 4b).
    throw new Error(
      `${describe} has ${String(syntactic.length)} syntax error(s), so its imports were not ` +
        `derived. An unparsed file reports an empty import set, which is indistinguishable from ` +
        `a clean one.`,
    );
  }

  /** @type {{ module: string, names: string[] }[]} */
  const imports = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;

    /** @type {string[]} */
    const names = [];
    const clause = statement.importClause;
    if (clause?.name !== undefined) names.push(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings !== undefined) {
      if (ts.isNamespaceImport(bindings)) names.push(`* as ${bindings.name.text}`);
      else for (const element of bindings.elements) names.push(element.name.text);
    }
    imports.push({ module: specifier.text, names });
  }

  if (imports.length === 0) {
    throw new Error(
      `${describe} declares no imports at all. A preload that imports nothing cannot expose a ` +
        `bridge, so this is a parse that found nothing rather than a file with nothing in it.`,
    );
  }

  return { imports, describe };
}

/**
 * What invariant 1 forbids in this file, if anything.
 *
 * @param {{ imports: { module: string, names: string[] }[], describe: string }} surface
 * @param {string[]} permitted
 * @returns {string[]} one message per violation; empty means compliant
 */
export function invariantOneViolations(surface, permitted) {
  const allowed = new Set(permitted);
  /** @type {string[]} */
  const problems = [];

  // THE POSITIVE CONTROL, inside the instrument rather than only in its proof.
  // A preload that imports no Electron at all cannot be exposing a bridge, and
  // "found no forbidden imports" is the same output as "read the wrong file".
  const electron = surface.imports.filter((entry) => entry.module === 'electron');
  if (electron.length === 0) {
    throw new Error(
      `${surface.describe} imports nothing from "electron". A preload must import ` +
        `contextBridge to expose anything, so a scan finding no Electron import has not found a ` +
        `compliant preload — it has failed to read one (audit item 4b).`,
    );
  }

  for (const entry of electron) {
    for (const name of entry.names) {
      if (allowed.has(name)) continue;
      problems.push(
        `imports \`${name}\` from "electron". Invariant 1 permits only ` +
          `${permitted.map((allowedName) => `\`${allowedName}\``).join(', ')}.`,
      );
    }
  }

  for (const entry of surface.imports) {
    if (entry.module === 'electron') continue;
    if (entry.module.startsWith('node:')) {
      problems.push(
        `imports "${entry.module}". A preload runs beside the renderer; a Node builtin here is ` +
          `a filesystem or a process one \`contextBridge.exposeInMainWorld\` away from the ` +
          `sandbox (invariants 1 and 2).`,
      );
    }
  }

  return problems;
}
