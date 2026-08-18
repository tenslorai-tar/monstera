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
 * @typedef {{ name: string, role: string, licence: string, origin: string, source: string, bundled: string[] }} NativeComponent
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
 * Compares the declared bundled libraries against what `libmupdf` actually
 * compiles, when the source is present.
 *
 * The build file, not the `thirdparty` directory. That distinction was found
 * the hard way and in both directions: the directory carries sources for
 * targets this project does not build — mutool, the GL viewer, OCR, barcodes —
 * so listing it declares curl, tesseract, zint and six others that never reach
 * the binary; while a list written by hand from the spike's prose omitted five
 * that do, openssl among them. Neither error is visible by reading a NOTICE.
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
  const project = join(source, 'platform', 'win32', 'libmupdf.vcxproj');
  if (!existsSync(project)) return { checked: false, missing: [], extra: [] };

  const actual = [
    ...new Set(
      [...readFileSync(project, 'utf8').matchAll(/thirdparty\\([A-Za-z0-9_-]+)/gu)].map((match) =>
        `${match[1]}`.toLowerCase(),
      ),
    ),
  ].sort();

  if (actual.length === 0) {
    throw new Error(
      `${project} names no thirdparty directories. Either MuPDF restructured its build, or this ` +
        `parse is reading the wrong file — and a comparison that finds nothing would silently ` +
        `agree with any declaration.`,
    );
  }

  const mupdf = nativeComponents().find((component) => component.name === 'MuPDF');
  const declared = (mupdf?.bundled ?? []).map((name) => name.toLowerCase());

  return {
    checked: true,
    missing: actual.filter((name) => !declared.includes(name)),
    extra: declared.filter((name) => !actual.includes(name)),
  };
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
      lines.push(`  Bundles: ${component.bundled.join(', ')}`);
      lines.push('  Those libraries carry their own licences, distributed with the source above.');
    }
    lines.push('');
  }
  lines.push('MuPDF is AGPL, and that is why this application is. Its source, the exact');
  lines.push('version and build configuration used, and the source of the shim that links it');
  lines.push('are all covered by the offer in README.');
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

if (process.argv[1]?.endsWith('generateNotice.mjs')) {
  const notice = renderNotice();
  const native = checkNativeComponents();

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
    process.stdout.write(
      `NOTICE is current${native.checked ? ' (native bundle list verified against the source)' : ' (native bundle list NOT verified — MuPDF source not provisioned here)'}.\n`,
    );
  } else {
    writeFileSync(NOTICE_PATH, notice, 'utf8');
    process.stdout.write(
      `Wrote NOTICE${native.checked ? ', native bundle list verified against the source' : ''}.\n`,
    );
  }
}
