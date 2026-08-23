# ADR-0022 — The engine host is a process we create, not a utility process

- **Status:** Accepted
- **Date:** 2026-08-22
- **Amends:** `docs/ARCHITECTURE.md` §2 (process topology), §5 (the contract),
  §9.25 (invariant 25) and §9.26 (invariant 26).

## Context

Invariant 25 names four properties of every process that parses a document:
lowest workable integrity level, a job object bounding memory and process
creation, **no network access**, and **no filesystem path it was not handed**.

It landed before the components it constrains, and said why in its own text:

> The hosts do not exist yet, so this is policy before mechanism — deliberately,
> because it is a property of processes `DocumentService` will create, and
> fitting it underneath them afterwards is the retrofit this project exists to
> avoid.

Between 2026-08-20 and 2026-08-22 the four properties were measured on a real
host — koffi loaded, the MuPDF shim opened through it — rather than on the
options passed to `utilityProcess.fork`.

**(a) and (b) are obtained.** Integrity: main reads the child's token at
**0x2000 before and 0x1000 after**, two readings differing across one action,
which is the only shape that separates a working reader from one that always
says Low. The host cannot read its own token afterwards — `OpenProcessToken`
fails ACCESS_DENIED, because the process object's descriptor was created at
Medium — so the reading has to come from outside. Job object: under
`ActiveProcessLimit = 1` and a process memory limit the host cannot spawn and
cannot commit past it, where the same host with no job spawns `v43.4.1` and
allocates freely.

**(c) and (d) had no mechanism, and (d)'s only candidate fell.** Node's
permission model was that candidate. Measured in one process under one policy,
with the model active and `--allow-addons` granted: a JavaScript read outside the
allow-list is refused `ERR_ACCESS_DENIED`, and a **native** read of the same file
through `CreateFileW` returns 4,096 bytes beginning `MZ`. The dial has no setting
that works — without `--allow-addons` the host cannot load koffi and so cannot
reach MuPDF; with it, native code is outside the model by design. One end has no
engine, the other has no containment.

**The principle that came out of that, and it predicts rather than summarises:**

> **Only kernel-enforced mechanisms contain native code.**

A job object, an integrity level, a token, an AppContainer — the kernel checks
these on every access, whoever makes it. Node's permission model is enforced
inside Node's own filesystem bindings, so it constrains JavaScript and nothing
else. This is why the permission-model finding leaves (a) and (b) untouched while
it removes (d)'s only candidate, and it settles (c) with no further measurement:
the model has no network dimension and would be enforced in the same place if it
grew one. **Of any proposed containment mechanism, ask who enforces it before
asking what it denies.**

That leaves exactly one family of candidates for both remaining properties, which
is why they were priced by one spike and not two.

### What the spike measured

`scripts/research/lowboxSpike.mjs`, three cells, same host code, each neighbour
pair flipping exactly one thing — `baseline` forked by Electron, `route` created
by our own `CreateProcessW` with containment off, `lowbox` by the same call with
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`. The middle cell exists because a
LowBox process **cannot** be created by `utilityProcess.fork`, so the contained
cell otherwise differs from today's host in two ways at once, and a refusal in a
two-variable comparison is unattributable.

The route control passed on koffi, the shim and the document, so the lowbox
column is readable. Against `route`:

| property | lowbox | route | |
|---|---|---|---|
| (d) filesystem, JS | refused `EPERM` | read 6029 bytes | **differs** |
| (d) filesystem, native | refused `CreateFileW: error 5` | read 4096 bytes | **differs** |
| (c) network, loopback | refused `ETIMEDOUT` | connected | **differs** |
| engine | `mz_init` created a context | same | same |
| document it WAS handed | opened, 1 page | same | same |
| IPC over a named pipe | refused `EPERM` | connected | **differs** |

`error 5` is `ERROR_ACCESS_DENIED` **from `CreateFileW` itself** — the call the
permission model could not reach, refused by a kernel object. Loopback rather
than a remote host, so a refusal cannot be a runner with no network. And the
engine still runs inside the container: koffi loads, the shim loads, `mz_init`
creates a context, and a document the host was handed opens with the right page
count.

**Feasibility was the open question and it is closed.** What remains is
plumbing.

## Decision

### 1. The engine hosts are processes this application creates

`CreateProcessW` with an extended startup info carrying
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` and the container SID, running
`process.execPath` under `ELECTRON_RUN_AS_NODE=1` — the same runtime as today,
so nothing new ships.

