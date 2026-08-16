# ADR-0005 — UI foundation: Base UI, cherry-picked Zag machines, Lingui, zustand

- **Status:** Accepted
- **Date:** 2026-08-16
- **Satisfies:** `docs/ARCHITECTURE.md` §10.4's requirement that the headless
  primitive library be decided by ADR in Stage 0, defaulting to a library.

## Context

§10.4 says behavior comes from a headless primitive library skinned with our
tokens, because accessible focus traps, menus and comboboxes are exactly the
class of solved problem Rule 0 says not to re-derive by hand. Three candidates
were named: Radix, Base UI, Ark UI.

Two premises turned out to be wrong, and both are worth recording because each
is a trap that produces a confidently wrong conclusion:

1. **`@radix-ui/react-primitives` has never existed** (HTTP 404). The current
   layout is the unified `radix-ui` package, or individual `@radix-ui/react-*`.
2. **Base UI renamed its package.** `@base-ui-components/react` carries an npm
   `deprecated` field reading *"Package was renamed to @base-ui/react"* and is
   frozen at `1.0.0-rc.0` (2025-12-04). The live package is **`@base-ui/react`
   at 1.7.0** (2026-08-04), eight stable minors past 1.0 on a monthly cadence,
   with no prerelease dist-tag at all. Querying the old name is how one
   concludes "Base UI is still in RC" — which this project did, briefly, before
   the check caught it.

## Decision

### Primitives: `@base-ui/react` ^1.7.0, plus individual `@zag-js/*` machines

**Base UI as the foundation.** The decisive fact is coverage, not maturity:
**Radix ships no combobox and no autocomplete.** §10.4 and the C7 command
palette both require one. Choosing Radix would mean bolting on Downshift or
cmdk — a second accessibility model, a second keyboard convention, and a second
set of bugs in precisely the widget class where a dense professional tool most
needs consistency. Radix is maintained; it simply does not cover the
requirement.

Base UI covers, first-party: combobox, autocomplete, menu, menubar, tabs,
slider, dialog and alert-dialog with focus trap, select, toolbar, context-menu,
navigation-menu, number-field, scroll-area, field/form/fieldset — one package,
five runtime dependencies.

**Zag machines, individually, for the widgets only a document editor needs.**
Ark UI is the best-covered library but pulls 66 `@zag-js/*` packages pinned to
exact versions, so every Ark release churns 66 lockfile entries — a large,
noisy supply-chain surface for a project whose dependency tree will be audited
for AGPL compliance and Store submission. Because Zag publishes per-machine
packages, the four widgets nobody else implements can be taken without the
other 62:

| Package | Serves |
|---|---|
| `@zag-js/tree-view` | bookmarks / document outline panel (D1) |
| `@zag-js/splitter` | resizable side panels with persisted widths (§10.3) |
| `@zag-js/signature-pad` | visible signature capture (D7) |
| `@zag-js/color-picker` | annotation and highlight colour (D3) |

All at 1.43.0, MIT.

### i18n: Lingui (`@lingui/core` + `@lingui/react` ^6.6.0)

B9 imposes two hard requirements — a lint rule banning literal user-facing
strings in JSX, and automated message extraction — and they decide this
structurally rather than by preference.

Lingui is **source-as-message**: `<Trans>Save As…</Trans>`, where the English
source *is* the key. i18next is **key-as-indirection**: `t('menu.file.saveAs')`
plus a separately maintained key namespace.

Under Lingui the fix for a lint violation is to wrap the string and stop. Under
i18next every violation forces a naming decision, and across a PDF editor's
thousands of menu items, tooltips, tool names and error strings that taxonomy
becomes a permanent maintenance surface with its own drift and its own review
debates. The lint rule fires far more often in this application than in a
typical one, which amplifies the difference rather than making it academic.

`@lingui/cli` extracts by walking the AST and compiles catalogs to plain JS at
build time — the right shape for a desktop app where every locale ships inside
the package and no HTTP backend ever exists. `extract --clean` fails CI when
catalogs drift from source, which is what makes B9 enforcement rather than
intention. `.po` output is also the native format for Weblate and Crowdin, which
is how a free AGPL project actually receives community translations.

