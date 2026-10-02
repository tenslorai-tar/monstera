# ADR-0140 — The ground has no lights; the grain stays

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** [ADR-0114](0114-the-grounds-light-follows-the-accent.md), whose subject this removes in part: the four
  glows over the window's ground (`--glow-green`, `--glow-teal`, `--glow-lime`, `--glow-warm` in `--ambient`), the
  page area's two lights (`--tint-canvas`, `--tint-canvas-far` in `--canvas-bg`), the start screen's wash
  (`--tint-start`), the green halo in dark's page shadow, and the *Background glow* setting. `docs/ARCHITECTURE.md`
  §10.2's paragraph on the ground's light is rewritten.
- **Decided by:** the owner's review of 0.1.9.0, item D.c: *"Remove the glow completely: the page-area light and the
  ambient lights, the green radial gradients, in every theme. Keep the window grain."*

## Decision

1. **No radial light anywhere on the ground.** `--ambient` is the design's base gradient alone, in every theme;
   `--canvas-bg` is `--canvas`; the start screen draws no wash; the page shadow carries no green halo. The tokens that
   held those lights are deleted, from the themes and from `ACCENT_LIGHTS`, so nothing can draw them again by
   reference.
2. **The surfaces' own tints stay**, and keep following the accent (ADR-0114 Decision 1): the menu row, the ribbon, the
   rail, the panels, the float bar, the status bar, the start screen's hero and the dialog head. They are linear washes
   belonging to a surface, not lights over the ground, and the owner's item names the lights.
3. **The grain stays, always.** The *Background glow* setting turned the glows and the grain off together. With no glow
   left, the only thing it could still do is remove the grain the owner asked to keep, under a name that describes
   something gone. It is removed: its registry entry, `applyGlow`, the `[data-glow='off']` block and its strings. A
   stored value is ignored like any unknown key. High contrast still draws no grain.

## Rejected alternatives

- **Keep the setting, renamed *Background grain*.** That would make the grain a preference the owner did not ask for.
  If a person should be able to turn the grain off, that is a new setting for the owner to ask for, not this one kept
  under a new name.
- **Set the lights' alpha to zero and keep the tokens.** Eight tokens nothing draws, still turned by every accent and
  swept by the contrast check, read as a design that is there.

## Consequences

- The ground is the base gradient with grain in light and dark, and flat in high contrast.
- The *Background glow* row leaves Settings › Appearance. Whether the grain should be switchable is carried to the
  owner as a question.
