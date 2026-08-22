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

## Note, 2026-08-22 — where P1's expiry is carried

§5 states P1's three expiry conditions and does not say what watches them.
It is carried on **`docs/FEATURES.md`'s packaging-skeleton row**, which already
owns *"an MSIX application cannot write to its install directory"* — the
constraint P1 is the other half of.

Deliberately **not** in `docs/security/engine-advisories.json`. That register's
mechanism is a symbol scan — *"the day shipped code names X"* — and P1's three
conditions are all **events**. A claim whose expiry no scan can see becomes a
verdict that never fires, sitting green and reading as coverage, which is the
state `engine-host-containment` was in until it was re-pointed on the same day.

## Correction, 2026-08-22 — `defineWorkerContract` does not exist (finding XX-1)

§4 above instructs that *"`defineWorkerContract` is extended to carry a
byte-stream transport rather than copied"*. **No such helper is implemented.**
`BUILD-PROMPT.md` Part D and `docs/ARCHITECTURE.md` §5 described it in the
present tense, ADR-0022 §4 repeated it, and this ADR turned it into an
instruction — three documents deep, none of which looked.

The instruction's *intent* is unchanged and is what to follow: extend the one
validated-boundary discipline, never write a second (B3a). Today that discipline
is `channel()` plus `wrapHandler`/`wrapHandlers`/`createClient`, and
`packages/contract/src/frame.ts` is the byte-stream layer beneath it, added in
`9429e00`. Whoever writes the worker protocol either extends those or builds the
named helper on top of them.

Left as written, because what this ADR instructed at the time is the record.
`docs/ARCHITECTURE.md` §5's **body** is corrected instead, being living law.

## Decision 7 — what crosses the pipe: intent and handles, never images (decided 2026-08-22)

*Numbered into the same sequence as §1–§6, which are `###` under `## Decision`.
This one and §8 were decided later and are appended at `##`, beside the
corrections, because this document is a record and appended sections are not
reordered into the body above them. The heading says "Decision" so the level
carries the same meaning either way.*

§4 settled the *shape* of the protocol and left its *payload* open, which is the
question that decides the frame maximum. Appended rather than folded into §4,
because this ADR's earlier text is a record of what was decided when.

**Intent and handles cross. Document images do not. The frame maximum is
kilobytes.**

### It follows from a budget this repository already enforces

Main's memory budget is **≤ 1.5× file size**, machine-read from
`docs/ARCHITECTURE.md` §9.17 and enforced on every push. Main already holds the
canonical image, measured at **1.00×**. Serialising a second full copy into a
pipe write puts main at **2.00×** — which is precisely the figure `perf:gate`
reports for two resident images, and it FAILS on both content shapes.

**A design whose normal path breaches a budget this repository enforces is wrong
before anyone argues about it.** No new measurement was needed and none was
taken; the numbers were already on the board.

### Three things support it, and none of them is the reason

Recorded separately from the argument above, because a supporting consideration
promoted to a reason is how a decision survives the withdrawal of its actual
basis.

1. **Invariant 25(d) presupposes handed paths.** *"Reaches no filesystem path it
   was not handed"* is a statement about a host that is handed some. A host that
   received everything over a pipe would have the simpler property, and that is
   not what the law says.
2. **The handed directory already exists in the design.** The LowBox spike
   measured a grant of **modify** on what the host was handed, because a host
   that reports has to write where it was handed.
3. **ADR-0007's kill-and-restart re-reads a path.** Re-transmitting hundreds of
   megabytes from a main process already near its ceiling is the worst possible
   moment to do the most expensive thing.

### How an image actually reaches the host is mechanism, and wants a measurement

Not decided here, and deliberately not chosen from an armchair. **The candidate
to test first:** main writes its canonical image to a handed path once per
version, and the host reads it there.

Its argument is not performance. It keeps **main the single source of truth** —
the host never opens the user's original, so the two cannot disagree about a
file that changed underneath, which is the entire subject of ADR-0009's identity
work.

**Split the grants by verb: read on the snapshot, modify only on the output
directory.** A compromised host that can rewrite the user's document is a
materially worse outcome than one that can read a copy of it, and the spike's
single modify grant on "what it was handed" does not distinguish the two.

### One argument to expect, and to refuse on its merits

Three of the four writers of record — `@cantoo/pdf-lib` field creation,
`@signpdf` — consume and produce whole byte images (`engineSeam.ts`), and
someone will conclude that this forces images through the pipe.

**It does not.** Whether those JavaScript writers run in the engine host *at all*
is undecided, and invariant 25's argument is about **native** memory-safety bugs.
A byte-image writer running in main needs no pipe crossing whatever.

**Do not let that widen the frame maximum without its own decision.** The
maximum is a required, undefaulted argument precisely so that widening it is a
visible act at a named call site rather than a constant somebody edits.

## Correction, 2026-08-22 — `hostFixture.mjs` no longer exists (finding WW-1)

§1 above names `hostFixture.mjs` as the instrument that had the host call
`SetTokenInformation` on its own token, and that remains an accurate statement
about what that file did. **The file has been deleted**, so it is history rather
than somewhere to go and look.

The reason is this ADR's own §1. Deciding that the LowBox token is Low at
creation withdrew the mechanism the fixture's variant matrix was switching, on a
process type ADR-0022 had already withdrawn — so the instrument named *one
realistic engine host* was the one that had stopped being realistic, and two
instruments measuring two process types breaks RR-2's premise that every
containment conclusion comes from one.

