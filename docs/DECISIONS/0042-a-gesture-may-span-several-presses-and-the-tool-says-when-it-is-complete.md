# 0042 — A gesture may span several presses, and the tool says when it is complete

Date: 2026-09-06
Status: accepted
Supersedes: nothing. Amends `docs/ARCHITECTURE.md` §6's tool lifecycle.

## Context

Stage 3's annotation platform models a gesture as one press, some movement and a
release. `AnnotationOverlay.tsx` calls `begin` on `pointerdown`, `update` on
`pointermove`, and `commit` on `pointerup` — after which it clears the gesture
unconditionally. Eight tools have been built on that shape and none of them
strained it: a rectangle, an ellipse, a line, an arrow, a stroke, a redact mark
and a text box are all one drag, and a sticky note and a caret are one click.

The click gesture in particular cost the platform **nothing** — a click tool
reads `startOf` and discards the rest — and that is worth stating here because it
is the reason this document exists rather than a fourth one like it. The cheap
widening was checked for first and found unnecessary. This one is not.

Three rows remain that cannot be expressed: **polygon, polyline and cloud**. A
polygon is not a drag. Every application a reader is coming from builds one the
same way — click a vertex, click another, and signal when the shape is done —
and the platform has no way to say any of those three things:

1. **A second press restarts the gesture.** `down` calls `begin` whenever a
   pointer goes down, so the second vertex discards the first.
2. **A release ends the gesture.** `up` clears the state and commits, so a
   three-vertex shape is committed after one.
3. **There is no finish signal**, because nothing needed one: for a drag, the
   release *is* the finish.

This is a seam that cannot carry the feature, so B4 applies: amend first, in its
own commit, then build.

## What was measured first

Before designing anything, MuPDF 1.28.0 was asked what these three annotations
are, because a decision about the renderer's gesture model is worth nothing if
the writer of record cannot store the result (measured 2026-09-06, on a
`/MediaBox [0 0 200 300]` page):

| asked | answer |
|---|---|
| `Polygon.setVertices` | stores `/Vertices` in PDF space and computes `/Rect` itself, with `/RD [2 2 2 2]` |
| `Polygon.setRect` | **refused** — *"Polygon annotations have no Rect property"* |
| `Polygon.setBorderEffect('Cloudy')` | stores `/BE << /S /C /I 2 >>`, grows `/RD` to `[11 11 11 11]` and expands `/Rect` past the page edge to `[-1 179 91 291]` |
| `PolyLine.setBorderEffect('Cloudy')` | **refused** — *"PolyLine annotations have no BE property"* |
| `Square.setBorderEffect('Cloudy')` | accepted |

So a **cloud is a polygon with a border effect**, not a third geometry and not a
polyline variant — the format refuses that reading outright. Three rows, two
subtypes, one gesture.

## Decision

### 1. A gesture records its PRESSES as well as its path

`Gesture` gains `presses` beside `points`. The platform records where each
pointer-down happened; `points` continues to record where the pointer has been.

A polygon reads `presses` and ignores `points`; a stroke reads `points` and
ignores `presses`; a rectangle reads two ends of `points` as it always has.

**Rejected: a second controller member for presses.** The lifecycle would have
gone from three members to five — `begin`, `press`, `update`, `commit`,
`complete` — and every existing tool would have had to say what a subsequent
press means to it, which for all eight of them is *nothing*.

**Rejected: deriving vertices from `points`.** The path is decimated by distance,
so a click and a slow drag through the same pixel are indistinguishable in it.
The information is destroyed by the time a tool could read it.

This is the second time `Gesture` has widened and it is the same move for the
same reason. It was `{ from, to }` until the ink tool needed a path; the platform
records what happened and each tool reads what it needs. The cost is two fields
tools ignore, and the alternative each time was a parameter, a union or a second
registry.

### 2. The controller decides when a gesture is COMPLETE; the overlay asks

`ToolController` gains one member, `complete(gesture): boolean`, called at
pointer-up. False means the gesture survives the release and the overlay keeps
it; true means commit and clear, which is what every release has done until now.

**No tool has to write it.** `pointerPath` — the shared `begin`/`update` that all
eight tools already spread — answers `true`, so *a release ends the gesture*
remains the default and not one existing controller changes. That is what
separates this from the `cancel` member `registries/tools.ts` rejected: `cancel`
would have been an empty body in twenty tools, and this is a default in one
place that a tool overrides when it means something else.

