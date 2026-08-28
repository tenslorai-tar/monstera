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
- **Electron's "MIT" describes only Electron's own source.** The binary that
  ships inside Monstera is an aggregate: Chromium (BSD-3-Clause plus many),
  Node.js (MIT), and **FFmpeg (LGPL-2.1-or-later)**. All are AGPL-3.0 compatible
  — LGPL-2.1-or-later upgrades to LGPL-3.0 and is therefore GPL/AGPL-3.0
  compatible — but two obligations follow that the npm licence field alone would
  hide: the bundled `LICENSE` and `LICENSES.chromium.html` must be distributed
  with the app, and AGPL §6/§13 corresponding-source duties extend to these
  bundled components. This is the one place in the toolchain where trusting the
  registry's licence field understates what is owed.
- **Distribution split matters for the analysis.** Only `electron` and
  `electron-updater` are conveyed to users and become part of the AGPL combined
  work. `electron-builder`, `electron-vite`, `@electron/rebuild`, the linters,
  the test tools and TypeScript itself are build-time only, never shipped, and
  carry no source-offer obligation. The generated NOTICE must reflect that split
  rather than listing the whole dependency tree indiscriminately.
- **`electron-builder`'s `latest` is not its highest version.** `latest` is
  26.15.3 (2026-06-09) while 26.15.7 (2026-07-18) sits on a `v26` dist-tag, with
  `next` pointing at 27.0.0-alpha.6. The pin follows `latest`, because a release
  the maintainers declined to promote is one they declined to recommend. Anyone
  reading "use the newest" literally here would pin a version npm does not serve
  by default.
- **Only direct dependencies have been licence-checked.** The transitive tree is
  where a GPL-2.0-only package would realistically hide — particularly beneath
  `electron-builder` (`app-builder-bin`, `7zip-bin`, the NSIS stubs). A
  full-tree scan generated from the lockfile is required before the first public
  release, which is what Part J already mandates by insisting the NOTICE be
  generated rather than hand-maintained.

## Addition — 2026-08-28 — the component-test vehicle

Added by the project owner's ruling. Not a correction to anything above: the
stack this ADR pinned had no way to render a React component in a test, and
nothing had needed one until Stage 0's four UI primitives came up.

| Package | Version | Licence | Scope |
|---|---|---|---|
| happy-dom | 20.11.12 | MIT | devDependency |
| @testing-library/react | 16.3.3 | MIT | devDependency |
| @testing-library/dom | 10.4.1 | MIT | devDependency |

All three fetched from `registry.npmjs.org` on 2026-08-28. `@testing-library/dom`
is a **peer** of `@testing-library/react`, declared here explicitly so the
lockfile pins it rather than leaving the version to peer resolution.

### happy-dom over jsdom, on a measured cost

Counted with `npm i --save-dev --dry-run` against this lockfile on 2026-08-28,
reading the number of `add` lines:

| option | packages added |
|---|---|
| `happy-dom@20.11.12` | **7** |
| `jsdom@30.0.1` | 38 |
| `@testing-library/react` + `@testing-library/dom` | 11 |

Nothing in the primitives needs what jsdom has and happy-dom does not — no
navigation, no canvas, no XHR. Five times the tree for capabilities this
project's renderer is forbidden to use is the wrong trade, and the revisit
trigger is concrete: the first component test that needs a jsdom-only API.

### This decision does not touch ADR-0005's supply-chain argument

`npm ls --omit=dev --all --parseable` counts **43** production packages before
this change and **43** after. Development-only tooling is never conveyed to a
user and never enters the AGPL combined work, which is the same split the
`electron-builder`-versus-`electron` consequence above already draws. The Lingui
question is about the **production** tree and is decided on its own evidence;
the two must not be allowed to blur.

### Vitest globals stay off, and that has one consequence worth writing down

`@testing-library/react` registers its own `afterEach(cleanup)` — but only when
`afterEach` is a global, which means `test.globals: true`. This repository runs
with globals off and every test imports its own `describe`/`it`/`expect`, so the
library's registration silently does not happen. The symptom is not an error:
renders accumulate in `document.body` and a later query finds an earlier test's
node.

Turning globals on was rejected. It changes what every existing test inherits
from its runner — the *rich ambient environment* axis of the stage audit's item
2, which has already cost this project one guard whose proof and subject
disagreed about which npm existed. Instead `vitest.config.mjs` gains one
`setupFiles` entry, `packages/testing/src/domCleanup.ts`, which registers
cleanup where a DOM exists and is inert everywhere else.

Measured, not assumed: with that entry removed, exactly one case of
`packages/ui/src/renderVehicle.test.tsx` fails — `expected 1 to be +0` — and the
other four pass. That is the control.

### The DOM stays inside `packages/ui`

A DOM is selected per file by a vitest docblock, which the config cannot
forbid — vitest honours the docblock whatever the config says, and scoping the
environment through `test.projects` would not change that while putting the
alias map at risk, which is the one part of that config that has already cost 27
green tests over a deleted line of source.

So the config decides the default, `node`, and `npm run check:domenvironment`
decides who may depart from it: outside `packages/ui` the environment must be
`node`. Stated that way round rather than as a deny-list of `happy-dom` and
`jsdom`, because a deny-list passes whatever vitest ships next with silence as
the failure mode. `proof:domenvironment` is what says the scan can see, and the
scan refuses to report when its own control fixture goes unfound.

The rule being enforced is `CLAUDE.md`'s, and it predates the capability: *a
test that must fake `DOMMatrix` or a window bridge just to exercise a save is
evidence the boundary is wrong.* Until happy-dom was installed there was nothing
to erode it with. Installing it created the capability, and a capability with a
rule over it and no mechanism is what this project's record says gets spent.
