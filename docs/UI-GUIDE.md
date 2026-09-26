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

**It scans the component stylesheets, `app.css` and `primitives.css`.** Read
2026-09-15 with `npm run check:bordertokens`, exit 0: *"2 CSS file(s), 103 boundary
declaration(s), 22 marked decorative."* Nothing re-reads those figures, so run the
command rather than trusting them. On a tree with no stylesheet it says `NOTHING TO
SCAN` rather than reporting clean, because an empty tree and a broken walker print
the same thing otherwise; `npm run proof:bordertokens` is what says it can see.

*Corrected 2026-09-15:* this paragraph said the check examined nothing because no
component stylesheet existed. Both files had been tracked for weeks.

---

## Colour: what you may write, and what you must not store

**No raw hex in a component.** §10.2 says *in a component*, and
`monstera/no-raw-hex` is scoped to component `.tsx`; `packages/ui/src/tokens.css`
is the single writer of the colour values components use. A colour that is
genuinely the person's — a stored annotation colour — is a value, not a literal,
and needs no exemption. A default that stands in for one is converted from the
module that owns it (`STARTING_STYLE_COLOUR` from the shape tools' red), never
retyped.

*Corrected 2026-09-15:* this read *"No raw hex, anywhere"*, wider than the law —
the same misreading `CLAUDE.md` carried until 2026-08-31.

**A contrast-bearing colour is computed at the point of use**, via
`onColor(brand, background, minRatio)`. **Storing a derived colour is a defect** —
it is a second copy of an answer that has one owner, and it goes stale silently
the moment the background it was derived against changes.

`onColor` lives in `@monstera/shared` and returns a `Result`: it refuses an empty
background set and an unreachable ratio rather than returning a colour nobody
asked for. In a component, call it through **`useOnColor`**, which solves against
the tokens in effect and writes the answer onto the element.

> **Two things `useOnColor` does that are not obvious, and both are load-bearing.**
>
> **It reads the tokens at YOUR element, not at the root.** A theme is whatever
> element carries `data-theme` — `tokens.css` writes those selectors unqualified
> — so an inverted panel or a preview pane showing the opposite theme remaps the
> tokens for everything inside it. A root-side read returns the wrong values
> there and renders something that merely looks slightly off.
>
> **It holds no state, and it re-solves when the theme changes.** The answer goes
> straight onto the node through `style.setProperty`, which is a CSSOM write and
> therefore not intercepted by §9.27's `style-src 'self'`. Storing the solved
> colour in React state was the first version, and it was wrong twice over: it
> cascaded a render, and its dependencies were the token *names*, which do not
> change when the theme does — so it computed once at mount and then held a stale
> colour. That is the stored derived colour this section forbids, arriving by the
> back door.
>
> §10.2 also requires CI to exercise the derivation *across every (context,
> minRatio) pair*. That is **not** done: `check:tokencontrast` evaluates the
> declared pairs and still reports `--accent-soft`'s derived foreground as
> **DEFERRED**. Owed.

Tokens carry a **role**, declared in `tokens.css` beside the value, and the role
decides what is checked:

| category | means | checked at |
|---|---|---|
| `surface` | something is drawn on top of it | — (it is the background in other pairs) |
| `text` | reading text | 4.5:1 against each declared surface; **7:1 under `hc`** |
| `boundary-control` | the boundary of something operable | 3:1 against each declared surface |
| `boundary-decorative` | a divider, an outline, a rule | not checked |
| `fill` | a solid block of brand colour | — |
| `ground` · `glow` · `tint` | the window's base, the lights over it, a surface's own gradient | — (they are what translucent surfaces are composited over) |

A TRANSLUCENT surface says what it sits `@over` (a surface, `ground`, or `any` for anything that floats), and its
pairs are checked against every colour it can present (ADR-0106). A new token needs its role on the same line as its value. A role without a value,
or a value without a role, fails `check:tokencontrast` in both directions — an
incomplete declaration silently narrows the check, which is the failure the
bidirectional test exists to prevent.

---

## Themes are three states, not two

Dark and light are both first-class from the first commit, and high contrast is a
third. Write every colour as a token so a theme swap is a token swap; a component
that names a colour directly is a component that only works in one theme.

**A theme is an element, not the page.** `tokens.css` declares its theme blocks
as `[data-theme='light']` rather than `:root[data-theme='light']`, so the
attribute remaps tokens for whatever element carries it and for everything below
it. Two things follow: anything that resolves a token must resolve it *at the
element it is styling* (`useOnColor` does), and anything watching for a theme
change must watch the subtree, because a panel switching its own theme touches no
attribute on the root.

---

## Strings, dialogs, icons

Every one of these is substrate rather than a feature — B9's whole point is that
they cannot be retrofitted across tens of thousands of lines.

- **No literal user-facing string in JSX.** Strings are i18n keys from the first
  line. `monstera/no-jsx-literals` is an **error** over both `.tsx` trees
  (`eslint.config.js`), and `proof:lintrules` drives a planted offender through
  the real config. What a lint rule cannot see is a literal passed to a
  text-bearing **prop**; that half is `MessageKey`'s, whose minter refuses a
  sentence. *Corrected 2026-09-15:* this said the rule was owed; it has existed
  since 2026-08-28.
- **Every dialog uses the one `<Dialog>` primitive**, registered through
  `declareDialog`. Not a div with a role, not a second modal — the primitive is
  where focus trapping, escape handling and the a11y contract live once.
  **A dialog opens with focus on its popup**, which a screen reader announces by
  its title. Focus on the first tabbable lands on the header's Close button, whose
  tooltip opens on focus and swallows the first Escape (design pass H1b,
  `Dialog.test.tsx`). *Still owed: a check that no second modal is written —
  nothing looks for a `div` with `role="dialog"`.*
- **The primitives** are in `packages/ui/src/primitives/`: `Button`,
  `IconButton`, `Input`, `Dialog`, `Tooltip`, `ToolButton`, `SegmentedControl`,
  `Splitter` and `Icon`. A control a feature needs that is not one of these is a
  primitive to add, not a one-off in the feature. Two rules that are not obvious
  from the markup: **a `Splitter` side that shuts stays a pane at zero width**,
  because the machine lays panes out by index and a changed pane count widened the
  other side (2026-09-15); and **a title bar control is `no-drag`**, or the window
  drag region swallows its click.
- **A colour setting is built with `colourSchema({ unset, starting })`** and
  carries `unsetTitle`; the Settings dialog draws it as a no-choice checkbox beside
  a colour input. Never recognise a colour setting by the shape of its union.
- **No emoji as icons.** Emoji render differently per platform and carry no
  accessible name. **Every named glyph comes from `primitives/icons.ts`**, one
  closed map over lucide. A command's `icon` is an `IconName`, so a misspelt glyph
  does not compile. `CommandRegistry` refuses, at startup, a command placed on the
  ribbon, the quick toolbar or the start screen that names none. A glyph beside
  visible text is `<Icon name size />`, which is hidden from assistive technology
  because the text is its name. A glyph alone is `IconButton`, whose label is
  required. Both take one of §10.4's four uses, never a pixel value.
  *Corrected 2026-09-14:* this line used to say icons come from "the generated
  set", and no such set existed until the map above.
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

**The gate runs.** `npm run test:a11y` drives the BUILT renderer against the
browser shim on both CI legs, fails on any `serious` or `critical` violation, and
carries a planted `image-alt` offender as its positive control — *no violations*
is also what an axe that never ran reports. Each case asserts a string only its
own screen shows, because an empty page scores clean. Component tests over
`happy-dom` and `@testing-library/react` still query by role and label, so a
control that loses its name goes red before a screen is composed; they are not
the gate, because a screen of correct parts can still fail on focus order and
post-composition contrast.

**Anything that measures layout belongs to the rendered cases**, because happy-dom
lays nothing out and every element measures 0. A unit case may stub a single
measurement when the property under test is a commit's arithmetic rather than a
drawn size — `Splitter.test.tsx` does, and says why.

*Corrected 2026-09-15:* this section said neither axe-core nor Playwright was
installed and counted 29 component cases. The gate has run in CI since
2026-09-01; the count is not given, because nothing re-reads it.

---

## Visual baselines (§10.7)

`npm run test:visual` compares the start screen, the keyboard shortcuts dialog,
the eight rail sections and the right contextual panel, in light, dark and high
contrast, against `packages/testing/baselines/`. `npm run test:visual:regenerate`
rewrites them, **in a commit that carries nothing else** — §10.7's own rule, and
the only way a reviewer can tell a deliberate visual change from drift.

- **The tolerance is stated in `scripts/test/visual.config.mjs` with its readings**:
  pixelmatch threshold 0.2, at most 100 differing pixels, chosen between a spread of
  0 across three runs and 319 pixels for a planted one-word change. A figure that
  starts failing is re-chosen from a new reading, never raised to pass.
- **A capture waits for what is late, never for time**: the page drawn, a lazy
  dialog's body. Playwright's stability rule is two identical frames, and a document
  that has not started drawing is two identical frames.
- **The baselines are Windows'**, named by platform. A baseline is one platform's
  rasterisation.

---

## When this file is wrong

It is derived. `docs/ARCHITECTURE.md` §10 and the ADRs are the law, and the
checks are the mechanism. If you find this file saying something the check does
not enforce, that gap is either a missing check or a stale sentence — say which,
in the commit that fixes it.
