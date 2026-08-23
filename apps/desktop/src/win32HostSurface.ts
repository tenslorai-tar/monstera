/**
 * The Win32 calls behind {@link HostCreationSurface}, bound with koffi.
 *
 * B7's sanctioned exception: one typed adapter module per native boundary. Every
 * `any` this application has around process creation lives here, behind the
 * interface `engineHostFactory.ts` consumes — which names no Win32 anything and
 * is exhaustively unit-tested without a process existing.
 *
 * ## This file invents nothing
 *
 * Every call, in this order, with these flags, is one
 * `scripts/research/lowboxSpike.mjs` already makes on every cell of every run.
 * That instrument has been exercised against real processes with the container
 * applied and without, with the job and without, and its readings are what
 * ADR-0022 and ADR-0023 were decided from. Where a line here looks arbitrary,
 * the spike is the specification and the reason is recorded there.
 *
 * ## Nothing is bound at import time
 *
 * `koffi.load('kernel32.dll')` at module scope would make importing this file
 * throw on any machine that is not Windows — including the Linux runner that
 * typechecks and lints the tree. The binding happens inside
 * {@link createWin32HostSurface}, so the module is importable everywhere and
 * only *calling* it needs the platform. The failure lands at the point of use,
 * where it names the call that could not be bound.
 *
 * ## What this surface deliberately does NOT do
 *
 * No ACL is granted on any install-root path. ADR-0023 §5's premise P1 is that
 * MSIX-installed files are already readable by `ALL APPLICATION PACKAGES`, and a
 * design needing a runtime grant there could not execute on a real install at
 * all — a packaged app cannot modify ACLs on its own installed files. The five
 * grants the spike makes are a development accommodation for a checkout under a
 * user's profile, not the shipped mechanism.
 *
 * No pipe, either. The transport is a named pipe main creates with the container
 * SID in its DACL (ADR-0023 §4), and it belongs to whoever composes this surface
 * with a runtime loop, not to the surface.
 */

import { type Result, err, ok } from '@monstera/shared';
import koffi from 'koffi';

import type {
  CreatedProcess,
  HostCreationSurface,
  JobHandle,
  JobMembership,
  ProcessHandle,
  ThreadHandle,
} from './engineHostFactory.js';

/**
 * A DERIVED COPY of `scripts/lib/win32Handle.mjs`, which is the writer of record.
 *
 * That module owns the rule because `INVALID_HANDLE_VALUE` is Win32's answer and
 * not ours (B3a), and three research files that each decided it for themselves
 * were all wrong the same way — every spelling they used answered `false` for a
 * handle that is invalid, so the failure branch was unreachable and a refused
 * call carried on into the next one (finding TT-2).
 *
 * This package cannot import it: it is plain Node under `scripts/`, and the
 * module graph forbids the edge. So this is a copy, and the rule for copies is
 * the one MMM-1 settled — **make one only where the reader cannot reach the
 * source, and prove every copy that exists.** `proof:win32handle` imports both
 * and requires them to agree on every value, including the four wrong spellings'
 * inputs, so a divergence is a red build rather than a second opinion.
 *
 * Both failure spellings are covered. `INVALID_HANDLE_VALUE` is all bits set,
 * which arrives as an unsigned BigInt; NULL is what `CreateJobObjectW` and
 * `OpenProcess` return instead, so the two are not interchangeable.
 */
export function isInvalidHandleAddress(address: unknown): boolean {
  if (address === null || address === undefined) return true;
  const value = BigInt(address as bigint | number | string);
  return value === 0n || BigInt.asIntN(64, value) === -1n;
}

/**
 * The whole rule, over a handle rather than an address.
 *
 * The split is not a testing convenience. The JUDGEMENT is the half that was
 * wrong three times — every one of the four broken spellings was a wrong
 * comparison, never a failure to read the address — and it is the half a proof
 * can drive with no native library present. `proof:win32handle` compares
 * {@link isInvalidHandleAddress} against the owner run with an identity address
 * reader, which makes the two functions the same function on the same inputs.
 */
export function isInvalidHandle(handle: unknown): boolean {
  if (handle === null || handle === undefined) return true;
  return isInvalidHandleAddress(koffi.address(handle));
}

declare const electronBinaryBrand: unique symbol;

