/**
 * Every grant this application makes to the contained engine host, as SDDL.
 *
 * ## One resolver, two callers
 *
 * `hostPipeDacl` lived in `enginePipeFactory.ts` while the transport pipe was
 * the only securable object this app created. The session directories are the
 * second, and the alternative shape — expressing their grant as `icacls`
 * argument strings — would have been a **second opinion about what a DACL is**
 * (B3a). The rule now has a name and two callers: `enginePipeFactory.ts` for
 * the pipe, `sessionDirectories.ts` for the handed pair.
 *
 * The koffi *bindings* are still one per adapter module, and that is not the
 * same thing. `win32PipeSurface.ts` and `win32DirectorySurface.ts` each declare
 * `ConvertStringSecurityDescriptorToSecurityDescriptorW` and their own
 * `SECURITY_ATTRIBUTES` struct, because a struct registered under a
 * process-global name from two modules is an ordering dependency between them
 * that nothing states. What must not be duplicated is the **rule** — what the
 * descriptor says — and that is this file.
 *
 * ## Masks are numeric, and every one of them was read from `icacls`
 *
 * SDDL's file mnemonics cannot express the pipe mask that matters (see
 * {@link hostPipeDacl}), so the pipe's are numeric on necessity. The
 * directories' are numeric for a weaker but sufficient reason: the values below
 * are the ones whose rendering was **measured**, and a mnemonic would be a
 * second spelling of a number nobody re-read.
 *
 * Read on this machine, 2026-08-26, by creating a directory with each mask and
 * running `icacls` on it:
 *
 * | mask | `icacls` renders | what it is |
 * |---|---|---|
 * | `0x00120089` | `(R)` | `FILE_GENERIC_READ` |
 * | `0x001301BF` | `(M)` | `FILE_GENERIC_READ｜FILE_GENERIC_WRITE｜FILE_TRAVERSE｜DELETE` |
 * | `0x001200A9` | `(RX)` | the above plus `FILE_TRAVERSE` — **not used** |
 *
 * `R` and `M` are exactly the two rights `lowboxSpike.mjs` measured the verb
 * split with (ADR-0023, the 2026-08-25 measurement), so the shipped grant makes
 * the ACL that instrument's four rows were read against. `RX` is in the table
 * because it is what the obvious mask produces and it is a widening nothing
 * measured as necessary — the spike's read succeeded on `R`.
 */

/**
 * A SID in string form, from a resolver rather than from a literal.
 *
 * Branded because the failure this prevents is not hypothetical: the shipped
 * descriptor needs the *user's* SID and the *container's*, they are both
 * `S-1-…` strings, and passing them in the wrong order produces a descriptor
 * that parses, creates the object, and refuses whichever principal it was
 * supposed to admit. Two brands make that a compile error.
 */
export interface UserSid {
  readonly __sid: 'user';
  readonly value: string;
}

export interface ContainerSid {
  readonly __sid: 'container';
  readonly value: string;
}

/**
 * The DACL for the engine host's transport, assembled from two resolved SIDs.
 *
 * Exported because the adapter has to be able to show what it built when a
 * creation fails, and a diagnostic that paraphrases the descriptor is a second
 * opinion about it.
 *
 * ## The two masks differ, and `GA` is not one of them (finding BBBB-4)
 *
 * Both ACEs said `GA` — `GENERIC_ALL` — on the argument that the host must read
 * and write and the creator must be able to add instances. That was a compound
 * claim whose two clauses cover different principals: the instance-creation half
 * is about the CREATOR, and the container got `GA` alongside it.
 *
 * `GA` maps to `FILE_ALL_ACCESS`, which carries `STANDARD_RIGHTS_REQUIRED` —
 * `WRITE_DAC` included. So the principal invariant 25 declares *contains a
 * compromise*, on the pipe this design calls a trust boundary, could rewrite
 * that boundary's own DACL and decide who else may reach the channel.
 *
 * **Demonstrated, not argued.** On the spike's pipe that still carries `GA`, the
 * contained cell opens it for `WRITE_DAC` and succeeds. Under the masks below it
 * is refused, error 5, in the same run.
 *
 * | principal | mask | what it is |
 * |---|---|---|
 * | this user | `0x0012019F` | `FILE_GENERIC_READ｜FILE_GENERIC_WRITE` |
 * | the container | `0x0012019B` | the same, **minus `0x4`** |
 *
 * `0x4` is `FILE_APPEND_DATA` for a file and `FILE_CREATE_PIPE_INSTANCE` for a
 * pipe. The creator needs it — measured: without it, instance 1 fails with
 * `GetLastError 5` and the factory reports the stage. The host does not, and it
 * is the one right on this object that would let a compromised host stand up
 * another instance of the channel.
 *
 * Neither mask contains `WRITE_DAC`, `WRITE_OWNER` or `DELETE`. What that buys
 * against the OWNER is nothing — an object's owner holds `READ_CONTROL` and
 * `WRITE_DAC` implicitly whatever the DACL says, measured here too — and
 * same-user was never a boundary this descriptor could draw. Against the
 * container it is the whole point.
 *
 * No group appears: `D:(A;;GA;;;BU)` would grant Built-in Users, which is every
 * user of the machine, and the spike carries that spelling only because its
 * uncontained control cells have to connect.
 *
 * The masks are written numerically because SDDL's file mnemonics cannot express
 * the one that matters: `FW` — `FILE_GENERIC_WRITE` — includes `0x4`, so
 * `FRFW` for the container would grant instance creation back.
 *
 * @param user This process's own user SID.
 * @param container The AppContainer's SID.
 * @returns An SDDL string.
 */