**Now, rather than later, and the reason is invariant 25's own.** Deferring (c)
and (d) is not deferring an *assertion*; it is deferring the **process creation
route**, and the route is where the containment lives. This project defers
assertions routinely and well — ADR-0018's dead seam, ADR-0019's read-back
pinned before a renderer existed — but each of those defers proving something
about a shape already chosen. Taking the `utilityProcess` route now and the
LowBox route later means changing process creation underneath a working host,
its IPC, its lifetime handling and its crash path: the sentence quoted in the
Context above, arriving on schedule.

**The host has zero callers.** There has never been a cheaper moment and there
will not be another.

### 2. What is lost is plumbing, and it is named here so nobody re-litigates it

| given up | replaced by | is (a)–(d) affected? |
|---|---|---|
| `MessagePort` | a named pipe with the container in its DACL | no — and the pipe has to exist and be DACL'd **either way** once the host is contained, so this is a protocol we write, not a capability we lose |
| Chromium's job nesting | the job we already assign from main against the child's pid | no — that works on any child; nesting was a bonus and never the mechanism, and (b) was measured with our own job |
| Electron's child lifetime handling | `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, already in the limit flags | no — and it is **stronger**, because it survives main dying badly rather than only main exiting cleanly |

### 3. Why not the renderer, which already has all four

The sandboxed renderer is an AppContainer with no network, no filesystem and a
low integrity level, supplied and maintained by Chromium. It is the correct
answer to this question in every respect except the one that matters: **reaching
MuPDF there means WASM**, and ADR-0010 withdrew WASM on measurement, not on
taste. Its 2 GB cap is declared in the binary itself, it copies the whole file,
and the document it could not process at all is one native saves in 4.5 seconds.
A held document handle is the entire basis of the editing loop and is precisely
what WASM cannot keep.

So the renderer is unavailable for the engine, and the containment it has must be
obtained rather than borrowed.

### 4. The host protocol registers into the contract discipline; it does not sit beside it

**The pipe is a trust boundary, and the host is hostile by invariant 25's own
premise** — its stated threat is code execution inside the host. Everything
arriving over that pipe is attacker-controlled and the parser is ours.

That obligation is not new: it was identical with a `MessagePort`. What is new is
the **wire format** — a byte stream needs framing, and framing is where a
hostile peer gets its first move, before any schema is consulted.

§5 already states the discipline: `packages/contract` defines every channel
exactly once with a zod schema per params and result, and **all validation
happens once, in the generated boundary wrapper**, because hand-writing the same
channel in several places drifts silently and surfaces at runtime. The worker
protocol already has the same shape through one `defineWorkerContract` helper
shared by both hosts.

**The host protocol takes that discipline.** Whether it can literally reuse
`defineWorkerContract` — which today assumes a message-oriented transport, not a
byte stream — is a mechanism question and belongs to the ADR that follows this
one. What is decided *here* is that there will not be a second opinion about how
a wire boundary is validated (B3a). A framing layer beneath the contract is a
transport; a second validation discipline beside it is the defect.

### 5. Invariant 26 gets a third case, and it is answered by PLACEMENT rather than by a new rule

