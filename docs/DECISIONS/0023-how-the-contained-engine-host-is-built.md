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

## Correction, 2026-08-23 — the container's refusal of process creation is BUILD-DEPENDENT, and Decision 8 is stronger for it

WW-1's matrix established that invariant 25(b) is delivered by the **job** and
not by the container, measured on the developing machine: a contained host with
no job of ours spawned a process without difficulty. Decision 8 rests on that —
a host with the container applied and the assignment failed looks contained and
is not, so a failed assignment must kill the process.

**On `windows-latest` it does not spawn.** The first CI run that reached the
cells reported the contained no-job cell **refused `EPERM`**, where this machine
allows it. So the AppContainer denies process creation on that Windows build and
not on Windows 11, and WW-1's reading was true of one environment rather than of
AppContainers.

**Decision 8 does not weaken; it gets a better argument.** It rests on *the
container cannot be relied upon for (b)*, and a mechanism present on some builds
and absent on others is precisely something you cannot rely on — which is a
stronger statement than *it is absent*, because a reader cannot dismiss it by
testing one machine. Nothing about the requirement changes: read
`IsProcessInJob`, terminate on anything but `in-job`, never resume a host with
two of three.

**What changes is what the proof asserts.** That row expected `same`. It now
expects `either` and asserts the half that is invariant — the UNCONTAINED cell
must still be able to spawn, which is what makes the neighbouring row's refusal
attributable to the job. Without that half a row expecting `either` would be
satisfied by two dead cells.

Recorded as a **coverage reduction** under audit item 2a: one direction less is
asserted than before, deliberately, because asserting either direction would
assert something untrue somewhere. It is also the first fact this project has
learned about containment that its own developing machine could not have
produced.

## Note, 2026-08-23 — §6 is discharged, and the transition happened IN PLACE (finding RR-3)

§6 says `scripts/research/` asserts nothing and gates nothing, on purpose, and
describes what becomes a proof. That has now happened, and the file did not
move.

**What it asserts.** Thirteen cases: three that the uncontained host is a
working host, nine property rows each carrying the verdict the invariant
requires, and the absence control. Every cell is created by the shipped surface.
Registered as `proof:hostcontainment`, invoked by the shim job with
`--require-containment`, which turns could-not-look into a hard failure on the
one job that provisions everything — Windows, MuPDF, Electron, and now the
compiled TypeScript that puts the surface on disk. That step is what discharges
finding TT-1.

**Two of the nine expect `same`, and that is the substance rather than a
concession.** The LowBox alone does not deliver process creation — WW-1's matrix
established the job does — so asserting a difference there would assert a
containment this design does not have. The engine and the document must work
INSIDE the container, so `same` is the property and a difference means the host
cannot do its job.

**Why the path did not change.** `check:docs` requires every `scripts/` path
named in a tracked document to resolve, and this file is named by
`docs/JOURNAL.md` and by two ADRs — records, which take appended corrections and
are never edited. Moving it would have forced a choice between a red check and
editing records, to buy a tidier directory. A file's behaviour is cheap to
change and its identity is not, because identity is what records point at.

So the sentence at the top of §6 is now false of this one file, and this note is
the correction rather than an edit to it. `scripts/research/` still means *does
not gate* for everything else in it; the exception is named here and in the
file's own header, which is a live specification and says so directly.

**What §6 asked for and did not get: nothing.** The four properties are
differentials against a cell that removes only their own mechanism; the control
travels; `unreadable` stays terminal; UNVERIFIABLE is never `passed`; the ACL
absence check keeps its post-grant positive control.

## Correction, 2026-08-23 — the `baseline` cell is gone, and §1's evidence block quotes a row that no longer exists (finding RR-3)

§1's fenced reading above ends with a `baseline (no job from us)` row, and the
paragraph under it explains that the forked cell separates the ordering from the
container. **That cell has been removed from `scripts/research/lowboxSpike.mjs`.**
The block stays as written, because it is what was measured on the day; this
records what changed and re-states the reading from the cells that remain.

