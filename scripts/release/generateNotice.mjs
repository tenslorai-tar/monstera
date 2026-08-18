// @ts-check
/**
 * Generates NOTICE from the lockfile's production tree and the native
 * components compiled into the shim.
 *
 * AGPL-3.0-or-later obliges this project to say what it ships and under what
 * terms. A hand-maintained list cannot do that honestly: it is right on the day
 * it is written and silently wrong on the day a dependency is added, and nobody
 * reviewing that dependency looks at NOTICE.
 *
 * ## What counts as shipped
 *
 * The lockfile's PRODUCTION tree, which is the set npm resolves with
 * `--omit=dev`, minus this repository's own workspaces. Development tooling is
 * not distributed and listing it would be as wrong as omitting a dependency —
 * a NOTICE naming 297 build-time packages tells a reader nothing about what is
 * on their machine.
 *
 * That set is only correct if the manifests are. Generating this found that
 * `packages/kernel` still declared the `mupdf` npm package as a production
 * dependency, which ADR-0010 withdrew when the engine moved to native linkage:
 * nothing imported it, and it would have appeared in NOTICE as a shipped
 * component that is not shipped.
 *
 * ## No guessing, anywhere
 *
 * A package with no resolvable licence identifier, or no licence text on disk,
 * **fails the run**. It does not get "UNKNOWN", or the SPDX id without the text,
 * or a silent omission. A licence notice that quietly drops a package is worse
 * than no notice, because it looks like diligence.
 *
 * Usage:
 *   node scripts/release/generateNotice.mjs           write NOTICE
 *   node scripts/release/generateNotice.mjs --check    fail if NOTICE is stale
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { bundledLibrariesIn, compiledSources } from '../lib/mupdfBuildGraph.mjs';
import { MUPDF_VERSION, mupdfSourcePath } from '../provision/mupdf.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = repoRoot();
const NOTICE_PATH = join(ROOT, 'NOTICE');

/** Filenames a licence text is conventionally kept in. */
const LICENCE_FILES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
  'COPYING.txt',
  'LICENSE-MIT',
  'LICENSE-APACHE',
];

/**
 * @typedef {{ name: string, version: string, licence: string, text: string, path: string }} ShippedPackage
 */

/**
 * Every third-party package in the production tree.
 *
 * Read from the lockfile rather than by walking node_modules: the lockfile is
 * what a reproducible install produces, and a walk would also see whatever a
 * developer happened to install locally.
 *
 * @returns {ShippedPackage[]}
 */
function shippedPackages() {
  /** @type {{ packages?: Record<string, { dev?: boolean, version?: string, link?: boolean, resolved?: string }> }} */
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages ?? {});

  /** @type {ShippedPackage[]} */
  const shipped = [];
  for (const [path, entry] of entries) {
    if (!path.startsWith('node_modules/')) continue;
    if (entry.dev === true) continue;
    // Workspace links are this repository's own code, covered by its own licence.
    if (entry.link === true) continue;

    const name = path.slice('node_modules/'.length);
    if (name.startsWith('@monstera/')) continue;

    const installed = join(ROOT, path);
    if (!existsSync(join(installed, 'package.json'))) {
      throw new Error(
        `${name} is in the production tree but is not installed at ${path}. NOTICE cannot be ` +
          `generated from a tree that has not been installed — run npm ci first.`,
      );
    }

    /** @type {{ license?: unknown, licenses?: unknown, version?: string }} */
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    const licence = spdxOf(manifest);
    if (licence === null) {
      throw new Error(
        `${name} declares no licence in its package.json. NOTICE will not invent one, and it will ` +
          `not omit the package: resolve the licence by reading the project, then record it here ` +
          `deliberately.`,
      );
    }

    const text = licenceText(installed);
    if (text === null) {
      throw new Error(
        `${name} declares ${licence} but ships no licence text (looked for ${LICENCE_FILES.join(', ')}). ` +
          `An SPDX identifier is not a licence notice — the terms have to travel with the software.`,
      );
    }

    shipped.push({ name, version: `${entry.version ?? manifest.version ?? ''}`, licence, text, path });
  }

  return shipped.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {{ license?: unknown, licenses?: unknown }} manifest
 * @returns {string | null}
 */
