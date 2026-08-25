# ADR-0024 — Execution mode is a placement axis, and `packages/nodemode` is the Node-mode side

**Date:** 2026-08-25
**Status:** accepted
**Amends:** `docs/ARCHITECTURE.md` §2 (the repository map) and §9 invariant 26.
**Supersedes nothing.** [ADR-0022](0022-the-engine-host-is-a-process-we-create.md)
placed the engine host body and stays correct; this generalises the axis it used
without moving anything it decided.

---

## The decision

**Where a module lives is decided by two questions, not one: what it is about,
and which runtime mode it executes in.** The repository map classifies by the
first. This adds the second as a stated axis, and names which side each mode
falls on:

| the module runs | it lives |
|---|---|
| inside Electron, with Electron's APIs available | `apps/desktop/` |
| in Node mode — the Electron binary may be the runtime, but Electron's APIs are absent | **outside `apps/desktop/`**, and if it is not about the document engine, in `packages/nodemode` |
| under `node` directly, as tooling | `scripts/` |

`packages/nodemode` is a sixth package for **modules that run in Node mode and
are not the headless document engine**. It is not in `MAY_IMPORT_ELECTRON`, so
naming the `electron` specifier there is a red build by all four routes
`patternsFor` covers, and TypeScript project references reject it independently.

**Harness and probe files are in scope**, by the same test as everything else —
which side of the table they execute on, not that they are harnesses. A harness
that runs inside Electron belongs in `apps/desktop/`; its worker half does not.
Stated because the alternative is that the first exception gets argued
individually, and this repository already knows how a proxy acquires residents.

---

## Why now: the measurement

Invariant 26 already says the `apps/desktop/src/` exemption is a **proxy** for
*runs inside Electron*, and records three failures of that proxy. The engine
host's reader is a `worker_threads` Worker inside the Electron main process, and
nobody had asked which mode such a thread runs in.

Measured 2026-08-25 by `scripts/research/workerMode.mjs`, driving a harness under
the pinned Electron binary:

| | main | worker thread |
|---|---|---|
| `process.type` | `"browser"` | **`undefined`** |
| `process.versions.electron` | 43.4.1 | **43.4.1** |
| `import('electron')` | a module | **a module** |
| the module carries `app` | **yes** | **no** |

Main's row is the control and is not decoration: without it, *the worker could
not* is indistinguishable from *this harness cannot import Electron at all* —
refusal and impossibility producing one observation.

**A worker thread is Node mode, and this is the fourth failure of the proxy —
the quietest of the four.** The other three broke at the import. This one
*succeeds*: a file under `apps/desktop/src/` that imports `electron` and runs in
a worker receives an object, not an error, and fails later at the first property
access, where nothing points back at the import. The runtime is the Electron
binary while the APIs are absent, which is exactly the pair a directory-shaped
proxy cannot express.

The claim carries an expiry no document can enforce — whether a worker sees
Electron's module is a property of the **runtime**, and a version bump is the
event that would change it in silence. `proof:workermode` runs on Windows, where
this decision applies; on Linux Electron needs a display server and hangs without
one rather than failing, so a decline there is legitimate.

---

## Why the axis rather than the instance

A decision saying *the pipe reader lives in X* is one the next Node-mode module
re-litigates. The map today classifies by what a package is **about** — document
engine, wire contract, UI, shell, fixtures — and this is the first module where
subject and execution mode **disagree**: it is Win32 pipe plumbing for the
desktop shell, and it executes where the shell's API surface does not exist.

Naming the axis is what makes the next case decidable without a fifth clause,
and invariant 26's own history is the argument: three occurrences were already
enough for that document to say *name the axis rather than add a clause*, and it
then answered its third case by moving one file. This finishes the sentence it
started.

---

## Rejected alternatives

### `packages/kernel` — the right mode, the wrong subject

ADR-0022 put the engine host body there and that placement is untouched. Its two
reasons come apart here.

The first is **B5**: the kernel already fails lint on the `electron` specifier.
That is satisfied by *any* package outside `apps/desktop/`, so it does not
select the kernel.

The second is what actually chose it — ADR-0022's words: the host *"is also where
it belongs on the existing map — the kernel is the headless document engine and
holds the engine adapters."* That holds for the host's protocol loop. It does not
hold for a koffi `ReadFile` loop over a named pipe, which is about a transport
and not about documents. **Following a precedent means following its reasoning,
and the reasoning points away.**

The cost is not aesthetic. `CLAUDE.md` states the kernel's Electron-free property
as making *"the whole document pipeline unit-testable in milliseconds"*, and that
**a test that must fake a platform just to exercise it is evidence the boundary
is wrong**. A Win32 reader in `packages/kernel` puts a module in that package
which cannot be exercised without Windows, and every future reader of the
kernel's dependency surface then has to establish that the platform requirement
is confined to one file. That is the boundary decaying by one reasonable-looking
exception, which is the failure this project exists to prevent.

