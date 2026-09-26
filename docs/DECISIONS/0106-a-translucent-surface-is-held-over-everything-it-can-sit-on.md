# ADR-0106 — A translucent surface is held to its floors over everything it can sit on

- **Status:** Accepted
- **Date:** 2026-09-26
- **Amends:** `docs/ARCHITECTURE.md` §10.2 (the token categories and what the contrast check evaluates).
- **Relates:** [ADR-0003](0003-token-role-typing-and-declared-pairings.md) (roles, categories and declared pairs).
- **Recorded after the code** (`f124f5fe`), in the same unpushed range — the ordering B4 asks for was missed, and
  the report of 2026-09-26 says so. The decision below is what that commit built.

## Context

The owner's v5 design (`v5-design-values.md`) draws every panel as a translucent colour over a lit ground: four
radial lights over a dark or pale base, a grain, and a gradient of its own on each surface. §10.2's check evaluated a
foreground against a surface's value, and the shared `channels` reads an `rgba()` with nothing beneath it as the
opaque colour — so every translucent pair would have been evaluated against a colour that never renders, and passed.
The dialog's glass (2026-09-25) had been special-cased in a block of its own; the design makes translucency the rule.

## Decision

Three categories join §10.2's table, none carrying an obligation of its own:

| Category | Role |
|---|---|
| `ground` | a colour the window's own background is at some point |
| `glow` | a light laid over the ground, taken at its peak |
| `tint` | a surface's own gradient at its peak, laid over the surfaces it names `@on` (or over `ground`) |

A translucent `surface` must declare what it sits `@over`: other surfaces, `ground`, or `any` — flat white and flat
black, for a surface that floats over the page or anything else. The check builds, per theme, every opaque colour
each surface can present — the ground alone and under each glow, each translucent surface composited over each colour
of what it sits on, each with and without its tints — and holds every declared `text`, `boundary-control` and
`graphic` pair to its floor against the **worst** of them. A translucent surface declaring no `@over` is refused,
because what it presents cannot be known. The dialog-glass block is removed: dialogs, menus, tooltips and the floating
toolbar are one `float` surface `@over any`.

A glow is taken at its peak everywhere, and two glows are never stacked: v5's peak in different corners of the
window. That is conservative for most of the window and exact where the bars' text sits.

## Consequences

Seven of the design's values could not hold their floors over the lit ground and were moved by the least amount that
does; each is marked `v5 was …` in `tokens.css` with the pair that forced it, and the report lists them. High contrast
is unchanged in kind: its surfaces are solid and its lights and tints are transparent.

## Rejected

- **Keep evaluating the rgba as opaque.** Passes pairs that render under their floor — the reassuring answer from an
  input the instrument cannot see.
- **Composite over the base ground only.** The failures v5 actually has are under the green glow's peak; a check that
  left the glows out passed all of them.
- **A block per translucent surface, as the glass was.** The second one is where two opinions about compositing begin.