It was **consolidated rather than repaired**: the per-property variant matrix,
the four-state outcome classifier and the removed-contained-reading control moved
into `scripts/research/lowboxSpike.mjs`, which creates the process the shipped
way. That file is now the only containment instrument, and it is the one §6
(RR-3) turns into a proof. One reading did not survive the move and is printed
where it would have been: **(b) memory**, because the fixture measured it against
a 512 MB literal and §2 of this ADR makes the shipped limit a derivation — so the
measurement belongs with the derivation, at RR-3.

Left as written above, because what this ADR said at the time is the record.

## Re-verification, 2026-08-22 — §1's reading, taken again on a fully lit instrument (EEE-1)

§1 withdrew finding PP-6's handshake on one measurement: the LowBox token is
**Low at creation**, read by main while the process is still suspended. BBB-1
then established that both contained cells of `scripts/research/lowboxSpike.mjs`
had been **dark from `56f77f7` onward** — the commit that introduced §1's own
ordering probe. §1's evidence was taken inside that window.

**The argument that the reading survived was sound and was not sufficient.**
`integrityBeforeResume` is read by main from the parent process, not reported by
the host, so it sits outside the blinded set — and *plausible* is the wrong
standard for a measurement that deleted a designed guard. QQ-2's discipline
applies to this project's own record: a conclusion about the host is only about
the host if it was measured on a host that was not partly dark at the time.

**Re-run on the repaired instrument, 2026-08-22.** All four `CreateProcessW`
cells completed their full probe chain — every probe reported and every report
was written, so no cell was dark — and the table printed **zero unreadable
rows**, exiting 0:

| cell | LowBox | job | `integrityBeforeResume` |
|---|---|---|---|
| `route` | no | yes | `0x2000` (Medium) |
| `route-no-job` | no | no | `0x2000` (Medium) |
| `lowbox` | **yes** | yes | **`0x1000` (Low)** |
| `lowbox-no-job` | **yes** | no | **`0x1000` (Low)** |

§1's reading reproduces, and the job axis WW-1 added strengthens it beyond a
re-run: the value is **identical in both contained cells regardless of the
job**, which is what a property of the token at creation looks like and is not
what a property of anything applied afterwards would look like. The withdrawal
of PP-6's handshake for this window stands.

**ADR-0022 was never exposed to this, and the order is worth stating so nobody
reconstructs it.** Its evidence came from `36caf21`; ADR-0022 itself is
`9741cc3`; the blinding arrived in `56f77f7`. So the decision rests on a
measurement taken **two commits before** the blinding, and the ADR was written
one commit before it.

## Decision 8 — a failed job assignment kills the process, never a host running with two of three (EEE-2, decided 2026-08-22)

**The measurement that forces this.** WW-1's per-property variant matrix
separated two mechanisms that had always been applied together, and the result
was not what the surrounding prose assumed:

| row | contained cell | uncontained cell | verdict |
|---|---|---|---|
| (b) process creation — job alone | `route` refused | `route-no-job` spawned | **differs** |
| (b) process creation — LowBox alone | `lowbox-no-job` spawned | `route-no-job` spawned | **same** |

**Invariant 25(b) is delivered by the job object, not by the AppContainer.** A
LowBox host with no job of ours creates child processes without difficulty.
Nothing had claimed otherwise, and nothing had separated them either — which is
the union problem the matrix exists to break.

### The state this makes representable, and it looks contained

A host created with the container applied and `AssignProcessToJobObject`
**failed** has (c) *no network* and (d) *no filesystem beyond what it was
handed*, and does **not** have (b). It is a partly contained host, and every
cheap way of asking "is this contained?" answers yes:

- the token is a LowBox token — Low at creation, per §1;
- `classifyContainment` in `packages/kernel/src/host/containment.ts` measures
  **(d)**, by probing reads. It says nothing about (b) and cannot: a host free to
  create processes still fails every filesystem probe exactly as a fully
  contained one does.

So the containment verdict and the job are **different mechanisms and neither
implies the other**, which is worth stating because the verdict's name invites
the opposite reading.

### The requirement

**If the job assignment does not take, the process is terminated. It is never
resumed.**

The ordering already in §1 makes this nearly free rather than a new mechanism:
the factory creates the process `CREATE_SUSPENDED`, assigns the job, and only
then calls `ResumeThread`. At the moment the assignment fails, the host has
executed **no instruction**. Terminating there is the natural branch; resuming
is the mistake, and it is the kind of mistake that produces a running host whose
own startup probe will confirm it is contained.

**Membership is verified, not inferred from a return value.** The factory checks
`IsProcessInJob` rather than trusting `AssignProcessToJobObject`'s boolean —
`scripts/research/lowboxSpike.mjs` already reads exactly this as
`inJobBeforeResume`, so the mechanism exists and has been exercised on every
cell of every run. A call that returned success while the process is not in the
job is the `available: true` shape at the kernel boundary.

**Two of three is not a degraded mode, it is a failure.** There is no
configuration in which a host runs with containment partially applied: invariant
25 is a conjunction, and a host that satisfies part of it is a host whose
compromise is contained in some directions and not others — which is worse than
an obvious failure, because it reports as healthy.

### Why this is written now rather than when someone meets it

The spike already carries the cell that demonstrates it. `lowbox-no-job` is not
a hypothetical: it is a real process, created the shipped way with the container
applied and no job, and it spawns children freely on every run. A requirement
whose counterexample is already running in an instrument is one to record before
the code that would violate it is written, not after.
