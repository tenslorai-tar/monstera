// @ts-check
/**
 * Every plain-Node caller that creates a contained host names the Electron
 * binary through the one resolver, and never through `process.execPath`
 * (finding YYY-2).
 *
 * ## Why a scan, when the type should be enough
 *
 * `Win32HostSurfaceConfig.executablePath` is branded, so a TypeScript caller
 * cannot pass a bare string. **That brand reaches no caller that exists.**
 * Measured 2026-08-23: with the brand in place `npm run typecheck` is green,
 * because both callers import the surface through
 * `await import(pathToFileURL(...).href)` — a computed specifier, which types as
 * `any`. A type cannot constrain a value it never sees.
 *
 * So the brand protects the composition root that does not exist yet, and this
 * protects the two drivers that broke the contract. Neither is redundant and
 * neither covers the other's callers.
 *
 * ## The defect this exists to make loud
 *
 * `process.execPath` is the Electron binary while the parent IS Electron, and
 * system Node the moment the parent is plain Node. The expression does not
 * change; its meaning does. When the containment driver moved into a plain-Node
 * parent, its cells silently began running `node.exe`: the container had no
 * rights on that install, one property row went from `same` to UNREADABLE, and
 * only the requirement that every verdict stay byte-identical across the
 * migration caught it. The same expression was written again, in a second file,
 * days later.
 *
 * ## Scope, stated because an unstated one is itself a finding
 *
 * `scripts/**` only, `.mjs` only. TypeScript under `apps/` and `packages/` is
 * covered by the brand, and adding it here would be a second opinion about a
 * rule the compiler already enforces there.
 *
 * ## The positive control is not optional
 *
 * This is a search, and every way of breaking a search produces the same
 * reassuring output: no violations. A wrong pattern, the wrong root, a rename of
 * the property — all of them report a clean tree. So the scan requires that it
 * LOCATED the call sites it is known to be able to find, on every run, and says
 * so in its output. It is run by hand on the day someone needs an answer, and CI
 * is not there.
 *
 * Usage: node scripts/lib/electronBinaryCallers.mjs [--root <dir>]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './gitScope.mjs';

/** The one resolver. Anything else assigned to the property is a violation. */
const SANCTIONED = 'electronBinaryPath()';

/**
 * The property, and whatever was assigned to it up to the end of the line.
 *
 * Deliberately not an expression parser: the question is textual — *which
 * resolver did the author name* — and a partial reimplementation of JavaScript
 * expression syntax would agree with the real rule most of the time, which is
 * the dangerous shape (B3a).
 */
const ASSIGNMENT = /executablePath\s*:\s*([^,\n]+)/gu;

/**
 * The two files whose SUBJECT is this rule, rather than files that call the
 * surface.
 *
 * This module names the property in its own prose; its proof builds fixtures
 * containing the violating expression on purpose, because a scan that cannot be
 * shown finding the defect has not been shown to work at all. Scanning either
 * would make the report depend on how the rule is documented and tested.
 *
 * Stated as a list rather than a pattern like `*.proof.mjs`, because a proof is
 * an ordinary caller as far as this rule is concerned — one that created a host
 * with `process.execPath` is exactly the defect that happened, twice, in files
 * of that kind. The list is asserted to be these two and no others.
 */
export const SUBJECT_FILES = Object.freeze([
  'scripts/lib/electronBinaryCallers.mjs',
  'scripts/proofs/electronBinaryCallers.proof.mjs',
]);

/** @param {string} dir @returns {string[]} */
function mjsFilesUnder(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...mjsFilesUnder(full));
    else if (entry.endsWith('.mjs')) found.push(full);
  }
  return found;
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ sites: Array<{ file: string, line: number, value: string, ok: boolean }> }}
 */
export function scanElectronBinaryCallers(options = {}) {
  const root = options.root ?? repoRoot();
  const scriptsDir = join(root, 'scripts');

  const files = mjsFilesUnder(scriptsDir);
  // An empty file set is a broken walk, not a repository with no scripts. The
  // whole output of this tool is "no violations", and an empty input produces it
  // for free.
  if (files.length === 0) {
    throw new Error(`Found no .mjs files under ${scriptsDir}. That is a broken walk, not a clean tree.`);
  }

  /** @type {Array<{ file: string, line: number, value: string, ok: boolean }>} */
  const sites = [];
  for (const file of files) {
    const relativePath = relative(root, file).replaceAll('\\', '/');
    if (SUBJECT_FILES.includes(relativePath)) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(ASSIGNMENT)) {
      const value = (match[1] ?? '').trim().replace(/,$/u, '');
      sites.push({
        file: relativePath,
        line: text.slice(0, match.index).split('\n').length,
        value,
        ok: value === SANCTIONED,
      });
    }
  }
  return { sites };
}

/**
 * @param {{ root?: string, control?: string }} [options]
 * @returns {{ ok: boolean, output: string }}
 */
export function report(options = {}) {
  // The control is a call site this scan is KNOWN to be able to find. If the
  // pattern, the root or the walk breaks, this is what goes red instead of the
  // violation count quietly reaching zero.
  const control = options.control ?? 'scripts/research/lowboxSpike.mjs';
  const { sites } = scanElectronBinaryCallers(options);
  const bad = sites.filter((site) => !site.ok);
  const located = sites.some((site) => site.file === control);

  let output = '';
  for (const site of bad) {
    output +=
      `  FAILED  ${site.file}:${String(site.line)} assigns \`${site.value}\`\n` +
      `          The one resolver is \`${SANCTIONED}\`. \`process.execPath\` is the Electron\n` +
      `          binary under Electron and system Node under plain Node, and a host created\n` +
      `          with the wrong one STARTS — it just runs the wrong runtime.\n`;
  }
  if (bad.length === 0) {
    output += `  ok  ${String(sites.length)} host executablePath site(s) name ${SANCTIONED}\n`;
  }
  output += located
    ? `  ok  and the scan located ${control}, so that result means something\n`
    : `  FAILED  the scan did not locate ${control}, which it is known to contain. Every way\n` +
      `          of breaking a search reports "no violations"; this run's clean result is\n` +
      `          not evidence of anything.\n`;

  return { ok: bad.length === 0 && located, output };
}

// `pathToFileURL`, not a hand-built `file://` string: on Windows the latter
// yields `file://C:/...` against an `import.meta.url` of `file:///C:/...`, so
// the guard never fires and the scan exits 0 having looked at nothing. Written
// that way here first, and caught only because the run printed no output at all
// — a main guard that never fires is a check that reports the reassuring answer.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootIndex = process.argv.indexOf('--root');
  const result = report(rootIndex === -1 ? {} : { root: resolve(process.argv[rootIndex + 1] ?? '.') });
  process.stdout.write(result.output);
  process.exitCode = result.ok ? 0 : 1;
}
