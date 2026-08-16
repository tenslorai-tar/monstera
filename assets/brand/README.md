# Brand assets

**Owned by Tenslor Inc. Not covered by the AGPL-3.0 grant that covers the
source code.** The licence permits you to use, modify and redistribute
Monstera's *code*; it does not grant a trademark or logo licence. A fork must
replace these assets with its own before distributing, so that users can tell
whose build they are running. This is the standard practice for open-source
applications with an identity (Firefox, Chromium and VS Code all do the same),
and it protects users rather than the project.

## Contents

| File | Size | Used by |
|---|---|---|
| `logo.png` | 826 × 1025, 32-bit RGBA | start-screen hero, title bar, app icon, file-association icon, packaging |

## Rules

- **This is the single source.** The UI build and the packaging configuration
  both read from here. Copying it into a package's own asset folder creates a
  second source that will drift.
- **Never edit it, and never derive a new mark from it.** Brand identity is
  supplied by the project owner; see
  [ADR-0002](../../docs/DECISIONS/0002-brand-mark-treatment.md). Format
  conversion — generating a multi-size `.ico` by resizing — is permitted and is
  done by script at package time, so the conversion is reproducible rather than
  a checked-in derivative.
- **The artwork is portrait (aspect ratio 0.806), not square.** Every mount
  point reserves a portrait box and letterboxes within it. A square icon is
  produced by **padding, never by stretching**.
- There is no vector source. Renderings are limited by the 1025 px height; a
  larger export must be requested from the owner if Store or web assets need
  one.
