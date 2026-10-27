# ADR-0258 — The React Compiler is switched on

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amends:** [ADR-0004](0004-toolchain-versions.md), which pinned `babel-plugin-react-compiler` 1.0.0 and whose
  pin nothing installed or used; the renderer's build (`scripts/build/renderer.vite.config.mjs`) now runs it.
- **Decided by:** the owner's R19, app-wide (Addendum 6, 2026-10-21): *"cut React's re-render of the whole document
  state for a change that touches one page"*, and no renderer task over 50 ms on an ordinary action.

## The problem, measured

Every command's answer moves its document's version, and `App` subscribes to the document's state whole, so it
renders. Nothing below it skips a render when its props are unchanged, so the whole shell renders with it: the
ribbon's buttons and their tooltips, the menu bar, the title bar, the side panels, the thumbnails.

Read 2026-10-21 by `measureMove.pw.ts` (an annotation erased on pinned Chromium, a Chrome CPU profile of each erasure,
an unminified renderer build so the profile names functions):

- the erasure's long task was **one synchronous React render of 53 ms**, of which `App`'s own function was 6.5 ms and
  the rest every child of it re-rendering;
- the React work per erasure, all samples under `performWorkOnRoot` over 1.5 s, was **119 to 449 ms, median about
  170**, in six runs.

The long task blocks the frames after the press, so the erasure's own result — the page drawn without the mark at
22 ms in one run — reached the screen at 126 ms.

## Decision

1. **The React Compiler runs on the renderer's bundle**, version 1.0.0 as ADR-0004 pinned it, through the React
   plugin's Babel step. It memoizes each component's elements and values by their inputs, so a child whose props did
   not change is not rendered again when its parent is.
2. **The code is already written to its rules**: `eslint-plugin-react-hooks`' full recommended set, which carries the
   compiler's rules, has been an error in `packages/ui` since B7. A component the compiler cannot prove safe is left
   as written, which is the compiler's own rule, not one this repository adds.
3. **It is a measured step, not the end of the stage.** Measured with it on, same six erasures: React work **82 to
   146 ms, median about 95**. What still renders on a version move, and why its inputs change, is the app-wide stage's
   next question, answered by its own measurements.

## Proof

The whole unit-test suite and the rendered suites run against the compiled bundle (the gate before push); the
measurement above is repeated with the commit that switches it on.

## Rejected

- **`React.memo` by hand on the expensive subtrees.** It is the same idea applied where somebody remembers to, with
  the props' identities left to each caller to keep stable — which is exactly what the shell does not do today. The
  compiler applies it everywhere and keeps the identities.
- **Narrowing `App`'s subscription first.** Needed, and the next step; alone it leaves every child of whatever does
  render rendering again.

## Correction, 2026-10-26 — Decision 2 was false for every command's state; the context now carries its answers

Decision 2 read *"the code is already written to its rules"*. It was not, and the rules could not have said so. The
compiler memoizes a component's output by the values it is given, and the surfaces draw a command's state by calling
its predicates in render: `pressed={entry.command.checked?.(context)}`. A predicate is handed only the context, but
many read a store they were given when the command was made — `deps.settings.get(LOUPE_SETTING.id)`, the panels'
presence (which reads settings), the open text editor's formatting. None of those is an input the compiler can see,
so when only the store moved, nothing a surface was given had changed and it kept the answer it drew last.

Measured 2026-10-26 on Chromium 151 (`commandStateLive.pw.ts`, the owner's second video of the same day): Loupe on the
Tools tab, pressed once, turned the loupe on and its button stayed unpressed; a switch to another tab and back drew it
pressed, and pressed again it turned the loupe off and stayed pressed. The same build with the compiler taken out of
`renderer.vite.config.mjs` drew it pressed at the first press. At 445fbaa7, `git grep` counts 23 `checked:` and 136
`when:` sites in `packages/ui/src/commands/`; a site may make many commands, and every `checked:` site reads something
other than its context.

`UiCommand.when` and `checked` say *"Pure and synchronous"* (ADR-0029 Decision 5). Synchronous holds. Pure of the
context does not, and that is the premise the memoization rested on.

### Decision

**The context the surfaces are given carries the commands' answers** (`CommandContext.answers`). One hook,
`useCommandContext`, evaluates every registered command's `when` and `checked` against the context and folds the
results into one string, through `useSyncExternalStore` subscribed to the stores the predicates read: the settings and
the open editor's state. The context's identity moves exactly when an answer moves, so every surface memoized on it
draws the new state, and nothing renders again for a change no answer shows. A predicate reading state `App` holds is
already covered: the registry is rebuilt from those values, and the answers are evaluated again on that render.

So no surface subscribes to anything, and none can forget to: the surfaces are unchanged, and a surface added later
takes the same context.

### Rejected

- **Each projection subscribing to the settings.** Five surfaces today (the ribbon, its overflow, the quick toolbar,
  the status bar, the menus and palette through `projections.ts`), and the sixth would be the one that forgets.
- **Predicates made pure of a settings snapshot in the context.** The strongest form for settings — a predicate that
  reads only its argument cannot be stale under memoization on that argument — and it would need every one of the
  settings readers rewritten and a check to keep them so, while leaving the editor's state and the next store a
  predicate reaches for exactly where they are. The answers cover any store a predicate reads, provided the store is
  subscribed; that list is one array in one hook.
- **Opting the surfaces out of the compiler.** Gives back what this ADR measured, and is still wrong under any other
  memoization of the same values.

## Note, 2026-10-27 — the correction's mechanism is replaced by ADR-0272

The finding above stands: a predicate reads stores the compiler cannot see, and a surface must be told when its answers
move. How it is told changes, by the owner's decision of 2026-10-27: the answers move into a store, and each surface
subscribes to the commands its placement can show, so an answer renders the surfaces that draw it and not the shell
([ADR-0272](0272-each-surface-subscribes-to-the-answers-of-the-commands-it-places.md)).
