// @ts-check
/**
 * Derives the Electron API surface invariant 25 cares about, from Electron's own
 * type declarations.
 *
 * ## What replaces what
 *
 * `docs/security/engine-advisories.json` carried two symbols — `utilityProcess`
 * and `MessageChannelMain` — with `in: null`, accepted only while Electron was
 * named in no `package.json`. Electron is now a dependency, so that condition is
 * false and the nulls stop being accepted. That was the design: one condition,
 * three consequences — a witness becomes possible, the null expires, and the
 * symbol list can stop being hand-picked.
 *
 * ## Why this is a PARSE and not a search, measured rather than assumed
 *
 * `electron.d.ts` is generated and heavily documented. **56% of its bytes are
 * comments.** A text search for a symbol matches prose in a doc comment exactly
 * as readily as a declaration, and the consequence here is inverted from the
 * usual search failure: instead of failing to find a symbol that exists, it
 * WITNESSES A SYMBOL THAT HAS BEEN REMOVED. That is the reassuring answer, and
 * invariant 25 rests on it.
 *
 * Not hypothetical. Measured on `electron@43.4.1`:
 *
 * | symbol | occurrences | outside comments | in prose |
 * |---|---|---|---|
 * | `utilityProcess` | 4 | 3 | **1** |
 * | `MessagePortMain` | 24 | 14 | **10** |
 *
 * So deleting the `utilityProcess` declaration would leave a text search still
 * finding it, today, for the exact symbol the invariant is about.
 *
 * `CLAUDE.md` item 4b records the OCR reachability walk failing four times in a
 * row, every time reporting "nothing reaches Tesseract", with two of the four
 * live at once and each concealing the other. Those four are this file's
 * pre-flight checklist, because they are four ways to produce one reassuring
 * output: the wrong edge type, **the wrong grammar**, anchoring, and a scan that
 * consumed its own input. The second is the live risk here, and the answer is to
 * use the real compiler rather than a pattern — TypeScript is already a
 * dependency, so there is no reason to guess a grammar.
 *
 * ## What a `.d.ts` witnesses, and what it does not
 *
 * It witnesses **declarations**. It witnesses nothing about Electron running.
 * `npm ci --ignore-scripts` — which is what every workflow here uses — installs
 * `electron.d.ts` at 1,125,720 bytes and **no binary at all**: there is no
 * `dist/`, and `path.txt` names an executable that was never downloaded.
 *
 * Conflating the two would be `available: true` for a binary that cannot be
 * spawned, in a new place. Nothing in this file may be read as evidence that an
 * Electron process can start.
 *
 * ## Why not a `{file}` witness input
 *
 * The register's `{file}` shape digests a path, and that was reachable here —
 * `resolveInput` reads any path, `node_modules/` included. It is the wrong tool
 * twice over.
 *
 * A digest of 1.1 MB says *the file changed*. It does not say `utilityProcess`
 * is still declared in it, which is finding T-1 exactly: a verdict whose path
 * glob had a positive control and whose SYMBOL had none, so a misspelt symbol
 * left the verdict green forever. And the `{file}` shape returns a stable
 * "absent" digest rather than throwing, deliberately, so that a deleted file is
 * a caught change rather than a broken checker — but under `node_modules/`,
 * absent is the NORMAL state before `npm ci`, so that verdict would mean
 * different things on either side of an install without saying so.
 *
 * Both are avoided by deriving instead of witnessing. A derivation is stronger
 * than a witness and carries no `witness` entry at all, the way the OCR doors do
 * — and its state is an input: where Electron is not installed, these symbols are
 * UNVERIFIABLE, printed and counted apart, never folded into verified.
 *
 * Usage: node scripts/security/electronSurface.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTypeScript as loadCompiler } from '../lib/loadTypeScript.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Names that must be found on EVERY run, or this instrument's silence is
 * worthless (audit item 4b).
 *
 * The control goes in the instrument rather than only in its proof, because the
 * proof runs in CI and the instrument gets run by hand on the day somebody needs
 * an answer.
 *
 * ## The anchor set must contain the HARD member, not any member
 *
 * `utilityProcess` is an anchor and not only a subject, because **a positive
 * control has to include the HARD member of the set, not any member.** The axis
 * that makes it hard is prose, measured on 43.4.1:
 *
 * | symbol | occurrences in prose |
 * |---|---|
 * | `utilityProcess` | **1** |
 * | `MessageChannelMain` | **0** |
 *
 * A naive text search is wrong for `utilityProcess` and would have looked
 * perfectly correct for `MessageChannelMain`. An instrument validated against
 * the second alone certifies the case that was never at risk, cleanly, forever.
 *
 * **What this anchor does NOT buy, stated because the obvious story is wrong.**
 * It is tempting to say the first four are top-level classes and this one is a
 * namespaced `const`, so it covers a node kind the others do not. Measured, by
 * disabling the variable-declaration branch: the walk drops from 437
 * declarations to 404 and loses `app`, `ipcMain` *and* `utilityProcess`. Two of
 * the original four are variable declarations already, so that mutation was
 * always caught. The prose axis is what this addition actually adds.
 */
