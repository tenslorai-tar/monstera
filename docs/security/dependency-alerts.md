# Dependency alerts left open

An alert stays open here only by the owner's decision, with what it affects and why it waits.

**None is held open.** The last, minimatch GHSA-g3hv-75wg-m249, ended on 2026-11-17 by the trigger its own record named:
every lint tool that depended on it published a release accepting the fixed version, and the lockfile took them, so it
resolves minimatch 11.0.9. Its history, the owner's decisions of 2026-11-07 and 2026-11-10 and the update that ended it,
is in ADR-0004's additions of 2026-11-01 and 2026-11-17.

`scripts/security/dependencyHolds.mjs` (`npm run check:dependencyholds`, a Guards step) is the expiry of every hold
recorded here. A new hold is a section in this file and an entry in its `HOLDS`, both under the advisory id.
