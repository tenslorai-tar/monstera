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

**When it ends:** when ESLint and the other two take a fixed version, or if minimatch comes to reach shipped code.