/**
 * A path that has been ESTABLISHED to name the Electron binary, not merely
 * claimed to (finding YYY-2).
 *
 * `executablePath: string` was a contract living in a comment, and two callers
 * broke it — both by writing `process.execPath`, which is the Electron binary
 * under Electron and system Node everywhere else. Once silently, costing a
 * property row that only a byte-identical comparison caught; once loudly, on an
 * interpreter flag. The parameter existed to be got wrong: the surface forces
 * `ELECTRON_RUN_AS_NODE` on every child it creates, so it already depends on the
 * answer, and a plain Node binary ignores that variable rather than failing.
 *
 * There is no single expression that is correct in both parents, which is why
 * the surface cannot simply resolve this itself: under Electron the answer is
 * this process, and under the plain-Node driver that proves containment it is
 * the pinned install, which only `scripts/provision/electron.mjs` can locate.
 * So the type restricts WHO MAY MINT instead.
 */
export type ElectronBinaryPath = string & { readonly [electronBinaryBrand]: true };

/**
 * The mint for a process that IS the Electron binary — the only mint this
 * package can offer, and exact rather than heuristic.
 *
 * `process.versions.electron` keys on the EXECUTABLE, never on the mode it was
 * started in. Two facts, stated apart so no clause can be read against the
 * other (finding ZZZ-1):
 *
 *   - it is PRESENT whenever the running executable is the Electron binary —
 *     **including under `ELECTRON_RUN_AS_NODE=1`**, where `process.execPath` is
 *     still that binary;
 *   - it is ABSENT only when the executable is not Electron at all.
 *
 * Node mode being on the present side is what makes this mint usable for the
 * engine host, which runs in exactly that mode (ADR-0022, invariant 26). A
 * reader who concludes otherwise reaches for `process.execPath` there, which is
 * the defect YYY-2 exists to close.
 *
 * So where this returns, it returns the right path; where it cannot, it throws
 * rather than handing back a plausible one.
 *
 * The plain-Node callers under `scripts/` cannot reach this — a computed
 * `import()` of the build output types as `any`, so no signature here constrains
 * them. Their side of the rule is `check:electronbinary`, which reads the value
 * they write.
 *
 * **The two mints were run against each other, 2026-08-23, and agree.** From a
 * plain-Node parent this throws; from the pinned binary under
 * `ELECTRON_RUN_AS_NODE=1` it returned
 * `.tools/electron/43.4.1/electron.exe` — the same string
 * `scripts/provision/electron.mjs` resolves. Executed rather than reasoned
 * about, because two resolvers for one authority that have never been compared
 * are two opinions (B3a).
 */
export function electronBinaryOfThisProcess(): ElectronBinaryPath {
  // `in`, not `=== undefined`. `NodeJS.ProcessVersions` carries an index
  // signature, so `process.versions.electron` types as `string` and the
  // comparison lint rejects is one the compiler believes can never be true — on
  // a machine where it is true every time this package runs outside Electron.
  // The presence test is both honest about the runtime and accurate to the type.
  if (!('electron' in process.versions)) {
    throw new Error(
      'electronBinaryOfThisProcess() was called from a process that is not the Electron ' +
        'binary. A host created with this path would run the wrong runtime and start ' +
        'successfully, which is the failure this mint exists to make impossible.',
    );
  }
  return process.execPath as ElectronBinaryPath;
}

/** How the host process is created. */
export interface Win32HostSurfaceConfig {
  /**
   * The executable to run — the Electron binary, started in Node mode.
   *
   * Branded, so a bare `process.execPath` is a compile error rather than a
   * comment somebody read. See {@link ElectronBinaryPath}.
   */
  readonly executablePath: ElectronBinaryPath;
  /** Arguments after the interpreter flags. The first is the host's entry script. */
  readonly commandArguments: readonly string[];
  /** The child's working directory. */
  readonly workingDirectory: string;
  /**
   * The AppContainer profile to run inside, or `null` for an uncontained host.
   *
   * `null` is not a convenience. It is the **route control**: the same creation
   * route with containment off, so a refusal measured against a contained host
   * cannot be a broken spawn. A proof that only ever creates contained hosts
   * cannot tell containment from a process that never started.
   */
  readonly containerName: string | null;
  /**
   * Where the child's stdout and stderr go, or `null` for nowhere.
   *
   * NOT optional diagnostics. `CreateProcessW` inherits no handles unless told
   * to, and the spike's first contained cell exited 1 with no report and no way
   * to say why — a diagnosable startup failure turned into an unattributed
   * refusal, which is the exact shape a route control exists to prevent one
   * layer up. An inherited handle is also the one channel a container cannot
   * close, because the access check happens when the parent opens the file.
   */
  readonly diagnosticPath: string | null;
}

