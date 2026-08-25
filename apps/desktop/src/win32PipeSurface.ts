import { type Result, err, ok } from '@monstera/shared';
import koffi from 'koffi';

import type {
  ContainerSid,
  PipeCreationSurface,
  PipeHandle,
  SecurityDescriptor,
  UserSid,
} from './enginePipeFactory.js';
import { containerSidText, isInvalidHandle } from './win32HostSurface.js';

/**
 * The Win32 calls behind {@link PipeCreationSurface}, bound with koffi.
 *
 * B7's sanctioned exception, the second instance of it: one typed adapter module
 * per native boundary, behind an interface `enginePipeFactory.ts` consumes —
 * which names no Win32 anything and is unit-tested without a pipe existing.
 *
 * ## This file invents nothing
 *
 * Every call here is one `scripts/research/lowboxSpike.mjs` already made when it
 * had its own pipe creation, with the descriptors and instance counts that
 * instrument measured on three Windows builds. That instrument now drives THIS
 * module instead, for the reason its own header gives: *anything that creates
 * has exactly one implementation.*
 *
 * ## Nothing is bound at import time
 *
 * `koffi.load` at module scope would make importing this file throw on any
 * machine that is not Windows, including the Linux runner that typechecks and
 * lints the tree. Binding happens inside {@link createWin32PipeSurface}, so the
 * module is importable everywhere and only *calling* it needs the platform.
 *
 * ## What this surface deliberately does NOT do
 *
 * It does not read or write. A `CreateNamedPipeW` handle cannot be adopted into
 * Node — measured 2026-08-24: `_open_osfhandle` in `ucrtbase.dll` yields a
 * descriptor whose `GetFileType` is `FILE_TYPE_PIPE`, and node's own C runtime
 * answers `EBADF` for the same number, because `node.exe` links its CRT
 * statically. So the bytes cannot travel as a Node stream, and whatever carries
 * them was a separate decision from creating the channel.
 *
 * **That decision is now taken** (ADR-0023 §4, 2026-08-25): the worker thread
 * does the overlapped reads, and main issues the overlapped writes itself,
 * because a thread inside `WaitForMultipleObjects` cannot be told anything. The
 * paragraph above used to end *"creating it is settled; carrying them is not"*,
 * which stopped being true on the day the decision landed and would have gone on
 * reading as a live reason not to put the write calls here.
 *
 * They belong here when they are built: writes on this handle are the same
 * native boundary as creating it, and B7 asks for one adapter per boundary
 * rather than one per verb. What must not move here is the READ side — it runs
 * on the worker, and a module a worker imports is a different execution mode
 * from this one.
 */

const PIPE_ACCESS_DUPLEX = 0x00000003;
/**
 * `FILE_FLAG_OVERLAPPED`, in `CreateNamedPipeW`'s open mode.
 *
 * Required, not optional, and the reason is termination rather than throughput.
 * A synchronous handle can only be read by a thread that blocks inside
 * `ReadFile`, and unwedging such a thread means `CancelIoEx` from outside or
 * closing the handle underneath it — teardown that works on one machine and
 * hangs on another. `HostRuntimeTransport` declares `terminate(reason)` as a
 * first-class operation and ADR-0023 Decision 8 kills the host rather than
 * resuming it, so the transport has to come down cleanly at an arbitrary
 * moment.
 *
 * With this flag the reader waits on the read's completion event **and** a stop
 * event together, and a stop returns from the wait rather than interrupting a
 * syscall. Measured by `scripts/research/transportTeardown.mjs`.
 *
 * The client side is unaffected: a server instance's overlapped flag is not
 * visible to whoever opens the name.
 */
const FILE_FLAG_OVERLAPPED = 0x40000000;
const SDDL_REVISION_1 = 1;
/** `CreateNamedPipeW`'s in and out buffer sizes. The kernel treats these as a hint. */
const PIPE_BUFFER_BYTES = 4096;

