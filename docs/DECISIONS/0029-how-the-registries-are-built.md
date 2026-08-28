# ADR-0029 — How the registries are built: registration is a value, not a side effect

**Date:** 2026-08-28
**Status:** accepted as a design. **Nothing here is built.** The seam every later
feature registers into is the one thing to see before it lands, so this ADR
exists to be read and argued with first.
**Amends nothing.** `docs/ARCHITECTURE.md` §7 already fixes *what* the registries
are and what each derives. This decides the questions §7 leaves open, which are
the ones a builder would otherwise re-derive — and re-derive differently each
time, which is how a registry acquires a second wiring place.

---

## What §7 already settles, and is not re-argued here

The registry table, the entries, what each derives, and the rule that
**placements are part of the command rather than of the surface**. Also that
chrome visibility is itself commanded, so a hidden surface can always be
restored from the palette.

This ADR is about the eight questions underneath.

---

## Decision 1 — A registry is a VALUE that is composed, never a module side effect

**Registration happens by putting entries into a structure at a composition
point.** No module registers itself when imported.

```ts
export const editCommands: readonly UiCommand[] = [rotatePages, deletePages];
```

…and one place gathers them. The alternative — a `register(...)` call at module
scope, executed for its side effect — is rejected, and the reasons are not
stylistic:

- **A side effect is invisible to the module graph.** Whether a command exists
  would depend on whether something imported its file, which is a question no
  type answers and no reader can see. This repository has already measured that
  exact failure class in the other direction: `import { type X } from …` emits
  `import {}`, keeps the side effect, and put 38.1 MB of MuPDF inside `main`'s
  baseline (ADR-0025). An import whose *only* purpose is a side effect is the
  same trap with the intent reversed.
- **It makes the set unknowable statically**, which kills Decision 4's
  totality check before it can be written.
- **Order becomes load-bearing and invisible.** Two modules registering the same
  id resolve by import order, and import order is decided by a bundler.

**Rejected: a decorator.** Same side-effect problem wearing better syntax, plus
a transform in the build.

---

## Decision 2 — `run` is required by the type, and `when` is how something unbuilt stays invisible

CLAUDE.md: *"Never register a command without a working `run`. Never mount a
button for an unimplemented command — the registry's `when` predicate hides what
does not exist yet."*

So `run` is **not optional** in `UiCommand`. A command with no implementation is
not a registered command with a stubbed `run`; it is **not registered at all**,
or it is registered with a `when` that is currently false.

**This is a type doing half the work and no more, and saying so matters.** A
required `run` makes *forgetting* an implementation impossible. It does nothing
about a `run` that is present and does nothing — `() => {}` compiles. §10.4's
*a control that renders but does nothing is a defect* is therefore **not**
enforceable at this seam, and the mechanism that does enforce it is the
wired-tools test pair: a kernel proof that the command produces the document
effect, plus a UI test that the control dispatches exactly that command.

Recording that limit is the point. A reader who believes the type covers it
will not write the pair.

---

## Decision 3 — Ids are unique, and a collision is a build failure rather than a last-write-wins

Two commands claiming one id is a defect with no correct resolution: the second
silently replacing the first is how a feature stops working with nothing red.
The registry's constructor refuses a duplicate, in the shape
`DocumentStores.open` already uses for the same reason.

**Rejected: namespacing by feature to make collisions impossible.** It removes
the collision and the check together, and ids appear in shortcut maps, telemetry
and the palette — a generated prefix would leak into all three.

---

## Decision 4 — Every surface is derived, and TOTALITY is checked rather than trusted

§7's claim is that the ribbon, floating toolbar, context menus, palette,
shortcut map and start screen are projections. A projection is only a projection
if nothing else can add to it, and that needs two mechanisms:

- **Exhaustiveness over `Placement`.** Each surface narrows on
  `placement.surface` and ends in a `never` case, so adding a placement variant
  fails to compile in every surface that has not handled it. That is the
  cheapest available *you have not finished* signal.
- **A scan for the second wiring place.** Exhaustiveness cannot see a surface
  that renders a hand-written list *beside* the projection. The check is that no
  module under the surfaces directory contains a literal array of command ids —
  and per audit item 4b it needs a positive control, because *found nothing* is
  its passing answer.

