# ADR-0250 — The font picker draws each family in itself

- **Status:** Accepted
- **Date:** 2026-10-16
- **Amends:** [ADR-0175](0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md), which added a third
  sanctioned byte crossing beside `document.readRange` and `document.renderPage`; this adds a fourth, `fonts.bundledFace`,
  closed by the contract as stated below. `docs/ARCHITECTURE.md` §3's in-place editing row (what the picker and the editor
  draw a chosen family in). §9.27's CSP is unchanged, for the reason ADR-0175 measured.
- **Decided by:** the owner's session 2, item 2, and their answers of 2026-10-16: the bundled fonts reach the screen by a
  read-only channel whose family names are a closed set in the contract, an enum the schema enforces; `main` validates
  every request against it and never derives a path from the name (locked decision 8). A family that cannot be drawn is
  still listed under *In this document*, in the interface font (locked decision 6).

## The problem, in one sentence

The picker draws each family by its CSS name, and Chromium resolves that name against the system's font families, so
a name it does not know falls to the browser's default face with nothing said: fix session 1's walk counted 29 of them —
Windows' legacy family names (*Franklin Gothic Demi*, *Sitka*, *Segoe UI Variable*), a document's standard-font names
(*Times-Roman*, *Times-Bold*), and every bundled family (*Arimo*, *Tinos*, *Cousine*, *Noto Sans Symbols 2*), which the
renderer has never been given.

## Decision

**1. An installed family is drawn by `local()`, named by its face's own full name.** The host that lists the families
already reads each face's `name` table (`fontFaces.ts`); the entry gains `local`, the full name (name 4) of the family's
upright regular face — the name Chromium's `local()` matches on Windows, where a legacy family name such as *Franklin
Gothic Demi* is a face of the typographic family *Franklin Gothic* and not a family of its own. The renderer registers
one `FontFace` per listed family, under the listed name, from `local("<full name>")`. Nothing is read from disk by the
renderer: `local()` asks the system for a face it has.

**2. A bundled family crosses as bytes, on a channel whose request is a closed enum.** `fonts.bundledFace` takes
`{ family }`, where `family` is `z.enum(BUNDLED_PREVIEW_FAMILIES)` — Arimo, Tinos, Cousine, Carlito, Caladea, Noto Sans
Arabic, Noto Naskh Arabic, Noto Sans Symbols 2 — so the renderer cannot express a request for anything else, and the
schema refuses it before a handler runs. `main` answers from a table keyed by that same enum (`Record<BundledFamily,
string>`, so a missing member is a compile error) naming the one pinned file of the family's upright face in the bundled
folder; the name in the request is a key, never a path segment. The answer is the file's bytes, bounded by the largest
pinned upright file, and the renderer loads them as a `FontFace` from an `ArrayBuffer`, which §9.27's `font-src 'self'`
does not govern (ADR-0175's measurement).

**3. A name the picker shows is previewed in the face the writer would set, or in the interface font.** A document's
standard-font name (*Times-Roman*, *Helvetica-Bold*) is drawn in its stand-in (`STAND_INS`, the resolver's one table, so
the picker and the writer cannot disagree); any other *In this document* name that is neither installed nor bundled is
drawn in the interface font and marked as not previewed, never given a CSS name that falls to the browser's default
(locked decision 6).

**4. The editor takes the same faces.** Registered on the document's `FontFaceSet` under the listed name, a family chosen
in the picker is drawn in the open editor by the very face the picker showed.

## Rejected alternatives

- **Copy the bundled fonts into the renderer's bundle.** No channel, but ten megabytes shipped twice, and the renderer's
  build would depend on provisioning.
- **Don't preview bundled fonts.** They would be listed in the interface font, and the picker would show a name it cannot
  draw for the faces Monstera itself ships.
- **A channel that takes a file name, or a family as a free string.** A path segment from the renderer, which a
  FileHandles rule exists to make unrepresentable; and a free string makes `main`'s check the only thing between a
  request and a read.
- **A `@font-face` rule with a `url()` to the bundled folder.** A load §9.27 refuses by design, and a path the renderer
  would have to know.

## Consequences

- `fontFamilySchema` gains `local` for an installed family; the catalogue reads name 4.
- `fonts.bundledFace` in the contract, its enum, `main`'s table, a case that an unknown family is refused by the schema,
  and a case that every enum member names a pinned file.
- `FontPicker` registers the faces; the text regression walk's 7b asks of every listed family that it is drawn in itself
  or marked as not previewed.
