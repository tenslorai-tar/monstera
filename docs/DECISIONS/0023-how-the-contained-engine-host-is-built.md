# ADR-0023 — How the contained engine host is built

- **Status:** Accepted
- **Date:** 2026-08-22
- **Follows:** [ADR-0022](0022-the-engine-host-is-a-process-we-create.md), which
  decided *what* the host is. This decides *how* it is built.
- **Constrains:** `docs/ARCHITECTURE.md` §9.17 (the budget it must read), §9.25
  (the properties it must obtain), §5 (the discipline its protocol takes).

## Context

ADR-0022 settled that the engine hosts are processes this application creates,
because two of invariant 25's four properties are supplied by an AppContainer and
`utilityProcess.fork` cannot create one. That decision leaves a set of mechanism
questions which were raised against the research and deliberately not answered
inside an instrument that asserts nothing.

This ADR answers them before any host code exists, because each is a question
whose wrong answer is invisible once there is something working built on top.

## Decision

### 1. Owning the creation route makes three windows unrepresentable, not handled

This is the first thing to state, because it changes two of the questions below
from *how do we handle this* into *this cannot occur*.

`utilityProcess.fork` returns a process that is **already running**. Everything
applied afterwards — the job object, the integrity level — is applied to a
process that has executed. Three windows follow, and the research carried a
handshake design for one of them (finding PP-6).

`CreateProcessW` takes `CREATE_SUSPENDED`, and the AppContainer is applied *at
creation* by the token itself.

| window | with `utilityProcess.fork` | with our route |
|---|---|---|
| created → job assigned | real; needs a handshake so the host runs nothing first | **closed by construction** — assign the job, then `ResumeThread` |
| created → contained | real; the host lowered its own integrity, after running | **closed by construction** — the LowBox token exists before the first instruction |
| contained → first document byte | needs the host to refuse work until told | still real, and it is the only one left |

So: **the host is created suspended, the job is assigned, and only then is the
thread resumed.** PP-6's handshake is withdrawn as unnecessary for the first two
windows — a handshake is a runtime agreement two parties can get wrong, and B5
prefers the shape that cannot express the bug.

**EXECUTED, not reasoned** (`lowboxSpike.mjs`, ORDERING section), because this
withdraws a designed mechanism and a decision to remove a guard should not stand
on an inference:

```
route    {"limitsSet":true,"assigned":true,"inJobBeforeResume":true,"previousSuspendCount":1}
baseline (no job from us)  allowed   spawned before doing anything else
route    (job, suspended)  refused   spawnSync ... UNKNOWN
```

Three readings, each carrying its own weight. `previousSuspendCount: 1` is what
`ResumeThread` returns as the count *before* the call, so it separates *we asked
for `CREATE_SUSPENDED`* from *it took effect* — a running thread reports 0.
`inJobBeforeResume: true` is the assignment landing while the process is still
suspended. And **the host's very first action is a spawn attempt**, so its
refusal is evidence the job was in force at instruction one rather than at some
point afterwards; the baseline, forked by Electron with no job of ours, spawns —
which is what separates the ordering from the container, since a LowBox refuses
process creation for its own reasons too.

**The second window is structural rather than measured, and that is stated
rather than blurred.** `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` is consumed
by `CreateProcessW` itself, so the primary token is a LowBox token from creation
and no interval exists in which the process is running uncontained. That is a
property of the API, not an observation of ours, and there is nothing to sample
between two events that never occur in that order.

The third window survives and keeps its handshake: the host accepts no document
byte until main has confirmed the host is contained, because "the container was
applied" and "main has verified it" are different facts and only the second is
evidence.

### 2. The job's memory limit is derived from §9.17, undefaulted (finding PP-4)

The research fixture carries `ProcessMemoryLimit: 512 * 1024 * 1024` — a literal
in a Windows struct, which is where a number survives review most easily. In
shipped code that is a **second opinion about §9.17's `mupdf-host` budget**, and
ADR-0012 already decided that the invariant holds the pen and code reads it.

So the limit is parsed from `memoryBudgets.mjs`, which parses §9.17's machine-read
line, and it takes the **absolute cap** rather than the multiple — §9.17 says the
absolute cap "bounds the whole process, because the machine pays for the baseline
too, and containment is about what the machine has to survive", which is exactly
what a job's `ProcessMemoryLimit` is.

**Undefaulted.** No `?? someNumber`, no fallback. A budget that cannot be read is
a host that does not start, for the same reason the composition root recomputes
its ceiling and fails when the constant differs: a default is how a withdrawn
number returns.

### 3. The job limit is the BACKSTOP. Main monitoring and killing is the mechanism (finding PP-5)

§9.17 says a `mupdf-host` breach means **kill-and-restart, never a raised
number**, and §2 says that is the same recovery route as handle recycling and
failed-save recovery — one route, reached three ways.

A job `ProcessMemoryLimit` does not do that. It makes the *allocation fail inside
the host*, which hands MuPDF an out-of-memory condition in native code — a
different event with a different failure shape, and not the one ADR-0007
designed. **"We set a job memory limit" reads as satisfying that design and does
not.**

Both exist, and the ADR states which is which:

- **Primary:** main samples the host's memory and kills it at the budget,
  restarting from canonical bytes plus the command log. This is the designed
  behaviour and the one the recovery path is written against.
