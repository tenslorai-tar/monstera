# ADR-0158 — An opener may reply to a report with new props

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** `docs/ARCHITECTURE.md` §7's dialog clause (*a dialog may report before it answers*).
- **Decided by:** the owner's item 17b: *"Settings › AI "Check" button per provider key via main's key check (behind
  CR-SEC-02 endpoint restriction). Green tick "Key works"; plain message why not (wrong key, no connection, provider
  refused); key never shown. After success fill model list (no "No models to choose from"/"has not been asked this
  session"). Tick stays while key unchanged; editing clears."*
- **Relates:** [ADR-0038](0038-a-dialog-answers-the-command-that-opened-it.md) (a dialog answers the command that opened
  it), [ADR-0094](0094-a-dialog-may-report-before-it-answers.md) (a dialog may report before it answers),
  [ADR-0117](0117-an-ai-model-is-chosen-per-provider-from-the-fetched-list.md) (the model list Settings opens with).

## Context

The check is main's already: `ai.models` asks the provider with the stored key through `listModels`, under
CR-SEC-02's address rule, and keeps a fetched list. Settings stores a key as it is typed (ADR-0094), so the key to
check is the stored one, and the renderer never holds it.

What cannot be expressed is the answer. A Settings body has no client, by ADR-0038, and reports outward with
`update`, by ADR-0094; nothing comes back. Its props are fixed while it is open, which is why *Import settings…*
closes the dialog and opens it again. A check answered that way would flash the dialog shut, drop the person's
place on the page and their focus on the button, and redraw everything to show one tick.

## Decision

**An opener may reply to a report by giving the open dialog new props.**

1. `ask(id, props, onUpdate)`'s `onUpdate` receives `reply(props)` beside the report.
2. `reply` validates its props by **the dialog's own props schema**, exactly as `ask` does, so a reply cannot hand a
   body what an open could not. A reply the schema refuses throws to the opener, which is where the open's refusal
   goes too; the dialog is left as it was.
3. A reply reaches **only the dialog that reported**. Once that dialog has closed, or another has replaced it, the
   reply does nothing: a slow answer to a question nobody is still asking is not drawn into a different dialog.
4. The body keeps its state across a reply. It is the same mounted body given new props, so the page it is on, what
   is typed and where focus is stay as they were.
5. The opener still writes and the body still has no client. A reply is data the opener read, handed to the surface
   that asked; nothing in it is a function.

For Settings: the body reports `check-key` with a provider, the command asks `ai.models` for that provider and
replies with the answer as the provider's check and, where the list was fetched, that provider's models. The body
shows *Key works* only where the provider answered a list, a plain sentence for each other answer, and clears both
when the key is edited or removed after the check was asked.

## Rejected

- **Close and open again**, as *Import settings…* does. It loses the person's place and focus for one line of answer,
  and draws the dialog twice.
- **A client in the body.** ADR-0038's whole subject: the body would become a second place a request is wired.
- **The answer in a store the body reads.** ADR-0094 rejected a context carrying the settings store for this reason;
  a live writer behind every body is that option again.
- **A promise or a callback in the props.** A validator cannot describe one, and props would stop meaning data.
- **Checking with `ai.checkKey`.** It takes a typed candidate and stores it when accepted, for the first run, where
  nothing is stored yet. In Settings the key is stored as it is typed, so the candidate is already the stored key,
  and sending it back across the boundary would put a key in renderer state for a check main can make without it.
