// @ts-check
/**
 * The set of source files this project's shim actually compiles into its DLL.
 *
 * Two consumers need this and they were about to derive it twice: the NOTICE
 * generator, which turns it into the list of bundled libraries, and the OCR door
 * derivation, which walks its call graph. One derivation, per B3 — and the
 * question is subtle enough that two answers would eventually disagree.
 *
 * ## The root is OUR link line
 *
 * `native/mupdf-shim/monstera_mupdf.vcxproj` names the static libraries the shim
 * links, and that is the only list which decides what can reach the shipped DLL.
 * Starting anywhere else has been wrong three times over. MuPDF's own
 * `libmupdf.vcxproj` compiles only its `source/**` and reaches the bundled
 * libraries through project references, so reading it alone missed tesseract,
 * leptonica and the barcode libraries entirely; and `thirdparty/`'s directory
 * listing over-declares, since the tarball ships sources for targets nobody
 * builds.
 *
 * ## Why `source/tools/**` must not be in it
 *
 * MuPDF's tree contains mutool, mudraw and muconvert. None is linked here, and
 * including them corrupts any call-graph analysis over this set — every tool has
 * a `main`, so a single global name binds unrelated programs into one component
 * and reachability walks bleed straight through it. Restricting to compiled
 * files removes them for the right reason: a function in a program we do not
 * link cannot be a path into anything we ship.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source extensions MSBuild compiles through `ClCompile`. */
const COMPILED = /\.(?:c|cc|cpp|cxx)$/iu;

/**
 * @param {string} sourceRoot Absolute path to the MuPDF source tree.
 * @param {string} shimProject Absolute path to monstera_mupdf.vcxproj.
 * @returns {{ files: string[], libraries: string[] } | null} Null when either
 *   path is absent, so a caller can report "not checked" rather than treating an
 *   unverified surface as verified.
 */
export function compiledSources(sourceRoot, shimProject) {
  const projectDir = join(sourceRoot, 'platform', 'win32');
  if (!existsSync(join(projectDir, 'libmupdf.vcxproj')) || !existsSync(shimProject)) return null;

  const libraries = [
    ...new Set(
      [...readFileSync(shimProject, 'utf8').matchAll(/\b(lib[a-z0-9]+)\.lib\b/gu)].map(
        (match) => `${match[1]}`,
      ),
    ),
  ].sort();

  if (libraries.length === 0) {
    throw new Error(
      `${shimProject} names no MuPDF static libraries. Either the shim's link line changed shape, ` +
        `or this parse is reading the wrong thing — and a graph that starts from nothing agrees ` +
        `with every claim made about it.`,
    );
  }

  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {Set<string>} */
  const files = new Set();

  /** @param {string} projectPath */
  const walk = (projectPath) => {
    const key = projectPath.toLowerCase();
    if (visited.has(key) || !existsSync(projectPath)) return;
    visited.add(key);
    const text = readFileSync(projectPath, 'utf8');

    // Source-file paths only. Matching any `thirdparty\X` mention also matched
    // AdditionalIncludeDirectories, which names include directories the 1.28.0
    // tarball does not even contain — that is how OpenSSL once entered a licence
    // notice for a library this build has never seen. An include path is not a
    // source file.
    for (const match of text.matchAll(/Include="([^"]+)"/gu)) {
      const relative = `${match[1]}`;
      if (!COMPILED.test(relative)) continue;
      files.add(join(projectDir, relative.replaceAll('\\', '/')));
    }

    for (const reference of text.matchAll(/ProjectReference Include="([^"]+)"/gu)) {
      walk(join(projectDir, `${reference[1]}`.replaceAll('\\', '/')));
    }
  };

  for (const library of libraries) walk(join(projectDir, `${library}.vcxproj`));

  if (files.size === 0) {
    throw new Error(
      `The link line ${libraries.join(', ')} reaches no source files. Either MuPDF restructured ` +
        `its build, or this parse is reading the wrong thing.`,
    );
  }

  return { files: [...files].sort(), libraries };
}

/**
 * The bundled third-party libraries those files belong to.
 *
 * @param {readonly string[]} files
 * @returns {string[]} Lower-cased directory names under `thirdparty/`.
 */
export function bundledLibrariesIn(files) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const file of files) {
    const parts = file.replaceAll('\\', '/').split('/');
    const index = parts.indexOf('thirdparty');
    if (index >= 0 && parts[index + 1] !== undefined) found.add(`${parts[index + 1]}`.toLowerCase());
  }
  return [...found].sort();
}
