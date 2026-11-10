# Dependency alerts left open

An alert stays open here only by the owner's decision, with what it affects and why it waits.

## minimatch, GHSA-g3hv-75wg-m249 (medium). Open since 2026-11-06

**What it is:** a slowdown from a crafted glob pattern. Affected: 7.0.0 up to but not including 11.0.1. This repository
resolves 10.2.6.

**What it affects:** the lint tools only. `npm ls minimatch` read 2026-11-07 finds it under ESLint,
`eslint-plugin-import-x` and `typescript-eslint`, and the alert marks it as a development dependency. The patterns those
tools read are this repository's own lint settings, so a person using the application cannot supply one. That it is
absent from a shipped package follows from that tree; no package was scanned for it.

**Why it waits (the owner's decision, 2026-11-07):** the fix is a new major version, and forcing it beneath those three
tools could break lint, with nothing at risk meanwhile. No change in this release.

**Confirmed, the owner's decision of 2026-11-10: minimatch 11 is not forced.** Read from the npm registry that day, the
newest ESLint (10.14.0) asks `^10.2.6`, its `@eslint/config-array` (0.23.5) `^10.2.4`, and typescript-eslint's
`@typescript-eslint/typescript-estree` (8.72.2) `^10.2.2`; only `eslint-plugin-import-x` (4.18.1) also accepts `^11.0.1`.
The fix exists only from 11.0.1, a new major that removes `makeRe()` and changes how some patterns match, so an override
would put it under three tools that do not support it. The reasons it can wait: it is a development dependency only and
is not in what ships, and the weakness needs a crafted file pattern, while the patterns these tools read are this
repository's own. The owner dismisses the GitHub alert as tolerable risk; the alert is not changed from here.

**When it ends, by itself:** `scripts/security/dependencyHolds.mjs` (`npm run check:dependencyholds`, a Guards step) reads
from the lockfile every package that depends on minimatch and asks the npm registry whether the newest version of each
accepts 11.0.1 or later. It fails the day they all do, naming each, so they are updated then; and it fails if the
lockfile ever resolves a fixed version, so this record and the alert are closed. A registry it cannot read is reported as
could-not-look, never as a hold still in force, and on Guards, which reaches the internet, the step passes
`--require-registry`, so could-not-look there fails the run; exit 0 on could-not-look is for a run by hand with no
network. Its proof reads that step from `guards.yml` and fails without the flag. It would also end if minimatch came to reach shipped code.