`eslint-plugin-lingui` 0.14.0 supplies the `no-unlocalized-strings` rule family
and understands Lingui's macros, so it does not fire on already-translated text.

### State: `zustand` 5.0.15

Confirmed rather than reconsidered. Zero hard runtime dependencies, all peers
optional, published three days before this decision.

The architecturally load-bearing part is *how* it is used, and it is not the
default pattern: **one store instance per open document, created with
`createStore` from `zustand/vanilla` and passed through React context.** The
module-level `create()` singleton that every tutorial shows is wrong here — it
leaks state across documents and makes closing a tab a manual reset, which is
the cross-tab corruption class §6 makes unrepresentable by shape.

## Rejected alternatives

- **Radix UI as the foundation.** No combobox, no autocomplete. Also publishes
  no GitHub Releases, so there is no changelog channel to track.
- **Ark UI as the foundation.** Excellent coverage and genuinely good
  engineering, but 66 exact-pinned transitive packages and a state-machine
  interpreter under every widget. Taken in pieces instead of whole.
- **Hand-rolled primitives.** Rule 0 names this directly: accessible focus
  traps, menus and comboboxes are a solved problem and re-deriving them by hand
  is how an app acquires a keyboard-accessible UI that no screen reader can use.
- **i18next + react-i18next.** Healthy, MIT, larger ecosystem, better-known.
  Rejected on the two hard requirements above. Its extractor, `i18next-parser`
  9.4.0, is also the weakest link in the toolchain: last published 2026-02-22,
  `engines` capped at Node 22 with no Node 24, and structurally unable to
  resolve dynamically-constructed keys.
- **`eslint-plugin-react`'s `react/jsx-no-literals` as the lint mechanism.**
  Last published 2025-04-03 and its ESLint peer range stops at `^9.7` — it does
  not support ESLint 10.
- **jotai / valtio / nanostores / @tanstack/store.** Valtio's snapshot model
  pairs neatly with an undo stack and was the one worth a second look, but §4
  already builds undo on a command log with checkpoints, so the snapshot
  affordance buys nothing. `@tanstack/store` is pre-1.0.

## Consequences

- **Node ≥ 22.19.0 is now the floor**, raised from 22.12.0. Every `@lingui/*`
  package declares `engines: node >=22.19.0`. This is build-time only —
  Electron's bundled Node is irrelevant to the renderer — but CI images and
  contributor machines must meet it or npm emits `EBADENGINE`. Recorded in
  `package.json` and `CONTRIBUTING.md`.
- `@lingui/vite-plugin` 6.6.0 peers `vite ^6.3.0 || ^7 || ^8`, compatible with
  the Vite 7.3.6 pin in [ADR-0004](0004-toolchain-versions.md).
- Lingui requires a macro transform, which is the main integration cost. The
  Babel-based `@lingui/vite-plugin` is the path under electron-vite; this is
  decided **before** the first `<Trans>` is written, because switching transform
  strategies later touches every localized file.
- `eslint-plugin-lingui` is 0.x and must be pinned exactly — rule options can
  move between minors.
- Expect to tune `no-unlocalized-strings` ignore patterns: a PDF codebase is
  full of legitimate non-UI literals — PDF operator names, filter names like
  `FlateDecode`, MIME types, CSS values. Each allowlist entry is narrow and
  carries a reason; a blanket disable is the banned shape.
- Two primitive sources means two skinning surfaces. Both are headless and
  token-skinned, so this is a real but bounded cost; the mitigation is that
  every Zag machine is wrapped in our own primitive in the primitives package,
  so no feature ever imports `@zag-js/*` directly.
- **`lucide-react` 1.x migration notes are unverified.** GitHub rate-limiting
  blocked the 1.0.0 release notes and `lucide.dev/guide/migration/1.0.0` 404s.
  Nothing is being ported from 0.x, so this is not blocking, but no icon usage
  should be copied from pre-2026 examples without checking the import path.