export function hostPipeDacl(user: UserSid, container: ContainerSid): string {
  return `D:(A;;0x0012019F;;;${user.value})(A;;0x0012019B;;;${container.value})`;
}

/**
 * What the host may do with one handed directory (ADR-0023 Decision 7).
 *
 * Two values and no third, because the split IS the decision: *read on the
 * snapshot, modify only on the output directory*. A caller that could pass a
 * mask would be a caller that could hand the host a writable snapshot, which is
 * the one thing the 2026-08-25 measurement showed produces a document the
 * contained host can alter.
 */
export type HandedVerb = 'read' | 'modify';

/** `FILE_GENERIC_READ` — `icacls` renders it `(R)`. */
const DIRECTORY_READ_MASK = '0x00120089';
/** `FILE_GENERIC_READ｜FILE_GENERIC_WRITE｜FILE_TRAVERSE｜DELETE` — `icacls` renders it `(M)`. */
const DIRECTORY_MODIFY_MASK = '0x001301BF';

/**
 * The DACL for one directory handed to the engine host.
 *
 * ## `P`, and it is the reason this is created with a descriptor at all
 *
 * `P` is `SE_DACL_PROTECTED`: the object takes this DACL and **no inherited
 * ACE**. That turns the failure measured on 2026-08-25 into a state that cannot
 * occur rather than one the layout has to keep avoiding.
 *
 * That measurement: grant `(OI)(CI)(M)` on a parent, then grant `(R)`
 * explicitly on a file inside it, and the file carries **both** ACEs — an
 * access check unions allow ACEs, so the explicit read restricts nothing and
 * the inherited modify still grants write. Separate directories keep the two
 * grants apart, and this flag stops whatever sits above them reaching in.
 *
 * Measured again on 2026-08-26, this time on the flag rather than the hazard: a
 * directory created by `CreateDirectoryW` under a parent carrying that same
 * inheritable `(OI)(CI)(M)` shows `(OI)(CI)(R)` and nothing else, while a
 * sibling created by `mkdir` under the identical parent shows
 * `(I)(OI)(CI)(M)`. The sibling is the positive control: without it, *no
 * inherited ACE* would be indistinguishable from a reader that cannot see one.
 *
 * ## Create-with-descriptor rather than create-then-grant
 *
 * `mkdir` followed by a grant leaves the directory existing, briefly, carrying
 * whatever it inherited. Whether that window is reachable depends on an
 * ordering argument — is the host running yet — and an ordering argument is a
 * thing someone has to keep true. Passing the descriptor to the create call
 * makes the intermediate state unrepresentable (B5).
 *
 * ## `OICI`, so the files inside carry the same grant
 *
 * `OI` is what makes the snapshot **file** readable by the host, and what makes
 * the file the host writes into the output directory readable by us. Without it
 * the grant stops at the directory and the bytes inside it are reachable by
 * nobody who needs them.
 *
 * ## `FA` for this user, and the owner argument that makes it safe
 *
 * The pipe's DACL refuses `GA` to both principals because `WRITE_DAC` on a
 * trust boundary is a right the container must not hold. Here the creating
 * process is also the **owner**, and an owner holds `READ_CONTROL` and
 * `WRITE_DAC` implicitly whatever the DACL says — measured for the pipe and
 * unchanged by the object being a directory. So withholding them from this user
 * would express a restriction that does not exist. The container's mask is
 * where the restriction is real, and it carries neither.
 *
 * @param user This process's own user SID.
 * @param container The AppContainer's SID.
 * @param verb What the host may do here.
 * @returns An SDDL string.
 */
export function handedDirectoryDacl(
  user: UserSid,
  container: ContainerSid,
  verb: HandedVerb,
): string {
  const mask = verb === 'read' ? DIRECTORY_READ_MASK : DIRECTORY_MODIFY_MASK;
  return `D:P(A;OICI;FA;;;${user.value})(A;OICI;${mask};;;${container.value})`;
}
