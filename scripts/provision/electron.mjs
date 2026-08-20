// @ts-check
/**
 * Provisions the Electron runtime against a pin recorded here.
 *
 * ## The third consumer of a primitive, not a new mechanism
 *
 * `downloadVerified` already provisions gitleaks and the MuPDF source. This
 * registers into that seam rather than bending one, so no B4 amendment: the same
 * allowlisted hosts, the same size cap, the same fetch-then-hash-then-publish
 * shape, and the same `.tools/` destination that `.gitignore` already covers.
 *
 * ## Why not `npm install electron` with its own install script
 *
 * Decided at `132c2e7` and recorded in `docs/JOURNAL.md`, measured rather than
 * argued. Two reasons, and the size of the download is neither:
 *
 * 1. **`ci.yml` passes `--ignore-scripts` because a dependency's install script
 *    runs arbitrary code.** Letting it run to obtain the binary would run that
 *    code on a developer machine holding git credentials instead of in a
 *    disposable runner. "Local" is the worse place for it, not the safer one.
 * 2. **`install.js` reads `electron_use_remote_checksums`** — an environment
 *    variable that repoints verification at a remote source. Trusting the
 *    installer's own check means trusting a pin an env var can replace, which is
 *    the escape hatch this project closes everywhere else.
 *
 * ## The chain is recorded, not trusted at each link
 *
 * package version → the package's `checksums.json` → **the pin below**. Each
 * link was read once, by a person, and written down; bumping Electron is then a
 * diff someone reads rather than a fetch someone trusts.
 *
 * The release's `SHASUMS256.txt` and the package's `checksums.json` agree on all
 * six archives, checked. That is **two channels from one publisher**, not two
 * independent attestations — it defeats a compromise of one distribution path
 * and nothing more. The pin is what makes a change visible; the agreement is
 * only evidence for choosing its value.
 *
 * ## Every platform is pinned, so no override is needed
 *
 * `MONSTERA_GITLEAKS` exists because contributors on unpinned platforms needed a
 * route, and `CLAUDE.md` item 1 names that shape: an escape hatch standing in for
 * missing coverage is a workaround with a config flag on it. Six archives cost
 * six lines; a route around the pin costs the pin.
 */

import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extract } from '../lib/extract.mjs';
import { loadTypeScript } from '../lib/loadTypeScript.mjs';
import { PLAIN_NODE_EXTENSIONS, SCAN_DATA_EXTENSIONS } from '../lib/plainNodeScope.mjs';
import { downloadVerified, fileExists, toolPath } from '../lib/fetchVerified.mjs';
import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The version provisioned, kept in step with the devDependency by
 * `proof:electronprovision`, which reads `apps/desktop/package.json` rather than
 * trusting this constant. Two places would otherwise disagree silently and the
 * binary would be a different build from the one the types describe.
 */
export const ELECTRON_VERSION = '43.4.1';

const ALLOWED_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/** Electron ships ~100–200 MB per platform; the cap only refuses the absurd. */
const MAX_ARCHIVE_BYTES = 320 * 1024 * 1024;

/**
 * @typedef {{ asset: string, sha256: string, executable: string }} PlatformBuild
 */

/**
 * Pinned archives, one per platform a contributor might build on.
 *
 * Keyed by `${process.platform}-${process.arch}`. Verified against both the
 * release `SHASUMS256.txt` and the package's `checksums.json` on 2026-08-20.
 *
 * @type {Readonly<Record<string, PlatformBuild>>}
 */
