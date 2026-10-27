# ADR-0272 — Each surface subscribes to the answers of the commands it places

- **Status:** Accepted
- **Date:** 2026-10-27
- **Decided by:** the owner, 2026-10-27, answering the open question of ADR-0271 (commit `7d480ebb`): *"each surface
  subscribes only to the answers for the commands it shows"*.
- **Amends:** [ADR-0258](0258-the-react-compiler-is-switched-on.md)'s correction of 2026-10-26, whose mechanism this
  replaces; its finding, that a predicate reads stores the compiler cannot see, stands.

## The problem, measured

ADR-0258's correction made the command context carry every command's answers (`CommandContext.answers`, one string
folded by `useCommandContext` in `App`), so that a surface memoized by the React Compiler draws a command's new state
the moment it moves. It works, and it renders the whole shell for any answer. Measured 2026-10-26 in
`editTextHandWalk.pw.ts` on this cloud machine (Chromium 151, the production build): *Bold visible in the editor* read a
median of 13.6 to 20.7 ms over six presses, with single presses from 22.0 to 52.1 ms; a CPU profile of ten presses
(unminified build, CDP sampling at 50 µs) put about 15 ms of React work in each, most of it `App`, the menu bar, the
ribbon and the status bar rendering again, because Bold's `checked` moved and with it the context every surface takes.
The same mechanism renders the shell on every page change while a scroll moves (measured 2026-10-27, `8e926ee4`'s
trace).

## Decision

1. **The answers live in a store, not in `App`'s state.** `CommandAnswers` holds each command's answer (`when`, and
   `checked` where it has one), recomputes them when a store a predicate reads moves (the settings, the open editor's
   state: the list ADR-0258's correction kept) and when the shell renders with a new base context or registry, and
   notifies per command. `App` writes the registry and the base context into it and does not subscribe, so an answer
   moving renders no part of the shell by itself.
2. **The context surfaces are given stops carrying every answer.** Its identity moves only with the base context.
3. **A surface subscribes through the one hook it projects with.** `useCommandAnswers(answers, ids)` returns the answers
   of `ids` as one value whose identity moves exactly when one of theirs does. The ids are not a list a surface keeps:
   they are the commands its placement can show, derived from the registry by the same placement filter that decides
   what it draws (`projections.ts`), shown or hidden, since a `when` that moves shows or hides one. A surface that draws
   a command's state outside a projection takes the command's id from the entry it draws. So a surface cannot draw a
   command it has not subscribed to, which is the property ADR-0258's correction bought by subscribing everyone.
4. **Everything that is not a surface keeps the base context.** Running a command, the shortcut map and the palette's
   filtering ask the predicates at the moment they are used, as before.

## Proof

- **The cost it removes:** a case that counts renders of `App` and of the surfaces across a Bold press in an open
  editor: the Bold controls render and `App` does not. Its control is the build before this change, where `App` renders.
- **The defect it must not bring back:** `commandStateLive.pw.ts` (Loupe pressed once draws pressed) passes unchanged,
  and an every-command case asserts that each command placed on a surface is among the ids that surface subscribed to,
  derived from the registry, so a placement added later cannot be drawn unsubscribed.
- The hand walk's Bold row, read again against the figures above.

## Rejected

- **Keep the correction as it is.** Correct, and it pays a shell render for every answer, which a Bold press, a toggle
  and a scroll all pay.
- **A context selector library.** A new dependency for what `useSyncExternalStore` already does.
- **Each surface lists the commands it shows.** A list a person keeps is a list a person forgets; a forgotten command
  draws stale state, which is the defect ADR-0258's correction exists for.
- **Take the compiler back out of the build.** ADR-0258's measured gains go with it.
