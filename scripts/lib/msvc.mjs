// @ts-check
/**
 * Locates the MSVC toolchain, without going through `vcvars64.bat`.
 *
 * ## Why not vcvars
 *
 * `vcvars64.bat` fails when invoked programmatically, and the mechanism is not
 * the one that is usually written down. Measured on this machine, all four
 * results reproducible:
 *
 *   1. `ProgramFiles(x86)` **is** set and readable — from Node, and from a cmd
 *      launched by bash. It does not "arrive unset".
 *   2. Expanded at the top level of a batch file it resolves correctly.
 *   3. Expanded **inside a parenthesised block** it breaks cmd's parser, which
 *      terminates the block at the `)` inside the variable's own name:
 *      `if 1==1 ( echo [%ProgramFiles(x86)%] )` → `] was unexpected at this time.`
 *   4. vcvars fails identically with cmd as the parent process — first
 *      `'vswhere.exe' is not recognized`, because that lookup is what collapses,
 *      then `\Microsoft was unexpected at this time` from the truncated path.
 *
 * So the parent shell is irrelevant. It is cmd's block parser versus a variable
 * whose name contains a bracket. Changing shells does not help, and believing it
 * might is how an afternoon disappears.
 *
 * MSBuild needs none of it: invoked directly it reports its version and resolves
 * the toolchain from the project file. So this module never calls vcvars.
 *
 * ## Why vswhere rather than a path
 *
 * The install layout is not fixed. This machine carries **BuildTools** under
 * `Program Files (x86)`; a workstation with the IDE carries `Community`,
 * `Professional` or `Enterprise` under `Program Files`. A hardcoded path works
 * on whichever machine it was written on and nowhere else, which is a
 * single-machine build dressed as a recipe.
 *
 * `vswhere.exe` has a documented fixed location that Microsoft guarantees, and
 * Node can read the parenthesised variable that names it (result 1 above).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The C++ toolset. Without this, an install that has only .NET would match. */
const CXX_COMPONENT = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64';

/**
 * @returns {string} Absolute path to vswhere.
 * @throws when Visual Studio's installer is not present at all.
 */
function vswherePath() {
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const path = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(path)) {
    throw new Error(
      `vswhere.exe not found at ${path}. It ships with every Visual Studio 2017+ install, ` +
        `including Build Tools. Install "Desktop development with C++" (or the Build Tools ` +
        `equivalent) and run this again.`,
    );
  }
  return path;
}

/**
 * The newest install that actually carries the C++ compiler.
 *
 * @returns {string} Absolute installation path.
 */