function spdxOf(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim() !== '') return manifest.license.trim();
  // The pre-SPDX form, still found on older packages.
  if (Array.isArray(manifest.licenses)) {
    const ids = manifest.licenses
      .map((entry) => (entry !== null && typeof entry === 'object' && 'type' in entry ? `${entry.type}` : ''))
      .filter((id) => id !== '');
    if (ids.length > 0) return ids.join(' OR ');
  }
  if (manifest.license !== null && typeof manifest.license === 'object' && 'type' in manifest.license) {
    return `${manifest.license.type}`;
  }
  return null;
}

/**
 * @param {string} directory
 * @returns {string | null}
 */
function licenceText(directory) {
  for (const candidate of LICENCE_FILES) {
    const path = join(directory, candidate);
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  }
  return null;
}

/**
 * @typedef {{
 *   spdx: string,
 *   file: string,
 *   marker: string,
 *   version?: string,
 *   note?: string,
 * }} BundledLicence
 *   `file` is relative to the MuPDF source root and is where these terms were
 *   read from; `marker` must still appear in it. Both are checked by
 *   {@link checkLicenceSources} whenever the source is provisioned.
 *
 * @typedef {{
 *   name: string,
 *   role: string,
 *   licence: string,
 *   origin: string,
 *   source: string,
 *   bundled: string[],
 *   licences?: Record<string, BundledLicence>,
 * }} NativeComponent
 */

/** @returns {NativeComponent[]} */
function nativeComponents() {
  /** @type {{ components?: NativeComponent[] }} */
  const declared = JSON.parse(readFileSync(join(HERE, 'nativeComponents.json'), 'utf8'));
  const components = declared.components ?? [];
  if (components.length === 0) {
    throw new Error('nativeComponents.json declares nothing. The shim statically links MuPDF; that is not nothing.');
  }
  return components;
}

/**
 * Compares the declared bundled libraries against what the shim actually
 * compiles, when the source is present.
 *
 * The build graph, not the `thirdparty` directory. That distinction was found
 * the hard way and in both directions: the directory carries sources for
 * targets this project does not build, so listing it declares curl, freeglut
 * and others that never reach the binary; while a list written by hand from the
 * spike's prose omitted five that do. Neither error is visible by reading a
 * NOTICE. The walk itself lives in scripts/lib/mupdfBuildGraph.mjs, because the
 * OCR door derivation needs the same file set and two answers to "what do we
 * compile" would eventually disagree.
 *
 * The result is deliberately a SUPERSET of what survives linking: the linker
 * discards objects nothing references, and no barcode symbol appears in the
 * built DLL even though libzxing is on the link line. For attribution a superset
 * is the safe direction — naming a library that did not survive costs a reader
 * nothing, and omitting one that did is the compliance failure this prevents.
 *
 * Skipped rather than failed when the source is absent, because most machines
 * have not provisioned a 69 MB source tree — but skipping is reported, so
 * "checked" and "could not check" are never confused. The native CI job has the
 * source, which is where this actually bites.
 *
 * @returns {{ checked: boolean, missing: string[], extra: string[] }}
 */
