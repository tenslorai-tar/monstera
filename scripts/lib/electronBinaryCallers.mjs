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

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/**
 * The resolvers a host's executable may be NAMED by. Anything else is a violation.
 *
 * ## It was one string until 2026-09-16, and what changed is the surface's job
 *
 * The rule was `electronBinaryPath()` and nothing else, because the surface started one program:
 * the Electron binary in Node mode. ADR-0063 Decision 2 gives it a second — an external converter,
 * *"resolved from the provisioned tree, never from `PATH` and never from an installed copy"* — and a
 * rule that admits only the first would be answered by exempting the file that has the second,
 * which is how a guard becomes a formality.
 *
 * **The property under test is unchanged**: a host's executable is named by a resolver that answers
 * out of a tree this repository provisioned. `process.execPath` — the expression two drivers
 * actually wrote — is the Electron binary under Electron and system Node under plain Node, so a
 * host created with it STARTS and runs the wrong runtime. That is still a violation, and so is any
 * other expression, including a bare variable this textual scan cannot follow.
 *
 * Matched by NAME rather than by the whole expression, because a resolver takes arguments — the
 * launcher kind here, a root in a driver — and an equality rule would have every call site spell
 * one fixed string or be reported.
 */
/**
 * Each resolver, and the ONE program kind its path may be run as.
 *
 * ## A resolver alone stopped being enough the day there were two
 *
 * Naming a sanctioned resolver was the whole rule while the surface started one program. With two,
 * the resolver says WHERE the executable came from and nothing about HOW it will be run — and the
 * surface decides what it adds to a command line from the program's kind (`containedProgram.ts`).
 * An untyped caller writing `runs: 'electron-node'` beside `sofficeLauncher()` hands LibreOffice
 * Node's interpreter flags, which is the exact command line LibreOffice refused on 2026-09-16:
 * `Error in option: --preserve-symlinks`. TypeScript callers cannot write that pair — each branch
 * of `ContainedProgram` carries its own brand — and these callers import the surface through a
 * computed specifier and see `any`, so this scan is where the pairing is held for them.
 *
 * One table rather than a list of names and a second map beside it (B3a): the names a site may use
 * ARE this table's keys.
 */
const RESOLVERS = Object.freeze(
  /** @type {Record<string, 'electron-node' | 'converter'>} */ ({
    electronBinaryPath: 'electron-node',
    sofficeLauncher: 'converter',
    // ADR-0071: Poppler's pdftotext, provisioned by scripts/provision/poppler.mjs.
    pdftotextPath: 'converter',
    // ADR-0075: Ghostscript's gswin64c, provisioned by scripts/provision/ghostscript.mjs.
    gswin64cPath: 'converter',
  }),
);

const SANCTIONED = Object.freeze(Object.keys(RESOLVERS));

/**
 * The resolver a value names, or `undefined` where it names none of them.
 *
 * @param {string} value
 * @returns {string | undefined}
 */
function resolverNamedBy(value) {
  return SANCTIONED.find((resolver) => value.startsWith(`${resolver}(`));
}

/**
 * The program kind the config around a site declares — the nearest `runs:` between the object's
 * opening brace and the property.
 *
 * Textual, for the reason {@link ASSIGNMENT} is: the question is what the author WROTE beside the
 * path, and every call site spells the kind first inside `program: { … }`. A kind written after the
 * path, or through a variable, reads as no kind at all and is reported — the scan cannot follow it,
 * and the alternative to a false positive there is silence about a real mismatch.
 *
 * @param {string} text
 * @param {number} index where the `executablePath` property starts
 * @returns {string | undefined}
 */
function programKindBefore(text, index) {
  const opening = text.lastIndexOf('{', index);
  if (opening === -1) return undefined;
  const window = text.slice(opening, index);
  return /runs\s*:\s*['"]([^'"]+)['"]/u.exec(window)?.[1];
}

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
 * A file that CREATES a host, whether or not it names the property (ZZZ-2).
 *
 * The assignment scan above reports the bad sites it finds. It says nothing
 * about a host built from a spread, a shared config object or a helper — such a
 * file contributes no site, and the run prints `ok`. That is this instrument's
 * own reassuring answer, one layer further out than the positive control
 * reaches: the control proves the walk can FIND a known file, not that the walk
 * saw every file that creates a host.
 *
 * So the creator set is derived independently and every member must carry at
 * least one site. Requiring the paren is what separates creating a host from
 * mentioning the factory: `electronImports.proof.mjs` and `win32Handle.proof.mjs`
 * both name this module and create nothing.
 *
 * A config assembled in one file and passed to a call in another is reported,
 * deliberately. The scan cannot follow it, and the alternative to a false
 * positive there is silence about a real one.
 */
