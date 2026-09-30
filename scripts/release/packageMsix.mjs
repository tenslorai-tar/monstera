// @ts-check
/**
 * Builds the application's MSIX: assembles the package's folder and packs it with the Windows SDK's MakeAppx
 * ([ADR-0123](../../docs/DECISIONS/0123-the-msix-is-assembled-here-and-packed-by-the-sdks-makeappx.md)).
 *
 * ## What goes in, and from where
 *
 * - the provisioned Electron runtime, `electron.exe` renamed `Monstera.exe`;
 * - `resources/app/`: the desktop package's `dist/`, and a `node_modules/` holding the workspace packages' `dist/`
 *   and npm's own production tree for them — npm answers which third-party packages ship, never a list kept here;
 * - `resources/native/<component>/` and `manifest.json` (ADR-0122), each file copied from its development tree and
 *   hashed on the way in against the pin the manifest carries, so the package holds pinned bytes or is not built;
 * - `NOTICE`, `LICENSE` and the third-party licence texts, and the Store images indexed by MakePri.
 *
 * ## Nothing ships that the entry does not reach
 *
 * `shippedModules.mjs` walks the staged modules from `entry.js` — imports, and files named by literal as the shell
 * names a preload, a worker and each host entry — and every module outside that closure is removed from the stage,
 * named in the output (decision E). The owner's 0.1.6.0 carried a test's fake of the host surfaces; a name-based rule
 * had let it through.
 *
 * ## Nothing ships that does not resolve
 *
 * Every bare import in the shipped JavaScript is looked up from inside the staged folder, the way Node's resolver
 * walks `node_modules`, and one miss refuses the package by name. A dependency declared only at the repository root
 * resolves in a checkout and is absent from the package; this is where that becomes visible, rather than at a
 * person's first click. The lookup carries a positive control — `zod`, which the contract imports, must be found —
 * because a search that could see nothing reports the same clean result as one that found everything.
 *
 * Usage: node scripts/release/packageMsix.mjs --flavour test|store --version A.B.C.0 --out <folder> [--replace-older]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORE_ASSETS, writeStoreAssets } from '../brand/storeAssets.mjs';
import { SHELL_LAUNCH, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { isMain } from '../lib/isMain.mjs';
import { loadTypeScript } from '../lib/loadTypeScript.mjs';
import { formatError } from '../lib/reportError.mjs';
import { shimPath } from '../lib/shimBinary.mjs';
import { electronRoot } from '../provision/electron.mjs';
import { gswin64cPath } from '../provision/ghostscript.mjs';
import { x2tPath } from '../provision/onlyoffice.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { pdftotextPath } from '../provision/poppler.mjs';
import { tessdataDirectory } from '../provision/tessdata.mjs';
import { nativeManifest } from './nativeManifest.mjs';
import { moduleClosure, modulesLoadedByPath } from './shippedModules.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The OID Windows requires in the Publisher of a package it installs unsigned (*Create an unsigned MSIX package*,
 * Microsoft Learn, read 2026-09-29).
 */
export const UNSIGNED_OID = 'OID.2.25.311729368913984317654407730594956997722=1';

/** The name Windows shows, in the Start menu and on the Store. */
export const DISPLAY_NAME = 'Monstera PDF Editor';

/** The runtime's executable, and the name the package gives it. */
const EXECUTABLE = 'Monstera.exe';

/** The workspace packages the shell loads in Node or Electron main. `ui` and `testing` are bundled or unshipped. */
const SHIPPED_WORKSPACES = ['@monstera/desktop', '@monstera/kernel', '@monstera/contract', '@monstera/shared', '@monstera/nodemode'];

/** The package budget the owner set, in bytes. */
export const SIZE_TARGET = 150 * 1024 * 1024;

/**
 * @typedef {'test' | 'store'} Flavour
 * @typedef {{ readonly name: string; readonly publisher: string; readonly publisherDisplayName: string }} Identity
 * @typedef {{ readonly store: { readonly identityName: string; readonly publisher: string; readonly publisherDisplayName: string } }} MsixConfig
 */

/**
 * The package's identity for a flavour. The test flavour's Publisher carries {@link UNSIGNED_OID}, the only form
 * Windows installs unsigned; the Store flavour takes Partner Center's reserved identity and REFUSES the OID, because a
 * Store package carrying it is one Windows treats as unsigned.
 *
 * @param {Flavour} flavour
 * @param {MsixConfig} config
 * @returns {Identity}
 */
