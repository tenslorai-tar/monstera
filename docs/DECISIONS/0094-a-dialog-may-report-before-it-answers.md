# ADR-0094 — A dialog may report before it answers, and Settings applies as it is changed

- **Status:** Accepted
- **Date:** 2026-09-22
- **Decided by:** the owner's design of 2026-09-22 — the Settings dialog's footer reads *"Changes
  save as you make them. Secrets are never exported."*, and its only closing control is **Done**.
- **Amends:** `docs/ARCHITECTURE.md` §7's dialog clause and the amendment log.
- **Relates:** [ADR-0038](0038-a-dialog-answers-the-command-that-opened-it.md) (a dialog answers the
  command that opened it), [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)
  (the settings dialog derives its controls; a secret is write-only).

## Context

ADR-0038 makes a dialog a **question**: the host hands the body one `resolve`, the opener awaits one
promise, and the command does the writing — which is what keeps mutations wired in one place. The
owner's Settings design is not a question. Every row applies at once, there is no *Save*, and the only
button that ends it is *Done*; a person who changes the theme sees the theme change.

Nothing in the registry can express that. Props are validated data and deliberately carry no function
(§7), there is no React context in this renderer, and a body that wrote settings itself would be a
second writer for the concern ADR-0038 gave the command.

## Decision

**A dialog may report a result before it answers with one.** The body receives `update` beside
`resolve`; `ask` takes the callback the opener wants those updates delivered to.

1. `DialogAnswering<Result>` gains `update: (result: Result) => void`. It does **not** close the
   dialog and does not settle the promise.
2. Every update is validated by the **same result schema** as the answer, at the same place, so a
   dialog cannot report something the opener's type does not admit — the property ADR-0038 bought.
3. `ask(id, props, onUpdate?)`. **The opener still writes**: for Settings the command applies each
   reported change exactly as it applied the final one, so the table's first row remains the only
   place a mutation is wired.
4. A dialog that reports nothing is unchanged: `update` is there, unused, and an informational body
   still cannot construct a result at all (`(r: never) => void`).
5. The closing answer stays meaningful — *Done* resolves, dismissal settles `undefined` — but for a
   dialog that applies as it goes, the answer carries nothing left to apply.

## Rejected

- **A callback in the props schema.** Props mean *the data this dialog was opened with*, and a
  validator cannot describe a function. §7 names this as the hole to keep shut.
- **The settings body writing through its own store.** Two writers for one concern (B3), and the
  place a person changes a setting would stop being the place the command records it.
- **A React context carrying the settings store.** It would put a live writer behind every dialog
  body in the tree, which is the first option wearing a provider.
- **Keeping *Save*.** It is the owner's design that is being built, and a dialog that collects a whole
  page before applying it is the thing the design replaces.
