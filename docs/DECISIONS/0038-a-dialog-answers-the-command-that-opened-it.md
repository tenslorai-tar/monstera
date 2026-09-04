# ADR-0038 — A dialog answers the command that opened it

**Date:** 2026-09-04
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §7's dialog registry row**,
which declares an entry as *id, lazy component, props schema* and has no way for
a dialog to produce a value. The architecture amendment is a separate commit
(B4); this ADR is the reasoning.

---

## The problem, in one sentence

`docs/FEATURES.md`'s mutation-dialog gate row says Stage 0 built the primitive,
the host, the registry and a lazy body and proved them on **informational**
dialogs, and that what it could not build is *"a dialog that collects arguments
a command then applies"* — and that is exactly what the first one needs, because
nothing in `DialogEntry` can carry a value out.

## What exists, read from the code

- `DialogEntry` is `{ id, title, props, component, mount }`. `props` is a zod
  schema, validated at the open call ([ADR-0029](0029-the-registries.md)
  Decision 7), and it also **types** the component — one writer for the shape.
- `DialogHost` renders `entry.mount(open.props)` inside the one `<Dialog>`. The
  body receives props and nothing else: no client, no close, no callback.
- `show(id, props)` returns `void`. The host closes on backdrop, Escape or the
  close control, through `onOpenChange`.

So a body that wanted to apply a command would have to obtain a client from
somewhere the registry does not give it.

## The decision

**A dialog may declare a `result` schema, and opening one is a question.** The
host supplies the body with a `resolve` callback; the opener receives a promise
that settles with the parsed result, or with `undefined` when the dialog was
dismissed. The command that opened it is what dispatches.

```ts
const answer = await deps.ask(DELETE_PAGES_DIALOG_ID, { pageCount });
if (answer === undefined) return;          // dismissed — nothing happened
await applyDocumentCommand(deps, docId, { kind: 'deletePages', pages: answer.pages });
```

Three properties fall out, and each is the reason for a rejected alternative
below.

1. **The command registry stays the only place a mutation is wired.** §7's
   *"there is no second place where a feature is wired"* is unchanged by a
   dialog existing; the dialog collects, the command applies.
2. **The gate is structural, not a rule.** Dismissal resolves `undefined` and
   the command returns before dispatching. There is no branch anyone can forget,
   because there is no value to apply.
3. **The result is validated by a schema, exactly as the props are.** Decision
   7's argument — *"a dialog is the one surface with no other error path"* —
   runs in both directions once a value comes back out.

`resolve` is **not** a prop and is not in the props schema. It is the host's
second argument to `mount`, so the schema keeps meaning *the data this dialog
was opened with* and a function never has to be described by a validator.

## Rejected alternatives

**A callback in the props.** The obvious shape, and it puts a function in a
`.strict()` zod object whose entire purpose is validating what reaches the body.
`z.custom<Fn>()` accepts anything callable, which is the hole in the one place
the project chose to close, and B7's `any` ban is the same argument one layer
down. It would also make the props schema untypeable as *data*, which is what
`show`'s validation and the `DialogPropsRejected` error rest on.

**A context holding the contract client, read by the body.** This is what most
applications do and it is the second wiring place §7 exists to forbid: a
mutation would be dispatched from a component rather than from a command, so
the command palette, the ribbon and the shortcut map would all be projections of
a registry that no longer contains the feature. It also makes every dialog body
a potential mutation site, which is precisely the audit surface a registry
removes.

**A `confirm` function on the `DialogEntry`.** Keeps the dispatch out of the
body and still needs the client at *declaration* time, which is before the
composition root exists — the same ordering that keeps `flush` off
`EngineSessionSource` in `apps/desktop`. Entries are module-level constants.

**Making the dialog a command that runs when confirmed.** Two registry entries
for one feature, and the second one has no `placements`, no `when`, and must
never appear in the palette — a command that is not a command.

**Leaving `show` and adding a second opener for the value case.** Two ways to
open a dialog is the shape B3a is about. `ask` **replaces** `show` for every
caller: an informational dialog declares no `result`, so its promise settles
with `undefined` and every existing call site ignores it exactly as it ignores
`void` today.

## What is proven, and the control

- The command dispatches with the value the dialog resolved, and the value
  reached it **through the schema** — a result the schema refuses never arrives.
- **The control is the gate:** dismissing the dialog dispatches nothing. It is
  asserted as *the call that was not made*, because the document is unchanged
  either way and an end-state assertion would pass with the whole mechanism
  deleted — the failure `docs/JOURNAL.md` records three times.
- A second control, because the first is satisfied by a dialog that can never
  resolve: confirming **does** dispatch, in the same file, on the same fixture.
  A gate that blocks everything is a gate that reads as working.
