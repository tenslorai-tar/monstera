# ADR-0141 — Every command declares how a person learns it worked

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** `docs/ARCHITECTURE.md` §7, the Commands registry's entry, which gains a required `feedback`.
- **Decided by:** the owner's review of 0.1.9.0, item E: *"Every registered command declares its feedback: visible on
  the page, a confirmation toast, a result dialog, or none with a written reason. A check fails the build if any
  command declares nothing."*

## Context

Whether a command tells a person it worked was decided command by command, at the moment each was written, and
nothing recorded the decision. The audit of 2 October found fourteen file writes saying nothing — an export that lands
out of sight looks exactly like a dismissed picker — and `confirmWritten` was made the one way a write confirms
(`confirmWritten.ts`). That fixed the commands found, and left the class where it was: the next command is written
with no question asked, and *silent* reads the same whether it was chosen or forgotten.

## Decision

1. **`UiCommand.feedback` is required**, one of four:
   - `{ kind: 'visible' }` — the effect is drawn where the person is looking: the page, a pane, a panel or window the
     command opens, the tool it arms, the theme it sets.
   - `{ kind: 'toast' }` — it finishes out of sight and says so through the one confirmation path, `confirmWritten`
     for a file, `confirmDone` for anything else, `confirmCopied` for the clipboard.
   - `{ kind: 'dialog' }` — its answer is a result dialog's content: a check, a count, a list found.
   - `{ kind: 'none', reason }` — nothing, with the reason written where the command is.
   A command that declares nothing is a compile error, and `typecheck` is part of the build; the registry refuses a
   `none` whose reason is empty, at startup, naming the command.
2. **The declaration is about success.** A failure says so through the command's own error path whatever it declares.
3. **A command with more than one route declares the one a person waits on**: an export that opens a dialog first
   declares `toast`, because the write is what the person is waiting for.
4. **The manual checklist names each command's feedback**, generated from the registry, so the installed-window pass
   checks what each command says it shows.

## Rejected alternatives

- **A scan for `confirmWritten` near each file write.** It finds the writes it can recognise and says nothing about the
  rest, and a command that should confirm and does not call anything is exactly the one a scan cannot see.
- **An optional field with a lint rule.** The type system already has the stronger form: required.
- **Inferring the feedback from the placements** (a ribbon tool is visible, an export toasts). It agrees most of the time,
  which is the dangerous shape (B3a), and a command's placement says where it is, not what it does.
- **A fifth kind, *opens a dialog*.** A dialog that opens is visible where the person is looking; what matters is how
  they learn the command FINISHED, which is one of the four.

## Consequences

Every command added from now on is asked the question by the compiler. The declaration is a claim, and the checklist is
where the installed window checks it; a command declaring `toast` that shows none is a defect in the command.
