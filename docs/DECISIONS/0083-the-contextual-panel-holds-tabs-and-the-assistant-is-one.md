# ADR-0083 — The right contextual panel holds tabs, and the assistant is one of them

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §10.3, whose right contextual panel is one surface
  holding the style controls and the selection's properties. It gains a **tab strip**, as
  the left document panel already has.
- **Relates:** [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md)
  (a surface is a projection of the registry around its own value controls),
  [ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md),
  [ADR-0082](0082-main-may-push-on-declared-event-channels.md).
- **Context:** the owner's AI design (2026-09-15): *assistant = TAB in right contextual
  panel*, correcting D11's row, which said *dialog*.

## The gap

§10.3 describes the right panel as the place properties live, and design pass D built it
that way: one region, children handed in by `App`. The owner's design puts the assistant
**in that panel, as a tab** — not in a dialog, because a conversation about the document is
read beside the document rather than over it, and not in the left panel, whose six tabs are
about the document's own contents.

## Decision

1. **The right contextual panel gains a tab strip**, the left panel's shape: named tabs,
   one open at a time, the open one persisted per person. Its first two tabs are
   **Properties** — what the panel holds today, unmoved — and **Assistant**.
2. **The panel's header keeps its collapse chevron**, and collapsing is still the panel's
   own setting: a person who shuts the panel shuts both tabs, and reopening returns to the
   tab they left.
3. **The assistant tab is a surface, not a registry projection.** A composer, a
   conversation and a model picker are value controls in the status bar's sense
   (ADR-0067): commands that *open* it — a shortcut, a palette entry — are registry
   commands, and what happens inside it is the tab's own.
4. **One conversation per document**, held where the document's other per-document state
   is held, and dropped with the document.

## Rejected

- **A dialog.** The owner's design says a tab, and a modal over the page makes *asking
  about what I am reading* into *leaving what I am reading*.
- **A tab in the left document panel.** That panel's tabs are the document's contents —
  pages, bookmarks, comments, layers, signatures, search. A conversation is not one.
- **A third panel.** A window with a panel on each side and a conversation between them is
  the layout §10.3 spends its care avoiding.
- **Keeping the panel single-purpose and putting the assistant in the ribbon's own overlay
  (Studio mode).** It would exist in one layout mode and not the others.

## Consequences

- §10.3 states the tab strip; the amendment log gets a line.
- The panel's open-tab setting joins the settings registry beside its open/width settings.
- D11's row already says *panel tab*; this is the law catching up with the owner's design
  rather than a new decision.