**Why it went.** §6 asks the proof to carry a control on the creation route. The
control it inherited was a differential against a process forked by
`utilityProcess.fork`, and **ADR-0022 decided the hosts are processes this
application creates** — so the reference is a process type nobody builds, and
agreement with it establishes nothing about ours. A differential against a
retired reference is a proxy whose referent is gone.

It was also expensive in a way that had already cost two runs. A forked cell
needs an Electron **app**, and that app started a GPU process which crash-looped
and killed whole runs before any verdict printed (finding LLL-1). The parent is
plain Node now, launched as the Electron binary under `ELECTRON_RUN_AS_NODE` by
path — the same way every cell runs.

**What replaced it, and it is not a comparison.** The uncontained `route` cell
must be observed **loading koffi, loading the shim, and opening the document it
was handed** on every run. If it cannot, the instrument prints `HOST NOT WORKING`
and offers no property verdict at all: a refusal measured against a host that
does not work is a broken run, not containment. `unreadable` remains terminal.

**§1's reading is unaffected and is now single-variable.** It never depended on
the forked row — the row was labelled *not the attribution* every time it
printed, because it changed the creation route as well. The pair that carries it
is `route` against `route-no-job`, same creation route on both sides, differing
only in the job. Measured again 2026-08-23, with the cell removed:

```
route        (our route, job)      refused   spawn UNKNOWN
route-no-job (our route, NO job)   allowed   spawned before doing anything else

route         {"assigned":true,"inJobBeforeResume":true,"previousSuspendCount":1}
route-no-job  {"assigned":"NO JOB (variant)","previousSuspendCount":1}
```

**Every property verdict in the table is byte-identical to the run taken
immediately before the removal**, which is the evidence that the fifth cell was
carrying nothing the same-route pairs did not already carry.

**The loss, stated rather than left implicit** (audit item 2a). A differential
can catch an **unanticipated** difference between two creation routes; a
working-host check catches only the three things it names. If our route broke
something that is neither koffi, nor the shim, nor opening a document — an
inherited handle, a console mode, an environment variable a future probe comes to
depend on — the forked cell would have shown it as a disagreement and this will
not. That is a genuine reduction in what the instrument can see, taken
deliberately, and the thing it cost was a reference this project no longer
builds.

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

## Correction, 2026-08-24 — §4's DACL sentence is necessary and NOT sufficient

§4 says the transport is *"a named pipe created by main with the container SID
in its DACL."* Every word of that is still true and it is not a specification: a
pipe built to that sentence alone **refuses the contained host**. Measured on
this machine, in one run of `scripts/research/lowboxSpike.mjs`, on a pipe
differing from the working one only in its descriptor:

| DACL | the contained cell |
|---|---|
| `D:(A;;GA;;;<container>)` | **refused, EPERM** |
| `D:(A;;GA;;;BU)(A;;GA;;;<container>)` | allowed |
| `D:(A;;GA;;;<user>)(A;;GA;;;<container>)` | allowed — **the shipped spelling** |

An AppContainer token's access check is **conjunctive**: the DACL must grant the
requested access to the token's ordinary identity — its user, or a group it is
in — *and* to the package SID. The container's ACE satisfies half of a two-part
test. What Built-in Users was doing in the spike's other pipes was standing in
for the identity half by accident, and the sentence above was written from a run
in which it was present.

Two further readings, from the same run, because they close a design that had
already been written down here:

- **Instance 0 of a named pipe is not access-checked; every later instance is.**
  `CreateNamedPipeW` for instance 0 creates the object. Instance 1 opens the
  existing object by name, and with `PIPE_ACCESS_DUPLEX` it asks for read and
  write — the same rights a client's `CreateFileW` asks for. So a descriptor
  that does not grant main denies main its own second instance
  (`GetLastError 5`), and `FILE_CREATE_PIPE_INSTANCE` alone is not enough
  (`0x00000004` for `OWNER RIGHTS`: also `GetLastError 5`).