const ANCHORS = ['app', 'BrowserWindow', 'ipcMain', 'WebContents', 'utilityProcess'];

/**
 * A token that appears in the file's TEXT but is not a declaration.
 *
 * This is the control that separates a parse from a search, and it is the one
 * that matters here: a text-matching implementation would report it as declared.
 * The control is itself controlled — if the token stops appearing in the raw
 * text, it can no longer distinguish anything and this throws rather than
 * quietly passing.
 */
const PROSE_SENTINEL = 'Deprecated';

/**
 * @typedef {{
 *   checked: boolean,
 *   reason: string,
 *   version: string,
 *   bytes: number,
 *   declared: string[],
 *   spawnSurface: string[],
 * }} ElectronSurface
 */

/**
 * The compiler, always this repository's own.
 *
 * Deliberately not resolved relative to whatever tree is being parsed: the
 * parser is ours, the input is theirs, and letting a fixture supply the compiler
 * would let a fixture decide what counts as a declaration.
 *
 * @returns {Promise<typeof import('typescript')>}
 */
async function loadTypeScript() {
  // MOVED to scripts/lib/loadTypeScript.mjs, because a second instrument now
  // parses source with the compiler and two copies of "where does it live and
  // how is it imported" is B3a. The `file://` URL and the backslash replacement
  // are the half a second copy would eventually get wrong, and only the Windows
  // job would notice.
  return loadCompiler(
    `electron.d.ts cannot be PARSED. Falling back to a text search is what this module exists ` +
      `to refuse: the file is 56% comments and a text match witnesses symbols that have been ` +
      `removed.`,
  );
}

/**
 * @param {string} root
 * @returns {{ typescript: string, declarations: string, version: string } | null}
 */
