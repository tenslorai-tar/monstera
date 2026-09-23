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
| `monstera_new_logo.png` | 2048 × 2048, RGBA | **master — supplied by the owner**: the mark with its wordmark | `logo-256.png`, `logo-hero.png` |
| `monstera_logo_no_text.png` | 2048 × 2048, RGBA | **master — supplied by the owner**: the mark alone | `logo-title.png`, `logo.ico`; the file-type icon and the Store tiles when packaging lands |
| `logo-256.png` | 256 × 256 | generated | `README.md` and docs |
| `logo-title.png` | 52 × 52 | generated | the title bar, drawn at 26 px |
| `logo-hero.png` | 168 × 168 | generated | the start screen's hero, drawn at 84 px |
| `logo.ico` | 16/24/32/48/64/128/256 px | generated | the packaged application's icon |

Which master feeds which output is this build's reading of the owner's file names, recorded in
[ADR-0002](../../docs/DECISIONS/0002-brand-mark-treatment.md)'s note of 2026-09-19 — moving one
is a line in `OUTPUTS`. The previous master, `logo.png` (1652 × 2050), was retired that day and
lives in the history.

**`monstera_logo_square.png` was retired on 2026-09-23**, by the owner's order that the mark alone
carries the application icon, the taskbar button, the title bar, the Store tiles and the PDF
file-type icon. It fed `logo.ico` and nothing else, so what changed is one master fewer and one
line in the generator; `logo.ico` was regenerated from the mark in the same commit. It lives in the
history like its predecessor.

## Rules

- **Each output has exactly one master**, named in `OUTPUTS` in
  `scripts/brand/generateAssets.mjs`. Adding a size is a line in that script,
  never a new binary committed by hand. `brand:check` also refuses a master
  with no alpha channel or an opaque corner (`scripts/brand/brandShape.mjs`,
  proven by `proof:brandshape`).

  ```bash
  npm run brand:generate    # rewrite the derived assets
  npm run brand:check       # fail if a committed derivative no longer matches
  ```

  The derivatives are committed even though they are generated, for one
  specific reason: GitHub renders `README.md` with no build step, and the
  packaging config needs an `.ico` on disk. `brand:check` runs in CI so a
  committed derivative cannot silently drift from the master — which is the
  failure mode that having one source of truth exists to prevent.

- **Never edit a master, and never derive a new *mark* from one.** Brand
  identity is supplied by the project owner; see
  [ADR-0002](../../docs/DECISIONS/0002-brand-mark-treatment.md). Resizing and
  format conversion are permitted and are done by the script, so they are
  reproducible rather than checked-in guesswork.

- **The masters are square, and outputs never stretch them.** Square outputs
  are produced by fitting inside the box and padding with transparency.

- **Do not ship a master to the renderer.** Each is 1.5–2.2 MB; the
  start-screen hero is 84 px and the title bar 26 px. The UI consumes derived
  sizes.

## Archival master

The 2048 px masters cover the largest requirement, roughly 1240 px for a
Microsoft Store tile at 400% scaling. A larger export of the retired portrait
mark (3304 × 4100, 15.5 MB) is retained by Tenslor Inc. outside version control.