// Win32 constants. Named rather than inlined, and grouped by the call that reads
// them, because a bare 0x2000 at a call site is unreviewable.
const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = 0x00020009;
const EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CREATE_SUSPENDED = 0x00000004;
const STARTF_USESTDHANDLES = 0x00000100;

const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ_WRITE = 0x00000003;
const OPEN_EXISTING = 3;
const OPEN_ALWAYS = 4;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9;
const JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

/** `ResumeThread`'s failure value: `(DWORD)-1`, which arrives unsigned. */
const RESUME_THREAD_FAILED = 0xffffffff;

const NUL = String.fromCharCode(0);

/** A wide, NUL-terminated string, which is what every `…W` entry point wants. */
function wide(text: string): Buffer {
  return Buffer.from(`${text}${NUL}`, 'utf16le');
}

/**
 * Every bound call, with a real signature rather than koffi's untyped one.
 *
 * B7 permits an `any` at a native boundary; it does not ask for one. koffi's
 * `func()` hands back a callable that accepts anything and returns anything, so
 * the cheap version of this module would have fifteen call sites the compiler
 * cannot check. Declaring the signatures moves that to **one** cast, in
 * {@link bind}, against declarations written directly from the C prototypes
 * passed to koffi three lines away — where a mismatch is visible by reading two
 * adjacent lines rather than by crashing at run time.
 *
 * `_Out_` parameters arrive as single-element arrays: that is koffi's calling
 * convention for an out pointer, not a choice made here.
 *
 * **Four returns are `unknown` rather than `boolean`, deliberately.** Every call
 * whose wrong answer would weaken containment — process creation, the limits,
 * the assignment and the membership read — is left unnarrowed, so the code below
 * MUST compare against `true` and the compiler enforces it. Typing them
 * `boolean` here would be this cast deciding a security question: the marshalled
 * value would be *asserted* to be a real boolean, and a `1` from a future koffi
 * would then read as success at a `!x` test. The narrowing is fail-closed in
 * every case — anything that is not exactly `true` is a refusal.
 */
interface Bindings {
  readonly createProcess: (
    application: null,
    commandLine: Buffer,
    processAttributes: null,
    threadAttributes: null,
    inheritHandles: boolean,
    flags: number,
    environment: Buffer,
    workingDirectory: string,
    startupInfo: Buffer,
    processInformation: Buffer,
  ) => unknown;
  readonly initializeAttributeList: (
    list: Buffer | null,
    count: number,
    flags: number,
    // `size_t`, and koffi marshals a 64-bit one as a BigInt on x64. Declared
    // `unknown` so the conversion at the call site is required rather than
    // looking redundant — the spike converts for the same reason, and a
    // `Buffer.alloc(BigInt)` throws where `Buffer.alloc(Number)` does not.
    size: unknown[],
  ) => boolean;
  readonly updateAttribute: (
    list: Buffer,
    flags: number,
    attribute: number,
    value: Buffer,
    size: number,
    previous: null,
    returned: null,
  ) => boolean;
  readonly deleteAttributeList: (list: Buffer) => void;
  readonly createFile: (
    name: string,
    access: number,
    share: number,
    securityAttributes: Buffer,
    disposition: number,
    flags: number,
    template: null,
  ) => unknown;
  readonly resumeThread: (thread: ThreadHandle) => number;
  readonly createJobObject: (attributes: null, name: null) => unknown;
  readonly setInformationJobObject: (
    job: JobHandle,
    informationClass: number,
    information: Buffer,
    length: number,
  ) => unknown;
  readonly assignProcessToJobObject: (job: JobHandle, target: ProcessHandle) => unknown;
  readonly isProcessInJob: (target: ProcessHandle, job: JobHandle, result: unknown[]) => unknown;
  readonly terminateProcess: (target: ProcessHandle, code: number) => boolean;
  readonly closeHandle: (handle: unknown) => boolean;
  readonly lastError: () => number;
  readonly createAppContainerProfile: (
    name: string,
    display: string,
    description: string,
    capabilities: null,
    count: number,
    sid: unknown[],
  ) => number;
  readonly deriveAppContainerSid: (name: string, sid: unknown[]) => number;
}

