import { describe, expect, it } from 'vitest';

import {
  type ContainerSid,
  type PipeCreationSurface,
  type PipeHandle,
  type SecurityDescriptor,
  type UserSid,
  createHostPipe,
  hostPipeDacl,
} from './enginePipeFactory.js';

/**
 * A recording Win32 surface.
 *
 * ONE list for every call, as `engineHostFactory.test.ts` does, because the
 * properties under test are about ORDER and about what happens after a refusal.
 * Per-call spies would let "the descriptor is freed on both paths" pass against
 * a factory that freed it before the last instance existed.
 */
interface Recorder extends PipeCreationSurface {
  readonly calls: string[];
}

const aDescriptor = { __handle: 'security-descriptor' } as SecurityDescriptor;
const user: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
const container: ContainerSid = { __sid: 'container', value: 'S-1-15-2-1-2-3-4-5-6-7' };

const NAME = String.raw`\\.\pipe\monstera-engine-host-1`;

function surface(
  overrides: {
    readonly describe?: PipeCreationSurface['describe'];
    readonly createInstance?: PipeCreationSurface['createInstance'];
    readonly lastError?: () => number;
  } = {},
): Recorder {
  const calls: string[] = [];
  let handles = 0;

  const describe: PipeCreationSurface['describe'] =
    overrides.describe ?? ((): SecurityDescriptor | null => aDescriptor);
  const createInstance: PipeCreationSurface['createInstance'] =
    overrides.createInstance ??
    ((): PipeHandle | null => ({ __handle: 'pipe', id: (handles += 1) }) as PipeHandle);

  return {
    calls,
    describe: (sddl) => {
      calls.push(`describe(${sddl})`);
      return describe(sddl);
    },
    createInstance: (name, descriptor, instances) => {
      calls.push(`createInstance(${name}, ${String(instances)})`);
      return createInstance(name, descriptor, instances);
    },
    freeDescriptor: () => {
      calls.push('freeDescriptor');
    },
    close: () => {
      calls.push('close');
    },
    lastError: overrides.lastError ?? ((): number => 5),
  };
}

describe('hostPipeDacl', () => {
  it('names the user and the container, and no group', () => {
    // BOTH ACES ARE REQUIRED and this is the case that says so. Measured
    // 2026-08-24: a DACL carrying only the container's ACE refuses the
    // contained host, because an AppContainer's access check is conjunctive.
    // Built-in Users is absent deliberately — `BU` is every user of the
    // machine, and the spike carries it only for its uncontained controls.
    expect(hostPipeDacl(user, container)).toBe(
      'D:(A;;GA;;;S-1-5-21-1-2-3-1001)(A;;GA;;;S-1-15-2-1-2-3-4-5-6-7)',
    );
  });
});

describe('createHostPipe', () => {
  it('creates every instance, then frees the descriptor', () => {
    const win32 = surface();
    const result = createHostPipe(win32, NAME, user, container, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instances).toHaveLength(3);
    expect(result.value.name).toBe(NAME);

    // THE ORDER IS THE PROPERTY. The descriptor is freed once, and only after
    // the last instance exists: the instances carry their own copy of the
    // security information, and freeing earlier would release memory a call
    // still in flight is reading.
    expect(win32.calls).toEqual([
      `describe(${hostPipeDacl(user, container)})`,
      `createInstance(${NAME}, 3)`,
      `createInstance(${NAME}, 3)`,
      `createInstance(${NAME}, 3)`,
      'freeDescriptor',
    ]);
  });

  it('creates no instance when the descriptor did not parse', () => {
    const win32 = surface({ describe: () => null });
    const result = createHostPipe(win32, NAME, user, container, 2);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('descriptor');

    // NOT ONE CALL PAST THE PARSE. `CreateNamedPipeW` with null security
    // attributes gives the object a DEFAULT DACL rather than none, so the pipe
    // would exist and the host would be refused — and the refusal would read as
    // "the container cannot reach a Win32 pipe" rather than as a broken
    // descriptor.
    expect(win32.calls).toEqual([`describe(${hostPipeDacl(user, container)})`]);
  });

  it('closes the instances it already made when a later one is refused', () => {
    let made = 0;
    const win32 = surface({
      // Instance 0 creates the object and is not access checked; instance 1
      // opens it by name and is. Measured on 2026-08-24: with a DACL that does
      // not grant this process, instance 1 fails with GetLastError 5. This is
      // that shape.
      createInstance: () => (made++ < 1 ? { __handle: 'pipe' } : null),
    });
    const result = createHostPipe(win32, NAME, user, container, 4);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('instance');
    expect(result.error.detail).toContain('GetLastError 5');

    // ONE close FOR THE ONE INSTANCE THAT EXISTED, and the descriptor freed
    // after it. A failure path that leaked would leave a reachable pipe behind
    // a creation that reported failure — the worst of both.
    expect(win32.calls).toEqual([
      `describe(${hostPipeDacl(user, container)})`,
      `createInstance(${NAME}, 4)`,
      `createInstance(${NAME}, 4)`,
      'close',
      'freeDescriptor',
    ]);
  });

  it('frees the descriptor when the FIRST instance is refused, having closed nothing', () => {
    // THE CONTROL FOR THE CASE ABOVE, and it is not symmetry for its own sake.
    // A factory that closed `made` unconditionally would pass that case and
    // call `close` on nothing here; a factory that freed the descriptor only
    // inside the loop's failure branch would leak it on the success path. The
    // two cases together pin one `close` per instance actually created.
    const win32 = surface({ createInstance: () => null, lastError: () => 87 });
    const result = createHostPipe(win32, NAME, user, container, 4);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.detail).toContain('instance 0 of 4');
    expect(win32.calls).toEqual([
      `describe(${hostPipeDacl(user, container)})`,
      `createInstance(${NAME}, 4)`,
      'freeDescriptor',
    ]);
  });

  it('refuses an instance count below one rather than creating a name nothing can reach', () => {
    const win32 = surface();
    expect(() => createHostPipe(win32, NAME, user, container, 0)).toThrow(RangeError);
    expect(win32.calls).toEqual([]);
  });
});
