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