export function packageIdentity(flavour, config) {
  if (flavour === 'test') {
    return { name: 'TenslorInc.MonsteraPDFEditor.Test', publisher: `CN=Tenslor Inc., ${UNSIGNED_OID}`, publisherDisplayName: 'Tenslor Inc.' };
  }
  const { identityName, publisher, publisherDisplayName } = config.store;
  if (identityName === '' || publisher === '' || publisherDisplayName === '') {
    throw new Error(
      'The Store flavour needs the identity Partner Center reserves: set store.identityName, store.publisher and ' +
        'store.publisherDisplayName in scripts/release/msix.json.',
    );
  }
  if (publisher.includes(UNSIGNED_OID)) {
    throw new Error(`The Store flavour's Publisher carries ${UNSIGNED_OID}, which marks a package Windows installs unsigned.`);
  }
  return { name: identityName, publisher, publisherDisplayName };
}

/**
 * Refuses a version that is not four numeric parts with the fourth 0 (the Store reserves it), or that is not greater
 * than every version already packed — B8's *never reuse a number*, as a check.
 *
 * @param {string} version
 * @param {readonly string[]} packed
 */
export function refuseVersion(version, packed) {
  const parts = version.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^(0|[1-9]\d{0,4})$/u.test(part))) {
    throw new Error(`${version} is not a four-part version (A.B.C.0).`);
  }
  if (parts[3] !== '0') throw new Error(`${version}: the fourth part must be 0 — the Store reserves it.`);
  const numbers = parts.map(Number);
  for (const earlier of packed) {
    const other = earlier.split('.').map(Number);
    const order = numbers.map((n, i) => n - (other[i] ?? 0)).find((d) => d !== 0) ?? 0;
    if (order <= 0) throw new Error(`${version} is not greater than ${earlier}, which was already packed.`);
  }
}

/**
 * The package manifest.
 *
 * @param {{ identity: Identity; version: string; architecture: 'x64' }} options
 */
export function appxManifest({ identity, version, architecture }) {
  const escape = (/** @type {string} */ text) =>
    text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"',
    '  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"',
    '  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"',
    '  IgnorableNamespaces="uap rescap">',
    `  <Identity Name="${escape(identity.name)}" Publisher="${escape(identity.publisher)}" Version="${version}" ProcessorArchitecture="${architecture}" />`,
    '  <Properties>',
    `    <DisplayName>${escape(DISPLAY_NAME)}</DisplayName>`,
    `    <PublisherDisplayName>${escape(identity.publisherDisplayName)}</PublisherDisplayName>`,
    '    <Logo>Assets\\StoreLogo.png</Logo>',
    '  </Properties>',
    '  <Dependencies>',
    '    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />',
    '  </Dependencies>',
    '  <Resources>',
    '    <Resource Language="en-us" />',
    '  </Resources>',
    '  <Applications>',
    `    <Application Id="Monstera" Executable="${EXECUTABLE}" EntryPoint="Windows.FullTrustApplication">`,
    `      <uap:VisualElements DisplayName="${escape(DISPLAY_NAME)}" Description="${escape(DISPLAY_NAME)}"`,
    '        BackgroundColor="transparent" Square150x150Logo="Assets\\MedTile.png" Square44x44Logo="Assets\\AppList.png">',
    '        <uap:DefaultTile Wide310x150Logo="Assets\\WideTile.png" Square71x71Logo="Assets\\SmallTile.png" Square310x310Logo="Assets\\LargeTile.png" />',
    '      </uap:VisualElements>',
    '      <Extensions>',
    '        <uap:Extension Category="windows.fileTypeAssociation">',
    '          <uap:FileTypeAssociation Name="pdf">',
    '            <uap:DisplayName>PDF document</uap:DisplayName>',
    '            <uap:Logo>Assets\\AppList.png</uap:Logo>',
    '            <uap:SupportedFileTypes>',
    '              <uap:FileType ContentType="application/pdf">.pdf</uap:FileType>',
    '            </uap:SupportedFileTypes>',
    '          </uap:FileTypeAssociation>',
    '        </uap:Extension>',
    '      </Extensions>',
    '    </Application>',
    '  </Applications>',
    '  <Capabilities>',
    '    <rescap:Capability Name="runFullTrust" />',
    '    <DeviceCapability Name="webcam" />',
    '  </Capabilities>',
    '</Package>',
    '',
  ].join('\r\n');
}