/**
 * Structs are registered under process-global names, so registering twice
 * throws. One surface per process is the expected shape; a second is not.
 */
let structsRegistered = false;

function registerStructs(): void {
  if (structsRegistered) return;
  koffi.struct('MONSTERA_STARTUPINFOW', {
    cb: 'uint32',
    lpReserved: 'void *',
    lpDesktop: 'void *',
    lpTitle: 'void *',
    dwX: 'uint32',
    dwY: 'uint32',
    dwXSize: 'uint32',
    dwYSize: 'uint32',
    dwXCountChars: 'uint32',
    dwYCountChars: 'uint32',
    dwFillAttribute: 'uint32',
    dwFlags: 'uint32',
    wShowWindow: 'uint16',
    cbReserved2: 'uint16',
    lpReserved2: 'void *',
    hStdInput: 'void *',
    hStdOutput: 'void *',
    hStdError: 'void *',
  });
  koffi.struct('MONSTERA_STARTUPINFOEXW', {
    StartupInfo: 'MONSTERA_STARTUPINFOW',
    lpAttributeList: 'void *',
  });
  koffi.struct('MONSTERA_PROCESS_INFORMATION', {
    hProcess: 'void *',
    hThread: 'void *',
    dwProcessId: 'uint32',
    dwThreadId: 'uint32',
  });
  koffi.struct('MONSTERA_SECURITY_CAPABILITIES', {
    AppContainerSid: 'void *',
    Capabilities: 'void *',
    CapabilityCount: 'uint32',
    Reserved: 'uint32',
  });
  koffi.struct('MONSTERA_SECURITY_ATTRIBUTES', {
    nLength: 'uint32',
    lpSecurityDescriptor: 'void *',
    bInheritHandle: 'int32',
  });
  koffi.struct('MONSTERA_IO_COUNTERS', {
    ReadOperationCount: 'uint64',
    WriteOperationCount: 'uint64',
    OtherOperationCount: 'uint64',
    ReadTransferCount: 'uint64',
    WriteTransferCount: 'uint64',
    OtherTransferCount: 'uint64',
  });
  koffi.struct('MONSTERA_JOBOBJECT_BASIC_LIMIT_INFORMATION', {
    PerProcessUserTimeLimit: 'int64',
    PerJobUserTimeLimit: 'int64',
    LimitFlags: 'uint32',
    MinimumWorkingSetSize: 'size_t',
    MaximumWorkingSetSize: 'size_t',
    ActiveProcessLimit: 'uint32',
    Affinity: 'size_t',
    PriorityClass: 'uint32',
    SchedulingClass: 'uint32',
  });
  koffi.struct('MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
    BasicLimitInformation: 'MONSTERA_JOBOBJECT_BASIC_LIMIT_INFORMATION',
    IoInfo: 'MONSTERA_IO_COUNTERS',
    ProcessMemoryLimit: 'size_t',
    JobMemoryLimit: 'size_t',
    PeakProcessMemoryUsed: 'size_t',
    PeakJobMemoryUsed: 'size_t',
  });
  structsRegistered = true;
}