function locate(root) {
  const declarations = join(root, 'node_modules', 'electron', 'electron.d.ts');
  const manifest = join(root, 'node_modules', 'electron', 'package.json');
  const typescript = join(REPO_ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (!existsSync(declarations) || !existsSync(typescript) || !existsSync(manifest)) return null;

  const parsed = /** @type {{ version?: unknown }} */ (
    JSON.parse(readFileSync(manifest, 'utf8'))
  );
  return {
    typescript,
    declarations,
    version: typeof parsed.version === 'string' ? parsed.version : '(unreadable)',
  };
}

/**
 * Every name `electron.d.ts` DECLARES, and the subset that spawns a process.
 *
 * @param {{ root?: string }} [options]
 * @returns {Promise<ElectronSurface>}
 */
export async function readElectronSurface({ root = REPO_ROOT } = {}) {
  const found = locate(root);
  if (found === null) {
    // NOT AN ERROR, and the distinction decides everything downstream. Guards
    // runs `check:advisories` with no `npm ci` at all, so this is the normal
    // state there. "Could not look" is reported as unverifiable; it is
    // `--require-derivation`, in the one job that installs, that turns it into a
    // failure.
    return {
      checked: false,
      reason: 'electron and/or typescript are not installed, so nothing could be parsed',
      version: '',
      bytes: 0,
      declared: [],
      spawnSurface: [],
    };
  }

  const parsed = await parseElectronDeclarations({
    path: found.declarations,
    describe: `electron ${found.version}`,
  });

  return {
    checked: true,
    reason: `parsed electron.d.ts from electron ${found.version}`,
    version: found.version,
    bytes: parsed.bytes,
    declared: parsed.declared,
    spawnSurface: parsed.spawnSurface,
  };
}

/**
 * The parse and its controls, separated from locating the file.
 *
 * Separate so a proof can feed it declaration text directly. A fixture that had
 * to build a scratch `node_modules` to be parsed would be testing the lookup,
 * and the lookup is the part that cannot be wrong in an interesting way.
 *
 * @param {{ path: string, describe: string }} input `describe` names the subject
 *   in every message — "electron 43.4.1", or what a fixture is standing in for.
 * @returns {Promise<{ declared: string[], spawnSurface: string[], bytes: number }>}
 */
export async function parseElectronDeclarations({ path, describe }) {
  const ts = await loadTypeScript();
  const text = readFileSync(path, 'utf8');

  // A Program rather than a bare SourceFile, because `getSyntacticDiagnostics`
  // is public and `parseDiagnostics` is an internal field this would have to
  // cast into. `noLib` and `noResolve` keep it to the one file: nothing here
  // needs type resolution, only the shape of the declarations.
  const program = ts.createProgram({
    rootNames: [path],
    options: { noLib: true, noResolve: true, skipLibCheck: true },
  });
  const source = program.getSourceFile(path);
  if (source === undefined) {
    throw new Error(`${path} exists but the compiler produced no source file for it.`);
  }

  // A .d.ts that will not parse is a BROKEN INPUT, not an empty one. Throwing
  // here is the corollary in item 4b: an empty intermediate result must never be
  // allowed to look like an answer.
  const parseErrors = program.getSyntacticDiagnostics(source);
  if (parseErrors.length > 0) {
    throw new Error(
      `${path} produced ${String(parseErrors.length)} parse error(s), the first at ` +
        `position ${String(parseErrors[0]?.start ?? -1)}. A declaration file that cannot be parsed ` +
        `yields no symbols, and no symbols is indistinguishable from "this symbol is not ` +
        `declared" — which is the answer every verdict here wants to hear.`,
    );
  }

  /** @type {Set<string>} */
  const declared = new Set();
  /** @type {Set<string>} */
  const spawnSurface = new Set();

  /** @param {import('typescript').Node} node */
  const walk = (node) => {
    if (
      (ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name !== undefined
    ) {
      declared.add(node.name.getText(source));
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.getText(source);
      declared.add(name);
      // The SPAWN surface, derived from the type rather than from a name
      // pattern: anything declared as the utility-process factory is a way to
      // start a child process, whatever it ends up being called.
      if (node.type !== undefined && /\bUtilityProcess\b/u.test(node.type.getText(source))) {
        spawnSurface.add(name);
      }
    }

    ts.forEachChild(node, walk);
  };
  walk(source);

  if (declared.has('UtilityProcess')) spawnSurface.add('UtilityProcess');

  // ---------------------------------------------------------------------------
  // The controls, INSIDE the instrument, on every run.
  // ---------------------------------------------------------------------------
  if (declared.size === 0) {
    throw new Error(
      `Parsed ${path} and found no declarations at all. That is a broken walk, not ` +
        `an empty API — and an empty symbol set makes every "not declared" below true by ` +
        `vacuity.`,
    );
  }

  const missing = ANCHORS.filter((anchor) => !declared.has(anchor));
  if (missing.length > 0) {
    throw new Error(
      `The Electron surface walk did not find ${missing.join(', ')} — name(s) every Electron ` +
        `main process declares. A search that cannot locate something known-present reports ` +
        `"not declared" for everything, which is the reassuring answer (audit item 4b). ` +
        `Found ${String(declared.size)} declaration(s) in ${describe}.`,
    );
  }

  if (!text.includes(PROSE_SENTINEL)) {
    throw new Error(
      `The prose sentinel ${PROSE_SENTINEL} no longer appears in ${path}, so it can ` +
        `no longer distinguish a parse from a text search. Pick a token that does appear in the ` +
        `comments — a control that cannot fail is not a control.`,
    );
  }
  if (declared.has(PROSE_SENTINEL)) {
    throw new Error(
      `${PROSE_SENTINEL} appears in this file's PROSE and was reported as declared, so this walk ` +
        `is matching text rather than parsing. Measured on electron@43.4.1: 56% of the file is ` +
        `comments, utilityProcess occurs once in them, and MessagePortMain ten times. A prose ` +
        `match witnesses a symbol that has been REMOVED, which is worse than missing one.`,
    );
  }

  if (spawnSurface.size === 0) {
    throw new Error(
      `No declaration in ${describe} is typed by UtilityProcess. Either the API was ` +
        `renamed — in which case invariant 25's symbol list is stale and this must be looked at — ` +
        `or the type walk is broken. Both need a person; neither may report an empty spawn ` +
        `surface as "nothing spawns processes".`,
    );
  }

  return {
    declared: [...declared].sort(),
    spawnSurface: [...spawnSurface].sort(),
    bytes: text.length,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const surface = await readElectronSurface();
  if (!surface.checked) {
    process.stdout.write(`  --  Electron surface NOT derived: ${surface.reason}\n`);
  } else {
    process.stdout.write(
      `  ok  electron ${surface.version}: ${String(surface.declared.length)} declaration(s) ` +
        `parsed from ${String(surface.bytes)} bytes\n` +
        `      spawn surface (derived from types, not names): ` +
        `${surface.spawnSurface.join(', ')}\n` +
        `      NOTE: this witnesses DECLARATIONS. No binary is installed under ` +
        `--ignore-scripts, so nothing here says Electron can run.\n`,
    );
  }
}
