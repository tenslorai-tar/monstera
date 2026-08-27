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

## Correction, 2026-08-27 — the grant is necessary and is not sufficient

This decision rested on a prediction nothing had run: that granting
`ALL APPLICATION PACKAGES` on the four provisioned paths lets a contained host
start. `scripts/research/containedStart.mjs` now measures it, three cells through
the shipped `win32HostSurface`, one variable, with `packages/kernel/dist/host/hostEntry.js`
as the program and its own no-pipe-name refusal as the marker that it reached its
own code:

| cell | contained | grants | outcome |
|---|---|---|---|
| `uncontained` | no | present | **ran** — reached the entry's refusal |
| `revoked` | yes | removed | dead at **runtime-init**, `icu_util.cc:232` |
| `granted` | yes | present | dead at **module-resolution**, `Cannot find module …dist/host/hostEntry.js` |

**The verdict is INSUFFICIENT.** The grant moves the failure and does not produce
a start.

Three things follow, and the third is the one that reopens a decision.

**The predicted mechanism is wrong in kind.** This ADR and the FEATURES row both
said the token *cannot execute the image* and the process *dies before its first
line*. It does execute: the revoked cell reaches Chromium's ICU initialisation
and dies reading the runtime's own data. The conclusion — no start without the
grant — holds; the sentence explaining it did not, and both documents are
corrected rather than left to vouch for each other.

**The revoked cell is what makes any of this readable.** The machine is left
granted by `provision:grants`, so a single positive reading cannot separate *the
grant works* from *it would have worked anyway*. The uncontained cell is the
other half: node says `Cannot find module` for a file it cannot **read** as
readily as for one that is absent, so without a cell that reaches the entry the
`granted` row would have been indistinguishable from a stale build path.

**Rejected alternative (b) was rejected under a premise this measurement
falsifies, and is therefore reopened rather than reaffirmed.** (b) — an
uncontained host in development — was refused on the reading that development
containment costs nothing beyond four grants on artefacts provisioning already
installs. It costs more: the host's program is the application's own built
output, which in production the install root grants by inheritance and in a
checkout grants nothing. Making development containment work means granting
application packages read over `packages/*/dist` and the npm dependency graph the
host loads — `@monstera/contract`, `@monstera/shared`, `mupdf`, `@cantoo/pdf-lib`,
`zod` — which is a materially wider surface than §5's three classes and is an
invariant 25(d) question, not a provisioning detail. **This correction does not
decide it.** It records that the choice between widening the set and taking (b)
is now open on evidence, and that the wiring is blocked behind it.

**And the paragraph above headed *Which paths are granted is derived* says the
spike holds five.** It holds four: the handed pair left the list on 2026-08-26
when `createSessionDirectories` began passing a security descriptor to
`CreateDirectoryW`, so there is no window in which those directories exist
ungranted. `grantSet()` and the spike's `GRANTS` are the same four paths today —
which is itself a second opinion about one question (B3a), and is left standing
here only because this correction does not settle what that set should contain.