**Rejected: trusting review.** *A hand-maintained layout file for any of them is
the second wiring place this registry exists to forbid* is a rule, and this
project's record on rules without mechanisms is seven occurrences for one of
them and seven for another.

---

## Decision 5 — `when(ctx)` is pure, and `ctx` is a value the caller already has

`when` decides visibility and runs on every projection render. Two constraints
follow, and both are about making a wrong implementation hard rather than
discouraged:

- **Pure and synchronous.** No IPC, no store read outside `ctx`. A predicate
  that could await would make visibility a race, and a surface that flickers as
  answers arrive is a defect nobody can reproduce.
- **`ctx` is passed in, never reached for.** A `when` that reads a module-level
  store binds the command to a singleton — which §6 forbids for document state
  and which would also make the predicate untestable without one.

`ctx` therefore carries the open document's `DocId` and version, the selection,
and shell state — and is a plain object, so a test constructs one.

---

## Decision 6 — The title is an i18n key, and the type says so

`title: string` invites a literal. `title: MessageKey` — a branded string with a
constructor — makes a literal a compile error at the registry boundary, which is
where it is cheapest to catch.

This is **narrower than B9's lint rule and does not replace it**: the rule bans
literal user-facing strings in JSX, and most such strings are not command
titles. Two mechanisms for two populations, and the ADR says so because a reader
who thinks one covers the other will skip the second.

---

## Decision 7 — Dialogs are lazy by construction, with the props schema beside the component

§7 gives a dialog an id, a lazy component and a props schema. The schema is
**required**, not optional: a dialog opened with the wrong props is a runtime
failure in the one surface that has no other error path, and validating at the
open call is the only place both sides exist.

One mount point, one focus trap, one Escape handler — so `<Dialog>` is where
§10.4's accessibility obligations are met once rather than per dialog.

---

## Decision 8 — Registries live in `packages/ui`, and their ENTRIES live with their features

The registry types and the composition point are UI infrastructure. A command's
entry lives beside the feature it belongs to, because a feature that is
*finished when registered* should have its registration in the diff that adds
it.

This is the one decision here with a real cost: it means the composition point
imports from every feature, so it is a file that grows with the application and
is edited by every feature. That is a **known and accepted** shape — it is the
single place §7 promises, and the alternative is Decision 1's side effect, which
buys a smaller diff with an unknowable set.

---

## Consequences

- **Nothing above is built, and the ordering is deliberate.** The registries are
  the seam every later feature registers into; building them before the
  primitives exist would mean designing projections against components nobody
  has written.
- **Decision 4's scan does not exist and is the load-bearing one.** Until it
  does, *no second wiring place* is a rule rather than a mechanism, and this
  project's record says which of those holds.
- **Decision 2 states a limit rather than closing it.** The registry cannot tell
  a working `run` from an empty one. The wired-tools pair is the mechanism, and
  it lives per feature — so it is owed once per command, forever, and no
  registry change reduces that.
- **`MessageKey` in Decision 6 does not exist yet** and arrives with the i18n
  scaffold. Until then a title is a plain string and the boundary is unenforced,
  which is a gap with a named expiry rather than a decision.

---

## Rejected alternatives

**One registry object with a `register()` method, called at startup.** This is
Decision 1's side effect with a function call instead of an import, and it has
the same three failures: invisible to the graph, unknowable statically, ordered
by whoever runs first.

**Deriving placements from the surfaces instead of the commands.** Each surface
declares which commands it wants. Rejected because it is the second wiring place
by construction — adding a command would mean editing every surface it appears
on, which is precisely what §7's *placements are part of the command* forbids.

**A single `features` registry rather than nine.** Rejected: the nine have
genuinely different entry shapes and different projections, and collapsing them
would produce a union that every consumer narrows — the switch statement §6
already forbids in `App.tsx`, moved one layer down and made mandatory.

**Building this now, before the primitives.** Rejected on the sequencing above,
and on B4's own logic: a seam is amended by evidence from the features that use
it, and there are none yet.