export const BUILDS = Object.freeze({
  'win32-x64': {
    asset: `electron-v${ELECTRON_VERSION}-win32-x64.zip`,
    sha256: 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a',
    executable: 'electron.exe',
  },
  'win32-arm64': {
    asset: `electron-v${ELECTRON_VERSION}-win32-arm64.zip`,
    sha256: '659e53872a7bba34d0a80bcbac69233c9e0919f75534b46244c581115f1f93d1',
    executable: 'electron.exe',
  },
  'linux-x64': {
    asset: `electron-v${ELECTRON_VERSION}-linux-x64.zip`,
    sha256: '79d4efd69f0ccf1fc11891ea5075329c7b3faddad79a08d9fb395bbd63169acf',
    executable: 'electron',
  },
  'linux-arm64': {
    asset: `electron-v${ELECTRON_VERSION}-linux-arm64.zip`,
    sha256: '9e2b5cfbd387e138f06c7bb19b399bb3ee487dbb4110215df097d94e80431892',
    executable: 'electron',
  },
  'darwin-x64': {
    asset: `electron-v${ELECTRON_VERSION}-darwin-x64.zip`,
    sha256: '4fd0f1826660a94216a0633600a3c3e2cd87ee9e4bc6f0e1edf717ad8e30c10b',
    executable: join('Electron.app', 'Contents', 'MacOS', 'Electron'),
  },
  'darwin-arm64': {
    asset: `electron-v${ELECTRON_VERSION}-darwin-arm64.zip`,
    sha256: 'fe3cac8cbfd9ba1739fac6c69166cf30848741f93cbe251d800ae6ef7cebb64b',
    executable: join('Electron.app', 'Contents', 'MacOS', 'Electron'),
  },
});

/** The platform key for the running process. */
export function platformKey() {
  return `${process.platform}-${process.arch}`;
}

/**
 * The pinned build for a platform, or a refusal naming what is missing.
 *
 * Throws rather than returning null, and the message lists what IS pinned: an
 * unpinned platform must read as "add a pin", never as "provisioning is
 * unavailable here", because the second invites an override.
 *
 * @param {string} [key]
 * @returns {PlatformBuild}
 */
export function buildFor(key = platformKey()) {
  const build = BUILDS[key];
  if (build === undefined) {
    throw new Error(
      `No Electron archive is pinned for ${key}. Pinned: ${Object.keys(BUILDS).join(', ')}.\n` +
        `Add its SHA-256 from the release's SHASUMS256.txt and from the package's ` +
        `checksums.json — both, and they must agree. There is deliberately no environment ` +
        `variable to point this at an unpinned binary.`,
    );
  }
  return build;
}

/** Where the provisioned runtime lives. Gitignored, like every other tool. */
export function electronRoot(root = REPO_ROOT) {
  return toolPath(root, 'electron', ELECTRON_VERSION);
}

/** The executable this platform would run, provisioned or not. */
export function electronBinaryPath(root = REPO_ROOT, key = platformKey()) {
  return join(electronRoot(root), buildFor(key).executable);
}

/**
 * THE RULE: no plain-Node code in this repository may `require('electron')`.
 * Spawn the binary this module provisions, by its explicit path.
 *
 * ## Why, measured rather than argued
 *
 * `node_modules/electron/index.js` ends with `module.exports =
 * getElectronPath()`, and that function calls `downloadElectron()` when the
 * binary is absent. So the import itself is the download trigger — lazily, at
 * first use, on a machine that installed cleanly. `--ignore-scripts` moves that
 * from install time to run time; it does not remove it. And `install.js` reads
 * `electron_use_remote_checksums`, which repoints verification at a remote
 * source, so the pin recorded above is bypassed by the very act of importing.
 *
 * Naming the provisioned path instead makes `getElectronPath()` unreachable —
 * B5, not a discouragement. There is no code path from a spawn to a download.
 *
 * ## Two routes that were rejected, and why, so they are not re-proposed
 *
 * - **`ELECTRON_OVERRIDE_DIST_PATH`.** It is read before both `downloadElectron`
 *   call sites, so it does short-circuit them. But `index.js:31` joins it with
 *   `executablePath || 'electron'`, where `executablePath` is read from
 *   `path.join(__dirname, 'path.txt')` — `__dirname` being *the dependency's*
 *   directory, not the override's. With no `path.txt` it yields `<dir>/electron`
 *   and drops the `.exe` on Windows, turning a loud "downloading" into a
 *   confusing "file not found". Making it work would mean writing inside
 *   `node_modules/`, which `npm ci` erases. **Setting it is worse than not.**
 * - **`.npmrc` with `ignore-scripts=true`.** It would also disable this
 *   repository's own `prepare` script, which installs the git hooks — silently
 *   disarming the secret scan and the escape-resolving-write guard.
 *
 * ## The rule covers what we control; the guard below catches the rest
 *
 * `apps/desktop/src/preload.ts` imports `electron` and is not a violation: it
 * runs *inside* the Electron runtime, where the specifier resolves to the API
 * surface rather than to `index.js`. The rule is about **plain Node** — the
 * launcher, and everything under `scripts/`.
 *
 * Promoting this to an `ARCHITECTURE.md` §9 invariant is a **B4 amendment owed**,
 * in its own commit. It is enforced here first because the enforcement is free
 * today and the amendment is not urgent; the ordering is deliberate and stated
 * rather than skipped.
 *
 * `stat` rather than `fileExists`, and that distinction is the whole function.
 * `fileExists` answers "is there a usable FILE here" — it ends in `.isFile()` —
 * and `dist` is a DIRECTORY, so the first version of this could not return true
 * for the only thing it looks at. It was written against a checkout where the
 * directory was absent, so it gave the right answer for the wrong reason and
 * every caller agreed with it. Its positive control is what separated the two.
 *
 * Any entry counts, not only a directory: a symlinked or file-shaped `dist` is
 * still an unpinned runtime arriving, and "present but not the shape I expected"
 * must not read as absent.
 *
 * @param {string} [root]
 * @returns {Promise<boolean>} whether an unpinned runtime is present
 */
