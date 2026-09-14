# ADR-0066 — The splitter's drag cursor is admitted by hash

- **Status:** Accepted
- **Date:** 2026-09-14
- **Amends:** `docs/ARCHITECTURE.md` §9 invariant 27 — the pinned `style-src` line gains three
  `'sha256-…'` sources. No other directive changes.
- **Relates:** [ADR-0019](0019-the-renderers-csp-is-pinned.md) (the policy is pinned, and a
  library that trips it gets *"a measured amendment"*, preferring *"a hash, over a blanket
  grant"*), [ADR-0005](0005-ui-foundation-libraries.md) (`@zag-js/splitter` for *"resizable side
  panels with persisted widths (§10.3)"*).
- **Context:** Stage 8's design pass, commit C2 — §10.3's *"panels resizable with persisted
  widths"*.

## The gap

`@zag-js/splitter` 1.43.3, already a `packages/ui` dependency and unused, appends a `<style>`
element to `head` on every drag:

- `splitter.dom.mjs` `setupGlobalCursor` writes `* { cursor: X !important; }`, where `getCursor`
  picks X from `col-resize`, `e-resize` and `w-resize` for a horizontal splitter.
- `utils/registry.mjs` `setGlobalCursor`, the only path that skips the one above, writes the same
  shape with its own cursor set. **No configuration of that version injects nothing.**

Invariant 27 pins `style-src 'self'`, and §9.27 names this exposure. Measured in `36ac3b5`: the
renderer refuses that element. So the library ADR-0005 chose for this row cannot be used under
the policy as pinned.

## Decision

`style-src` grants `'self'` and the SHA-256 of exactly the three texts a horizontal splitter
without a registry can inject:

| hash source | text |
|---|---|
| `'sha256-xdlIrB/4WiSknZvpoFpCjfGK/lJUmYy2eZyjhAkS6Gc='` | `* { cursor: col-resize !important; }` |
| `'sha256-jCCYA3vpFOJV+i2q53qkChQ7iYHu/CA8MARujZ+f5lg='` | `* { cursor: e-resize !important; }` |
| `'sha256-kf+FbTsVu4ocGti/dUsGhX4NbwF01+EmbZmIT5W1mGI='` | `* { cursor: w-resize !important; }` |

Computed by a scratch script whose control first reproduced the published digest of the empty
string. A vertical splitter or a registry would inject other texts; each owes its own amendment,
and until it has one it is refused at the first drag, which is the loud direction.

## Measured, 2026-09-14 (Electron's Chromium, `proof:rendererpolicy`)

1. **A hash admits a script-inserted `<style>`.** The harness inserts the `col-resize` text: no
   `style-src` violation fires, and the `<body>`'s computed cursor is `col-resize` — the effect,
   not only the absence of an event.
2. **One character is enough to refuse.** The same text with one more space fires a `style-src`
   violation and the cursor does not change. That refusal is also what proves the listener hears
   `style-src` at all.
3. **The admission depends on the hash.** With the `col-resize` source removed from both the pinned
   block and the derived constant — so the block-equals-constant comparison stays green — the
   admission case alone failed, one failure line, the other twenty-one passing.

22 renderer-policy cases pass with the amendment.

## Rejected alternatives

**`'unsafe-inline'`.** It admits every inline style anyone can inject, which is the grant ADR-0019
dropped before pinning and the one `windowPolicy.test.ts` forbids by name.

**A `nonce`.** It is the library's own escape, and a nonce must be fresh per response to mean
anything. The renderer loads one `file://` document with a header set once by `main`, so a
nonce here would be a fixed secret in the build — a blanket grant spelt differently.

**The registry path.** It moves the injection to `utils/registry.mjs`; it does not remove it.

**Patching or forking the library.** A patched dependency is a second copy of someone else's
code that every upgrade must re-apply, and the drag cursor is behaviour worth keeping: without it
the cursor flickers back to the default whenever the pointer leaves the thin trigger mid-drag.

**A splitter of our own.** Pointer capture, keyboard resizing, `aria-valuenow` and constraint
arithmetic are what ADR-0005 took this machine to avoid writing, and it would be a second opinion
about a widget the chosen library already implements (B3a).

## Consequences

- A `@zag-js/splitter` upgrade that changes any of those three texts is refused at the first drag,
  and `proof:rendererpolicy`'s admission case fails in CI before that — it inserts the text the
  harness names, which then has to be checked against the new build. The texts are recorded above
  so that comparison needs no archaeology.
- Enforcement evidence for `style-src` now has two sides: an admitted text and a refused one.
- The C2 feature commit wraps the machine in a primitive (ADR-0005:145) configured horizontal and
  without a registry, which is what keeps the injected set inside these three.