interface PipeBindings {
  readonly createNamedPipe: (
    name: string,
    openMode: number,
    pipeMode: number,
    maxInstances: number,
    outBuffer: number,
    inBuffer: number,
    timeout: number,
    securityAttributes: Buffer,
  ) => unknown;
  readonly convertStringSecurityDescriptor: (
    sddl: string,
    revision: number,
    descriptor: unknown[],
    size: unknown[],
  ) => boolean;
  readonly localFree: (memory: unknown) => unknown;
  readonly closeHandle: (handle: unknown) => boolean;
  readonly lastError: () => number;
  readonly openProcessToken: (process: unknown, access: number, token: unknown[]) => boolean;
  readonly getCurrentProcess: () => unknown;
  readonly getTokenInformation: (
    token: unknown,
    informationClass: number,
    information: Buffer | null,
    length: number,
    returned: unknown[],
  ) => boolean;
  readonly convertSidToStringSid: (sid: unknown, out: unknown[]) => boolean;
}

/**
 * Registered under a process-global name, so registering twice throws. The host
 * surface has its own `MONSTERA_SECURITY_ATTRIBUTES` for `CreateFileW`; this one
 * is named separately rather than shared, because two modules registering the
 * same global name is an ordering dependency between them that nothing states.
 */
let structRegistered = false;

function registerStruct(): void {
  if (structRegistered) return;
  koffi.struct('MONSTERA_PIPE_SECURITY_ATTRIBUTES', {
    nLength: 'uint32',
    lpSecurityDescriptor: 'void *',
    bInheritHandle: 'int32',
  });
  structRegistered = true;
}

function bind(): PipeBindings {
  const kernel = koffi.load('kernel32.dll');
  const advapi = koffi.load('advapi32.dll');
  // As in `win32HostSurface.ts`: koffi's `func()` returns a callable assignable
  // to any signature, so the types below are an ASSERTION the compiler never
  // checks. They are written from the C prototype on the adjacent line so the
  // pair reads together, and that adjacency is the whole review mechanism.
  return {
    createNamedPipe: kernel.func(
      'void *CreateNamedPipeW(const char16_t *name, uint32 openMode, uint32 pipeMode, ' +
        'uint32 maxInstances, uint32 outBuffer, uint32 inBuffer, uint32 timeout, void *sa)',
    ),
    convertStringSecurityDescriptor: advapi.func(
      'bool ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *sddl, ' +
        'uint32 revision, _Out_ void **sd, _Out_ uint32 *size)',
    ),
    localFree: kernel.func('void *LocalFree(void *memory)'),
    closeHandle: kernel.func('bool CloseHandle(void *handle)'),
    lastError: kernel.func('uint32 GetLastError()'),
    openProcessToken: advapi.func(
      'bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)',
    ),
    getCurrentProcess: kernel.func('void *GetCurrentProcess()'),
    getTokenInformation: advapi.func(
      'bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, ' +
        '_Out_ uint32 *ret)',
    ),
    convertSidToStringSid: advapi.func('bool ConvertSidToStringSidW(void *sid, _Out_ char16_t **out)'),
  };
}

/** `TOKEN_QUERY`. */
const TOKEN_QUERY = 0x0008;
/** `TokenUser`. */
const TOKEN_USER_CLASS = 1;

/**
 * This process's own user SID, which the transport's DACL must name.
 *
 * ## Why the DACL needs it, which ADR-0023 §4's original sentence did not say
 *
 * Measured 2026-08-24: a pipe carrying `D:(A;;GA;;;<container>)` and nothing
 * else refuses **the contained host**, EPERM, in the same run where a DACL
 * naming a user as well admits it. An AppContainer token's access check is
 * conjunctive — the DACL must grant the request to the token's ordinary
 * identity AND to the package SID — so the container's ACE satisfies half of a
 * two-part test.
 *
 * Read from the token rather than from a group, because `D:(A;;GA;;;BU)` grants
 * Built-in Users, which is every user of the machine.
 *
 * @returns The SID as `S-1-5-…`, or why it could not be read.
 */