export function checkNativeComponents() {
  const source = mupdfSourcePath(ROOT);

  // The root is OUR link line, not MuPDF's project graph.
  //
  // `native/mupdf-shim/monstera_mupdf.vcxproj` names the static libraries this
  // shim links, and that is the only list that decides what can reach the
  // shipped DLL. Starting anywhere else was wrong three times over: MuPDF's
  // libmupdf.vcxproj compiles only its own source/** and reaches the bundled
  // libraries through project references it does not control our use of, so
  // reading it missed tesseract, leptonica and the barcode libraries entirely.
  //
  // Names are then taken only from SOURCE FILE paths. Matching any
  // `thirdparty\X` also matched AdditionalIncludeDirectories, which lists
  // `thirdparty\openssl\include` and `thirdparty\libarchive\include` —
  // directories the 1.28.0 tarball does not contain — and so put OpenSSL into a
  // licence notice for a library the build has never seen. An include path is
  // not a source file.
  //
  // This is deliberately a SUPERSET of what ends up in the binary: the linker
  // discards objects nothing references, and no barcode symbol appears in the
  // built DLL even though libzxing is on the link line. For attribution a
  // superset is the safe direction — naming a library that did not survive
  // linking costs a reader nothing, and omitting one that did is the compliance
  // failure this file exists to prevent.
  const build = compiledSources(source, join(ROOT, 'native', 'mupdf-shim', 'monstera_mupdf.vcxproj'));
  if (build === null) return { checked: false, missing: [], extra: [] };
  const actual = bundledLibrariesIn(build.files);

  const mupdf = nativeComponents().find((component) => component.name === 'MuPDF');
  const declared = (mupdf?.bundled ?? []).map((name) => name.toLowerCase());

  return {
    checked: true,
    missing: actual.filter((name) => !declared.includes(name)),
    extra: declared.filter((name) => !actual.includes(name)),
  };
}

/**
 * Verifies every declared licence against the file it was read from.
 *
 * A licence table is a set of claims about someone else's code, and until this
 * existed not one of them was checkable: "read from each library's own licence
 * file" was prose, and a reader who doubted an entry had to argue rather than
 * look. Two of the sixteen are not even where a reader would look — leptonica
 * keeps its terms in `leptonica-license.txt`, and libjpeg ships no licence file
 * at all, its terms being a section of README.
 *
 * The marker is the half that catches a RELICENSING rather than a moved file.
 * These libraries arrive inside someone else's tarball, so a version bump can
 * change a component's terms with nobody here reviewing it; a marker that
 * vanishes turns that into a failed build instead of a stale line in NOTICE.
 *
 * Skipped, and reported as skipped, when the source is not provisioned — the
 * same rule {@link checkNativeComponents} follows, for the same reason: "could
 * not check" must never print like "checked".
 *
 * @returns {{ checked: boolean, problems: string[] }}
 */
export function checkLicenceSources() {
  const source = mupdfSourcePath(ROOT);
  if (!existsSync(source)) return { checked: false, problems: [] };
  return { checked: true, problems: verifyLicenceSources(nativeComponents(), source) };
}

/**
 * The comparison itself, over values rather than over the repository.
 *
 * Separated so the proof can mutate a declaration without writing to a tracked
 * file, and so its resolution test runs on any machine rather than only one
 * with a 69 MB source tree provisioned.
 *
 * @param {readonly NativeComponent[]} components
 * @param {string} sourceRoot
 * @returns {string[]} One entry per problem; empty means every claim checks out.
 */