function bind(): Bindings {
  const kernel = koffi.load('kernel32.dll');
  const userenv = koffi.load('userenv.dll');
  // NO CAST IS NEEDED HERE, AND THAT IS THE POINT WORTH KNOWING. koffi's
  // `func()` returns a callable that accepts and returns anything, so it is
  // assignable to every signature in `Bindings` without one — which means those
  // signatures are an ASSERTION that the compiler will never check, not a type
  // it derived. They are written from the C prototype on the adjacent line so
  // the pair can be read together, and that adjacency is the whole review
  // mechanism. Nothing else is watching.
  const bound = {
    createProcess: kernel.func(
      'bool CreateProcessW(const char16_t *app, void *cmdline, void *pa, void *ta, bool inherit, ' +
        'uint32 flags, void *env, const char16_t *cwd, void *si, _Out_ void *pi)',
    ),
    initializeAttributeList: kernel.func(
      'bool InitializeProcThreadAttributeList(void *list, uint32 count, uint32 flags, ' +
        '_Inout_ size_t *size)',
    ),
    updateAttribute: kernel.func(
      'bool UpdateProcThreadAttribute(void *list, uint32 flags, size_t attribute, void *value, ' +
        'size_t size, void *previous, void *returned)',
    ),
    deleteAttributeList: kernel.func('void DeleteProcThreadAttributeList(void *list)'),
    createFile: kernel.func(
      'void *CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, ' +
        'uint32 disp, uint32 flags, void *tmpl)',
    ),
    resumeThread: kernel.func('uint32 ResumeThread(void *thread)'),
    createJobObject: kernel.func('void *CreateJobObjectW(void *attrs, const char16_t *name)'),
    setInformationJobObject: kernel.func(
      'bool SetInformationJobObject(void *job, int cls, void *info, uint32 len)',
    ),
    assignProcessToJobObject: kernel.func('bool AssignProcessToJobObject(void *job, void *proc)'),
    isProcessInJob: kernel.func('bool IsProcessInJob(void *proc, void *job, _Out_ bool *result)'),
    terminateProcess: kernel.func('bool TerminateProcess(void *proc, uint32 code)'),
    closeHandle: kernel.func('bool CloseHandle(void *handle)'),
    lastError: kernel.func('uint32 GetLastError()'),
    createAppContainerProfile: userenv.func(
      'int CreateAppContainerProfile(const char16_t *name, const char16_t *display, ' +
        'const char16_t *description, void *capabilities, uint32 count, _Out_ void **sid)',
    ),
    deriveAppContainerSid: userenv.func(
      'int DeriveAppContainerSidFromAppContainerName(const char16_t *name, _Out_ void **sid)',
    ),
  };
  return bound;
}

/**
 * The container SID, creating the profile if it is absent (ADR-0023 §5).
 *
 * Never deleted, and that is the decision rather than an omission: deleting a
 * profile silently drops every ACE that names it, so a repair that removes one
 * un-grants paths nobody will think to re-grant.
 *
 * `CreateAppContainerProfile` returns `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`
 * when the profile is there, which is the ordinary case after first run — so
 * that code derives the SID rather than failing. Any other non-zero HRESULT is
 * a real refusal and is reported with its value, because "the container could
 * not be made" and "the container already exists" must not share an output.
 */
const HRESULT_ALREADY_EXISTS = 0x800700b7 | 0;

function containerSid(bindings: Bindings, name: string): Result<unknown, string> {
  const out: unknown[] = [null];
  const created: number = bindings.createAppContainerProfile(name, name, name, null, 0, out);
  if (created === 0) return ok(out[0]);
  if (created !== HRESULT_ALREADY_EXISTS) {
    return err(`CreateAppContainerProfile failed: 0x${(created >>> 0).toString(16)}`);
  }
  const derived: number = bindings.deriveAppContainerSid(name, out);
  if (derived !== 0) {
    return err(`the container profile exists but its SID could not be derived: 0x${(derived >>> 0).toString(16)}`);
  }
  return ok(out[0]);
}

/**
 * The child's environment, with `ELECTRON_RUN_AS_NODE` forced on.
 *
 * The host runs the Electron binary in Node mode (ADR-0022, invariant 26), so
 * the variable is set rather than inherited — an inherited one is a variable the
 * caller's environment decides, and this is the difference between starting a
 * Node process and starting a Chromium one.
 */
function environmentBlock(): Buffer {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') continue;
    if (value === undefined) continue;
    entries.push(`${key}=${value}`);
  }
  entries.push('ELECTRON_RUN_AS_NODE=1');
  return Buffer.from(`${entries.join(NUL)}${NUL}${NUL}`, 'utf16le');
}

/**
 * `--preserve-symlinks` AND `--preserve-symlinks-main`, and the reason is
 * measured rather than defensive.
 *
 * Without them the spike's first contained cell died before its first line with
 * `EPERM lstat 'C:\'`. Node resolves the main path and every require through
 * `realpathSync`, which stats each ancestor by name — and a LowBox token passes
 * an access check only where the DACL grants the container SID or an
 * application-package SID, so the user's own rights on the volume root do not
 * count and the root grants app packages nothing.
 *
 * The alternative fix is an ACE on the volume root, which needs administrator
 * rights and puts a permanent grant there in order to run a sandbox. These flags
 * remove the call that was failing instead.
 */
