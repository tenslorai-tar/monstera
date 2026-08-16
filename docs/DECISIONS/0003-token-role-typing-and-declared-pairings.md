# ADR-0003 — Token role typing: five categories and declared pairings

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** `docs/ARCHITECTURE.md` §10.2 (tokens and contrast).
- **Supersedes:** `BUILD-PROMPT.md` Part M2's two-way role typing — "every color
  role is declared in the token file as **text-bearing** or **fill-only**".

## Context

Part M2 requires contrast to be **enforced, not audited**: CI computes, from the
token file itself, 4.5:1 for every text-bearing role on every surface it may sit
on and 3:1 for UI boundaries. It also names the failure mode to avoid — a check
that needs a wholesale exemption is the green-check-that-verifies-nothing Rule 0
bans.

Before encoding the design draft's token seed, that law was run against it. Two
clusters of failure came out, and they turn out to share one cause.

### Finding 1 — `--border` fails 3:1 by a wide margin, in both themes

| Theme | `--border` | Worst case on chrome | Required |
|---|---|---|---|
| dark | `#33393e` | **1.16:1** | 3.00:1 |
| light | `#dcdfe3` | **1.13:1** | 3.00:1 |
| high contrast | `#ffffff` | 19.03:1 | 3.00:1 |

The token is not simply too faint. It is **doing two jobs with different legal
requirements**:

- *Decorative region dividers* — the ribbon's bottom edge, the rail's right
  edge, panel edges, the window and dialog outlines. WCAG 1.4.11 does not
  require 3:1 here; nothing about identifying a component depends on them.
- *The visible boundary of an interactive control* — the find field, dialog
  inputs, the status-bar page field, the secondary button, and the zoom slider
  track. Here 3:1 **is** required, because the boundary is what identifies the
  control.

The draft is already inconsistent about this, which is itself the evidence that
the distinction is not encoded anywhere: the layout switcher and the Ctrl+K
command search — both interactive — use `--border-soft`, which is fainter still,
while the visually similar find field uses `--border`.

At `#33393e` on `#2a2f33` the zoom slider's track is effectively invisible.

### Finding 2 — text roles fail on `--accent-soft`, on pairs that never render

`--muted` and `--faint` fall to 3.83–4.45:1 when composited over
`--accent-soft`. But `--accent-soft` is the **selected-state** surface — the
active ribbon button, rail section, panel tab, floating-toolbar button — and in
every one of those the label switches to the derived accent text, which clears
4.59:1 (dark) and 4.53:1 (light). `--muted` never sits on it.

So the check as specified fails a pairing that does not exist.

### The shared root cause

**The token file declares colors, but not which foreground may sit on which
surface.** A check derived from "every text role × every surface" is
simultaneously

- **over-broad** — it fails pairs that never render, and the only ways out are
  hand-maintained exception lists or a wholesale exemption, both of which are
  the banned shape; and
- **under-specified** — it cannot distinguish a divider from a control boundary,
  so it must either hold decorative hairlines to 3:1 (turning the whole UI into
  a wireframe of mid-gray boxes) or hold nothing to 3:1.

Two categories cannot express this. Raising `--border` to a passing value is the
patch; typing the roles is the fix.

## Decision

**1. Five role categories, declared in the token file.**

| Category | Contrast obligation |
|---|---|
| `surface` | none itself; is a background others are checked against |
| `text` | 4.5:1 against **its declared surface set** |
| `boundary-control` | 3:1 against every surface it may sit on (WCAG 1.4.11) |
| `boundary-decorative` | none; **lint forbids its use as a control boundary** |
| `fill` | none itself; if it carries a foreground it is also a `surface` |

**2. Every `text` and `boundary-*` role declares the surfaces it may sit on.**
CI checks exactly the declared pairs — no more, no fewer. Invariant L16 (no
literal colors in components) is what makes the declaration exhaustive: a
foreground that is not a token cannot exist, so a pair the check does not
evaluate cannot render.

**3. `--border` splits into two roles**, with these solved values:

| Token | Category | dark | light | high contrast |
|---|---|---|---|---|
| `--border-control` | `boundary-control` | `#74787c` | `#848688` | `#ffffff` |
| `--border` | `boundary-decorative` | `#33393e` | `#dcdfe3` | `#ffffff` |
| `--border-soft` | `boundary-decorative` | `#2b3034` | `#e6e8eb` | `#8a8f94` |

`--border-control` was **solved, not chosen**: it is `onColor(--border, all
chrome surfaces, 3.0)` — the nearest colour to the existing border that clears
the threshold. Worst cases 3.04:1 (dark) and 3.10:1 (light). High contrast
already passed and is unchanged.

`--border-control` is used by: text inputs, the find field, the page field, the
command search, the layout switcher, secondary buttons, checkboxes, radios,
select triggers, and the zoom slider track. `--border` and `--border-soft`
remain for region dividers, separators, window and dialog outlines, and
non-interactive containers.

**4. `--accent-soft` is declared a state surface whose only permitted foreground
is the derived chrome accent text.** That pair is checked and passes. `--muted`
and `--faint` do not declare it, so it is not checked against them — because
that combination is not permitted to render, not because it was excused.

## Rejected alternatives

- **Raise `--border` globally to the solved value.** Every divider in the app —
  ribbon edge, rail edge, panel edges, group separators — would become a
  distinctly visible mid-gray line, turning a calm dense tool into a wireframe.
  It also over-applies a WCAG requirement that does not attach to decorative
  dividers, and an over-strict rule invites the same exemption pressure as a
  wrong one.
- **Exempt `--border` from the 3:1 check.** This is the exemption M2 names and
  bans. It would also leave the zoom slider genuinely unusable at 1.16:1, which
  is the actual accessibility defect underneath the failing number.
- **Keep one border token and check it at 3:1 only where it is used on
  controls.** The check reads the token file, not the usage sites; inferring
  usage would mean parsing CSS modules and reasoning about which selectors are
  interactive. That is a fragile analysis whose failure mode is silence.
- **Special-case the `--accent-soft` × text-role pairs out of the check.** A
  hand-maintained exception list — the patch shape. It grows by one entry per
  newly discovered surface, which is exactly the failure M2's `onColor` rule
  already rejected for derived colours.
- **Drop the CI contrast check and audit manually at Stage 10.** The late-audit
  shape M2 eliminated on purpose. Thirteen violations existed in a token seed
  nobody had rendered yet; at Stage 10 they would be spread across a hundred
  components.

## Consequences

- The token file gains a machine-readable role declaration alongside each value.
  It is no longer only a list of colours; it is the input to the check.
- A lint rule is required: `--border` / `--border-soft` may not be used as the
  boundary of an interactive control. Without it the split is a convention, and
  a convention is not a mechanism.
- `docs/UI-GUIDE.md` must state which border token a new control uses, with a
  do/don't pair, because this is the one token decision a contributor will get
  wrong by default.
- The CI check now needs the pairing declarations to be **complete**. An
  incomplete declaration silently narrows the check, so the primitives are the
  only place foregrounds and surfaces are combined, and a review of a new
  primitive checks its declarations.
- The design draft (`DESIGN-DRAFT.html`) does not implement this split. It
  remains illustrative only, as Part M7 already states; it is not updated,
  because it is a record of the approved layout rather than reference code.