**Rejected: an optional member.** The overlay would branch on its presence, which
is a runtime check standing in for a type — and a tool that meant to drive a
multi-press gesture and misspelt the member would silently get the default.

**Rejected: a third return value from `commit`.** `commit` would answer *a
command*, *nothing*, or *not yet*, and the first two already mean *the gesture is
over*. Overloading the return would put the lifecycle decision inside the
function that builds payloads, and every tool's `commit` signature would widen
for a state seven of them cannot produce.

### 3. The finish signal is a double press, recorded by the platform

`Gesture` gains `done`, set by the overlay when a pointer-down arrives as a
double-click. A multi-press tool's `complete` reads it.

**The platform records the signal and the tool interprets it**, which is the same
division as everywhere else here: the overlay knows about pointers and the
controller knows what the gesture means. A polygon may also complete by other
rules — a press near the first vertex closes a shape, and that is expressible
from `presses` alone with no platform involvement at all.

**Rejected: Enter, or a toolbar button.** Both are real and neither is the one to
build first: a keyboard finish needs the overlay's focus behaviour settled, and a
button is a second control for a gesture already in flight. Double-click is what
the applications this replaces use, and it costs one field.

### 4. Cancelling is still the absence of a member

Escape and `pointercancel` already drop the gesture, and a multi-press gesture is
dropped the same way. `registries/tools.ts`' argument for `cancel` not being a
member is untouched by this: the state is still a value the overlay holds, so
abandoning it is still forgetting it.

This is worth stating because a multi-press gesture makes cancelling **matter
more** — a half-drawn polygon is visible on screen and a person will want out of
it — and it would have been easy to read that as the trigger the original
argument named. It is not: the trigger was a tool holding a resource, and a
polygon holds nothing but points.

## Consequences

- `Gesture` grows two fields every existing tool ignores.
- `ToolController` grows one member no existing tool implements.
- `AnnotationOverlay.tsx` changes in two places: a press extends a live gesture
  instead of restarting it, and a release commits only when the tool says so.
- Three FEATURES rows become buildable — polygon, polyline and cloud — and the
  **callout** row behind them, which the reviewing seat had raised as a question
  about interaction design: one drag can define a box or a pointer and not both,
  which is true, and multi-press removes the premise. A callout is a press at the
  thing being pointed at and a press where the box goes.
- The overlay can now hold a gesture across an arbitrary number of events, which
  is a state that outlives a single interaction. It is still per-page and still
  dropped on Escape, so nothing about the store's lifetime changes.

## The honest limit

`complete` is asked **only at pointer-up**. A tool that wanted to finish on a
move, a timer or a keystroke cannot say so, and would need the overlay to ask at
those moments too. That is deliberate: pointer-up is where every gesture this
build has now ends, and adding the other call sites before a tool needs one would
be architecture written ahead of need. The trigger is the first tool whose finish
is not a release.

## Correction, 2026-09-06 — the clause this superseded was already false in three places

Recorded by the stage audit at `909c388`, hours after this was accepted, and
appended rather than edited because what was believed when it was written is the
record.

The Context above, and the amendment row this produced in `docs/ARCHITECTURE.md`,
both describe §6's lifecycle clause as naming `begin`, `update`,
`commit → Command` and `cancel`. That is what the clause said. It was not what
the code said, and had not been for four commits:

- **`cancel` was never a member.** `registries/tools.ts` decided against it when
  the platform landed at `4853e58`, with a stated argument this document even
  restates in Decision 4 — while the amendment row went on listing it among the
  members being superseded around.
- **`preview` is a member** and appeared in neither.
- **`commit` had already gained an asynchronous return** at `1714e24`, so
  `→ Command` was the signature of a previous version.

So the sentence quoted here to say *what is being changed* was itself stale in
three of four entries, and quoting it is what made it feel checked. §6's body has
been corrected; this decision's own reasoning is unaffected, because the seam it
could not express is a fact about the overlay rather than about the clause.

**The compensation, narrow enough to run: an amendment that QUOTES a clause
verifies the whole quotation before superseding part of it.** It fires on the
exact action that failed, which *be careful reading documents* does not.