const INTERPRETER_FLAGS = [
  '--preserve-symlinks',
  '--preserve-symlinks-main',
  // `--no-stdio-init`, and the WIN32 STD HANDLES ARE NOT THE CRT'S FILE
  // DESCRIPTORS — which is the whole of it.
  //
  // Measured on a windows-latest runner, twice, and on no machine here: both
  // contained cells died before their first line with
  //
  //   FATAL:electron/shell/app/node_main.cc:215
  //   Unable to open nul device needed for initialization, aborting startup
  //
  // at Low integrity, in their job, with `previousSuspendCount: 1`. The first
  // attempt at this was to supply `hStdInput` — the parent opens NUL and hands
  // it in, which is this file's own rule for the diagnostic handle. **It did not
  // help, and the reason is the mechanism.** `CreateProcessW` sets the Win32
  // standard handles; it does not populate the CRT's inherited descriptor block
  // (`lpReserved2`), which only a CRT parent passing its own table does. So
  // `_get_osfhandle(0)` is invalid in the child however the Win32 handles are
  // set, node's startup opens `nul` through the CRT to occupy descriptors 0-2,
  // and inside an AppContainer that open is refused on that Windows build.
  //
  // This flag skips exactly that initialisation. It is safe HERE and not in
  // general, because the handles the child then uses are the ones supplied
  // above: `createSuspended` sets `STARTF_USESTDHANDLES` whenever it has a
  // handle to set, so the host has real stdout and stderr rather than none.
  // Supplying them was necessary and not sufficient; both halves ship.
  //
  // NOT a workaround for a defect of ours, and Rule 0 asks for the cause to be
  // named: the cause is that a Windows AppContainer token cannot open the NUL
  // device on that build, and node opens it unconditionally when the CRT
  // descriptors are absent. Both are outside this repository, and the
  // alternative — a CRT descriptor block — means fabricating an undocumented
  // `lpReserved2` layout, which is a second opinion about a private ABI.
  '--no-stdio-init',
] as const;

function commandLine(config: Win32HostSurfaceConfig): Buffer {
  const parts = [
    `"${config.executablePath}"`,
    ...INTERPRETER_FLAGS,
    ...config.commandArguments.map((argument) => `"${argument}"`),
  ];
  return wide(parts.join(' '));
}

/**
 * Binds the Win32 calls and returns the surface `createContainedHost` consumes.
 *
 * Throws if the calls cannot be bound — there is no degraded mode, and a surface
 * that reports failure from every member would be indistinguishable from a
 * machine where containment does not work.
 */
