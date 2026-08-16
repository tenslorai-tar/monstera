# Brand assets

**Owned by Tenslor Inc. Not covered by the AGPL-3.0 grant that covers the
source code.** The licence permits you to use, modify and redistribute
Monstera's *code*; it does not grant a trademark or logo licence. A fork must
replace these assets with its own before distributing, so users can tell whose
build they are running. This is standard practice for open-source applications
with an identity — Firefox, Chromium and VS Code all do the same — and it
protects users rather than the project.

## Contents

| File | Size | Origin | Used by |
|---|---|---|---|
| `logo.png` | 1652 × 2050, RGBA | **master — supplied by the owner** | the source every other asset is derived from |
| `logo-256.png` | 206 × 256 | generated | `README.md` and docs |
| `logo.ico` | 16/24/32/48/64/128/256 px | generated | packaged app icon, file association |

## Rules

- **`logo.png` is the single source of truth.** Everything else here is
  produced from it by `scripts/brand/generateAssets.mjs`. Adding a size is a
  line in that script, never a new binary committed by hand.

  ```bash
  npm run brand:generate    # rewrite the derived assets
  npm run brand:check       # fail if a committed derivative no longer matches
  ```

  The derivatives are committed even though they are generated, for one
  specific reason: GitHub renders `README.md` with no build step, and the
  packaging config needs an `.ico` on disk. `brand:check` runs in CI so a
  committed derivative cannot silently drift from the master — which is the
  failure mode that having one source of truth exists to prevent.

- **Never edit the master, and never derive a new *mark* from it.** Brand
  identity is supplied by the project owner; see
  [ADR-0002](../../docs/DECISIONS/0002-brand-mark-treatment.md). Resizing and
  format conversion are permitted and are done by the script, so they are
  reproducible rather than checked-in guesswork.

- **The artwork is portrait (aspect ratio 0.806), not square.** Square outputs
  fit inside the box and pad with transparency. **Never stretch it** — mount
  points reserve a portrait box and letterbox within it.

- **Do not ship `logo.png` to the renderer.** It is 4.4 MB; the start-screen
  hero is 84 px and the title bar 26 px. The UI consumes derived sizes.

## Archival master

A 3304 × 4100 export exists and is **deliberately not in this repository** —
at 15.5 MB it exceeds the 5 MB pre-commit ceiling, and nothing needs it: the
largest requirement is roughly 1240 px, a Microsoft Store tile at 400% scaling.
It is retained by Tenslor Inc. outside version control. Request it if an asset
ever genuinely needs more than the 2050 px master provides.