- **Same-user exclusion is therefore not a boundary this DACL can draw.** There
  is no ACE that admits the container and excludes other processes of the user
  running it, because admitting the container requires admitting that identity.
  A one-instance pipe was tried as the way around it — no second creation, so no
  access check against main — and it fails for the same conjunctive reason.

None of this weakens the decision. Invariant 25 contains the *engine*; it does
not defend against the user's own processes, and it never claimed to. What the
correction removes is a *tighter* claim the original sentence invited a reader
to make. The shipped spelling is this user plus the container, and what it buys
over `Built-in Users` is **other users of the machine** — which a single-account
runner cannot measure, and which is stated here rather than recorded as
measured.

The row `IPC — Win32 pipe, the SHIPPED DACL` builds that exact descriptor on
every run of the spike, so the day it stops admitting the container is a red
rather than a discovery during integration.

## Correction, 2026-08-24 — "handed to Node" cannot be done, and the limit is the CRT

§4 also says the pipe is *"created through Win32 with an explicit security
descriptor and handed to Node, not created by Node."* The first half is measured
and stands. **The second half is not achievable from this process**, and every
reading this ADR was written from was an access check at a *client's* open — the
spike created pipe instances and never accepted a connection or carried a byte
over the server half, so *handed to Node* was an inference about the half that
does the work.

Measured, in the run that added `echoWin32` and its control:

| | |
|---|---|
| a pipe **Node** created, same client code | echoed — the control |
| a pipe `CreateNamedPipeW` created, adopted via `_open_osfhandle` | `Unsupported fd type: UNKNOWN` |

That message is what `net.Socket({ fd })` says both for a handle it cannot drive
and for a descriptor that resolves to nothing, so it was not an answer. Two more
readings separated them:

- `_get_osfhandle(3)` in `ucrtbase.dll` returns a handle whose `GetFileType` is
  `FILE_TYPE_PIPE`. The descriptor is sound in the runtime that created it.
- `fstatSync(3)` — node's own C runtime — answers **`EBADF`** for the same
  number.

The descriptor tables are not shared: `node.exe` links its CRT statically, so an
fd minted by any DLL an FFI can reach is meaningless to it. **No handle this
process obtains through an FFI can become an fd node will accept.** The limit is
the CRT and it has nothing to do with pipes, which is why no other pipe flag,
descriptor or instance count would move it.

So the transport's server half belongs to the surface: it owns the overlapped
reads and writes and feeds bytes to `createHostRuntime`. **The architecture
already had this shape and only this ADR's wording did not** — `HostRuntimeTransport`
takes `write(frame)` and the loop takes `receive(chunk)`, deliberately, so that
"a test that must fake a window bridge is evidence the boundary is wrong" applies
to sockets too. What changes is the surface's size, not the seam.

The rejected alternative in this ADR's own list — *creating the pipe with Node
and adjusting its DACL afterwards* — is **not** revived by this. It was rejected
for a window in which the pipe exists with the wrong descriptor, and that window
is unaffected by anything above.

`echoWin32`'s assertion pins the negative result **and its mechanism**: outcome
`error` and a detail naming `EBADF`. A change in either is a red, because a
message-only pin would survive the mechanism moving underneath it.

## Correction, 2026-08-25 — the DACL's first spelling let the host rewrite the DACL

The descriptor the corrections above settled on was
`D:(A;;GA;;;<user>)(A;;GA;;;<container>)`, and `GA` is wrong for the container.
`GENERIC_ALL` maps to `FILE_ALL_ACCESS`, which carries
`STANDARD_RIGHTS_REQUIRED` — so it granted **`WRITE_DAC`** and
**`FILE_CREATE_PIPE_INSTANCE`** to the principal invariant 25 declares *contains
a compromise*, on the object §4 calls a trust boundary.

**Demonstrated in the run that fixed it**, not argued: on the spike's pipe that
still carries `GA`, the contained cell opens it for `WRITE_DAC` and succeeds.

