# ADR-0036 — The error boundary is the one class component

**Date:** 2026-09-03
**Status:** accepted. **Amends `BUILD-PROMPT.md` rule B7's clause** *"React
function components only"*, by naming a single confined exception. The
architecture amendment is a separate commit (B4); this ADR is the reasoning and
the measurements behind it.

---

## The problem, in one sentence

`docs/FEATURES.md`'s error boundary row has had its trigger fire — D1's
continuous scroll and lazy per-page render are code that can throw mid-render —
and React offers no way to declare an error boundary as a function component, so
the feature cannot be built without either bending B7 or buying a dependency to
hold the class for us.

## What was read, and where

Read 2026-09-03 from this repository's own `node_modules`, not from
documentation about React:

- `react` **19.2.8**, `@types/react` **19.2.18**.
- `node_modules/@types/react/index.d.ts:1225` declares
  `getDerivedStateFromError` on `StaticLifecycle<P, S>`, reachable only from
  `ComponentClass`. `componentDidCatch` is declared at `:1219` on
  `ComponentLifecycle`. Both are class members; neither has a function form.
- The same file's every exported hook — `useActionState`, `useDeferredValue`,
  `useEffectEvent`, `useId`, `useInsertionEffect`, `useOptimistic`,
  `useSyncExternalStore`, `useTransition`, and the `use` primitive — carries no
  error-boundary hook. There is no `useErrorBoundary` in React.
- `:1216-1218`, on `componentDidCatch`: *"Unhandled exceptions will cause the
  entire component tree to unmount."* That sentence is what makes doing nothing
  the worst option rather than the neutral one.

**A warning worth recording, because it will meet the next reader too.** Several
pages on the open web assert that React 19 introduced a `useErrorBoundary` hook.
It did not. The name is real and belongs to the `react-error-boundary` package,
where it does not declare a boundary at all — it returns `showBoundary` so an
event handler can forward an error *to a class boundary above it*. The claim
survives because it is plausible and because nobody checks a hook list.

## The decision

**Exactly one module in `packages/ui` may declare a React class component:
`packages/ui/src/ErrorBoundary.tsx`.** It holds error state and renders a
fallback. It contains no application logic, reads no store, and knows nothing
about documents.

The confinement is a lint rule, `monstera/no-class-components`, an **error**
over `packages/ui`, exempting that one path. This is the shape B7's own
sanctioned exception already has — *"`any` is confined to one typed adapter
module per native boundary … those files alone may carry a file-level lint
disable"* — and the shape `monstera/no-raw-hex` has for components. A rule with
a written-down exception is a rule someone re-derives; a rule with a *scoped*
exception is one the tree enforces.

## Rejected alternatives

**1. `react-error-boundary` 6.1.4, so the class lives one dependency down.**
The package is maintained and its `ErrorBoundary` is
`class … extends Component` with `getDerivedStateFromError` — so this does not
remove the class, it relocates it and adds a dependency to the production tree.
This project has already measured what that costs: `docs/FEATURES.md`'s i18n row
records one production dependency taking the tree **39 → 114 packages**. Paying
that to avoid writing thirty lines, in order to satisfy the *letter* of a rule
whose purpose is that our React code is function components, is outsourcing
compliance rather than achieving it. It would also put the fallback's behaviour —
what resets, and when — behind somebody else's API at exactly the point where
this build wants to state its own guarantee.

**2. `createRoot`'s `onUncaughtError`.** It cannot render. The three root error
options are `void` callbacks for reporting; `onCaughtError` fires *because* a
boundary caught something and plays no part in what that boundary renders.
Substituting them for a boundary produces a log line and a blank screen — which
is finding AAAAAA-4 (*"a page that failed to draw was silently blank … for ever,
and to every observer"*) at application scale rather than page scale, and this
ADR exists to close that class.

**3. No boundary; let the throw propagate.** The type declaration quoted above
says what happens: the entire component tree unmounts. A reader loses the
document, the panels and the shell, and is left with a white window carrying no
sentence. §10.5 already forbids the mild version of this — *"It just shows
nothing" is a defect* — and this is the severe one.

**4. A class component wherever one is convenient, with B7 relaxed generally.**
The rule earns its keep by being absolute; B7's own text says so — *"A rule
weakened by ad-hoc exceptions stops being law, so this is the only one"*, written
of the `any` adapters. This amendment therefore adds a **second** named
exception rather than an escape hatch, and confines it the same way: one path,
enforced by lint, with a control asserting the rule still fires everywhere else.

## What the boundary must guarantee, and where that guarantee comes from

The row's promise is that **reload is cheap**, and a promise phrased that way is
worth nothing until something says what a reader gets back. The guarantee here
is: after a throw, the reader returns to **the same document, at the same page,
at the same zoom**.

That does not come from the boundary restoring anything. It comes from
**placement**: the boundary is mounted *below* the state that holds the open
document, the current page and the zoom mode, so a reset re-renders the view
from state that was never inside the failure. Restoring is a mechanism that can
be wrong; being below is a shape that cannot (B5).

The larger claim underneath — that a renderer which throws loses no *work* —
is §2's and not this component's: the truth is main's canonical bytes plus the
command log, and the renderer holds a `DocId` and a `DocVersion`.

## Correction — 2026-09-03, the same day: placement is necessary and not sufficient

The section above says the recovery guarantee *"does not come from the boundary
restoring anything"* and that being below the state *"is a shape that cannot"*
be wrong. **The first half is right for two of the three properties and wrong
for the page**, found by building the case that asserts the guarantee rather
than by reading the sentence again.

Measured: with the boundary mounted below the state, a throw and a retry left
`open`, `zoomMode` and `currentPage` intact — and the remounted scroller seeded
its first page as visible and **reported** it through `onCurrentPage`, so the
preserved page was overwritten by the fresh view a moment later. Every piece of
state was correct and the reader was on page 1.

So the retry re-issues the scroll request through `goTo` — the seam that already
exists for *put the reader here* — in the same event as the reset. The document
and the zoom hold by placement; the page holds by placement **plus** that
request.

**What was wrong was not the design but the certainty of the sentence.** A
position genuinely cannot be wrong about what it *preserves*; it says nothing
about what a remounted child then reports over the top, and the two are easy to
read as one because both are about the boundary's place in the tree. The
question placement does not answer is: **what does this subtree derive on
mount?**

The test asserts it as a call rather than as an end state, for the reason
`CLAUDE.md` gives: `currentPage` reads 1 after the retry whatever happened,
because the seed fires either way, so only *the reader's page was requested*
separates a correct retry from an absent one. Dropping the re-request reddens
that assertion alone.

## What this does not cover, stated so it is not assumed

A React error boundary catches errors thrown **during rendering**, in lifecycle
and in the constructor of its subtree. It does not catch errors in event
handlers, in `setTimeout`, or in a rejected promise nobody awaited — those never
enter React's rendering path. `PageSlot`'s draw is one of them: it is async, it
already marks its canvas on failure, and this boundary neither replaces nor
weakens that.