/**
 * The package a bare specifier names: `@scope/name` or `name`, without a subpath.
 *
 * @param {string} specifier
 */
export function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

const BUILTINS = new Set(builtinModules);

/**
 * The bare specifiers a JavaScript file names literally.
 *
 * **The compiler's own import scanner reads them** (`ts.preProcessFile`): static and dynamic imports and `require`
 * calls, and never the inside of a string. A text pattern was the first version here, and on its first run it reported
 * eleven "imports" that were prose — `Promise.resolve('ended')`, an error message saying `from 'the harness'` — which is
 * a second opinion about what a module imports, where TypeScript already owns the answer (B3a).
 *
 * One form the scanner does not report, because it names a module's PATH rather than importing it:
 * `require.resolve('x')` and `createRequire(...).resolve('x')`, which the kernel uses to find its WebAssembly. Those
 * two receivers are matched by name, and `Promise.resolve` never is. A specifier built at run time is out of reach of
 * both, which is stated rather than hidden.
 *
 * @param {string} source
 * @param {typeof import('typescript')} ts
 * @returns {string[]}
 */
export function bareSpecifiers(source, ts) {
  const named = ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
  for (const match of source.matchAll(/(?:\brequire|\bcreateRequire\([^()]*\))\.resolve\(\s*['"]([^'"\n]+)['"]\s*\)/gu)) {
    named.push(match[1] ?? '');
  }
  const found = new Set();
  for (const specifier of named) {
    if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z]+:/iu.test(specifier)) continue;
    if (BUILTINS.has(specifier) || BUILTINS.has(packageNameOf(specifier))) continue;
    if (specifier === 'electron') continue;
    found.add(specifier);
  }
  return [...found];
}

/**
 * Whether `name` is found from `file` the way Node walks `node_modules` — each ancestor's `node_modules/<name>`,
 * stopping at `root`. Presence, not the package's `exports`: the question is whether it SHIPPED.
 *
 * @param {string} file
 * @param {string} name
 * @param {string} root
 */
