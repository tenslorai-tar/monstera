# ADR-0027 — a development grant belongs to provisioning, not to the application

**Status:** accepted, 2026-08-27
**Decides:** how the engine host's container reaches the runtime on a machine that is not a Store install.
**Builds:** nothing. This ADR is the decision; the work is a separate commit.

## Context

The engine host cannot start from a development checkout. Measured 2026-08-27,
read-only:

```
icacls .tools\electron\43.4.1\electron.exe
  → NT AUTHORITY\SYSTEM:(I)(F)   BUILTIN\Administrators:(I)(F)   EMEM-PC\emiso:(I)(F)
```

No `ALL APPLICATION PACKAGES` ACE and no container SID. An AppContainer's access
check is **conjunctive** ([ADR-0023](0023-how-the-contained-engine-host-is-built.md)
§4's 2026-08-24 correction): the DACL must grant the request to the token's
ordinary identity **and** to the package SID. With no package-SID ACE at all the
image cannot be executed by a contained token, and the process dies before its
first line.

Positive control, because *no such ACE* is a search's reassuring answer: the same
command on `C:\Windows\System32\kernel32.dll` prints
`ALL APPLICATION PACKAGES:(RX)`. The reading can see the ACE when there is one.

§5 already says this from the other end. **Premise P1** is that under the shipped
install root the runtime, the FFI and the shim are reachable by an AppContainer
**without any grant this application makes**, because MSIX-installed files
inherit read+execute for `ALL APPLICATION PACKAGES`. And §5 states plainly that
**the five grants `lowboxSpike.mjs` takes are a development accommodation, not
the shipped mechanism** — a checkout under a user profile grants application
packages nothing, so the spike supplies by hand what the install root is expected
to supply by inheritance.

What was missing is the consequence for the wiring: **`engine-host-factory-wired`
cannot be observed in development at all**, whatever `composition.ts` calls,
until something grants.

## The false premise

Three options were considered and all three share one assumption:

> a development checkout's binary cannot be executed by a contained token,
> therefore development must choose between **containment** and **running**.

That is true only if the grant has to come from **the application**. It does not.
`lowboxSpike.mjs` already issues five grants against real processes on this
machine and reverses every one of them on exit, including the failure path.

## Decision

**The grants are a provisioning step.** They live in `scripts/provision/`,
attached to the artefact whose installation already happens there:
`.tools\electron\<version>\electron.exe` is put in place by
`scripts/provision/electron.mjs`, and the ACEs that make it executable by a
contained token are a property of that artefact.

**Rule B3 decides the owner: the thing that installs an artefact owns its
state.** A grant taken by the application would be a second writer of a property
provisioning already establishes.

**Feasibility is measured, not assumed** — 2026-08-27, on a throwaway file under
`.tools/`, granted and then reversed:

| step | result |
|---|---|
| `icacls <file> /grant "*S-1-15-2-1:(RX)"` | succeeded **unelevated** |
| read back | `APPLICATION PACKAGE AUTHORITY\ALL APPLICATION PACKAGES:(RX)` present |
| `icacls <file> /remove "*S-1-15-2-1"` | succeeded |
| read back | **0** app-package ACEs |

No elevation is required because the user already holds `(I)(F)` on that tree,
which includes `WRITE_DAC`. The probe file was deleted. This is the fact the
decision rests on, and it was the one worth checking before writing any of the
above: *impossible* and *expensive* read the same in a plan, and only one of them
can be revisited.

**The principal is `ALL APPLICATION PACKAGES`, not the container SID**, and that
is a fidelity choice rather than a convenience. Production reaches the runtime
because MSIX inheritance grants exactly that principal; granting the same one in
development leaves **how the ACE arrived** as the only difference between the two
configurations. Granting the specific container SID would work and would make
development and production differ in the principal as well, which is one more
axis along which a dev-only result could fail to transfer.

## Consequences

- **No ACL-granting code ships.** This is the whole point and it is what kills
  option (a): security-relevant code that executes only in the configuration
  nobody audits is worse than the problem it solves.
- **An unprovisioned machine gets a LOUD failure, not a silent one.** The host
  starts uncontained or fails to start, and `engine/probe-containment` answers
  `containment-absent` — a declared verdict, already classified, from the
  mechanism built for exactly this. That is option (b) demoted from *design* to
  *fallback state*, which is where it belongs.
- **Development containment is NOT production containment, and this must be
  stated wherever a containment result is reported.** The DACL differs: granted
  here, inherited there. What development exercises is *a contained host*, which
  is what invariant 25 names; what it does not exercise is **P1 itself**. P1
  expires on packaging, on an elevated read of the install root, or at Stage 7,
  and this decision does not touch that.
- **The grants are reversible and the provisioning step owns the reversal.**
  `lowboxSpike.mjs` is the shape to copy: every grant recorded, every grant
  reversed on exit including the failure path. A provisioning step that grants
  must also be able to un-grant, or an uninstall leaves ACEs behind naming a
  principal nothing on the machine uses.
- **Which paths are granted is derived, not listed here.** §5 names the classes —
  the runtime, the FFI, the engine shim — and `lowboxSpike.mjs` holds the five it
  measured. The provisioning step takes its set from what the host must reach,
  and a list restated in this ADR would be a second opinion about it (B3a).

## Rejected alternatives

**(a) The application grants when unpackaged.** Puts ACL-writing code in the
shipped binary, gated on a condition (`installChannel === 'development'`) that is
itself a runtime read. The code path that writes a security descriptor would then
exist in every shipped copy and execute in none of them, so its only testing is
by developers on machines where its failure is invisible. §5's own reasoning
applies: the only ACL the shipped app sets at runtime is on a path **it creates**
— the handed directory — which it fully controls.

**(b) An uncontained host in development.** Development then never exercises
invariant 25, and `containerName: null` is documented in `win32HostSurface.ts` as
the **route control** for proofs — a way to tell containment from a broken spawn.
Making it a product mode would spend the control to buy a convenience, and the
first thing to break would be the ability to tell those two apart. It survives as
the *fallback*, announced by the probe.

**(c) No host in development.** Blocks every later stage locally for a property
that already has its own instrument, and makes each of Stages 1–9 wait on
packaging to be exercised end to end.

**(d′) Grant at first run rather than at provisioning.** Same code, later moment,
and worse: it moves a machine-state write out of the step whose whole job is
machine state and into the application, which is (a) with a different trigger.

## What this does NOT decide

- **Whether P1 is true.** Unchanged and still carried, with its expiry on the
  packaging row. This decision makes development work *whatever* P1 turns out to
  be, which is why it is worth taking before P1 is settled rather than after.
- **Whether the containment reading transfers.** It does not, and the third
  consequence above requires that to be said rather than implied at every point a
  development containment result is reported.
- **The wiring itself.** `composition.ts` still calls no factory. This removes the
  reason it could not be observed; it does not do it.
