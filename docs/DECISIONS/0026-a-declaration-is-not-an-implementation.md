# ADR-0026 — a declaration is not an implementation, and the kernel's public surface carries no native binding

**Status:** accepted, 2026-08-27
**Supersedes:** nothing. Amends `docs/ARCHITECTURE.md` §1 and §3.

## Context

Invariant 20 says native faults are uncatchable, and §2's process diagram puts
MuPDF in a process that is not `main` with **no in-main fallback**. §9.17 argues
`main`'s memory budget from *"main holds canonical bytes and never parses"*.

`main` loads the MuPDF native library at startup anyway.

**Measured, on this machine, peak RSS of a bare Node process after loading one
built kernel module** (`scripts/research/barrelCost.mjs`, re-read 2026-08-27):

| module | RSS | over bare |
|---|---|---|
| bare | 54.4 MB | — |
| `capabilityRegistry.js` | 56.4 MB | +2.0 MB |
| `documentService.js` | 62.8 MB | +8.4 MB |
| `commandBus.js` | 94.5 MB | **+40.1 MB** |
| `mupdfWriter.js` | 100.4 MB | **+46.0 MB** — the anchor; it binds the library at module scope |
| the barrel `index.js` | 96.1 MB | **+41.7 MB** |

A cell within a megabyte or two of the anchor has loaded the library too. Three
of these have.

### Three edges, and they are one cause

Read from source rather than inferred:

1. `commandBus.ts` imports `declaredSpecs` **as a value**, which reaches
   `rotatePages.ts` → `mupdfWriter.ts` → `import * as mupdf`.
2. `apps/desktop/src/documentCommands.ts` imports `declaredSpecs` as a value,
   independently of the bus.
3. `packages/kernel/src/index.ts` line 13 re-exports `mupdfWriter` as a value,
   so **loading the barrel at all** executes the adapter. `composition.ts`
   imports the barrel.

So `main` pays it by three separate routes, and closing any one leaves the other
two. That is Rule 0's *fix the class, not the instance* with a class that has
three members.

**The cause under all three is the same and it is a design fact, not an
oversight:** `declaredSpecs` bundles **what a command is** with **how it is
performed**. Every consumer that wants routing gets execution, because they are
properties of one object.

### What the consumers actually read

Every call site was read rather than assumed:

| call site | reads |
|---|---|
| `commandBus.ts:161` | `spec.writer` |
| `commandBus.ts:240` | `spec.writer` |
| `commandBus.ts:287` | `spec.replay`, at compile time |
| `documentCommands.ts:251` | `spec.writer` |

**Not one of them calls `apply`, `capture` or `invert`.** They have gone through
the registered writer since ADR-0023 Decision 10 moved them there. So the value
import buys routing and pays for execution, and has done since Decision 10
landed — the edge outlived the reason for it.

### Why this is a B4 amendment and not a refactor

Splitting the table is internal. Removing `mupdfWriter` from the barrel changes
`packages/kernel`'s **public surface**, which is §1's business: the map says what
each package is and what may import it, and *what the kernel exports* is the
shape every other package sees. `packages/kernel/package.json` exports exactly
one entry, `"."`, so a caller that legitimately needs the adapter has no way to
ask for it narrowly.

## Decision

**1. A declaration is not an implementation, and they are separate modules.**
`commandDeclarations.ts` holds what a command *is* — its writer of record, its
invertibility, its undo strategy, its reproducibility, its replay strategy. It
imports no implementation and therefore reaches no engine.
`commandSpecs.ts` composes that declaration with the functions, and is imported
only by the executor that runs them.

**One declaration, two layers — not two tables.** `commandSpecs.ts` builds each
entry by spreading its declaration and adding the functions, so a command is
still declared in exactly one place and a new kind that is declared and not
implemented does not compile. The file's own note that *"a second table would be
a second declaration; a second view of one table is not"* is the rule this
follows rather than an obstacle to it (B3).

**2. The kernel's public surface exports no value whose module graph binds a
native library.** The adapter is reached through an explicit subpath —
`@monstera/kernel/engine` — and only from the process that runs it. Importing
`@monstera/kernel` cannot load a native library, which is the property invariant
20 needs and could not previously state.

The subpath is not a loophole. It is the difference between a cost you take
deliberately and a cost that arrives through a barrel nobody read: the host's
entry names it, and every accidental route is gone because the barrel no longer
has one.

## Rejected alternatives

**Keep the barrel and tell callers to import narrowly.** This is the status quo
with a rule attached, and this repository already has the measurement of what
that is worth: the exposure reached `main`'s baseline through
`import { type X } from './documentCommands.js'`, whose emitted form is
`import {}` — **in a file whose own header documents that trap**, one commit
after it was written. A rule an author must recall at the moment of composing an
import is not a mechanism. It is also *seven for seven* on the escape-guard
rule's own record.

**A dynamic `import()` inside the barrel.** Hides the cost rather than removing
it: the library still loads, just later and at a moment nothing chose, which is
worse for a memory budget measured at startup and worse for diagnosing a load
failure. It would also make `mupdfWriter`'s export asynchronous for every
caller, in service of a problem the subpath solves synchronously.

**Split `packages/kernel` into two packages.** Bigger, and the boundary it draws
is the wrong one. ADR-0024 established that the axis that matters is **which
mode a module runs in**, not which directory or package it sits in, and the
adapter and the command declarations run in the *same* package and different
*processes*. A package split would encode the wrong axis and leave the barrel
question unanswered inside whichever half kept the index.

**Make `proof:kernelload` cover the barrel and change nothing else.** That is a
guard over a defect instead of a fix, and it would go red immediately with
nothing to do about it. A check is what keeps this closed *after* it is closed —
and it is owed either way, because the property has three routes and nothing
today can tell whether a fourth has appeared.

## Consequences

- `apps/desktop` may no longer obtain `mupdfWriter` from the barrel. Today two
  test files do, exercising a local engine — the pre-host arrangement — and they
  take the subpath. **That is not a workaround for those tests; it is the point
  arriving early:** invariant 20 says main must not parse, so main's own tests
  reaching for the adapter is the shape that should have to name itself.
- `commandBus.ts`, `documentCommands.ts` and anything else that routes import
  the declarations and stop reaching the engine.
- The three measurements above become the acceptance evidence, re-run after the
  change. **This ADR does not claim the numbers that will result** — the
  prediction is that all three fall to within a megabyte or two of
  `documentService.js`, and a prediction recorded as a measurement is exactly
  what `CLAUDE.md`'s B6 forbids.
- `proof:kernelload`'s subject widens from `documentService.js` to the barrel,
  with `mupdfWriter.js` as the positive control that keeps it honest: a guard
  asserting *this module does not bind native* is worthless unless something in
  the same run asserts *this one does*.

## What this does NOT decide

**Whether the byte-image writers run in the engine host.** ADR-0023 §7 leaves
that open and this changes nothing about it — the decision here is about which
module graph an import pulls in, not about where a writer executes.

**The other native binding.** `pdfiumFfi.ts` is the second sanctioned adapter
and is not reached from the barrel today. Clause 2 governs it the moment it is,
which is the point of stating the rule as a property of the surface rather than
as a list of two filenames.