export async function unpinnedRuntimeExists(root = REPO_ROOT) {
  try {
    await stat(join(root, 'node_modules', 'electron', 'dist'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Plain-Node files that load a given specifier **at runtime** — the shapes
 * ESLint's `no-restricted-imports` cannot see.
 *
 * ## What this does NOT cover, and why that is correct
 *
 * Static `import`, `export … from` and `import x = require(…)` are ESLint's,
 * restricted for `scripts/` in `eslint.config.js` against the same
 * `ELECTRON_SPECIFIERS` list. **B3a: the authority already defines that answer,
 * so exactly one thing implements it.** This function used to be a second
 * opinion about static imports; it is now the residue and nothing else.
 *
 * The residue is real and was measured rather than assumed. In ESLint 10.8.1,
 * `no-restricted-imports.js` is 891 lines with a single visitor object at line
 * 857 — `ImportDeclaration`, `ExportNamedDeclaration`, `ExportAllDeclaration`,
 * `TSImportEqualsDeclaration`. `ImportExpression` occurs **zero** times in the
 * file, and there is no `CallExpression` visitor. `eslint-plugin-import-x` is
 * installed and adds nothing: the only rules that visit `ImportExpression` are
 * `no-cycle`, `no-dynamic-require`, `dynamic-import-chunkname` and
 * `no-unused-modules`, none of which restricts a specifier.
 *
 * So two shapes reach `getElectronPath()` with no rule in their way, and both
 * are `CallExpression`s, which is why one walk covers both:
 *
 * ```
 *   await import('electron')
 *   createRequire(import.meta.url)('electron')
 * ```
 *
 * Aliased `createRequire` is covered too — `const require = createRequire(…)`
 * then `require('electron')` — because that binding is not hypothetical: it is
 * how `proofs/nativeAddon.proof.mjs` loads koffi.
 *
 * ## Nested, not top-level
 *
 * The static version read `source.statements` only, which is sound for imports
 * because they are always top-level. A runtime load is not: every one of this
 * repository's real `await import(…)` calls sits inside a function. Reading
 * statements would have reported "nothing" for a file that loads on every run.
 *
 * ## Why a parse rather than a grep
 *
 * This repository's own proofs are the reason. Measured, and the count matters
 * because the first version of this paragraph got it wrong: six lines under
 * `scripts/` hold a fixture STRING reading
 * `import … from 'electron'` — four in `proofs/preloadSurface.proof.mjs`, one in
 * `proofs/boundaries.proof.mjs`, one in `security/preloadSurface.mjs` — and
 * every one of them is inside this scan's own root. A text scan flags three
 * files that are enforcing the rule, and a scan that cries wolf gets relaxed
 * until it flags nothing. That is item 4b's window axis arriving as a FALSE
 * POSITIVE rather than a false negative — the same failure, and more likely to
 * be "fixed" the wrong way.
 *
 * That paragraph previously named `electron.proof.mjs` as the file holding the
 * four, which contains exactly one occurrence: the sentence claiming there were
 * four. The argument was sound and the evidence was not, which is the shape that
 * survives review best — a checked claim with an unchecked detail attached,
 * where the checked half makes the other read as checked.
 *
 * ## Scope, and the one place it is load-bearing
 *
 * `scripts/` is this repository's plain-Node surface, and **the launcher belongs
 * here for that reason** rather than as a filing preference.
 * `apps/desktop/src/` is deliberately excluded: it runs inside the Electron
 * runtime, where `electron` is the API surface and not `index.js`.
 *
 * A launcher under `apps/desktop/` would be invisible to **both** mechanisms at
 * once, and neither could say so. ESLint's boundary is per-package and exempts
 * `desktop` by design, so `apps/desktop/src/launch.ts` is *permitted*; a
 * `apps/desktop/dev.mjs` matches no package glob at all — they end `.ts,.tsx` —
 * and no `scripts/` glob either, so no rule applies to it whatsoever. Keeping
 * the launcher in `scripts/` makes that state unrepresentable instead of
 * policed, which is B5 rather than a fourth rule. Moving it is a **B4
 * conversation**, not a refactor.
 *
 * @param {string} specifier
 * @param {string} [root]
 * @returns {Promise<string[]>} repo-relative paths, empty when none
 */
export async function scriptsLoadingAtRuntime(specifier, root = REPO_ROOT) {
  const ts = await loadTypeScript(
    `runtime module loads cannot be DERIVED, and a text scan is not a substitute: this ` +
      `repository's own proof fixtures contain the exact string being searched for.`,
  );
  const scripts = join(root, 'scripts');
  /** @type {string[]} */
  const files = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf('.') + 1);
      if (PLAIN_NODE_EXTENSIONS.includes(extension)) files.push(full);
      else if (!SCAN_DATA_EXTENSIONS.includes(extension)) {
        // REFUSE an unrecognised extension rather than skip it. Skipping is how
        // both mechanisms came to glob `.mjs` alone: a `.js` or `.cjs` here was
        // invisible to this walk AND to ESLint, each reporting the reassuring
        // answer with no way to say it had not looked. A file the classifier
        // does not recognise is a decision someone has to make, so it stops
        // here instead of being silently dropped into the safe pile.
        throw new Error(
          `${relative(root, full).replaceAll('\\', '/')} has an extension this scan does not ` +
            `classify. Add it to PLAIN_NODE_EXTENSIONS in eslint.config.js if it is code that ` +
            `runs — which also brings it under the lint rule — or to SCAN_DATA_EXTENSIONS if ` +
            `it is not. Skipping it would report "nothing loads ${specifier}" without ever ` +
            `having read it.`,
        );
      }
    }
  };
  walk(scripts);

  if (files.length === 0) {
    throw new Error(
      `No plain-Node files were found under ${scripts}. An empty file set reports "nothing ` +
        `loads ${specifier}" for every specifier, which is the reassuring answer (item 4b).`,
    );
  }

  const program = ts.createProgram({
    rootNames: files,
    options: { allowJs: true, noLib: true, noResolve: true, skipLibCheck: true },
  });

  /** @type {string[]} */
  const found = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (source === undefined) {
      throw new Error(`${file} was listed but the compiler produced no source file for it.`);
    }

    // `createRequire` bindings first, because a call is only a module load if
    // its callee is one — and the whole file has to be read before the calls
    // are judged, since a binding may be declared after a function that uses it.
    /** @type {Set<string>} */
    const requireAliases = new Set(['require']);
    /** @param {import('typescript').Node} node */
    const collectAliases = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        isCreateRequireCall(ts, node.initializer)
      ) {
        requireAliases.add(node.name.text);
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(source);

    /** @param {import('typescript').Node} node */
    const inspect = (node) => {
      if (ts.isCallExpression(node) && loadsSpecifier(ts, node, specifier, requireAliases)) {
        found.push(relative(root, file).replaceAll('\\', '/'));
      }
      // RECURSE. Every real `await import(…)` in this repository sits inside a
      // function, so a top-level-only visit reports nothing for a file that
      // loads on every run.
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
  return [...new Set(found)];
}

/**
 * Whether an expression is a `createRequire(…)` call.
 *
 * Matches the bare identifier and the namespaced form (`module.createRequire`),
 * because both are how it is reached.
 *
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Node} node
 * @returns {boolean}
 */
function isCreateRequireCall(ts, node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'createRequire';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'createRequire';
}

/**
 * Whether a call expression loads `specifier` at runtime.
 *
 * Three callee shapes count, and the argument must be a STRING LITERAL equal to
 * the specifier. That last condition is what keeps the scan from crying wolf at
 * its own proofs, which pass `'electron'` as an ordinary argument all over the
 * place — `scriptsLoadingAtRuntime('electron', root)` is a call with that exact
 * string in it, and a callee-blind check would flag every one.
 *
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').CallExpression} node
 * @param {string} specifier
 * @param {Set<string>} requireAliases
 * @returns {boolean}
 */
function loadsSpecifier(ts, node, specifier, requireAliases) {
  const [argument] = node.arguments;
  if (argument === undefined || !ts.isStringLiteral(argument) || argument.text !== specifier) {
    return false;
  }
  const callee = node.expression;

  // `import('x')` — a CallExpression whose callee is the `import` keyword.
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;

  // `require('x')`, or any identifier bound to a `createRequire(…)` result.
  if (ts.isIdentifier(callee) && requireAliases.has(callee.text)) return true;

  // `require.resolve('x')` and the aliased equivalent. Stated precisely,
  // because the first draft of this comment overstated it: `resolve` returns a
  // path and does NOT execute the module, so on its own it triggers no
  // download. It is flagged because resolving `electron` from plain Node has no
  // legitimate use here — the pinned binary is named directly — and because the
  // resolved path is one `require` away from the thing this rule exists to
  // prevent. Detection of a precursor, not of the act.
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    requireAliases.has(callee.expression.text) &&
    callee.name.text === 'resolve'
  ) {
    return true;
  }

  // `createRequire(import.meta.url)('x')` — invoked without ever being bound.
  return isCreateRequireCall(ts, callee);
}

/**
 * Downloads and publishes the runtime if it is not already present.
 *
 * Extracted into a staging directory and renamed into place, so an interrupted
 * run leaves no half-extracted tree that a later run would treat as provisioned.
 * That is the same publish shape `gitleaks.mjs` uses, and the same reason.
 *
 * @param {{ root?: string, key?: string }} [options]
 * @returns {Promise<string>} the executable's path
 */
export async function provisionElectron({ root = REPO_ROOT, key = platformKey() } = {}) {
  const build = buildFor(key);
  const binary = join(electronRoot(root), build.executable);
  if (await fileExists(binary)) return binary;

  const staging = await mkdtemp(join(tmpdir(), 'monstera-electron-'));
  const archive = join(staging, build.asset);
  try {
    await downloadVerified({
      url: `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${build.asset}`,
      allowedHosts: ALLOWED_HOSTS,
      sha256: build.sha256,
      maxBytes: MAX_ARCHIVE_BYTES,
      destination: archive,
    });

    extract(staging, build.asset);
    await rm(archive, { force: true });

    await mkdir(dirname(electronRoot(root)), { recursive: true });
    await rm(electronRoot(root), { recursive: true, force: true });
    await rename(staging, electronRoot(root));
  } catch (thrown) {
    await rm(staging, { recursive: true, force: true });
    throw thrown;
  }

  if (!(await fileExists(binary))) {
    throw new Error(
      `The archive verified and extracted, but ${binary} is not there. The pin is for ` +
        `${build.asset}; either its layout changed or the wrong executable name is recorded.`,
    );
  }
  return binary;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/') ?? ''}`) {
  provisionElectron().then(
    (binary) => {
      process.stdout.write(`Electron ${ELECTRON_VERSION} at ${binary}\n`);
    },
    (error) => {
      process.stderr.write(`${formatError(error)}\n`);
      process.exitCode = 1;
    },
  );
}
