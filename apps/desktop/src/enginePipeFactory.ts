import { type Result, err, ok } from '@monstera/shared';

import { type ContainerSid, type UserSid, hostPipeDacl } from './hostDacl.js';

/**
 * Creating the engine host's transport pipe, in the one order that leaks
 * nothing (ADR-0023 §4 and both of its 2026-08-24 corrections).
 *
 * ## What is here and what is deliberately not
 *
 * This is the **ordering**, over an injected Win32 surface, exactly as
 * `engineHostFactory.ts` is the ordering for process creation. The calls
 * themselves — `ConvertStringSecurityDescriptorToSecurityDescriptorW`,
 * `CreateNamedPipeW`, `LocalFree`, `CloseHandle` — belong to the adapter module
 * that may carry an `any` under B7's native-boundary rule.
 *
 * It does **not** read or write. Whoever composes this with the runtime loop
 * owns that, and the reason is measured rather than stylistic — see *the server
 * half* below.
 *
 * ## The descriptor reaches here from a resolver, never from a caller
 *
 * The SDDL itself is `hostPipeDacl` in `hostDacl.ts`, which owns every grant
 * this application makes to the contained host — the session directories being
 * the second caller. What this file owns is the ORDER: parse, create every
 * instance, free on both paths.
 *
 * ADR-0023 §4 said *"a named pipe created by main with the container SID in its
 * DACL"*. Measured on 2026-08-24: a pipe carrying only that ACE **refuses the
 * contained host**. An AppContainer token's access check is conjunctive — the
 * DACL must grant the request to the token's ordinary identity *and* to the
 * package SID — so the container's ACE satisfies half of a two-part test.
 *
 * Both SIDs are therefore required, and both arrive as branded values rather
 * than as strings. A `string` parameter here would let a caller pass a DACL it
 * assembled itself, which is the second opinion that produced the original
 * error: the descriptor is the one thing about this pipe that has to be right,
 * and the shape that cannot express the wrong one is a descriptor with no
 * caller-supplied text in it at all (B5).
 *
 * ## Every instance, or none
 *
 * `CreateNamedPipeW` for instance 0 creates the object and is not access
 * checked. Every later instance opens the existing object by name and IS, and
 * with `PIPE_ACCESS_DUPLEX` it asks for read and write — the same rights a
 * client asks for. Measured: a descriptor that does not grant the creating user
 * denies the creator its own second instance, `GetLastError 5`.
 *
 * So a partial creation is a real outcome and not a theoretical one, and it is
 * the case that leaks: the spike throws out of its loop with the earlier
 * instances still open. Failure here closes what it made, in one place, for the
 * same reason `createContainedHost` has one `abandon`.
 *
 * ## The descriptor is freed on both paths
 *
 * `ConvertStringSecurityDescriptorToSecurityDescriptorW` allocates with
 * `LocalAlloc`, and the caller frees it. It is freed as soon as the last
 * instance exists, because the instances hold their own copies of the security
 * information — keeping it alive longer would be a handle nobody owns.
 *
 * ## The server half is NOT a Node stream, and that is measured
 *
 * §4 also said the pipe is *"handed to Node"*. It cannot be. Measured
 * 2026-08-24: `_open_osfhandle` in `ucrtbase.dll` yields a descriptor whose
 * `GetFileType` is `FILE_TYPE_PIPE`, and node's own C runtime answers `EBADF`
 * for the same number — `node.exe` links its CRT statically, so an fd minted by
 * any DLL an FFI can reach is meaningless to it. `net.Socket({ fd })` reports
 * `Unsupported fd type: UNKNOWN` for both that case and for a handle it cannot
 * drive, which is why the two had to be separated before either could be
 * believed.
 *
 * The consequence lands on the composer rather than here: bytes reach
 * `createHostRuntime` from whatever the adapter does with these handles, not
 * from a stream. `HostRuntimeTransport` already takes `write(frame)` and the
 * loop already takes `receive(chunk)`, so the seam is unchanged; only the size
 * of the module behind it moved.
 */

/** An opaque Win32 handle, branded per kind so two pointers cannot be swapped. */
export interface PipeHandle {
  readonly __handle: 'pipe';
}

/** A parsed security descriptor, owned by the caller until it is freed. */
export interface SecurityDescriptor {
  readonly __handle: 'security-descriptor';
}