const CREATES_HOST = /createWin32HostSurface\s*\(/u;

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
 * @returns {{
 *   sites: Array<{ file: string, line: number, value: string, runs: string | undefined, ok: boolean }>,
 *   creators: string[],
 *   silent: string[],
 * }}
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

  /** @type {Array<{ file: string, line: number, value: string, runs: string | undefined, ok: boolean }>} */
  const sites = [];
  /** @type {string[]} */
  const creators = [];
  for (const file of files) {
    const relativePath = relative(root, file).replaceAll('\\', '/');
    if (SUBJECT_FILES.includes(relativePath)) continue;
    const text = readFileSync(file, 'utf8');
    if (CREATES_HOST.test(text)) creators.push(relativePath);
    for (const match of text.matchAll(ASSIGNMENT)) {
      const value = (match[1] ?? '').trim().replace(/,$/u, '');
      const resolver = resolverNamedBy(value);
      const runs = programKindBefore(text, match.index);
      sites.push({
        file: relativePath,
        line: text.slice(0, match.index).split('\n').length,
        value,
        runs,
        // BOTH HALVES: a sanctioned resolver, AND the kind that resolver's path may be run as.
        ok: resolver !== undefined && runs === RESOLVERS[resolver],
      });
    }
  }
  // A file that creates a host and names the property nowhere. It is not a
  // clean file; it is a file this scan cannot read, and the two must not share
  // an output.
  const silent = creators.filter((file) => !sites.some((site) => site.file === file));
  return { sites, creators, silent };
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
  const { sites, creators, silent } = scanElectronBinaryCallers(options);
  const bad = sites.filter((site) => !site.ok);
  // TWO SEARCHES, TWO CONTROLS. The assignment scan and the creator derivation
  // fail independently and both report their failure as a clean tree, so a
  // control on one says nothing about the other.
  const located = sites.some((site) => site.file === control);
  const locatedCreator = creators.includes(control);

  let output = '';
  for (const site of bad) {
    const resolver = resolverNamedBy(site.value);
    if (resolver === undefined) {
      output +=
        `  FAILED  ${site.file}:${String(site.line)} assigns \`${site.value}\`\n` +
        `          The resolvers are ${SANCTIONED.map((name) => `\`${name}()\``).join(' and ')}, each\n` +
        `          answering out of a tree this repository provisioned. \`process.execPath\` is the\n` +
        `          Electron binary under Electron and system Node under plain Node, and a host\n` +
        `          created with the wrong one STARTS — it just runs the wrong runtime.\n`;
      continue;
    }
    output +=
      `  FAILED  ${site.file}:${String(site.line)} runs \`${site.value}\` as ` +
      `${site.runs === undefined ? 'NO program kind' : `\`runs: '${site.runs}'\``}\n` +
      `          \`${resolver}()\`'s path may only be run as \`runs: '${RESOLVERS[resolver] ?? ''}'\`, written\n` +
      `          before the path inside \`program: { … }\`. The kind decides what the surface adds:\n` +
      `          Node's interpreter flags handed to LibreOffice were refused with\n` +
      `          \`Error in option: --preserve-symlinks\`, and an Electron host started without\n` +
      `          them dies before its first line.\n`;
  }
  if (bad.length === 0) {
    output +=
      `  ok  ${String(sites.length)} host executablePath site(s) name a provisioned-tree resolver, ` +
      `each run as its own program kind\n`;
  }
  for (const file of silent) {
    output +=
      `  FAILED  ${file} creates a host and names executablePath nowhere\n` +
      `          A spread, a shared config object or a helper contributes no site, so this\n` +
      `          file would otherwise read as clean. It is not clean — it is unreadable to\n` +
      `          this scan, and the two must not share an output. Name the property at the\n` +
      `          call, with ${SANCTIONED.join(' or ')}.\n`;
  }
  if (silent.length === 0) {
    output += `  ok  all ${String(creators.length)} file(s) creating a host name the property\n`;
  }
  output += located
    ? `  ok  and the scan located ${control}, so that result means something\n`
    : `  FAILED  the scan did not locate ${control}, which it is known to contain. Every way\n` +
      `          of breaking a search reports "no violations"; this run's clean result is\n` +
      `          not evidence of anything.\n`;
  output += locatedCreator
    ? `  ok  and the creator derivation located it too, so ITS silence means something\n`
    : `  FAILED  the creator derivation did not locate ${control}, which calls the factory.\n` +
      `          A derivation that finds no creators reports every file as covered.\n`;

  return { ok: bad.length === 0 && silent.length === 0 && located && locatedCreator, output };
}

// THE THIRD OF THREE, and the one that made it a mechanism. Written as a
// hand-built `file://` string here, which on Windows yields `file://C:/...`
// against an `import.meta.url` of `file:///C:/...`, so the guard never fired and
// this scan exited 0 having looked at nothing. Caught only because the run
// printed no output at all — luck, and unavailable to a scan whose normal output
// is one quiet line. `isMain` is the named thing (AAAA-5).
if (isMain(import.meta.url)) {
  const rootIndex = process.argv.indexOf('--root');
  const result = report(rootIndex === -1 ? {} : { root: resolve(process.argv[rootIndex + 1] ?? '.') });
  process.stdout.write(result.output);
  process.exitCode = result.ok ? 0 : 1;
}
