# ADR-0114 — The ground's light follows the accent, computed from its hue at the point of use

- **Status:** Accepted
- **Date:** 2026-09-27
- **Amends:** `docs/ARCHITECTURE.md` §10.2 (the `glow` and `tint` categories, which were stored values) and the
  accent's reach, which was the accent, its label, selection and focus.
- **Decided by:** the owner's 27 September list, item 6: *"Derive every glow and tint from the accent at the point of
  use (never stored), keeping the design's relationships between them. The default accent gives exactly today's look.
  Add an Appearance setting 'Background glow': On (default) / Off (plain ground, no grain). High contrast stays flat
  regardless. Contrast floors hold over every derived tint."*
- **Relates:** ADR-0003 (token roles), [ADR-0106](0106-a-translucent-surface-is-held-over-everything-it-can-sit-on.md)
  (a translucent surface is held over everything it can sit on).

## Decision 1 — a light takes the accent's HUE, and keeps the design's lightness, chroma and alpha

Each ground colour, glow and tint the design draws in green is stored once as the design's value, and the theme's own
accent is its reference. For an accent with OKLCH hue `h` and chroma `c`, every light is its design value in OKLCH with
its hue turned by `h − h₀` and its chroma scaled by `min(1, c / c₀)`, where `h₀, c₀` are the theme accent's. Lightness
and alpha are the design's. So:

- **the relationships hold** — the teal glow stays the green's neighbour on the far side, the warm one stays warm
  relative to it, and each keeps its strength;
- **the default accent reproduces today exactly** — a turn of zero and a scale of one are the identity, and a case
  asserts every value to the byte;
- **a grey accent gives a neutral ground** rather than a green one under a grey accent.

**The hue, not the colour, is the input, and that is what makes the floors provable rather than hoped for.** A light
whose lightness and alpha are fixed can present only a two-parameter family of colours — a turn and a scale — so the
contrast check sweeps that family (every degree, several scales) and holds every text and control pair over every
member. An accent is any six-digit colour a person types; a proof over the family is a proof over all of them.

**What turns** is named once, in `ACCENT_LIGHTS` beside the function: the ground's own colours (`--app-bg`,
`--ground-start`, `--ground-mid`, `--ground-end`), the four glows, every `tint-*` role and each gradient's far stop —
which become roles of their own (`--tint-mica-far`, `--tint-ribbon-far`, `--tint-status-far`, `--tint-canvas-far`,
`--tint-hero-far`) so the check can see them — `--dialog-head-wash`, `--accent-soft`, and the two colours the design's
glows and selection rings are drawn in, `--light-ring` and `--light-halo`, `fill` roles the shadow values now name.
What does not turn is as deliberate: text, borders and the page, which carry the contrast obligations; the brand tones
ADR-0113 fixes; and the accent's own solid fills, which `applyAccent` already writes.

## Decision 2 — computed where it is applied, one module, never stored

`accentLights` in `@monstera/shared` computes the family; `applyAccent` writes the results as custom properties on the
root when the accent or theme changes, beside `--accent` and `--on-accent`, and removes them for the theme's own accent.
The setting stores the one colour a person chose, as §10.2 requires. `check:tokencontrast` imports the same function,
so the check and the application cannot hold two opinions about what a light is (B3a).

## Decision 3 — *Background glow* is a setting; high contrast is flat regardless

`appearance.background-glow`, on by default. Off draws the plain ground — the design's base gradient, no glows, no
grain — and the tints on panels stay, since they are part of each surface rather than of the ground. High contrast
draws no light whatever either setting says, as it does today.

## Rejected

- **CSS relative colour (`oklch(from var(--accent) …)`) in `tokens.css`.** It computes at the point of use with no
  script, and it cannot be checked: the contrast check reads the token file, and a value that exists only once a
  browser resolves it is a colour the check cannot see — ADR-0003's *"a value with no role"*, arriving by syntax.
- **Take lightness and chroma from the accent too.** A pale accent would then light the ground more, a dark one less,
  and the family the check must sweep becomes the whole colour space; the floors would hold only where someone happened
  to look.
- **Keep the stored greens and tint only the start screen.** The owner's words are *every glow and tint*.

## Correction, 2026-09-27 — a turned light is drawn weaker, and the ground's own colours do not turn

**Decision 1 said the lights keep the design's alpha, and that a pass over the family followed from lightness and
alpha being fixed. The sweep refuted the first half on its first run.** The design's text and control edges were solved
to their floors with no headroom — the tightest pair reads 3.00:1 against 3:1, several 4.50:1 against 4.5:1 — so a
light turned at the design's full strength broke seven pairs by a hundredth, some under a turn of one degree; the
composite over a ground is not a function of lightness alone. Every light lowers contrast in both themes, so **a turned
light is drawn at 0.75 of the design's alpha** (`TURNED_STRENGTH`), and the theme's own accent still at all of it — the
default is the design exactly. At 0.85 three light-theme pairs still failed near a 207° turn; at 0.75 all 144,120
evaluations pass. The family is still two parameters, so the sweep's argument stands.

**Decision 1 listed the ground's own colours among what turns. They do not.** An opaque near-black turned by its hue
moves its luminance, and it is the base the floors were solved against. The glows over it, the tints and the rings
turn; `--app-bg` and the ground gradient's three stops stay the design's.

**The sweep is 360 degrees at five chroma scales, and it costs about a minute** (57 s measured on this machine): parsing
the same colour strings again was over half of each evaluation (a CPU profile), so the one parser now remembers what it
has parsed, and the sweep leaves out high contrast, whose lights never turn.
