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
| created → integrity lowered | real; the host had to RUN in order to lower itself, so (a) was not in force at instruction one | **there is no window** — the LowBox token is Low at creation |
| contained → first document byte | needs the host to refuse work until told | still real, and it is the only one left |

So: **the host is created suspended, the job is assigned, and only then is the
thread resumed.** PP-6's handshake is withdrawn as unnecessary for the first two
windows — a handshake is a runtime agreement two parties can get wrong, and B5
prefers the shape that cannot express the bug.

**EXECUTED, not reasoned** (`lowboxSpike.mjs`, ORDERING section), because this
withdraws a designed mechanism and a decision to remove a guard should not stand
on an inference:

```
route   {"assigned":true,"inJobBeforeResume":true,"integrityBeforeResume":"0x2000","previousSuspendCount":1}
lowbox  {"assigned":true,"inJobBeforeResume":true,"integrityBeforeResume":"0x1000","previousSuspendCount":1}

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

**The second window gets the same treatment, and the honest question sharpened
it.** Calling it "structural" was about to be a weaker claim than it needed to
be: **the second window is integrity, and integrity is property (a) — so if the
host has to run in order to lower itself, (a) is not in force at instruction
one.** A window with no stated permissible action is one somebody later puts work
into, so it needed either a reading or a rule.

It got a reading, and there is no window: `integrityBeforeResume` is read by main
against the child's token **while the process is still suspended**, and the
container's token is already **Low**.

| cell | integrity before the first instruction |
|---|---|
| `route` — our route, no container | `0x2000` (Medium) |
| `lowbox` — our route, container | **`0x1000` (Low)** |

Two readings differing across the one variable, which is the same shape that
made the utility-process integrity measurement a reading rather than a hope.

**So the host never lowers itself, and that removes a mechanism rather than
scheduling one.** `hostFixture.mjs` had the host call `SetTokenInformation` on
its own token because a utility process has no other route — and finding PP-2 is
the consequence: afterwards it cannot open its own token at all, so the
verification had to come from main. None of that exists here. (a) arrives with
the process, it is read from outside, and there is no interval to write rules
about.

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

### 5. The container's lifecycle, and the premise the shipped design rests on

- The profile is created if absent at first host creation, named from the
  application's own identity, and **never deleted** — deleting it would silently
  drop every ACE that names it.

#### THE NO-RUNTIME-GRANT BRANCH IS PRIMARY, and it is a premise with an expiry

**Premise P1:** *under the shipped install root, the runtime, the FFI and the
engine shim are reachable by an AppContainer without any grant this application
makes — because MSIX-installed files inherit read+execute for `ALL APPLICATION
PACKAGES`, and every AppContainer is a member of it.*

**Why this is primary rather than the five grants.** MSIX-installed files under
`C:\Program Files\WindowsApps\<package>` are **read-only to the app itself** — a
packaged application cannot modify ACLs on its own installed files — and
distribution is Store-only (ADR-0018). So a design that *needs* a runtime grant
on an install-root path cannot execute on a real install at all. It would not
degrade; it would fail on every machine.

That reframes what the spike measured. **The five grants are a development
accommodation, not the shipped mechanism.** A checkout under
`C:\Users\…\Desktop` grants application packages nothing, so the spike had to
supply by hand what the install root is expected to supply by inheritance. The
only ACL the shipped app sets at runtime is on a path **it creates** — the handed
directory — which it fully controls, and which is not an install-root path.

Saying this now rather than later changes which path carries the tests, which is
the whole reason it belongs in the decision and not in a follow-up.

#### P1 is not measured, and the failure mode is named rather than discovered

`icacls "C:\Program Files\WindowsApps"` returns **Access is denied** without
elevation, so this seat cannot read it. That is a *could-not-look*, not a
*looked-and-found-nothing*, and the two must not share an output.

Nor is it settled by building a package to find out: **installers are built only
when the owner asks** (B8), and that is the owner's call.

**The expiry.** P1 is carried as a named premise, and it expires the first time
any of these happens: the app is packaged for the Store; an elevated read of the
install root becomes available; or Stage 7 begins, whichever is first. **It is
not "owed before Stage 10"** — if P1 is false it does not add work to this ADR,
it **invalidates the mechanism**, and a premise that can invalidate a decision has
to be checked while the decision is still cheap to change.

**What the probe reports when P1 is false**, so the failure names its cause
instead of being mute. The host factory verifies the container's reach at startup
and fails closed — one positive probe (a path the host must reach) and one
negative probe (a path it must not, built from one the *uncontained* cell reads
successfully, so refusal and impossibility cannot share an observation). Failing
closed is right. **Failing closed on a condition the app has no power to fix is
not a guard, it is a guaranteed outage with a good diagnostic** — so the
diagnostic has to distinguish the two:

| what the probe sees | what it means | what it says |
|---|---|---|
| positive probe refused, on an **install-root** path | **P1 is false.** The app cannot fix this by granting, because it cannot write its own ACLs | names P1, names the path, and says the containment branch is unavailable on this installation — a branch-level failure, reported as such and not as a document error |
| positive probe refused, on a path the app **created** | a grant this app is responsible for did not take | names the path and the grant, because this one *is* actionable |
| negative probe **allowed** | the container is not containing | the loudest case: containment is absent while the host appears healthy |

The first row is the one this section exists for. **A product that cannot open a
document is not an acceptable outcome of a security mechanism**, so if P1 comes
back false the answer is a decision to retake — the utility-process host with (a)
and (b), or a different route to the install root — and not a retry loop or a
silently disabled container. Recorded here so that whoever meets it knows it is a
premise failing and not a bug.

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

**Assuming the Store install root grants `ALL APPLICATION PACKAGES`, silently.**
The inheritance is the *primary branch* (P1), but assuming it without a startup
check would convert a premise failure into a silent loss of containment. It is
carried as a named premise with an expiry and verified at runtime instead.

**Making the five measured grants the shipped mechanism.** Rejected on the
constraint rather than on preference: MSIX-installed files are read-only to the
app itself, so a design that needs a runtime grant on an install-root path
cannot execute on any real installation. It would fail on every machine, not
some — which is why the branch had to be chosen now rather than discovered at
packaging.