- **Backstop:** the job limit, set higher than nothing and lower than the machine
  dying, catching the case where the host allocates faster than main samples.
  It exists because a sampler is not a guarantee.

A breach of the backstop is a **defect in the primary**, not a normal event, and
must be reported as one rather than absorbed.

### 4. The host protocol: framing beneath the contract, never beside it

ADR-0022 decided the discipline. The mechanism:

- The transport is a **named pipe created by main with the container SID in its
  DACL.** Node's `net.createServer` sets no DACL for the container — measured,
  `EPERM` from the contained host beside a connection from the uncontained one —
  so the pipe is created through Win32 with an explicit security descriptor and
  handed to Node, not created by Node.
- The framing is **length-prefixed**, fixed-width, with a declared maximum. It is
  parsed before any schema is consulted, which makes it the first thing a hostile
  peer reaches: a length field that can be trusted to size an allocation is the
  classic way this goes wrong, so the maximum is checked before the allocation
  and a frame that exceeds it kills the host rather than truncating.
- Above the frame, `packages/contract`'s existing discipline: one definition per
  channel, zod for params and result, validation in one generated boundary
  wrapper. **`defineWorkerContract` is extended to carry a byte-stream transport
  rather than copied** — if it turns out it cannot be, the finding is that we
  have two opinions about wire validation and the answer is to fix the helper,
  not to write a second one (B3a).
- Errors cross structurally, as §5 already requires.

### 5. The container's lifecycle, and one thing this seat could not measure

- The profile is created if absent at first host creation, named from the
  application's own identity, and **never deleted** — deleting it would silently
  drop every ACE that names it.
- Grants are applied at **runtime, on first launch**, because a Store app runs no
  install script.

**And here is what is NOT known.** The spike measured five grants in a
development checkout. In the shipped layout the runtime, the FFI and the shim all
live under the install root, and `C:\Program Files` grants `ALL APPLICATION
PACKAGES` read+execute — which would supply them with no grant of ours at all.
Whether the Store's own root does the same is **unmeasured and unmeasurable from
this seat**: `icacls "C:\Program Files\WindowsApps"` returns *Access is denied*
without elevation.

That is a *could-not-look*, not a *looked-and-found-nothing*, and the two must
not share an output. It matters in both directions: if the install root already
grants app packages, our grants are redundant; if it does not, and a packaged app
also cannot modify ACLs on its own installed files, **the contained host cannot
load the FFI in the shipped configuration at all** and ADR-0022's branch fails
where it counts.

So the mechanism does not depend on the answer:

> **The host factory verifies the container's reach at startup and fails closed.
> It never assumes a grant, whoever supplied it.**

One positive probe (a file the host must reach) and one negative probe (a file it
must not, built from a path the *uncontained* cell reads successfully, so refusal
and impossibility cannot share an observation). A host that cannot prove both
does not start. This is the same rule as everything else here — assert against
the running thing, not against the configuration — and it makes the unmeasured
question a runtime fact rather than a planning assumption.

**Owed regardless, and it is a scheduled item and not a note:** measure the Store
layout before Stage 10, on a packaged build or from an elevated read. If it comes
back wrong, this is a branch-level finding and not a bug.

### 6. The research→proof transition (finding RR-3)

`scripts/research/` asserts nothing and gates nothing, on purpose. What becomes a
proof, and where:

- **Which assertions.** The four properties, each as a differential against a
  cell that removes only its own mechanism — never as a single "everything
  applied and everything refused" run, which cannot say which mechanism produced
  which denial.
- **The route control comes with them.** A property verdict read from a
  comparison that crosses two variables is not a verdict, so the proof carries
  the middle cell and refuses to report properties when it fails.
- **Where it runs:** the shim job. It is `windows-latest`, it builds MuPDF, and
  it now provisions Electron (finding RR-1) — the only job that can host one.
  **That step's consumer is this proof**, which discharges finding TT-1: if this
  ADR had concluded the fixture stays research-only, the provisioning step would
  have been removed in the same commit.
- **Where provisioning is impossible**, the result is `UNVERIFIABLE` and never
  `passed`. A proof that cannot look must not print the reassuring answer, which
  is the advisory register's rule and applies with more force here, because
  "containment asserted" is the most reassuring line in the build.
- **The instrument's own controls travel with it**: the ACL absence check keeps
  its post-grant positive control, and the attribution table keeps `unreadable`
  as a terminal, non-zero state.

## Rejected alternatives

**A handshake for the job-assignment window.** Correct for `utilityProcess.fork`
and unnecessary here: `CREATE_SUSPENDED` closes the window by construction, and a
runtime agreement is a thing two parties can get wrong.

**The job memory limit as the containment mechanism, with no sampler.** Rejected:
it produces a native out-of-memory inside MuPDF, not the kill-and-restart §9.17
specifies, and it would quietly replace a designed recovery path with an
undesigned failure.

**A default for the memory limit when §9.17 cannot be parsed.** Rejected: a
default is how a withdrawn number returns, and a host that will not start is a
louder failure than a host contained to a number nobody chose.

**Creating the pipe with Node and adjusting its DACL afterwards.** Rejected: the
window between creation and adjustment is exactly the shape §1 above spends
effort closing everywhere else, and it would be the only one left open for no
reason but convenience.

**Assuming the Store install root grants `ALL APPLICATION PACKAGES`.** Rejected
because it is unmeasured from this seat, and an assumption in this position
converts a startup failure into a silent loss of containment.
