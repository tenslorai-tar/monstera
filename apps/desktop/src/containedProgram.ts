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
 * **There is no product mint yet, and that is the state, not an omission.** The
 * one caller that constructs this branch is the Office import row, which is not
 * built. Its resolver under `scripts/` is `sofficeLauncher()`; the product one
 * arrives with the feature that needs it, rather than as a mint nothing calls —
 * a declaration nothing can contradict.
 */
export type ConverterExecutablePath = string & { readonly [converterExecutableBrand]: true };

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
 * The child's environment entries, `KEY=value`, in the parent's order.
 *
 * **`ELECTRON_RUN_AS_NODE` is removed from the inherited set on BOTH branches**,
 * and set again on the Node one. An inherited value is one the caller's
 * environment decides: under Electron it is absent and the binary would start
 * Chromium; for a converter it means nothing, and passing our runtime's mode to a
 * program we did not write is a variable nobody chose.
 *
 * The rest is inherited as the engine hosts inherit it. The container, not the
 * environment, is what bounds the filesystem — `TEMP` and `APPDATA` name places
 * the token cannot open — so trimming variables here would be a second
 * containment opinion with no kernel behind it.
 */
export function environmentFor(
  program: ContainedProgram,
  inherited: Readonly<Record<string, string | undefined>>,
): string[] {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(inherited)) {
    if (key.toUpperCase() === RUN_AS_NODE) continue;
    if (value === undefined) continue;
    entries.push(`${key}=${value}`);
  }
  if (program.runs === 'electron-node') entries.push(`${RUN_AS_NODE}=1`);
  return entries;
}
