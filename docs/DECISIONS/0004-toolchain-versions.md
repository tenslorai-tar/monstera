# ADR-0004 — Toolchain versions, and two deliberate steps back from "latest"

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** nothing structural. Records the pinned toolchain and the reasoning
  behind two versions that are **not** the newest published.

## Context

The project owner's standing instruction is to use the latest available version
of every dependency, researching rather than recalling, because a stale pin
costs performance and support life. Everything below was fetched live from
`registry.npmjs.org` on 2026-08-16 and cross-checked against peer-dependency
ranges rather than assumed compatible.

Two places where "latest of everything" does not compose were found **before**
any code depended on them. Both were put to the owner with the tradeoff stated,
and both decisions below are theirs.

## Decision

### The pinned stack

| Package | Version | Licence | Note |
|---|---|---|---|
| electron | 43.4.0 | MIT | |
| typescript | **6.0.3** | Apache-2.0 | not 7.0.2 — see below |
| vite | **7.3.6** | MIT | not 8.2.1 — see below |
| @vitejs/plugin-react | 5.2.0 | MIT | peer range spans vite ^4.2–^8 |
| electron-vite | 5.0.0 | MIT | `@swc/core` peer is optional |
| electron-builder | 26.15.3 | MIT | |
| react / react-dom | 19.2.8 | MIT | |
| babel-plugin-react-compiler | 1.0.0 | MIT | |
| eslint | 10.8.1 | MIT | |
| typescript-eslint | 8.67.0 | MIT | |
| eslint-plugin-react-hooks | 7.1.1 | MIT | carries the React Compiler rules |
| eslint-plugin-jsx-a11y | 6.10.2 | MIT | |
| eslint-plugin-import-x | 4.17.1 | MIT | |
| eslint-plugin-boundaries | 7.2.0 | MIT | enforces C1 package boundaries |
| vitest | 4.1.10 | MIT | peers vite ^6/^7/^8 |
| @playwright/test | 1.62.1 | Apache-2.0 | |
| axe-core / @axe-core/playwright | 4.13.0 | **MPL-2.0** | dev-only; MPL is AGPL-compatible |
| zod | 4.4.3 | MIT | |
| mupdf | 1.28.0 | **AGPL-3.0-or-later** | the licence that forces the project's |
| pdfjs-dist | 6.2.108 | Apache-2.0 | |
| koffi | 3.1.5 | MIT | pin **≥3.1.5**, see below |
| @signpdf/signpdf | 3.3.0 | MIT | |
| node-forge | 1.4.0 | **(BSD-3-Clause OR GPL-2.0)** | taken under BSD-3-Clause |
| exceljs | 4.4.0 | MIT | never `xlsx` (Part A) |
| tesseract.js | 7.0.0 | Apache-2.0 | |

### Deviation 1 — TypeScript 6.0.3, not 7.0.2

TypeScript 7.0.2 (2026-07-08) is the native Go rewrite. `typescript-eslint`
8.67.0 — published 2026-08-10, six days before this decision, so plainly current
and maintained — declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. Its
canary (`8.67.1-alpha.4`) carries the identical range. The native port changed
the compiler API surface that typed linting reads, so this is a real
incompatibility rather than a lag nobody got to.

**Adopting TypeScript 7 today means no type-aware linting at all.** B7 makes
`any` an error rather than a warning, and the rules that actually catch `any`
crossing a boundary — `no-explicit-any`, `no-unsafe-assignment`,
`no-unsafe-argument`, `no-unsafe-member-access` — are exactly the typed rules
that would be lost. The two sanctioned FFI adapter modules exist to be the place
untypedness *dies*; without typed lint there is nothing to prove it died there.

TypeScript 6.0.3 (2026-04-16) is a current, supported release, not an old one.

### Deviation 2 — Vite 7.3.6, not 8.2.1

Vite 8 replaces Rollup with Rolldown. `electron-vite@5.0.0` (stable) declares
`vite: ^5 || ^6 || ^7`. Its Vite 8 support exists only in `6.0.0-beta.1`,
published 2026-04-12 with **no stable release in the four months since**.

The chosen combination — Vite 7.3.6 + electron-vite 5.0.0 +
`@vitejs/plugin-react` 5.2.0 — is stable end to end with no prerelease anywhere
in the build chain of a shipping product.

`@vitejs/plugin-react` 5.2.0 is worth noting: its peer range is
`^4.2.0 || ^5 || ^6 || ^7 || ^8`, so it spans both sides. Moving to Vite 8 later
requires changing Vite and electron-vite only, not the React plugin.

## Rejected alternatives

- **TypeScript 7 with typed lint disabled, re-enabled later.** Rules turned on
  late light up hundreds of pre-existing violations and get turned off again —
  the mechanism B7 names when it insists `any` is an error and not a warning.
- **TypeScript 7 permanently without typed lint.** Trades B7's enforcement for
  compiler speed. The project's central claim is that the codebase is the
  product; an unenforceable `any` ban is a README claim.
- **Vite 8 + electron-vite 6.0.0-beta.1.** Puts a four-month-old beta with no
  stable follow-up into the build chain.
- **Vite 8 with esbuild replacing electron-vite.** Genuinely attractive — latest
  Vite, no beta, ~80 lines of build script we control, and it removes a
  coupling that recurs at every Vite major. The owner chose the fully-stable
  combination instead, preferring a supported wrapper over hand-rolled build
  code in a project that will take outside contributors. Recorded because it
  remains the natural path if electron-vite stalls.

## Consequences

- **A revisit trigger, not a permanent position.** Move to TypeScript 7 when
  `typescript-eslint` widens its peer range; move to Vite 8 when electron-vite 6
  ships stable. Both are single-line changes plus a CI run, and neither is
  load-bearing on any architecture decision.
- `npm ci` will not silently resolve past these pins, because the lockfile is
  committed and CI never runs bare `npm install` (Part J).
- **koffi must be pinned ≥3.1.5.** 3.1.3 switched Windows builds to Clang
  cross-compilation and 3.1.5 reverted to native compilation "for stability";
  3.1.3–3.1.4 are the unstable window.
- **`node-forge` is dual `(BSD-3-Clause OR GPL-2.0)`.** GPL-2.0-*only* is
  incompatible with AGPL-3.0, so the BSD-3-Clause option must be taken and
  recorded in the generated NOTICE. Part A anticipated this exactly; the check
  confirms it rather than discovering it.
- **`axe-core` is MPL-2.0.** Compatible, and development-only, but it is the one
  non-permissive licence in the toolchain and belongs in the audit record.
- **`lucide-react` is ISC, not MIT** — permissive and compatible, but the licence
  manifest must say ISC.