**An argument NOT used, recorded so it is not reached for later:** that the
kernel "imports only shared and contract" and therefore may not bind koffi. That
rule governs **internal package imports**. koffi is a root dependency, and the
kernel already declares a native one — `mupdf` is its only dependency. The
dependency rule does not forbid native bindings in the kernel and will not carry
the argument.

### `apps/desktop/src/` — the right subject, the wrong mode

The four-row table above, measured. The module would sit in the one directory
exempted from the Electron-import ban while running where that ban's hazard is
live, and the failure mode is the silent one: an import that succeeds and yields
an object with nothing on it.

This is already true of a file in the tree — `workerModeHarnessWorker.ts`, added
by the very range that took this measurement, imports no Electron and so breaks
nothing, **which is exactly why it would have stayed** (finding DDDD-9). It moves
with this amendment.

### A fourth clause on the exemption

ADR-0022 refused this shape for the third case and the refusal generalises: *"this
case is answered by placement, not by a fourth clause"*. A clause saying *except
worker threads* is a rule somebody has to recall at the moment of composing an
import, and `MAY_IMPORT_ELECTRON` is an exception list — a fourth entry widens
the exemption rather than narrowing it. Placement makes the specifier a red
build with no rule to remember (B5).

### One package per execution context

Rejected as premature. Two Node-mode contexts exist today — a worker thread and
an `ELECTRON_RUN_AS_NODE` process — and they differ in how they are started, not
in what they may name. Splitting on a distinction no enforcer reads would be
structure ahead of a need, and the map can split later without moving what this
places.

---

## What it costs, stated rather than assumed

Small, and worth saying plainly rather than implying it is free:

- one entry in `PACKAGES`, `ALLOWED_IMPORTS` and `PACKAGE_DIR` in
  `eslint.config.js`. `boundaries.proof.mjs` **generates** its cases from that
  table, so enforcement widens on its own — this is the registry pattern
  collecting on the promise it was built for;
- a `tsconfig.json` and a project reference;
- a build line.

Its allowed imports are `shared` and `contract` — the same as the kernel's, and
for the same reason: a Node-mode module that could reach `ui` or `desktop` could
reach Electron transitively, which is the property the placement exists to make
unrepresentable.

Nothing in `apps/desktop/` moves except the harness worker. **The factory that
spawns a worker stays in `apps/desktop/`**, where Electron is the API surface and
the code genuinely runs inside it — the same split ADR-0022 drew for the host.

---

## What this does not change

- **The engine host body stays in `packages/kernel`.** ARCHITECTURE §2 and
  §9.26 say so and remain true. The host is the document engine's protocol loop;
  its subject and its mode agree on the kernel, and this amendment moves nothing
  whose two answers already agree.
- **Invariant 26's rule is unchanged.** Plain Node still never loads Electron.
  What changes is that the document now states where Node-mode code *goes*,
  rather than answering each occurrence by moving one file.
- **`scripts/` is unaffected.** Tooling `node` starts directly is already
  covered, by the same rule and by two enforcers.

---

## Correction, 2026-08-25 — the cost was read off a file rather than paid, and it was wrong twice

The section above lists what the package costs: *one entry in `PACKAGES`,
`ALLOWED_IMPORTS` and `PACKAGE_DIR`*, a tsconfig, a build line. That was written
by reading `eslint.config.js` before building anything, and it went into a
document that reads like a statement of fact. It is corrected here rather than
edited above, and the audit that recorded it as **asserted** is what made the gap
visible.

**Wrong in two directions.**

Larger, in two places the estimate missed:

- **Four tables in `eslint.config.js`, not three.** `PACKAGE_GLOB` is a fourth,
  and the `PackageName` union is a fifth edit — it is a union rather than
  `string` on purpose, so a package added to `PACKAGES` and not to the union is
  a type error rather than a silent gap. Missing that from an estimate is
  harmless; missing it from the change would not have been.
- **A new workspace needs `npm install`,** which writes `package-lock.json`. The
  build fails with `TS2307: Cannot find module '@monstera/nodemode'` until the
  workspace link exists, and that is the correct failure — it just is not free,
  and `check:lockfile` has an opinion about the result.

Smaller in one:

- **There is no build line.** `npm run build` is `npm run typecheck && npm run
  build:preload`, and the typecheck is `tsc --build` over the root's project
  references. Adding the reference *is* adding the build. The vitest aliases are
  derived from the workspace globs too, so the package cannot silently resolve to
  a stale `dist`.

**And the claim that enforcement widens on its own is measured rather than
estimated: 148 boundary cases became 202**, all generated from `ALLOWED_IMPORTS`,
with no case written by hand. That is the registry pattern collecting on what it
was built for, and it is the one part of the estimate that was worth stating
before the work.
