# UI-GUIDE — the practical companion to `docs/ARCHITECTURE.md` §10

§10 is the law. This file is what you read while writing a control, and it
exists because one token decision is reliably got wrong by default
([ADR-0003](DECISIONS/0003-token-role-typing-and-declared-pairings.md)).

Where this file and §10 disagree, **§10 is right and this file is stale** — fix
it in the same commit, the same rule `CLAUDE.md` carries for itself.

---

## The one decision this file exists for: which border token

Monstera has three border tokens and they are not interchangeable. The rule is
about the **thing being bordered**, never about how the line looks:

> **If a user can click it, type in it, drag it or focus it, its boundary is
> `--border-control`. Everything else uses `--border` or `--border-soft`.**

That is a contrast requirement, not a preference. WCAG 1.4.11 attaches 3:1 to
the boundary of a user interface component and attaches nothing to a decorative
divider. `--border-control` is solved for it — `#74787c` on dark, `#848688` on
light, worst case 3.04:1 and 3.10:1 — and `--border` is deliberately far below
it, because raising every divider to that value turns a calm dense tool into a
wireframe. ADR-0003 rejected that global raise by name.

### Do

```css
/* A text input: the user types in it, so its boundary is control-grade. */
.field {
  border: 1px solid var(--border-control);
  background: var(--surface);
  color: var(--text);
}

/* A panel divider: nothing here is operable, so it stays quiet. */
.rail {
  border-right: 1px solid var(--border);
}
```

### Don't

```css
/* WRONG. The slider track is a control's boundary and this is decorative-grade:
   measured at 1.16:1, which is the accessibility defect underneath the number,
   not a styling opinion. */
.zoom-slider__track {
  border: 1px solid var(--border);
}

/* WRONG the other way. A separator is not a control, and control-grade here is
   a visible mid-gray line across a surface that should read as one piece. */
.ribbon__group-separator {
  border-left: 1px solid var(--border-control);
}
```

### The set, so you do not have to judge case by case

`--border-control` is what text inputs, the find field, the page field, the
command search, the layout switcher, secondary buttons, checkboxes, radios,
select triggers and the zoom slider track use.

`--border` and `--border-soft` are for region dividers, separators, window and
dialog outlines, and non-interactive containers.

**A control you are adding that is not in the first list still takes
`--border-control`.** The list is what exists, not what is permitted.

### What is mechanised, and what is not yet

`npm run check:tokencontrast` reads `packages/ui/src/tokens.css`, evaluates every
declared pairing, and fails when one misses its category's ratio. That guards the
**values**: it is why `--border-control` is 3.04:1 rather than 1.16:1.

**Usage is guarded by `npm run check:bordertokens`**, and it works by inverting
the burden rather than by guessing which selectors are interactive — ADR-0003
rejected that inference by name, because a scan wrong about `.rail--active` or
`.tab` fails silently.

So the rule it enforces is:

> Every `border` or `outline` property using `var(--border)` or
> `var(--border-soft)` is reported, **unless the same line carries a CSS comment
> beginning `decorative:` and a reason.**

Write the reason for a reader, not for the scan: *region divider*, *group
separator*, *dialog outline*. The scan only checks that you gave one; whether it
is honest is what a reviewer reads. If you find yourself writing
`decorative: because the design says so` on something a user can click, that is
the defect the rule exists for.

**It examines nothing today** — there is no component stylesheet yet — and it
says `NOTHING TO SCAN` rather than reporting clean, because an empty tree and a
broken walker print the same thing otherwise. `npm run proof:bordertokens` is
what says it can see. The first `.css` file added to `packages/ui` puts it to
work.

---

## Colour: what you may write, and what you must not store

**No raw hex, anywhere, outside `packages/ui/src/tokens.css`.** Not in a
component, not in a style module, not as a "just this once" default. §10 forbids
it and the token file is the single writer of colour values.

**A contrast-bearing colour is computed at the point of use**, via
`onColor(brand, background, minRatio)`. **Storing a derived colour is a defect** —
it is a second copy of an answer that has one owner, and it goes stale silently
the moment the background it was derived against changes.