The shipped masks are now:

| principal | mask | what it is |
|---|---|---|
| this user | `0x0012019F` | `FILE_GENERIC_READ｜FILE_GENERIC_WRITE` |
| the container | `0x0012019B` | the same, **minus `0x4`** |

Four readings, all from the shipped factory rather than from a copy:

- The contained cell **still connects** under `0x0012019B`, so the conjunctive
  check does not consume any right the narrowing removed. That was the open
  question and it resolved in the tightening's favour.
- The contained cell is **refused `WRITE_DAC`, error 5**, on the shipped pipe.
- The creator **needs `0x4`**: at `0x0012019B` for both principals, instance 1
  fails with `GetLastError 5` and the factory reports the stage. Instance 0
  creates the object and is not access checked; every later one asks for read
  and write on the existing object, and `0x4` is part of what
  `PIPE_ACCESS_DUPLEX` asks for.
- The **owner** is allowed `WRITE_DAC` on the shipped pipe even though its mask
  does not contain it. An object's owner holds `READ_CONTROL` and `WRITE_DAC`
  implicitly. That cannot be narrowed and does not need to be: same-user was
  already established above as a boundary this descriptor cannot draw.

The masks are numeric because SDDL's file mnemonics cannot express the one that
matters — `FW` (`FILE_GENERIC_WRITE`) includes `0x4`, so `FRFW` for the
container would grant instance creation back.

**What this correction does not claim.** That `WRITE_DAC` is the only right worth
removing, or that `FILE_GENERIC_READ｜FILE_GENERIC_WRITE` is minimal for a host
that only reads and writes framed messages. It is the mask a Node client's
`GENERIC_READ｜GENERIC_WRITE` open requires, and narrowing below it would refuse
the host for a reason unrelated to the threat. A host that opened the pipe with
an explicit mask could go tighter; that is a change to both ends and is not made
here.

## Addition, 2026-08-25 — the reader is a worker thread, and it stops by waking

The correction above leaves the surface owning the reads and writes. **How** it
owns them is decided here, because the property that decides it is one neither
candidate's description covered.

`HostRuntimeTransport` declares `terminate(reason)` as a first-class operation,
deliberately separate from `write`, and Decision 8 kills the host rather than
resuming it. So the transport must come down cleanly **at an arbitrary moment**,
and termination is the half that cannot be retrofitted: a transport that carries
bytes correctly and cannot be torn down has to be rewritten, and by then there is
a runtime loop on top of it.

**Rejected: overlapped I/O polled from main.** A poll loop in the process that
must stay responsive is a latency floor on every frame, paid whether or not
anything is in flight. No measurement is needed to see that.

**Decided: a worker thread that waits over the operation's completion event AND a
stop event.** Not a thread blocking inside `ReadFile` — unwedging one of those
means `CancelIoEx` from another thread, or closing the handle underneath it, and
both are teardown that works on one machine and hangs on another.
`WaitForMultipleObjects` over the two turns a stop into a wait returning, so
nothing is ever interrupted mid-syscall.

`FILE_FLAG_OVERLAPPED` on `CreateNamedPipeW` follows from that, and is in the
shipped surface for this reason rather than for throughput.

Measured by `scripts/research/transportTeardown.mjs`, on the shipped pipe, seven
cases on the Windows containment jobs:

| the reader is | it exited after the signal |
|---|---|
| waiting for a client | **10ms**, code 0 |
| waiting for bytes | **7ms**, code 0 |

**And the rejected shape was measured too**, by mutating the wait to one handle —
which is exactly what blocking in `ReadFile` amounts to. Both cells wedge: the
budget expires with the thread alive and the exit code is `null`, at 2010ms and
2015ms. So the second handle is not defensive; it is the whole difference.

Three further facts the probe settled, each of which would have changed the
adapter:

- **A reader has TWO waits, not one.** The probe's first version issued
  `ReadFile` straight away and got `ERROR_PIPE_LISTENING`: a server instance
  cannot be read before a client connects. The wait for a client is where a
  `terminate()` most often lands — a host that never connects is precisely what
  Decision 8 kills for — so a design stoppable only in the second wait would be
  stoppable only in the case that does not matter.
- **Handles cross to a worker as addresses.** Worker threads share the process
  handle table, and `postMessage` carries structured-cloneable data rather than
  koffi pointers, so the handle travels as a numeric address. Had that failed,
  the pipe would have to be created inside the worker, which moves where
  `createHostPipe` is called.
- The stop event is **manual-reset**, because a stop is permanent: an auto-reset
  event consumed by one waiter would leave a second reader waiting on a
  transport that has already been told to stop.

### Correction to the above, 2026-08-25 — the millisecond figures are one machine's

The table reads *"seven cases on the Windows containment jobs"* and then gives
`10ms` and `7ms`. Both halves are true and the sentence they form is not.

The containment jobs assert a **bound** — that the reader exits within 2000ms and
with code 0 — and that is all this project can read from them without owner
authentication, because a job's log is not public and only its step conclusions
are. **The figures are the developing machine's**, and they move run to run: 10ms
and 7ms, 14ms and 8ms, 4ms and 4ms across the runs taken that day.

So the correct statement is: the design is asserted on three Windows builds and
**timed on one**. The one-handle mutation's 2010ms and 2015ms are the same — this
machine, and against a 2000ms budget, which is where those two numbers come from
rather than from the failure taking exactly that long.

Nothing about the decision changes. What changes is that a reader could have
taken the table as evidence that the containment images exit in single-digit
milliseconds, which nothing here has measured. Recorded under finding CCCC-1
because the shape is the one item 7 names: a compound claim whose live clause
vouches for the dead one beside it, written an hour after the measurement it
describes.

### Addition, 2026-08-25 — a waiting reader cannot be told anything, so writes do not travel by message

The reader thread blocks in `WaitForMultipleObjects`, which means it is not
running JavaScript. **A message sent to it while it waits is not delivered until
the wait returns** — measured, and with the control that makes the silence mean
something:

| the reader is | a message sent to it |
|---|---|
| idle in its own event loop, before any Win32 call | acknowledged |
| inside either wait | **nothing within 750ms** |

The acknowledgement for the second one does arrive — after the stop event fires
and the wait returns. So the port is not broken and the message is not lost; it
is queued behind a thread that cannot run.

**This rules out the simplest write path.** `postMessage` into the reader would
mean frames sit in a queue until something unrelated wakes it, which is the
opposite of what a transport owes its caller. The write side therefore needs a
mechanism that does not require the reader to run JavaScript, and the candidates
are: a **third handle** the same thread also waits on, with the frame in shared
memory; a **second thread** for writes; or **main issuing overlapped writes
itself** and reaping completions when it next has business rather than on a
timer. That choice is not made here.

Two further facts, both found by the probe rather than by reasoning:

- **A worker holding a `parentPort` message listener does not exit.** The
  listener is an active handle in its event loop, so a reader that registers one
  outlives its Win32 work. Measured by adding the acknowledgement listener: the
  connect cell's worker then outlived its 2000ms budget with everything else
  unchanged, and the probe reported a wedged reader that was not wedged. The
  shipped reader must `unref` its port or end explicitly.
- **`OVERLAPPED.hEvent` is the fourth pointer-sized field, at offset 3.** The
  probe had it at offset 4, so `hEvent` was NULL and the kernel signalled the
  file handle instead of an event. The read cell passed anyway for several runs,
  because the client happened to connect before `ConnectNamedPipe` was issued and
  the call returned `ERROR_PIPE_CONNECTED` without needing the event — the cell
  was being SET UP by a race. Adding the handshake moved the timing by a few
  milliseconds and it stopped reaching its wait at all. Its assertions had been
  about the stop event, which is a different handle and did work, which is why
  nothing showed.