export function packageFound(file, name, root) {
  let directory = dirname(file);
  for (;;) {
    if (existsSync(join(directory, 'node_modules', name, 'package.json'))) return true;
    if (directory === root || !directory.startsWith(root)) return false;
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

/**
 * Every shipped JavaScript file's bare imports that do not resolve inside `appRoot`, as `file: specifier` lines.
 * Refuses to report when its positive control — `zod` from the contract's `dist` — is not found.
 *
 * @param {string} appRoot the staged `resources/app`
 * @param {typeof import('typescript')} ts
 * @returns {string[]}
 */
export function unresolvedImports(appRoot, ts) {
  const contract = join(appRoot, 'node_modules', '@monstera', 'contract', 'dist', 'index.js');
  if (!existsSync(contract) || !packageFound(contract, 'zod', appRoot)) {
    throw new Error('The resolution check could not find zod from the contract: it cannot see, so it reports nothing.');
  }
  const roots = [
    join(appRoot, 'dist'),
    ...SHIPPED_WORKSPACES.filter((name) => name !== '@monstera/desktop').map((name) =>
      join(appRoot, 'node_modules', name, 'dist'),
    ),
  ];
  /** @type {string[]} */
  const missing = [];
  let scanned = 0;
  for (const top of roots) {
    for (const file of filesUnder(top)) {
      if (!/\.(?:m?js|cjs)$/u.test(file) || file.includes(`${sep}renderer${sep}`)) continue;
      scanned += 1;
      for (const specifier of bareSpecifiers(readFileSync(file, 'utf8'), ts)) {
        if (!packageFound(file, packageNameOf(specifier), appRoot)) missing.push(`${relative(appRoot, file)}: ${specifier}`);
      }
    }
  }
  if (scanned === 0) throw new Error('The resolution check scanned no file: an empty input is a broken read.');
  return missing;
}

/**
 * Every file under `folder`, recursively.
 *
 * @param {string} folder
 * @returns {string[]}
 */
function filesUnder(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** What a shipped `dist/` leaves out: tests, maps, declarations, and the build's own Store images. */
function shippedFromDist(/** @type {string} */ source) {
  const name = basename(source);
  if (/\.(?:map|d\.ts|d\.mts)$/u.test(name)) return false;
  if (/\.(?:test|spec|proof|setup)\.[cm]?js$/u.test(name)) return false;
  if (source.split(sep).includes('store-assets')) return false;
  return true;
}

/** The newest Windows SDK's `bin/<version>/x64`, holding both MakeAppx and MakePri. */
export function sdkTools() {
  const base = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = existsSync(base)
    ? readdirSync(base)
        .filter((name) => /^10\.0\.\d+\.\d+$/u.test(name))
        .sort((a, b) => Number(b.split('.')[2]) - Number(a.split('.')[2]))
    : [];
  for (const version of versions) {
    const folder = join(base, version, 'x64');
    if (existsSync(join(folder, 'makeappx.exe')) && existsSync(join(folder, 'makepri.exe'))) {
      return { makeappx: join(folder, 'makeappx.exe'), makepri: join(folder, 'makepri.exe'), version };
    }
  }
  throw new Error(`No Windows SDK with makeappx.exe and makepri.exe under ${base}. Install the Windows SDK.`);
}

/**
 * Each native component's development folder: the one its manifest paths are relative to — the folder the
 * launcher's path sits in, as `nativeComponentFolder` answers it in development.
 *
 * @param {string} root
 * @returns {Record<string, string>}
 */
function componentSources(root) {
  return {
    pdfium: dirname(pdfiumLibrary(root)),
    poppler: dirname(pdftotextPath(root)),
    ghostscript: dirname(gswin64cPath(root)),
    onlyoffice: dirname(x2tPath(root)),
    'mupdf-shim': dirname(shimPath(root)),
    'ocr-models': tessdataDirectory(root),
  };
}

/** @param {string} path */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The npm production tree for the shipped workspaces, as package folders relative to the root `node_modules`.
 * npm is the authority on which packages a workspace's production dependencies are (B3a).
 *
 * @param {string} root
 * @returns {string[]}
 */
function productionPackages(root) {
  const args = ['ls', '--omit=dev', '--all', '--parseable', ...SHIPPED_WORKSPACES.flatMap((name) => ['-w', name])];
  /** @type {string} */
  let output;
  try {
    output = execFileSync('npm', args, { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // `npm ls` EXITS NON-ZERO on a tree it considers imperfect and still prints the tree; the paths are what it says
    // is installed, and the resolution check below is what decides whether they are enough.
    output = /** @type {{ stdout?: string }} */ (error).stdout ?? '';
  }
  const modules = join(root, 'node_modules') + sep;
  const found = output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(modules))
    .map((line) => line.slice(modules.length))
    .filter((path) => !path.startsWith(`@monstera${sep}`));
  if (found.length === 0) throw new Error('npm named no production package: an empty tree is a broken read.');
  return [...new Set(found)].sort();
}

/**
 * Copies a package folder without its nested `node_modules`, which npm's tree lists as packages of their own.
 *
 * @param {string} from
 * @param {string} to
 */
function copyPackage(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (source) => relative(from, source).split(sep)[0] !== 'node_modules',
  });
}

/** @param {string[]} argv */
function parseArguments(argv) {
  /** @type {Record<string, string | true>} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument ${argument}.`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) options[argument.slice(2)] = true;
    else {
      options[argument.slice(2)] = next;
      index += 1;
    }
  }
  /** @type {Flavour | null} */
  const flavour = options['flavour'] === 'test' ? 'test' : options['flavour'] === 'store' ? 'store' : null;
  const version = options['version'];
  const out = options['out'];
  if (flavour === null) throw new Error('--flavour must be test or store.');
  if (typeof version !== 'string') throw new Error('--version A.B.C.0 is required.');
  if (typeof out !== 'string') throw new Error('--out <folder> is required.');
  return { flavour, version, out: resolve(out), replaceOlder: options['replace-older'] === true };
}

/** @param {string} root */
function packedVersions(root) {
  const path = join(root, 'docs', 'packaged-versions.json');
  /** @type {{ packed: { version: string; flavour: string; commit: string; date: string }[] }} */
  const record = JSON.parse(readFileSync(path, 'utf8'));
  return { path, record };
}

async function main() {
  const { flavour, version, out, replaceOlder } = parseArguments(process.argv.slice(2));
  const { path: versionsPath, record } = packedVersions(REPO_ROOT);
  refuseVersion(version, record.packed.map((entry) => entry.version));
  /** @type {MsixConfig} */
  const config = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'release', 'msix.json'), 'utf8'));
  const identity = packageIdentity(flavour, config);
  const tools = sdkTools();
  const ts = await loadTypeScript('the resolution check reads each shipped module’s imports with the compiler’s scanner');
  const step = (/** @type {string} */ text) => process.stdout.write(`${text}\n`);

  // A PACKAGE IS A COMMIT'S. Anything uncommitted in what ships — a tracked edit, or an untracked source file the build
  // would compile in — would put bytes in the package that no commit holds.
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'scripts', 'NOTICE', 'LICENSE', 'package.json', 'package-lock.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  if (dirty !== '') throw new Error(`Commit or remove these before packaging, so the package is a commit's:\n${dirty}`);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

  // FROM A CLEAN BUILD, through the project's own verbs. `tsc` never deletes an output whose source is gone, so a
  // `dist/` carries modules nothing produces any more — measured 2026-09-29: a research probe from 2026-09-15 in the
  // kernel's `dist/` — and a package copied from it would ship them.
  step('clean build');
  const heap = { ...process.env, NODE_OPTIONS: process.env['NODE_OPTIONS'] ?? '--max-old-space-size=8192' };
  execFileSync('npm run clean --workspaces --if-present', { cwd: REPO_ROOT, stdio: 'inherit', shell: 'cmd.exe' });
  execFileSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit', shell: 'cmd.exe', env: heap });
  refuseStaleBuild(REPO_ROOT, SHELL_LAUNCH, 7);

  const work = join(REPO_ROOT, 'release', 'msix', flavour);
  const stage = join(work, 'layout');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  step('runtime');
  cpSync(electronRoot(REPO_ROOT), stage, { recursive: true });
  renameSync(join(stage, 'electron.exe'), join(stage, EXECUTABLE));
  rmSync(join(stage, 'resources', 'default_app.asar'), { force: true });

  step('application');
  const app = join(stage, 'resources', 'app');
  const semver = version.split('.').slice(0, 3).join('.');
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify({ name: 'monstera', productName: DISPLAY_NAME, version: semver, private: true, type: 'module', main: './dist/entry.js', license: 'AGPL-3.0-or-later' }, null, 2)}\n`,
  );
  cpSync(join(REPO_ROOT, 'apps', 'desktop', 'dist'), join(app, 'dist'), { recursive: true, filter: shippedFromDist });
  for (const name of SHIPPED_WORKSPACES.filter((workspace) => workspace !== '@monstera/desktop')) {
    const from = join(REPO_ROOT, 'packages', name.slice('@monstera/'.length));
    const to = join(app, 'node_modules', name);
    mkdirSync(to, { recursive: true });
    copyFileSync(join(from, 'package.json'), join(to, 'package.json'));
    cpSync(join(from, 'dist'), join(to, 'dist'), { recursive: true, filter: shippedFromDist });
  }
  // ONLY WHAT THE ENTRY REACHES (decision E): a module no path from `entry.js` loads — a test's fake, a proof's
  // harness — was in `dist/` because the proofs run it from there, and is removed from the stage by name.
  const closure = moduleClosure({
    entry: join(app, 'dist', 'entry.js'),
    roots: [join(app, 'dist'), ...SHIPPED_WORKSPACES.filter((name) => name !== '@monstera/desktop').map((name) => join(app, 'node_modules', name, 'dist'))],
    packageDir: (name) => (SHIPPED_WORKSPACES.includes(name) ? join(app, 'node_modules', name) : null),
    mustReach: await modulesLoadedByPath(join(app, 'dist')),
    ts,
  });
  for (const path of closure.unreached) rmSync(path);
  step(`  ${String(closure.reached.size)} modules reached from the entry; ${String(closure.unreached.length)} left out:`);
  for (const path of closure.unreached) step(`    ${relative(app, path)}`);
  const packages = productionPackages(REPO_ROOT);
  for (const path of packages) copyPackage(join(REPO_ROOT, 'node_modules', path), join(app, 'node_modules', path));
  step(`  ${String(packages.length)} production packages`);
  const missing = unresolvedImports(app, ts);
  if (missing.length > 0) {
    throw new Error(`The package would not resolve ${String(missing.length)} import(s):\n  ${missing.join('\n  ')}`);
  }

  step('native components');
  const manifest = nativeManifest(REPO_ROOT);
  const sources = componentSources(REPO_ROOT);
  for (const id of Object.keys(sources)) {
    const entry = manifest.components[id];
    if (entry === undefined) throw new Error(`${id} is not in this checkout's manifest; provision or build it first.`);
    for (const [path, digest] of Object.entries(entry.files)) {
      const from = join(sources[id] ?? '', path);
      const to = join(stage, 'resources', 'native', id, path);
      if (!existsSync(from)) throw new Error(`${id}: ${path} is pinned and absent from ${sources[id] ?? ''}.`);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      if (sha256(to) !== digest) throw new Error(`${id}: ${path} does not match its pin; re-provision it.`);
    }
  }
  writeFileSync(join(stage, 'resources', 'native', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  step('notices');
  copyFileSync(join(REPO_ROOT, 'NOTICE'), join(stage, 'NOTICE'));
  copyFileSync(join(REPO_ROOT, 'LICENSE'), join(stage, 'LICENSE'));
  cpSync(join(REPO_ROOT, 'scripts', 'release', 'licences'), join(stage, 'licences'), { recursive: true });

  step('images and manifest');
  // THE IMAGES ARE INDEXED FROM THEIR OWN FOLDER. MakePri's default indexer reads every file under the folder it is
  // given as a resource and every dotted name part as a qualifier, so pointed at the whole layout it would read
  // Chromium's `en-US.pak` as a language — the index is built beside the images and copied in.
  const images = join(work, 'images');
  await writeStoreAssets(join(images, 'Assets'));
  rmSync(join(images, 'Assets', 'Listing.AppTileIcon-300.png'), { force: true });
  if (STORE_ASSETS.length !== 73) throw new Error('The Store image set changed size; read storeAssets.mjs before packing.');
  const manifestXml = appxManifest({ identity, version, architecture: 'x64' });
  writeFileSync(join(images, 'AppxManifest.xml'), manifestXml);
  const priconfig = join(work, 'priconfig.xml');
  execFileSync(tools.makepri, ['createconfig', '/cf', priconfig, '/dq', 'en-US', '/pv', '10.0.0', '/o'], { stdio: 'pipe' });
  execFileSync(tools.makepri, ['new', '/pr', images, '/cf', priconfig, '/mn', join(images, 'AppxManifest.xml'), '/of', join(stage, 'resources.pri'), '/o'], { stdio: 'pipe' });
  cpSync(join(images, 'Assets'), join(stage, 'Assets'), { recursive: true });
  writeFileSync(join(stage, 'AppxManifest.xml'), manifestXml);

  step('pack');
  mkdirSync(out, { recursive: true });
  const file = join(out, `Monstera-PDF-Editor_${version}_x64_${flavour}.msix`);
  if (replaceOlder) {
    for (const name of readdirSync(out)) {
      if (/^Monstera-PDF-Editor_.*\.msix$/u.test(name)) rmSync(join(out, name));
    }
  }
  execFileSync(tools.makeappx, ['pack', '/d', stage, '/p', file, '/o'], { stdio: 'pipe', maxBuffer: 256 * 1024 * 1024 });

  record.packed.push({ version, flavour, commit, date: new Date().toISOString().slice(0, 10) });
  writeFileSync(versionsPath, `${JSON.stringify(record, null, 2)}\n`);

  const size = statSync(file).size;
  const megabytes = (size / 1024 / 1024).toFixed(1);
  step(`\n${file}`);
  step(`${String(size)} bytes (${megabytes} MB) against the 150 MB target: ${size <= SIZE_TARGET ? 'within' : 'OVER'}`);
  step(`version ${version}, ${flavour} flavour, commit ${commit}, MakeAppx from SDK ${tools.version}`);
}

if (isMain(import.meta.url)) {
  main().catch((/** @type {unknown} */ error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  });
}