> **`onColor` is not written yet.** §10.2 requires it and requires CI to exercise
> it across every (context, minRatio) pair; today the name appears only inside
> `scripts/lib/tokenContrast.mjs`, which reports `--accent-soft`'s derived
> foreground as **DEFERRED** rather than skipping it. So the rule above is what
> you must build to, not a function you can call. Do not work around its absence
> by storing a value — that is the defect the rule names, and it is the one thing
> here that would be expensive to undo.

Tokens carry a **role**, declared in `tokens.css` beside the value, and the role
decides what is checked:

| category | means | checked at |
|---|---|---|
| `surface` | something is drawn on top of it | — (it is the background in other pairs) |
| `text` | reading text | 4.5:1 against each declared surface |
| `boundary-control` | the boundary of something operable | 3:1 against each declared surface |
| `boundary-decorative` | a divider, an outline, a rule | not checked |
| `fill` | a solid block of brand colour | — |

A new token needs its role on the same line as its value. A role without a value,
or a value without a role, fails `check:tokencontrast` in both directions — an
incomplete declaration silently narrows the check, which is the failure the
bidirectional test exists to prevent.

---

## Themes are three states, not two

Dark and light are both first-class from the first commit, and high contrast is a
third. Write every colour as a token so a theme swap is a token swap; a component
that names a colour directly is a component that only works in one theme.

---

## Strings, dialogs, icons

**Three of the four rules below still have no mechanism**, and every one of them
is substrate rather than a feature — B9's whole point is that they cannot be
retrofitted across tens of thousands of lines. They are listed here so the first
component written obeys them, and each names what is owed:

- **No literal user-facing string in JSX.** Strings are i18n keys from the first
  line. *Owed: the lint rule. `eslint.config.js` registers no such rule today.*
  The primitives take their text as **props rather than children**, which puts
  the ban at that boundary in the meantime; it is not a substitute, because a
  feature composing its own JSX is not covered by it.
- **Every dialog uses the one `<Dialog>` primitive.** Not a div with a role, not
  a second modal — the primitive is where focus trapping, escape handling and the
  a11y contract live once. **Landed 2026-08-28**:
  `packages/ui/src/primitives/Dialog.tsx`, on Base UI, with `Button`,
  `IconButton` and `Input` beside it. *Still owed: a check that no second modal
  is written — the rule is a rule, and nothing looks for a `div` with
  `role="dialog"`.*
- **No emoji as icons.** Icons come from the generated set; emoji render
  differently per platform and carry no accessible name.
- **No magic pixel values.** Spacing and radii are tokens for the same reason
  colours are.

---

## Accessibility is checked by running the screen, not by reading the source

The a11y mechanism is **axe-core driven over Playwright against real screens**,
not a source-level JSX linter. A rule that reads source can confirm an attribute
is present; it cannot tell you the focus order is wrong, the contrast fails after
composition, or the dialog never got focus. Those are the defects that reach
users.

So a new primitive is done when a screen containing it passes the axe run — not
when its markup looks right.

> **Neither axe-core nor Playwright is installed.** This paragraph is the
> specification the primitives must eventually meet, not a suite you can run
> today. It is written down because the alternative — build the primitives, then
> decide how they are checked — is how a project ends up with a source-level
> linter standing in for a real screen.
>
> **Corrected 2026-08-28.** This paragraph used to end *"and React is not
> installed either"*. React went in at `3e25b74`, a range before that was
> noticed, and the sentence stayed true about axe and Playwright the whole time
> — a compound claim with one clause dead and one alive, which is the shape a
> reader checks the living half of and passes over. Recorded as audit finding
> EEEE-2 rather than quietly fixed, because nothing in this repository could have
> caught it: no check reads this file, and no commit ever touched both this
> sentence and the code that falsified it.
>
> **What IS runnable today**, and it is less than this section requires: 29
> component cases over `happy-dom` and `@testing-library/react`, querying by
> accessible role and label so a control that loses its name goes red. That is
> not the axe gate. A screen composed of correct parts can still fail on focus
> order and post-composition contrast, which is the whole reason §10.4 puts the
> mechanism at runtime.

---

## When this file is wrong

It is derived. `docs/ARCHITECTURE.md` §10 and the ADRs are the law, and the
checks are the mechanism. If you find this file saying something the check does
not enforce, that gap is either a missing check or a stale sentence — say which,
in the commit that fixes it.