The host runs as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`. **In that mode
the process is Node**, so `require('electron')` resolves to
`node_modules/electron/index.js`, whose `module.exports` is `getElectronPath()`,
which downloads an unpinned binary through an `install.js` that reads
`electron_use_remote_checksums` and bypasses our pin. The import *is* the
download.

Invariant 26 exempts `apps/desktop/src/` on the grounds that it "runs inside the
Electron runtime, where the specifier is the API surface". That was already
corrected once — a module a `.test.ts` imports is executed by vitest in plain
Node — and this is its **third** occurrence. `eslint.config.js` states the axis
in its own comment: *"may import Electron" is a property of code that RUNS INSIDE
Electron, and package membership is only a proxy for that.*

So the fix is not a fourth clause on the exemption. **The host body lives in
`packages/kernel`, and does not live under `apps/desktop/src/`.**

- `MAY_IMPORT_ELECTRON = 'desktop'` is an exception list, so every other package
  — the kernel included — already fails lint on the specifier and its subpaths
  by all four routes `patternsFor` covers. TypeScript project references reject
  it independently, at compile time.
- That is B5 rather than B7: the host cannot name Electron, so no rule about
  when it may is needed, and no reasoning about runtime mode is required at the
  point of use.
- It is also where the host belongs on the existing map — the kernel is the
  headless document engine and holds the engine adapters, and it is `NEVER
  Electron` there for a reason that now has a second, sharper instance.

The **factory** that creates the process — container, ACLs, `CreateProcessW`,
job assignment — stays in `apps/desktop/`, because creating processes is the
shell's job, and it is injected into `DocumentService` rather than reached for.
The split is the same one §2 already draws: main owns the document, and the
kernel is what runs headless.

### 6. The costs, stated as measured rather than as accepted

1. **Five grants, of two kinds.** Read+execute for the container SID on the
   runtime, the FFI, the FFI's platform sibling and the engine shim; **modify**
   on what the host was handed, because a host that reports has to write where it
   was handed. Granted read+execute, it ran every probe and exited 97 — its own
   code for "could not write the report".

   **The consequence, and it is the one to carry:** those paths are now *part of
   the containment*. Anything that can write the FFI or the shim defeats it. That
   is a property of the installed tree, not of the host, and it is why this is
   listed as a cost rather than as configuration.

2. **`--preserve-symlinks` and `--preserve-symlinks-main`**, which change module
   resolution for the host. Without them it dies before its first line with
   `EPERM lstat 'C:\'`: Node realpaths the main path and every `require`,
   statting each ancestor by name, and a LowBox token passes an access check only
   where the DACL names the container or an application-package SID — so the
   user's own rights on the volume root do not count. Measured: `C:\Program
   Files` grants `ALL APPLICATION PACKAGES`; `C:\` and `C:\Users` grant it
   nothing.

3. **The pipe needs its own DACL.** Node's named-pipe server sets none for the
   container, so a contained host cannot connect to a pipe created with
   `net.createServer`. Measured: `EPERM` in the lowbox cell beside a connection
   in the route cell.

## Rejected alternatives

**Keep the utility process, ship (a) and (b), record (c) and (d) as priced and
deferred.** Cheapest today and the most expensive later: it is the retrofit
invariant 25 was written to prevent, performed on a host that by then has
callers, an IPC protocol and a crash path built on the route being replaced.
Rejected on ADR-0017's own sequencing reason.

**The Chromium renderer.** Has all four properties already. Rejected because
reaching MuPDF there means WASM, withdrawn on measurement in ADR-0010 — the 2 GB
cap, the whole-file copy, and the document it cannot process at all.

**Node's permission model.** Rejected on measurement: enforced inside Node's
filesystem bindings, so the native adversary invariant 25 names walks past it,
and the `--allow-addons` grant that lets koffi load is the grant that puts native
code outside the model by design.

**An ACE for the container on `C:\` instead of the resolution flags.** Rejected:
it needs administrator rights and would leave a permanent grant on the volume
root in order to run a sandbox — a containment mechanism whose installation step
widens the machine.

**A broker process with a policy engine.** This is the shape the "hand-rolled
sandboxes ship holes" objection is really about, and the objection is right about
it. Rejected, and named here so that what *is* being built stays legible by
contrast: a LowBox token, a container SID, five explicit grants and a job
object — no policy engine, no interception, no decisions taken at runtime about
what the host may do.

**The strongest case against this decision**, kept rather than paraphrased: the
Chromium utility process is battle-tested and a process we create is not. That is
true of the plumbing and false of the property. The utility process was measured
to supply **none** of (c) or (d) — so "battle-tested" applies to the parts being
replaced and not to the part being added.

## Consequences

- Invariant 25 stops being policy before mechanism. Every property has a
  mechanism and a measured differential, and `docs/FEATURES.md`'s row is now a
  specification of assertions rather than of candidates.
- `docs/security/engine-advisories.json`'s `engine-host-containment` trigger
  fires on `utilityProcess` in shipped code. **The engine hosts will no longer
  name it**, so that trigger must be re-pointed at the creation route this ADR
  chooses, or it becomes a check that can no longer see its subject — an
  instrument reporting the reassuring answer for the wrong reason. Owed to the
  mechanism ADR.
- The two-host topology in §2 is unchanged in shape: `mupdfHost` and
  `pdfiumHost`, both contained, both on the shared protocol. What changes is who
  creates them.
- Everything here is Windows-specific, which matches distribution being the
  Microsoft Store only (ADR-0018). A port would need this decision retaken, not
  translated.

## Correction, 2026-08-22 — `defineWorkerContract` does not exist (finding XX-1)

§4 above says *"the worker protocol already has the same shape through one
`defineWorkerContract` helper shared by both hosts"*, and goes on to weigh
whether the host protocol can *literally reuse* it. **No such helper is
implemented.** `BUILD-PROMPT.md` Part D and `docs/ARCHITECTURE.md` §5 both
describe it in the present tense, and this ADR took them at their word without
looking.

**The decision does not change**, and that is worth saying plainly rather than
leaving a reader to work out how much of §4 survives. What §4 decided is that
there will be no second opinion about how a wire boundary is validated (B3a),
and that stands on `packages/contract`'s discipline whatever the helper is
called. What was wrong was the *premise* that the discipline already had a
byte-stream-shaped vehicle to extend.

Left as written above, because what this ADR believed at the time is the record.
Recorded here because **an ADR whose reasoning cites a fact that is not one gets
read as evidence by whoever writes the next ADR** — which is exactly what
happened: ADR-0023 §4 instructed that the helper "is extended", and the first
person to build against that instruction had to discover there was nothing to
extend.

`docs/ARCHITECTURE.md` §5, being living law rather than a record, has had its
**body** corrected instead. `BUILD-PROMPT.md` is untouched — it is the immutable
founding record, and the architecture document superseding it is the document
table working rather than a problem.

## Correction, 2026-08-23 — the `baseline` cell this ADR describes no longer exists (finding RR-3)

*What the spike measured* above names `baseline`, forked by Electron, as the
first of three cells and as the route control. That is what was measured when
this decision was taken and it stays as written. **The cell has since been
removed from `scripts/research/lowboxSpike.mjs`**, and a reader following the
reference will find four cells, none of them forked.

**This decision is what removed it.** Deciding that the hosts are processes we
create made the fork route historical, and a control that establishes *our route
resembles the fork route* is then a differential against a reference nobody
builds. The control is now that the uncontained cell is observed doing host
things — koffi, the shim, and the document it was handed — with no property
verdict printed when it cannot. `docs/DECISIONS/0023-…` carries the full
correction, the re-measurement, and the loss that comes with it.

Recorded here rather than only there because this is the ADR whose text names
the cell, and a cross-reference that still resolves while the target says
something else is the failure finding UU-1 named: worse than a broken link,
because it announces nothing.
