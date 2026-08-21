# ADR-0020 — The preload is bundled to CommonJS, and enters the contract by a leaf

- **Status:** Accepted
- **Date:** 2026-08-21
- **Amends:** nothing in `docs/ARCHITECTURE.md`. This records how invariant 1's
  preload is built, which the law requires to exist and does not say how to
  produce.

## Context

`apps/desktop/src/preload.ts` is the fourth contract surface: two Electron
imports, one exposed function. Invariant 1 constrains what it may reach, and
`proof:preload` derives that set from the file's own syntax.

**It had never been executed.** The renderer read-back added the same day asked
the page whether the bridge was reachable, and it was not. Electron's
`preload-error` event carried the reason and nothing else did:

```
dist/preload.js: SyntaxError: Cannot use import statement outside a module
```

No stderr line, no exception in main, no failed load event. The window opened,
the page rendered, and `window.monstera` was undefined. Every check the
repository had was structural — the import derivation, the channel exhaustivity
proof — and all of them passed, correctly, about a file nothing ran.

## Decision

### 1. The shipped preload is a CommonJS bundle

`scripts/build/preload.mjs` calls Vite's build API to produce
`apps/desktop/dist/preload.cjs`: CommonJS, unminified, with `electron` external.
`npm run build` is `typecheck` followed by this; CI's two "Typecheck and build"
steps call it.

Two independent reasons, and either alone forces it:

- **A sandboxed preload is loaded as CommonJS.** Electron supports an ESM
  preload only at the `.mjs` extension *and* only with `sandbox: false`.
  `apps/desktop` is `"type": "module"`, so `tsc` emits ESM.
- **`require` in a sandboxed preload resolves a small fixed set, not
  `node_modules`.** `@monstera/contract` is unreachable from there in any module
  format, so `BRIDGE_KEY` must be inlined at build time.

### 2. The preload enters the contract through `@monstera/contract/bridge`

A new export subpath on the contract package. Importing `BRIDGE_KEY` from the
package root worked and produced a **137,809-byte** preload carrying the entire
channel registry and zod, because `channelIds = Object.keys(channels)` is a
top-level evaluation in the index and nothing could be dropped around it.
Through the leaf the bundle is **233 bytes** and its only `require` is
`electron`. Both figures are `wc -c` on the built artefact — the first draft of
this ADR guessed "9 KB", which was wrong by a factor of fifteen and is the
reason the rule is to measure rather than to estimate.

That is not only size. A preload holding the schemas is a preload where someone
later validates at the bridge, which is a second validator for a boundary that
has one (B3a).

### 3. `tsc` still emits `dist/preload.js`, and it stays dead

Type-checking produces it. The window names `preload.cjs`; pointing it back
reproduces the SyntaxError, and `proof:rendererpolicy` fails with the
`preload-error` text in the message.

## Rejected alternatives

**`sandbox: false` with a `.mjs` preload.** The documented way to keep an ESM
preload. It trades ARCHITECTURE §2's first non-negotiable for a build
convenience, and the trade would be invisible in the diff that made it — a
`webPreferences` edit, not a security decision.

**Retype `BRIDGE_KEY` in the preload as a literal.** No bundler, no subpath, two
lines changed. It puts a second opinion about the bridge's name in the one file
whose whole job is to answer to that name, and the failure when they drift is a
renderer that finds no bridge — the exact symptom just spent a day being
diagnosed.

**`"sideEffects": false` on the contract package.** True as written, and it
would let a bundler drop the registry from a root import. Rejected because it
makes the preload's contents depend on a hint being honoured and on the package
staying side-effect-free forever; the day someone adds a real top-level effect,
the preload silently regrows. The subpath makes the wide import unavailable
rather than prunable (B5).

**Emit CommonJS from a second tsconfig instead of bundling.** Fixes the module
format and not the resolution: `require('@monstera/contract')` still fails in a
sandboxed preload. Half the problem, and the half that fails identically.

**Add esbuild for this one file.** A second bundler in a repository that already
has one, to avoid learning the API of the one it has (B3a).

## Consequences

- `npm run typecheck` alone no longer produces a runnable shell. `npm run build`
  does, and CI calls it. A contributor who runs only `typecheck` gets a failing
  `proof:rendererpolicy` whose message names the bundle command.
- The contract package has a second entry point. The ESLint boundary rules
  already cover `@monstera/*/**`, so the subpath is governed exactly as the root
  is.
- `proof:preload` continues to read the **source**, which is correct — it
  constrains what may be written, and this ADR constrains what is shipped. The
  bundle's contents are now also observable: it is 233 bytes and one `require`.
