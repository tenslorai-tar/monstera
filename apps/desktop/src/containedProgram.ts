/**
 * **What program a contained process runs**, and the command line and environment
 * that follow from it.
 *
 * ## Why this is a type, and why it is its own module
 *
 * `win32HostSurface.ts` created exactly one kind of program for its first month:
 * the Electron binary in Node mode (ADR-0022). So it prepended three Node
 * interpreter flags to every command line and forced `ELECTRON_RUN_AS_NODE=1`
 * into every environment — each correct, each measured, and each a fact about
 * **that program** written as a fact about **the surface**.
 *
 * ADR-0063 Decision 2 gives the surface a second program: an external converter,
 * *"a named executable with arguments"*. Measured 2026-09-16 with
 * `scripts/research/libreofficeContained.mjs`, LibreOffice refused the first flag
 * the surface added — `Error in option: --preserve-symlinks` — identically
 * inside the container and outside it. The containment was never reached.
 *
 * The fix is not a flag on the config that somebody remembers to set. It is that
 * **the program's kind decides what is added, and nothing else can**: a
 * {@link ContainedProgram} is a discriminated union, and the interpreter flags
 * exist only on the `electron-node` branch. A converter handed Node's flags is
 * not a state a caller can write (B5).
 *
 * Split out of `win32HostSurface.ts` because that module loads koffi and no unit
 * test can exercise it without a Windows kernel. What decides the command line
 * is pure, so it lives where `vitest` can reach it — the same split
 * `isInvalidHandleAddress` made for the same reason.
 *
 * ## Each branch carries its OWN brand
 *
 * A branch keyed only by a string would let an untyped caller write
 * `runs: 'electron-node'` beside a LibreOffice path, and the flags would arrive
 * where they were refused. So the executable's brand names the resolver that
 * minted it, and the two branches cannot swap paths without a cast. The untyped
 * callers under `scripts/` — which import this through a computed specifier and
 * see `any` — are held to the same pairing by `check:electronbinary`, which reads
 * the resolver and the branch from the same config.
 */

import { type NativeSource, nativeComponentPath, nativeSource } from './nativeComponents.js';

declare const electronBinaryBrand: unique symbol;
declare const converterExecutableBrand: unique symbol;

/**
 * A path that has been ESTABLISHED to name the Electron binary, not merely
 * claimed to (finding YYY-2). Minted by `electronBinaryOfThisProcess` in
 * `win32HostSurface.ts`, and under `scripts/` by `electronBinaryPath()`.
 */
export type ElectronBinaryPath = string & { readonly [electronBinaryBrand]: true };

/**
 * A path to an external converter's executable, resolved from the tree this
 * repository provisioned — **never from `PATH` and never from an installed copy**
 * (ADR-0063 Decision 2). This machine has LibreOffice installed, and a converter
 * that found it would be running an unpinned build.
 *
 * **The product mint is {@link providedConverterExecutable}**, arriving with the
 * first built feature that runs a converter — layout-preserving text, ADR-0071.
 * Under `scripts/` the resolvers are `sofficeLauncher()` and `pdftotextPath()`.
 */
export type ConverterExecutablePath = string & { readonly [converterExecutableBrand]: true };

/**
 * The converter executable `scripts/launch.mjs` handed down in `variable`, or
 * `null` when it handed none.
 *
 * ## Why an environment variable, and why that is still the provisioned tree
 *
 * `scripts/provision/*.mjs` own where a provisioned artefact lives, and
 * `apps/desktop` cannot import them — `scripts/` is not shipped. So the launcher,
 * the one process that knows the repository root, resolves the path through that
 * resolver and passes it, exactly as it passes PDFium's library. Nothing here
 * searches `PATH` or an install directory, so the only way a path reaches this
 * brand is through the resolver that owns it.
 *
 * **Asked of the one resolver since ADR-0122**, which answers from the launcher's
 * variable in development and from the package's `resources/native/<component>/`
 * when packaged — so a packaged build finds its converters rather than reporting
 * each unavailable. Absent is still a decided state: the feature says so.
 */
export function providedConverterExecutable(
  component: 'poppler' | 'ghostscript' | 'onlyoffice',
  from: NativeSource = nativeSource(),
): ConverterExecutablePath | null {
  const path = nativeComponentPath(component, from);
  return path === null ? null : (path as ConverterExecutablePath);
}

/**
 * The program a contained process runs.
 *
 * - **`electron-node`** — the Electron binary under `ELECTRON_RUN_AS_NODE=1`, with
 *   {@link NODE_MODE_FLAGS}. Every engine host.
 * - **`converter`** — an external program run once per conversion. Its own
 *   arguments and nothing else; its environment has no `ELECTRON_RUN_AS_NODE`.
 */
export type ContainedProgram =
  | {
      readonly runs: 'electron-node';
      readonly executablePath: ElectronBinaryPath;
      /** Arguments after the interpreter flags. The first is the host's entry script. */
      readonly commandArguments: readonly string[];
    }
  | {
      readonly runs: 'converter';
      readonly executablePath: ConverterExecutablePath;
      /** The converter's own arguments, in order. No flag is added in front of them. */
      readonly commandArguments: readonly string[];
    };