export function currentUserSid(): Result<UserSid, string> {
  const bindings = bind();
  const token: unknown[] = [null];
  if (!bindings.openProcessToken(bindings.getCurrentProcess(), TOKEN_QUERY, token)) {
    return err(`OpenProcessToken failed: ${String(bindings.lastError())}`);
  }
  const size: unknown[] = [0];
  bindings.getTokenInformation(token[0], TOKEN_USER_CLASS, null, 0, size);
  const needed = Number(size[0]);
  if (!needed) {
    return err(`GetTokenInformation sized 0: ${String(bindings.lastError())}`);
  }
  const buffer = Buffer.alloc(needed);
  if (!bindings.getTokenInformation(token[0], TOKEN_USER_CLASS, buffer, needed, size)) {
    return err(`GetTokenInformation failed: ${String(bindings.lastError())}`);
  }
  // TOKEN_USER is a SID_AND_ATTRIBUTES whose first member is the SID pointer.
  const sid: unknown = koffi.decode(buffer, 'void *');
  const out: unknown[] = [null];
  if (!bindings.convertSidToStringSid(sid, out) || typeof out[0] !== 'string') {
    return err(
      `ConvertSidToStringSidW gave no string for this process's user ` +
        `(GetLastError ${String(bindings.lastError())})`,
    );
  }
  return ok({ __sid: 'user', value: out[0] });
}

/**
 * The AppContainer's SID, branded for the pipe factory.
 *
 * Thin on purpose: `containerSidText` in `win32HostSurface.ts` is the resolver,
 * because *what is this container's SID* is a question that module already
 * answers for process creation, including the part everyone gets wrong. This
 * only puts a brand on it (B3a).
 *
 * @param name The AppContainer profile name.
 */
export function hostContainerSid(name: string): Result<ContainerSid, string> {
  const text = containerSidText(name);
  if (!text.ok) return text;
  return ok({ __sid: 'container', value: text.value });
}

/**
 * @returns The Win32 calls {@link PipeCreationSurface} declares.
 */
export function createWin32PipeSurface(): PipeCreationSurface {
  registerStruct();
  const bindings = bind();
  const attributeSize = koffi.sizeof('MONSTERA_PIPE_SECURITY_ATTRIBUTES');

  return {
    describe: (sddl: string): SecurityDescriptor | null => {
      const descriptor: unknown[] = [null];
      const size: unknown[] = [0];
      if (
        !bindings.convertStringSecurityDescriptor(sddl, SDDL_REVISION_1, descriptor, size) ||
        descriptor[0] === null
      ) {
        return null;
      }
      return descriptor[0] as SecurityDescriptor;
    },

    createInstance: (
      name: string,
      descriptor: SecurityDescriptor,
      instances: number,
    ): PipeHandle | null => {
      // BUILT PER CALL rather than once per pipe. The struct holds a pointer to
      // the descriptor, and a buffer reused across calls is a buffer whose
      // contents at the moment of the call depend on what else touched it —
      // which is the class of bug an FFI boundary exists to keep out of the rest
      // of the application.
      const attributes = Buffer.alloc(attributeSize);
      koffi.encode(attributes, 'MONSTERA_PIPE_SECURITY_ATTRIBUTES', {
        nLength: attributeSize,
        lpSecurityDescriptor: descriptor,
        // NOT inheritable. A child created after this pipe exists must not
        // receive a handle to the host's control channel by accident, and an
        // inherited handle is the one channel a container cannot close —
        // the access check happened when the parent opened it.
        bInheritHandle: 0,
      });
      const handle: unknown = bindings.createNamedPipe(
        name,
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        0,
        instances,
        PIPE_BUFFER_BYTES,
        PIPE_BUFFER_BYTES,
        0,
        attributes,
      );
      if (isInvalidHandle(handle)) return null;
      return handle as PipeHandle;
    },

    freeDescriptor: (descriptor: SecurityDescriptor): void => {
      bindings.localFree(descriptor);
    },

    close: (pipe: PipeHandle): void => {
      bindings.closeHandle(pipe);
    },

    lastError: (): number => bindings.lastError(),
  };
}
