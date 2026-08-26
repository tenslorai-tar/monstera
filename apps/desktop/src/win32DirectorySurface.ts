import { existsSync, rmSync } from 'node:fs';

import koffi from 'koffi';

import type { DirectoryCreationSurface, DirectoryPath } from './sessionDirectories.js';

/**
 * The Win32 calls behind {@link DirectoryCreationSurface}, bound with koffi.
 *
 * B7's sanctioned exception, the third instance of it: one typed adapter module
 * per native boundary, behind an interface `sessionDirectories.ts` consumes —
 * which names no Win32 anything and is unit-tested with no directory existing.
 *
 * ## Why this is not `mkdir` followed by a grant
 *
 * `CreateDirectoryW` takes a `SECURITY_ATTRIBUTES`, so the directory's first
 * observable state already carries its DACL. The alternative — `fs.mkdirSync`
 * and then an ACL edit — leaves the directory existing, briefly, with whatever
 * it inherited, and the argument that nothing can reach it in that window is an
 * ordering argument somebody has to keep true. B5 over a check.
 *
 * ## Why this is not `icacls`
 *
 * `spawnSync('icacls', …)` lets PATH resolution decide which binary establishes
 * a security boundary. This repository already refuses that shape in a
 * different domain — a filename may not select a native library (invariant 23)
 * — and the objection carries over unchanged. `lowboxSpike.mjs` granted that
 * way while it was research; the shipped path does not, and the spike now
 * drives this module so its measurements stay measurements *of the shipped
 * path*.
 *
 * ## Nothing is bound at import time
 *
 * `koffi.load` at module scope would make importing this file throw on any
 * machine that is not Windows, including the Linux runner that typechecks and
 * lints the tree. Binding happens inside {@link createWin32DirectorySurface},
 * so the module is importable everywhere and only *calling* it needs the
 * platform.
 *
 * ## The struct and the converter are declared again here, deliberately
 *
 * `win32PipeSurface.ts` declares its own `SECURITY_ATTRIBUTES` struct and its
 * own `ConvertStringSecurityDescriptorToSecurityDescriptorW`. Sharing them
 * would mean two modules registering one process-global koffi name, which is an
 * ordering dependency between them that nothing states — the reason that file
 * already gives for naming its own. What must exist exactly once is the RULE,
 * and that is `hostDacl.ts`: a binding is not a second opinion, a second DACL
 * would be (B3a).
 */

const SDDL_REVISION_1 = 1;
/** `CreateDirectoryW` failed because the name is already there. */
const ERROR_ALREADY_EXISTS = 183;

interface DirectoryBindings {
  readonly createDirectory: (name: string, securityAttributes: Buffer) => boolean;
  readonly removeDirectory: (name: string) => boolean;
  readonly convertStringSecurityDescriptor: (
    sddl: string,
    revision: number,
    descriptor: unknown[],
    size: unknown[],
  ) => boolean;
  readonly localFree: (memory: unknown) => unknown;
  readonly lastError: () => number;
}

/**
 * Registered under a process-global name, so registering twice throws. Named
 * for this module rather than shared with the pipe surface — see the header.
 */
let structRegistered = false;

function registerStruct(): void {
  if (structRegistered) return;
  koffi.struct('MONSTERA_DIRECTORY_SECURITY_ATTRIBUTES', {
    nLength: 'uint32',
    lpSecurityDescriptor: 'void *',
    bInheritHandle: 'int32',
  });
  structRegistered = true;
}

function bind(): DirectoryBindings {
  const kernel = koffi.load('kernel32.dll');
  const advapi = koffi.load('advapi32.dll');
  // As in `win32HostSurface.ts` and `win32PipeSurface.ts`: koffi's `func()`
  // returns a callable assignable to any signature, so the types above are an
  // ASSERTION the compiler never checks. They are written from the C prototype
  // on the adjacent line so the pair reads together, and that adjacency is the
  // whole review mechanism.
  return {
    createDirectory: kernel.func('bool CreateDirectoryW(const char16_t *name, void *sa)'),
    removeDirectory: kernel.func('bool RemoveDirectoryW(const char16_t *name)'),
    convertStringSecurityDescriptor: advapi.func(
      'bool ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *sddl, ' +
        'uint32 revision, _Out_ void **sd, _Out_ uint32 *size)',
    ),
    localFree: kernel.func('void *LocalFree(void *memory)'),
    lastError: kernel.func('uint32 GetLastError()'),
  };
}

/**
 * @returns The Win32 calls {@link DirectoryCreationSurface} declares.
 */
export function createWin32DirectorySurface(): DirectoryCreationSurface {
  registerStruct();
  const bindings = bind();
  const attributeSize = koffi.sizeof('MONSTERA_DIRECTORY_SECURITY_ATTRIBUTES');

  return {
    create: (path: DirectoryPath, sddl: string): 'created' | 'exists' | 'refused' => {
      const descriptor: unknown[] = [null];
      const size: unknown[] = [0];
      if (
        !bindings.convertStringSecurityDescriptor(sddl, SDDL_REVISION_1, descriptor, size) ||
        descriptor[0] === null
      ) {
        // A DESCRIPTOR THAT DID NOT PARSE MUST NOT REACH A CreateDirectoryW
        // CALL. Passing null security attributes gives the directory the
        // parent's inheritable ACEs rather than none — which is precisely the
        // union measured on 2026-08-25 — so the snapshot would be writable by
        // the host and every later check would pass.
        return 'refused';
      }

      // BUILT PER CALL rather than once per surface. The struct holds a pointer
      // to the descriptor, and a buffer reused across calls is a buffer whose
      // contents at the moment of the call depend on what else touched it.
      const attributes = Buffer.alloc(attributeSize);
      koffi.encode(attributes, 'MONSTERA_DIRECTORY_SECURITY_ATTRIBUTES', {
        nLength: attributeSize,
        lpSecurityDescriptor: descriptor[0],
        // NOT inheritable. This is a handle-inheritance flag on the attributes
        // structure and has nothing to do with ACE inheritance, which `P` in
        // the DACL governs; a child created later must not receive anything by
        // accident.
        bInheritHandle: 0,
      });

      const made = bindings.createDirectory(path, attributes);
      const why = made ? 0 : bindings.lastError();
      bindings.localFree(descriptor[0]);
      if (made) return 'created';
      // EXISTS IS SEPARATED FROM REFUSED because only one of them is safe to
      // continue from, and they are the same `false` here. A directory already
      // at this path carries a DACL nobody in this run wrote — so the caller
      // must treat it as a collision rather than reuse it.
      return why === ERROR_ALREADY_EXISTS ? 'exists' : 'refused';
    },

    remove: (path: DirectoryPath): boolean => bindings.removeDirectory(path),

    // NOT AN FFI CALL, and the boundary is not being crossed loosely. Deleting
    // is not a securable-object *creation*: it takes no descriptor, so there is
    // no rule about what it grants and nothing for a second implementation to
    // disagree with. `rmSync` also does the one thing `RemoveDirectoryW` will
    // not — remove a directory with contents — which is required rather than
    // convenient, since the host holds modify on the output directory and
    // invariant 25 declares it hostile, so what is in there is not limited to
    // the one file this design asks for.
    removeTree: (path: DirectoryPath): boolean => {
      try {
        rmSync(path, { recursive: true, force: true });
        return !existsSync(path);
      } catch {
        // REPORTED, NOT SWALLOWED. The caller's `false` means a directory that
        // may hold the user's document is still on disk, which is the whole
        // reason this returns a value — see `removeSessionDirectories`.
        return false;
      }
    },

    lastError: (): number => bindings.lastError(),
  };
}