/**
 * The Win32 calls this factory makes, in the order it makes them.
 *
 * Every member reports failure as a value rather than throwing, for the reason
 * `HostCreationSurface` does: these are foreign calls whose failure is an
 * outcome, and a surface that threw would put the cleanup for a half-created
 * pipe in a `catch` block, which is where a leaked handle goes to live.
 */
export interface PipeCreationSurface {
  /** Parses an SDDL string. `null` when it did not parse. */
  readonly describe: (sddl: string) => SecurityDescriptor | null;
  /** One `CreateNamedPipeW` instance. `null` when the call was refused. */
  readonly createInstance: (
    name: string,
    descriptor: SecurityDescriptor,
    instances: number,
  ) => PipeHandle | null;
  /** `LocalFree` on the descriptor. Called exactly once, on every path. */
  readonly freeDescriptor: (descriptor: SecurityDescriptor) => void;
  /** `CloseHandle`. */
  readonly close: (pipe: PipeHandle) => void;
  /** `GetLastError`, read only to put a number in a diagnostic. */
  readonly lastError: () => number;
}

/** A pipe whose every instance exists. */
export interface HostPipe {
  readonly name: string;
  /**
   * Every instance, in creation order.
   *
   * All of them, not just the first: each is a separate object that a client
   * can connect to, and closing the set is how the channel is torn down.
   */
  readonly instances: readonly PipeHandle[];
}

/** Why no pipe was created. Every one of these leaves nothing open. */
export interface PipeCreationFailure {
  readonly stage: 'descriptor' | 'instance';
  readonly detail: string;
}

/**
 * @param surface The Win32 calls, injected. See {@link PipeCreationSurface}.
 * @param name The pipe's full name, `\\.\pipe\…`.
 * @param user This process's own user SID — see {@link hostPipeDacl}.
 * @param container The AppContainer's SID.
 * @param instances How many instances to create. Must be at least one.
 * @returns The pipe, or the stage that refused and why.
 */
export function createHostPipe(
  surface: PipeCreationSurface,
  name: string,
  user: UserSid,
  container: ContainerSid,
  instances: number,
): Result<HostPipe, PipeCreationFailure> {
  if (!Number.isInteger(instances) || instances < 1) {
    throw new RangeError(
      `instances must be a positive integer, received ${String(instances)}. A pipe with no ` +
        'instances is a name nothing can connect to, which fails at the host rather than here.',
    );
  }

  const sddl = hostPipeDacl(user, container);
  const descriptor = surface.describe(sddl);
  if (descriptor === null) {
    // A DESCRIPTOR THAT DID NOT PARSE MUST NOT REACH A CreateNamedPipeW CALL.
    // Passing `null` security attributes gives the object a default DACL rather
    // than no DACL, so the pipe would exist, the host would be refused, and the
    // refusal would read as "the container cannot reach a Win32 pipe" — the
    // reading that sends someone into an amendment they do not owe.
    return err({
      stage: 'descriptor',
      detail:
        `the DACL did not parse, so nothing below would carry it: ${sddl} ` +
        `(GetLastError ${String(surface.lastError())})`,
    });
  }

  const made: PipeHandle[] = [];
  for (let index = 0; index < instances; index += 1) {
    const handle = surface.createInstance(name, descriptor, instances);
    if (handle === null) {
      // EVERY INSTANCE OR NONE. Instance 0 creates the object; every later one
      // opens it by name and is access checked against the DACL just written,
      // so a partial set is what a descriptor that does not grant this process
      // produces. Leaving the earlier instances open would leave a reachable
      // pipe behind a failed creation.
      const why = surface.lastError();
      for (const open of made) surface.close(open);
      surface.freeDescriptor(descriptor);
      return err({
        stage: 'instance',
        detail:
          `instance ${String(index)} of ${String(instances)} was refused (GetLastError ` +
          `${String(why)}); the ${String(made.length)} already created were closed. Instance 0 ` +
          'creates the object and is not access checked, so a failure after it means the DACL ' +
          'does not grant this process the read and write PIPE_ACCESS_DUPLEX asks for.',
      });
    }
    made.push(handle);
  }

  // Freed once the instances exist and never before: they carry their own copy
  // of the security information, and the descriptor is this function's to
  // release on both paths.
  surface.freeDescriptor(descriptor);
  return ok({ name, instances: made });
}