export function verifyLicenceSources(components, sourceRoot) {
  /** @type {string[]} */
  const problems = [];
  for (const component of components) {
    for (const [name, licence] of Object.entries(component.licences ?? {})) {
      const path = join(sourceRoot, licence.file);
      if (!existsSync(path)) {
        problems.push(`${name}: ${licence.file} does not exist in the provisioned source`);
        continue;
      }
      if (!readFileSync(path, 'utf8').includes(licence.marker)) {
        problems.push(
          `${name}: ${licence.file} no longer contains ${JSON.stringify(licence.marker)} — ` +
            `its terms may have changed, and NOTICE still claims ${licence.spdx}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The declared components, for callers that need to inspect the declaration
 * rather than only the verdict over it.
 *
 * @returns {NativeComponent[]}
 */
export function declaredNativeComponents() {
  return nativeComponents();
}

/** @returns {string} */
export function renderNotice() {
  const shipped = shippedPackages();
  const native = nativeComponents();

  const lines = [];
  lines.push('MONSTERA PDF EDITOR — THIRD-PARTY NOTICES');
  lines.push('');
  lines.push('Monstera PDF Editor is free software licensed under the GNU Affero General');
  lines.push('Public License, version 3 or later. See LICENSE for its terms, and README for');
  lines.push('where to obtain the corresponding source.');
  lines.push('');
  lines.push('This file is GENERATED by scripts/release/generateNotice.mjs from the');
  lines.push('production dependency tree in package-lock.json and from the native components');
  lines.push('compiled into the shim. Do not edit it by hand: a hand-maintained notice is');
  lines.push('correct on the day it is written and silently wrong the day a dependency lands.');
  lines.push('');
  lines.push('Development tooling is deliberately absent. It is not distributed, and listing');
  lines.push('it would tell a reader nothing about what is on their machine.');
  lines.push('');

  lines.push('═'.repeat(78));
  lines.push('NATIVE COMPONENTS — compiled into the application');
  lines.push('═'.repeat(78));
  lines.push('');
  for (const component of native) {
    const version = component.name === 'MuPDF' ? ` ${MUPDF_VERSION}` : '';
    lines.push(`${component.name}${version} — ${component.licence}`);
    lines.push(`  ${component.role}`);
    lines.push(`  Home:   ${component.origin}`);
    lines.push(`  Source: ${component.source}`);
    if (component.bundled.length > 0) {
      lines.push('  Bundles, each under its own terms. Each line names the file those terms were');
      lines.push('  read from, relative to the source above, so every claim here is checkable:');
      lines.push('');
      for (const name of component.bundled) {
        // Read from the library's own licence file in the provisioned source,
        // not from a package index. A licence a notice states must be the one
        // the shipped code actually carries.
        const licence = component.licences?.[name];
        if (licence === undefined) {
          throw new Error(
            `${component.name} bundles ${name} with no licence recorded. NOTICE will not list a ` +
              `component without its terms — naming a library while omitting its licence is the ` +
              `part of an attribution notice that does the work.`,
          );
        }
        const version = licence.version === undefined ? '' : ` ${licence.version}`;
        lines.push(`    ${name}${version} — ${licence.spdx}`);
        lines.push(`      read from: ${licence.file}`);
        if (licence.note !== undefined) lines.push(`      ${licence.note}`);
      }
      lines.push('');
      lines.push('  Their full texts are distributed with the source above.');
    }
    lines.push('');
  }

  // FreeType's binary-distribution clause is not discharged by naming FreeType
  // in the table above. It requires a disclaimer, in the distribution
  // documentation, stating that the software is based in part on the work of the
  // FreeType Team — so the sentence is rendered rather than paraphrased, and the
  // packaging test asserts this file reaches the installed application.
  lines.push('─'.repeat(78));
  lines.push('FreeType');
  lines.push('─'.repeat(78));
  lines.push('');
  lines.push('Portions of this software are copyright The FreeType Project');
  lines.push('(https://freetype.org). All rights reserved.');
  lines.push('');
  lines.push('This software is based in part on the work of the FreeType Team.');
  lines.push('');
  lines.push('MuPDF is AGPL, and that is why this application is. The source offer in README');
  lines.push('covers, at the exact versions shipped:');
  lines.push('');
  lines.push(`  - MuPDF ${MUPDF_VERSION} itself;`);
  lines.push('  - the build configuration used to produce the static libraries, which is what');
  lines.push('    makes the result reproducible rather than merely available;');
  lines.push('  - the source of the shim that links it;');
  lines.push('  - and the separately AGPL-licensed components bundled in MuPDF\'s own tree, named');
  lines.push('    individually rather than left to be inferred:');
  for (const component of native) {
    for (const [name, licence] of Object.entries(component.licences ?? {})) {
      if (!/AGPL/i.test(licence.spdx)) continue;
      const version = licence.version === undefined ? '' : ` ${licence.version}`;
      lines.push(`      ${name}${version} — ${licence.spdx}`);
    }
  }
  lines.push('');
  lines.push('    Those arrive inside MuPDF\'s tree, so "the MuPDF version" arguably covers them');
  lines.push('    already. Naming them costs a line and removes the argument.');
  lines.push('');

  lines.push('═'.repeat(78));
  lines.push(`BUNDLED PACKAGES — ${String(shipped.length)} from the production dependency tree`);
  lines.push('═'.repeat(78));
  lines.push('');
  for (const pkg of shipped) {
    lines.push(`${pkg.name}@${pkg.version} — ${pkg.licence}`);
  }
  lines.push('');

  for (const pkg of shipped) {
    lines.push('─'.repeat(78));
    lines.push(`${pkg.name}@${pkg.version}`);
    lines.push(`SPDX: ${pkg.licence}`);
    lines.push('─'.repeat(78));
    lines.push('');
    lines.push(pkg.text);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Says which of the two source-dependent checks actually ran.
 *
 * Both are skipped without the provisioned MuPDF tree, and a run that skipped
 * them must not print like a run that passed them.
 *
 * @param {boolean} bundleChecked
 * @param {boolean} sourcesChecked
 * @returns {string}
 */
function verifiedSuffix(bundleChecked, sourcesChecked) {
  const ran = [
    ...(bundleChecked ? ['bundle list'] : []),
    ...(sourcesChecked ? ['licence provenance'] : []),
  ];
  if (ran.length === 2) return ' (bundle list and licence provenance verified against the source)';
  if (ran.length === 1) return ` (${ran[0]} verified; the other check needs the MuPDF source)`;
  return ' (NOT verified — MuPDF source not provisioned here)';
}

if (process.argv[1]?.endsWith('generateNotice.mjs')) {
  const notice = renderNotice();
  const native = checkNativeComponents();
  const sources = checkLicenceSources();

  if (sources.problems.length > 0) {
    process.stderr.write(
      `NOTICE's licence provenance does not match the provisioned source:\n` +
        sources.problems.map((problem) => `  ${problem}\n`).join('') +
        `Read the file named above and correct scripts/release/nativeComponents.json to say what ` +
        `it actually grants. A licence table that cites a file it no longer matches is worse than ` +
        `one with no citation, because the citation is what invites a reader to stop checking.\n`,
    );
    process.exit(1);
  }

  if (native.checked && (native.missing.length > 0 || native.extra.length > 0)) {
    process.stderr.write(
      `NOTICE's declared native bundle list does not match MuPDF ${MUPDF_VERSION}'s thirdparty/:\n` +
        (native.missing.length > 0 ? `  present in the source, not declared: ${native.missing.join(', ')}\n` : '') +
        (native.extra.length > 0 ? `  declared, not in the source: ${native.extra.join(', ')}\n` : '') +
        `Update scripts/release/nativeComponents.json. A licence notice that omits a bundled ` +
        `library is the failure this comparison exists to prevent.\n`,
    );
    process.exit(1);
  }

  if (process.argv.includes('--check')) {
    const current = existsSync(NOTICE_PATH) ? readFileSync(NOTICE_PATH, 'utf8') : null;
    if (current !== notice) {
      process.stderr.write(
        `NOTICE is stale. Run: npm run notice:generate\n` +
          (current === null ? '  (it does not exist yet)\n' : '  (its content differs from the current tree)\n'),
      );
      process.exit(1);
    }
    process.stdout.write(`NOTICE is current${verifiedSuffix(native.checked, sources.checked)}.\n`);
  } else {
    writeFileSync(NOTICE_PATH, notice, 'utf8');
    process.stdout.write(
      `Wrote NOTICE${verifiedSuffix(native.checked, sources.checked)}.\n`,
    );
  }
}
