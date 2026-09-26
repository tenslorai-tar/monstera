# ADR-0110 — The update check is built dormant, and reads numbers only

- **Status:** Accepted
- **Date:** 2026-09-26
- **Builds:** [ADR-0018](0018-distribution-is-the-microsoft-store.md)'s `StoreUpdateProvider` and the update-provider
  registry it said would land *"as an implementation when the registries are built"*. No amendment: §8's three
  clauses are what is built, and every choice below sits inside them.
- **Decided by:** the project owner, work list of 2026-09-26, item 7: *"Build now: version, minimum version, security
  flag, plain GET sending nothing, an indicator with a Store link, a setting to turn it off. Address = config value on
  monsterapdf.com; propose the path in the report. DORMANT: never calls the address until the owner says the site is
  live."*
- **Relates:** [ADR-0107](0107-the-menu-bar-is-a-projection.md) (*Help › Check for updates* opens the Store's
  *Downloads and updates* page, unchanged), [ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md)
  (the title bar projects commands), [ADR-0058](0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md)
  (a fixed-host request from `main`, and why invariant 9 does not govern a reply that changes).

## Context

`docs/FEATURES.md` carried the check as blocked on 2026-09-25: the manifest had no address and nothing hosted it, and
building against a guessed address would ship the application's only call to this project's server pointed at
nothing. The owner's answer is to build all of it now and hold the one thing that reaches the network behind a state
that only the owner's word changes.

## Decision 1 — the address is a state in the contract, and dormant answers before anything else is asked

`UPDATE_MANIFEST` is `{ state: 'dormant' } | { state: 'live', url }`, and the URL's type admits HTTPS on
`monsterapdf.com` only. While dormant, `main`'s check answers `dormant` without reading the setting or calling
anything; a case asserts the fetch is called **zero** times, against a control that is called exactly once when the
address is live, the build is a Store build and the setting is on.

**The proposed address is `https://monsterapdf.com/updates/v1/store.json`.** `/v1/` because an installed build reads
the file for years and cannot learn a new shape: a new shape is published beside it at `/v2/`. `store.json` because
the file describes one install channel. It must be served from the apex directly — no redirect is followed — and it
carries no query string, ever, not even a cache-buster.

Going live is that one value, in its own commit, on the owner's word that the site serves the file.

## Decision 2 — the providers are a record over the install channel

`UPDATE_PROVIDERS` maps each channel to its provider: `store` checks the manifest; `web` is `WebUpdateProvider`,
**registered with nothing behind it** — ADR-0018's seam for a signed download, not dead code; `development` checks
nothing. A channel with no entry is a compile error. Every build this repository makes today bakes `development`
(`entry.ts`), so even a live address is inert until packaging bakes `store`.

## Decision 3 — one GET, once per start, when the renderer first asks, sending nothing

`main` makes the request, because the renderer's CSP pins `connect-src 'none'` (invariant 27). The transport takes
`timestampTransport.ts`' shape: Node's `fetch`, `redirect: 'error'`, a 10-second timeout, and the body bounded at 4096
**received** bytes through `readWithin`, the one implementation of that rule. No header is set; the request carries
no cookie, no body, no query and no identifier. The header names Node's `fetch` adds by itself were measured against a
local server on 2026-09-26 and are written into `updateCheck.test.ts`, which fails if one is added. Like any request,
the site sees the internet address, and the setting's description says so.

Of invariant 9's four guarantees, three are taken (HTTPS, no redirect followed, bytes counted). The fourth — a pinned
digest — cannot apply: the file changes by design, which is ADR-0058's reading of the same invariant.

The check runs the first time the renderer asks `app.updateStatus`, after the first paint, so it is never on the
startup path; the answer is kept for the run. No retry follows a failure and a long session does not check again: the
next start is the next check. A failure is `unknown`, silent to the person, and one line in the diagnostics log.

## Decision 4 — the manifest is numbers only

`{ schema: 1, channel: 'store', version, minimumVersion, security }`, `.strict()`, with a refusal when the minimum is
above the newest. Versions are three numbers with no pre-release tag, compared as numbers (`1.2.10` is above `1.2.9`).

**No address and no text, on purpose.** A manifest a stranger swapped can at worst show a false *update available*
that opens the real Microsoft Store; every sentence a person reads is the application's own. That is B5 over a
signature this project has no key for — and it is the reason nobody should add a `notes` field.

Precedence, first match wins: a security release above the installed version; below the minimum; below the newest;
otherwise current (which includes a build ahead of the manifest). An installed version that is not three numbers is
`unknown`, never a guess.

## Decision 5 — what the person sees

- **The indicator** is a title-bar command, *Update available*, whose `when` reads the status: present for a newer,
  unsupported or security release, absent otherwise. It opens the Store application's page for Monstera through
  `app.openStore({ page: 'listing' })` — `ms-windows-store://pdp/?ProductId=…`, the form Microsoft Learn recommends
  for linking to a product. Main holds the address; the page names a place.
- **A security release** opens a notice, *Important security update*, naming the version, with *Open Microsoft Store*
  and *I understand*. Either answer acknowledges; closing it does not, and it returns next start. The acknowledgement
  is recorded per version in `update-check.json` under the application's data folder, so a later security release is
  shown again.
- **The setting**, *Check for new versions* under Updates, default on, describes what is fetched and what is sent.
  **It is registered only while the address is live**, derived from the same contract value the check reads: a switch
  for a check that cannot run would read ON while nothing is ever asked, which is the display-only defect. Going live
  brings the row with it.
- **About** says *Monstera also checks monsterapdf.com* only on a run that did — the line is derived from the status,
  so it cannot drift from what happened.

It never says *update now* as though the application could: ADR-0018 forbids it installing its own package.

## Rejected

- **Building against a guessed live address, or a flag beside the URL.** A boolean the code consults next to a real
  URL is a switch somebody flips in a refactor; the address's absence is the state.
- **A settings row that is disabled with a reason while dormant.** It needs a field on the settings registry's shape
  for a condition that ends the day the file is hosted.
- **Electron's `net.fetch`.** It brings Chromium's cookie jar and user agent — both things *sends nothing* argues
  against.
- **A periodic re-check.** A person who keeps the window open for a week learns at the next start; a timer is a second
  call pattern to describe in the setting.

## Not verified

Everything runs against injected transports or a local server; nothing contacted monsterapdf.com, and nothing has
run in a packaged Store build. The header set was measured with Node 24.12.0's `fetch` under the test runner, not
inside Electron's main process, whose Node may add a different user agent.
