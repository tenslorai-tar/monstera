import { describe, expect, it } from 'vitest';

import {
  type ContainerSid,
  type UserSid,
  handedDirectoryDacl,
  hostPipeDacl,
} from './hostDacl.js';

const user: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
const container: ContainerSid = { __sid: 'container', value: 'S-1-15-2-1-2-3-4-5-6-7' };

/**
 * MOVED HERE WITH THE FUNCTION, 2026-08-26 (finding EEEE-1).
 *
 * These two cases stayed in `enginePipeFactory.test.ts` when `hostPipeDacl`
 * left it, and the file that gained the function got a weaker duplicate of the
 * first one. That is *proven in the wrong file* arriving by a route worth
 * naming: nothing was deleted and no coverage was lost, so no check could see
 * it — the thorough cases simply sat under a `describe` for a symbol their file
 * no longer imports, next to a second, thinner assertion of the same literal in
 * the file that does. Two files asserting one expected value is the second
 * opinion B3a is about, and the one a reader trusts is whichever they open.
 */
describe('hostPipeDacl', () => {
  it('names the user and the container, and no group', () => {
    // BOTH ACES ARE REQUIRED and this is the case that says so. Measured
    // 2026-08-24: a DACL carrying only the container's ACE refuses the
    // contained host, because an AppContainer's access check is conjunctive.
    // Built-in Users is absent deliberately — `BU` is every user of the
    // machine, and the spike carries it only for its uncontained controls.
    expect(hostPipeDacl(user, container)).toBe(
      'D:(A;;0x0012019F;;;S-1-5-21-1-2-3-1001)(A;;0x0012019B;;;S-1-15-2-1-2-3-4-5-6-7)',
    );
  });

  it('gives the container a mask that is four bits smaller than the creator’s', () => {
    // THE DIFFERENCE IS THE PROPERTY, so it is asserted as a difference rather
    // than left implicit in two literals a reader has to subtract (BBBB-4).
    // `0x4` is FILE_CREATE_PIPE_INSTANCE on a pipe: the creator needs it —
    // measured, instance 1 fails with GetLastError 5 without it — and the host
    // does not. Neither mask carries WRITE_DAC, which is what `GA` was
    // handing to the principal invariant 25 declares hostile.
    const dacl = hostPipeDacl(user, container);
    const masks = [...dacl.matchAll(/\(A;;(0x[0-9A-F]{8});;;/gu)].map((match) =>
      Number(match[1]),
    );
    const [creator, host] = masks;
    expect(masks).toHaveLength(2);
    expect(creator).toBeDefined();
    expect(host).toBeDefined();
    expect((creator ?? 0) - (host ?? 0)).toBe(0x4);
    for (const mask of masks) expect(mask & 0x00040000).toBe(0);
  });
});

describe('handedDirectoryDacl', () => {
  /**
   * THE MUTATION MUST BE TOWARDS DISAGREEMENT (audit item 4).
   *
   * The defect this file exists to catch is a builder that ignores `verb` — and
   * a builder that ignored it would return one string for both, which is also
   * what a test asserting "they are both well-formed" would accept. So the
   * load-bearing assertion is that the two DIFFER, and specifically that they
   * differ in the mask rather than anywhere else.
   */
  it('gives read and modify different masks and nothing else different', () => {
    const read = handedDirectoryDacl(user, container, 'read');
    const modify = handedDirectoryDacl(user, container, 'modify');

    expect(read).not.toBe(modify);
    expect(read).toBe(
      'D:P(A;OICI;FA;;;S-1-5-21-1-2-3-1001)(A;OICI;0x00120089;;;S-1-15-2-1-2-3-4-5-6-7)',
    );
    expect(modify).toBe(
      'D:P(A;OICI;FA;;;S-1-5-21-1-2-3-1001)(A;OICI;0x001301BF;;;S-1-15-2-1-2-3-4-5-6-7)',
    );
    // The only difference is the container's mask: swap it back and the two
    // strings are identical. A builder that also moved a flag or a principal
    // between the two verbs would fail here rather than passing on "they
    // differ".
    expect(modify.replace('0x001301BF', '0x00120089')).toBe(read);
  });

  /**
   * `P` IS THE ONE FLAG THE 2026-08-25 MEASUREMENT TURNED INTO A REQUIREMENT.
   *
   * Without it the directory takes its parent's inheritable ACEs, an access
   * check unions them with these, and a read-granted snapshot inside a
   * modify-granted ancestor is writable by the contained host. Asserted on both
   * verbs, because a builder that emitted it for one is the half-fix.
   */
  it('protects both DACLs from inherited ACEs', () => {
    expect(handedDirectoryDacl(user, container, 'read').startsWith('D:P(')).toBe(true);
    expect(handedDirectoryDacl(user, container, 'modify').startsWith('D:P(')).toBe(true);
  });

  /**
   * The mask that the obvious reading produces, and which nothing measured as
   * necessary. `RX` adds `FILE_TRAVERSE`; the spike's contained read succeeded
   * on `R`, so this asserts the widening did not creep in.
   */
  it('grants the container no traverse it was not measured to need', () => {
    expect(handedDirectoryDacl(user, container, 'read')).not.toContain('0x001200A9');
  });

  /**
   * ORDER IS THE FAILURE THE BRANDS EXIST FOR, and this is the runtime half of
   * it: the user's ACE comes first and carries `FA`, the container's second and
   * carries the verb's mask. A builder that emitted them the other way round
   * would produce a descriptor that parses, creates the directory, and grants
   * the container everything.
   */
  it('puts the creator first and the container second', () => {
    const dacl = handedDirectoryDacl(user, container, 'modify');
    expect(dacl.indexOf(user.value)).toBeLessThan(dacl.indexOf(container.value));
    expect(dacl).toContain(`FA;;;${user.value}`);
    expect(dacl).toContain(`0x001301BF;;;${container.value}`);
  });
});