/**
 * The Node interpreter flags, and each one is measured rather than defensive.
 *
 * **`--preserve-symlinks` and `--preserve-symlinks-main`.** Without them the
 * spike's first contained cell died before its first line with
 * `EPERM lstat 'C:\'`. Node resolves the main path and every require through
 * `realpathSync`, which stats each ancestor by name — and a LowBox token's access
 * check is CONJUNCTIVE: the DACL must grant the request to the token's ordinary
 * identity AND to the container or an application-package SID. So the user's own
 * rights on the volume root are necessary and not sufficient, and the root grants
 * app packages nothing. (The other half of that conjunction was measured on
 * 2026-08-24 and is ADR-0023 §4's correction: a DACL naming only the container
 * refuses the container.) The alternative fix is an ACE on the volume root, which
 * needs administrator rights and puts a permanent grant there in order to run a
 * sandbox. These flags remove the call that was failing instead.
 *
 * **`--no-stdio-init`, and the WIN32 STD HANDLES ARE NOT THE CRT'S FILE
 * DESCRIPTORS — which is the whole of it.** Measured on a windows-latest runner,
 * twice, and on no machine here: both contained cells died before their first
 * line with
 *
 *     FATAL:electron/shell/app/node_main.cc:215
 *     Unable to open nul device needed for initialization, aborting startup
 *
 * at Low integrity, in their job, with `previousSuspendCount: 1`. Supplying
 * `hStdInput` did not help, and the reason is the mechanism: `CreateProcessW`
 * sets the Win32 standard handles; it does not populate the CRT's inherited
 * descriptor block (`lpReserved2`), which only a CRT parent passing its own table
 * does. So `_get_osfhandle(0)` is invalid in the child however the Win32 handles
 * are set, node's startup opens `nul` through the CRT to occupy descriptors 0-2,
 * and inside an AppContainer that open is refused on that Windows build. This flag
 * skips exactly that initialisation, and it is safe because the surface supplies
 * real stdout and stderr through `STARTF_USESTDHANDLES`. Not a workaround for a
 * defect of ours: both causes are outside this repository, and the alternative —
 * fabricating an undocumented `lpReserved2` layout — is a second opinion about a
 * private ABI.
 *
 * **All three are Node's, which is why they belong to one branch.** A converter
 * is not Node and does not accept them: LibreOffice answers the first with
 * `Error in option: --preserve-symlinks`, measured 2026-09-16.
 */
export const NODE_MODE_FLAGS = Object.freeze([
  '--preserve-symlinks',
  '--preserve-symlinks-main',
  '--no-stdio-init',
] as const);

/** The environment variable that decides whether the Electron binary is Node or Chromium. */
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE';

/**
 * The command line, as the one string `CreateProcessW` takes.
 *
 * Every argument is quoted. The quoting is not escaping: an argument containing
 * `"` would break it, and that is safe only because of what reaches this
 * function — Decision 2's contract that **a picked file's name never reaches a
 * command line**, since the input is copied into the granted area under a fixed
 * name. A caller that passed a person's file name here would be the defect, and
 * this comment is where the dependency is stated.
 */
export function commandLineFor(program: ContainedProgram): string {
  const flags = program.runs === 'electron-node' ? NODE_MODE_FLAGS : [];
  return [
    `"${program.executablePath}"`,
    ...flags,
    ...program.commandArguments.map((argument) => `"${argument}"`),
  ].join(' ');
}

/**
 * The variables a contained program is handed: the ones WINDOWS defines for every process, upper-cased as the
 * comparison is.
 *
 * Every other inherited variable is one a shell, an installer or a person added, and those are where a secret lives:
 * `MONSTERA_GOOGLE_CLIENT_SECRET` (`cloudClients.ts`), an API key, a token. The AppContainer bounds what the child can
 * OPEN; the environment block is copied into the child's own memory, so a hostile host reads whatever it was handed
 * (CR-SEC-18). `NODE_OPTIONS` is the same class from the other side: inherited, it would tell the host's runtime to
 * load code nobody chose.
 *
 * The set is Windows' rather than one derived from what each program reads, because nothing here can observe what x2t
 * or pdftotext reads, and CI runs neither on Windows: a program relying on a variable Windows defines keeps it, and no
 * program of ours relies on one somebody added. None of these is a secret; the paths name places the token cannot
 * open.
 */
const WINDOWS_DEFINED = new Set([
  'ALLUSERSPROFILE',
  'APPDATA',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'COMPUTERNAME',
  'COMSPEC',
  'DRIVERDATA',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'LOGONSERVER',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PUBLIC',
  'SESSIONNAME',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERDOMAIN',
  'USERDOMAIN_ROAMINGPROFILE',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]);

/**
 * The child's environment entries, `KEY=value`, in the parent's order.
 *
 * **Only {@link WINDOWS_DEFINED} variables are inherited**, compared case-insensitively as Windows compares environment
 * names; see that set for why.
 *
 * **`ELECTRON_RUN_AS_NODE` is not among them on EITHER branch**, and is set on the Node one. An inherited value is one
 * the caller's environment decides: under Electron it is absent and the binary would start Chromium; for a converter
 * it means nothing, and passing our runtime's mode to a program we did not write is a variable nobody chose.
 */
export function environmentFor(
  program: ContainedProgram,
  inherited: Readonly<Record<string, string | undefined>>,
): string[] {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(inherited)) {
    if (!WINDOWS_DEFINED.has(key.toUpperCase())) continue;
    if (value === undefined) continue;
    entries.push(`${key}=${value}`);
  }
  if (program.runs === 'electron-node') entries.push(`${RUN_AS_NODE}=1`);
  return entries;
}