export function visualStudioPath() {
  const vswhere = vswherePath();
  const result = spawnSync(
    vswhere,
    [
      '-products',
      '*',
      '-requires',
      CXX_COMPONENT,
      '-latest',
      '-format',
      'value',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8' },
  );

  if (result.error !== undefined) {
    throw new Error(`Could not run ${vswhere}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`${vswhere} exited ${result.status}: ${result.stderr}`);
  }

  const path = `${result.stdout}`.trim().split(/\r?\n/)[0] ?? '';
  if (path === '') {
    throw new Error(
      `No Visual Studio install carries ${CXX_COMPONENT}. vswhere found no match, which means ` +
        `Visual Studio is present but the C++ toolset is not installed. Add "Desktop ` +
        `development with C++" in the Visual Studio Installer.`,
    );
  }
  return path;
}

/**
 * @returns {string} Absolute path to MSBuild.exe, proven to run.
 */
export function msbuildPath() {
  const installation = visualStudioPath();
  const msbuild = join(installation, 'MSBuild', 'Current', 'Bin', 'MSBuild.exe');

  if (!existsSync(msbuild)) {
    throw new Error(`vswhere reported ${installation}, but MSBuild is not at ${msbuild}.`);
  }

  // Spawn it rather than trust the path: an install can be present and broken,
  // and a build that fails three minutes in is far more expensive to read than
  // one that refuses at the start.
  const probe = spawnSync(msbuild, ['-version', '-nologo'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) {
    throw new Error(
      `MSBuild at ${msbuild} did not run: ${probe.error?.message ?? `exit ${probe.status}`}`,
    );
  }

  return msbuild;
}

/**
 * Locates `dumpbin.exe` and the environment it needs to run.
 *
 * dumpbin is a thin front end over `link.exe` and loads its DLLs from the same
 * directory, so invoking it by absolute path alone fails to start. vcvars is
 * what normally puts that directory on PATH, and this module deliberately never
 * runs vcvars — so the directory is prepended to PATH for this one spawn
 * instead, which is the same effect without the batch file.
 *
 * @returns {{ command: string, env: NodeJS.ProcessEnv } | null} Null when the
 *   toolchain is present but dumpbin is not, so a caller can say "not checked"
 *   rather than reporting an unverified surface as verified.
 */
export function dumpbin() {
  const installation = visualStudioPath();
  const toolsRoot = join(installation, 'VC', 'Tools', 'MSVC');

  /** @type {string[]} */
  let versions;
  try {
    versions = readdirSync(toolsRoot).sort();
  } catch {
    return null;
  }

  const newest = versions[versions.length - 1];
  if (newest === undefined) return null;

  const binDirectory = join(toolsRoot, newest, 'bin', 'Hostx64', 'x64');
  const command = join(binDirectory, 'dumpbin.exe');
  if (!existsSync(command)) return null;

  return {
    command,
    env: { ...process.env, PATH: `${binDirectory};${process.env['PATH'] ?? ''}` },
  };
}

/**
 * Runs one MSBuild target, streaming output so a ten-minute build shows progress.
 *
 * `PlatformToolset` is passed by every caller rather than defaulted here:
 * MuPDF's own solution pins v142 (VS2019) and fails with MSB8020 under VS2022,
 * while this repository's own project files already name their toolset. A
 * default would silently override the second case to fix the first.
 *
 * `compilerOptions` are passed through the `CL` environment variable, which
 * cl.exe prepends to every command line it receives. That route is used rather
 * than an MSBuild property because the definitions have to reach a VENDORED
 * project file: `libmupdf.vcxproj` composes its own `PreprocessorDefinitions`
 * from item metadata, which a `/p:` global property does not reach, and editing
 * the vendored file would be undone by the next provisioning run.
 *
 * @param {object} options
 * @param {string} options.project Absolute path to a .sln or .vcxproj.
 * @param {readonly string[]} [options.properties] `Name=Value` pairs.
 * @param {readonly string[]} [options.compilerOptions] Raw cl.exe options.
 * @param {string} [options.target]
 * @param {string} [options.label] Shown in progress output.
 */
export function build({ project, properties = [], compilerOptions = [], target, label }) {
  const msbuild = msbuildPath();
  const args = [
    project,
    ...(target === undefined ? [] : [`/t:${target}`]),
    ...properties.map((property) => `/p:${property}`),
    // One line per project rather than per file: the full log for MuPDF is tens
    // of thousands of lines and buries the error that matters.
    '/verbosity:minimal',
    '/nologo',
    // MuPDF has ~10 independent thirdparty libraries; serial is needlessly slow.
    '/maxcpucount',
  ];

  process.stderr.write(`\n  building ${label ?? project}\n`);
  if (compilerOptions.length > 0) {
    process.stderr.write(`  with CL=${compilerOptions.join(' ')}\n`);
  }

  const env = { ...process.env };
  if (compilerOptions.length > 0) {
    env['CL'] = [process.env['CL'] ?? '', ...compilerOptions].join(' ').trim();
  }

  const result = spawnSync(msbuild, args, { stdio: 'inherit', env });

  if (result.error !== undefined) {
    throw new Error(`Could not run MSBuild for ${project}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`MSBuild exited ${result.status} building ${label ?? project}`);
  }
}