export function createWin32HostSurface(config: Win32HostSurfaceConfig): HostCreationSurface {
  registerStructs();
  const bindings = bind();

  const createSuspended = (): Result<CreatedProcess, string> => {
    let attributeList: Buffer | null = null;
    let logHandle: unknown = null;
    let stdinHandle: unknown = null;

    /** An inheritable handle, opened BY THE PARENT so the child never asks. */
    const inheritableAttributes = (): Buffer => {
      const attributes = Buffer.alloc(koffi.sizeof('MONSTERA_SECURITY_ATTRIBUTES'));
      koffi.encode(attributes, 'MONSTERA_SECURITY_ATTRIBUTES', {
        nLength: koffi.sizeof('MONSTERA_SECURITY_ATTRIBUTES'),
        lpSecurityDescriptor: null,
        bInheritHandle: 1,
      });
      return attributes;
    };

    try {
      // THE HOST'S STDIN IS THE PARENT'S NUL HANDLE, and it is not tidiness.
      //
      // Measured 2026-08-23, on a windows-latest runner and on no machine here:
      // both CONTAINED cells died before their first line with
      //
      //   FATAL:electron/shell/app/node_main.cc:215
      //   Unable to open nul device needed for initialization, aborting startup
      //
      // at Low integrity, in their job, having been created and resumed
      // correctly. Electron's node startup opens the NUL device to give itself
      // the standard descriptors, and inside an AppContainer that open is
      // refused — on that Windows build. A developing machine masked it
      // completely, which is audit item 3's inverse: the richer world is the one
      // that hides a provisioning-shaped defect.
      //
      // The fix is the one this file already uses for the diagnostic handle, and
      // the comment there states the mechanism: **the access check happens when
      // the file is OPENED, and the parent opens it.** An inherited handle is
      // the one channel a container cannot close. So the host is handed a NUL it
      // never had to reach for.
      //
      // NOT `--no-stdio-init`, which the fatal message suggests. That flag makes
      // the host start without the descriptors rather than with them, so every
      // later write goes somewhere unspecified — a workaround for a symptom,
      // where the cause is a handle nobody supplied.
      const nulOpened: unknown = bindings.createFile(
        'NUL',
        GENERIC_READ,
        FILE_SHARE_READ_WRITE,
        inheritableAttributes(),
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        null,
      );
      stdinHandle = isInvalidHandle(nulOpened) ? null : nulOpened;

      if (config.diagnosticPath !== null) {
        const opened: unknown = bindings.createFile(
          config.diagnosticPath,
          GENERIC_WRITE,
          FILE_SHARE_READ_WRITE,
          inheritableAttributes(),
          OPEN_ALWAYS,
          FILE_ATTRIBUTE_NORMAL,
          null,
        );
        logHandle = isInvalidHandle(opened) ? null : opened;
      }

      if (config.containerName !== null) {
        // The sizing call: it is EXPECTED to fail, and what it leaves behind is
        // the answer. Its return value is deliberately not read, because a
        // false there is the documented way it reports the required size.
        const size: unknown[] = [0];
        bindings.initializeAttributeList(null, 1, 0, size);
        const required = Number(size[0]);
        if (!Number.isInteger(required) || required < 1) {
          return err(
            `InitializeProcThreadAttributeList sized ${String(size[0])}: ` +
              String(bindings.lastError()),
          );
        }
        attributeList = Buffer.alloc(required);
        if (!bindings.initializeAttributeList(attributeList, 1, 0, size)) {
          return err(`InitializeProcThreadAttributeList failed: ${String(bindings.lastError())}`);
        }

        const sid = containerSid(bindings, config.containerName);
        if (!sid.ok) return err(sid.error);

        const capabilities = Buffer.alloc(koffi.sizeof('MONSTERA_SECURITY_CAPABILITIES'));
        koffi.encode(capabilities, 'MONSTERA_SECURITY_CAPABILITIES', {
          AppContainerSid: sid.value,
          Capabilities: null,
          CapabilityCount: 0,
          Reserved: 0,
        });
        if (
          !bindings.updateAttribute(
            attributeList,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
            capabilities,
            koffi.sizeof('MONSTERA_SECURITY_CAPABILITIES'),
            null,
            null,
          )
        ) {
          return err(`UpdateProcThreadAttribute failed: ${String(bindings.lastError())}`);
        }
      }

      const startup = Buffer.alloc(koffi.sizeof('MONSTERA_STARTUPINFOEXW'));
      koffi.encode(startup, 'MONSTERA_STARTUPINFOEXW', {
        StartupInfo: {
          cb: koffi.sizeof('MONSTERA_STARTUPINFOEXW'),
          lpReserved: null,
          lpDesktop: null,
          lpTitle: null,
          dwX: 0,
          dwY: 0,
          dwXSize: 0,
          dwYSize: 0,
          dwXCountChars: 0,
          dwYCountChars: 0,
          dwFillAttribute: 0,
          // USESTDHANDLES when EITHER handle exists. It used to depend on the
          // diagnostic handle alone, so a caller passing no `diagnosticPath`
          // got a child with no supplied descriptors at all — which is the
          // state the contained host could not start from.
          dwFlags: logHandle === null && stdinHandle === null ? 0 : STARTF_USESTDHANDLES,
          wShowWindow: 0,
          cbReserved2: 0,
          lpReserved2: null,
          hStdInput: stdinHandle,
          hStdOutput: logHandle,
          hStdError: logHandle,
        },
        lpAttributeList: attributeList,
      });

      // CREATE_SUSPENDED, so the job can be assigned BEFORE the first
      // instruction. A process that is already running has, by the time
      // anything is applied to it, executed — which is the window Decision 8
      // closes by construction rather than with a handshake.
      const information = Buffer.alloc(koffi.sizeof('MONSTERA_PROCESS_INFORMATION'));
      const started: unknown = bindings.createProcess(
        null,
        commandLine(config),
        null,
        null,
        logHandle !== null,
        EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
        environmentBlock(),
        config.workingDirectory,
        startup,
        information,
      );
      // Exactly `true`, not truthy. See the note on {@link Bindings}.
      if (started !== true) {
        return err(`CreateProcessW failed: ${String(bindings.lastError())}`);
      }

      const decoded = koffi.decode(information, 'MONSTERA_PROCESS_INFORMATION') as {
        hProcess: unknown;
        hThread: unknown;
        dwProcessId: number;
      };
      return ok({
        pid: decoded.dwProcessId,
        process: decoded.hProcess as ProcessHandle,
        thread: decoded.hThread as ThreadHandle,
      });
    } finally {
      // The parent's copies are closed either way: the child has its own, and
      // holding ours open past creation keeps handles alive for the life of the
      // surface rather than the life of the call.
      if (logHandle !== null) bindings.closeHandle(logHandle);
      if (stdinHandle !== null) bindings.closeHandle(stdinHandle);
      if (attributeList !== null) bindings.deleteAttributeList(attributeList);
    }
  };

  return {
    createSuspended,

    createJob: (): JobHandle | null => {
      const job: unknown = bindings.createJobObject(null, null);
      // NULL, not INVALID_HANDLE_VALUE — this is one of the calls where the two
      // are not interchangeable, which is why the shared rule takes both.
      return isInvalidHandle(job) ? null : (job as JobHandle);
    },

    applyLimits: (job: JobHandle, processMemoryLimitBytes: number): boolean => {
      const limits = Buffer.alloc(
        koffi.sizeof('MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION'),
      );
      koffi.encode(limits, 'MONSTERA_JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
        BasicLimitInformation: {
          PerProcessUserTimeLimit: 0n,
          PerJobUserTimeLimit: 0n,
          // ACTIVE_PROCESS delivers invariant 25(b): WW-1's matrix showed that
          // no process creation comes from the JOB and not from the container,
          // so a host with the container applied and no job spawns children
          // freely while answering yes to every cheap containment question.
          //
          // KILL_ON_JOB_CLOSE makes the job handle the host's leash.
          // PROCESS_MEMORY is the §9.17 term, and it is here rather than in the
          // struct as a literal because a number in a Win32 struct is a second
          // opinion about the invariant (ADR-0023 §2).
          LimitFlags:
            JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE |
            JOB_OBJECT_LIMIT_PROCESS_MEMORY,
          MinimumWorkingSetSize: 0,
          MaximumWorkingSetSize: 0,
          ActiveProcessLimit: 1,
          Affinity: 0,
          PriorityClass: 0,
          SchedulingClass: 0,
        },
        IoInfo: {
          ReadOperationCount: 0n,
          WriteOperationCount: 0n,
          OtherOperationCount: 0n,
          ReadTransferCount: 0n,
          WriteTransferCount: 0n,
          OtherTransferCount: 0n,
        },
        ProcessMemoryLimit: processMemoryLimitBytes,
        JobMemoryLimit: 0,
        PeakProcessMemoryUsed: 0,
        PeakJobMemoryUsed: 0,
      });
      return (
        bindings.setInformationJobObject(
          job,
          JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
          limits,
          limits.length,
        ) === true
      );
    },

    assignToJob: (job: JobHandle, target: ProcessHandle): boolean =>
      bindings.assignProcessToJobObject(job, target) === true,

    readJobMembership: (target: ProcessHandle, job: JobHandle): JobMembership => {
      const out: boolean[] = [false];
      // THREE ANSWERS, because the call itself can fail. A false return is not
      // "not in the job" — it is "nothing looked", and the two have different
      // repairs. Collapsing them is the shape the factory refuses to resume on.
      if (bindings.isProcessInJob(target, job, out) !== true) return 'could-not-read';
      return out[0] === true ? 'in-job' : 'not-in-job';
    },

    resume: (thread: ThreadHandle): number | null => {
      const previous: number = bindings.resumeThread(thread);
      return previous === RESUME_THREAD_FAILED ? null : previous;
    },

    terminate: (target: ProcessHandle): void => {
      // Best effort by the interface's own contract: there is nothing to do if
      // this fails, and reporting it would offer the caller a decision it
      // cannot act on.
      bindings.terminateProcess(target, 1);
    },

    close: (handle: ProcessHandle | ThreadHandle | JobHandle): void => {
      bindings.closeHandle(handle);
    },
  };
}
