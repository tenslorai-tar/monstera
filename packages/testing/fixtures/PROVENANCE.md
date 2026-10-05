# Fixture provenance

Every PDF under `packages/testing/fixtures/` is declared here: what made it, from what, and what it may contain.
`guardFiles.mjs` refuses a committed PDF that this file does not name. No fixture is a real-world document — the
words are this project's own, and every font in one is freely licensed.

| Fixture | Made by | Contents | Fonts |
|---|---|---|---|
| `text-edit/chromium-type3.pdf` | `node scripts/research/chromiumType3Fixture.mjs`, which prints a page of our own HTML with Edge headless (`--print-to-pdf`); printed 2026-10-04 by Edge 154.0.4258.53, Skia/PDF m154 | One page, three lines of our own words (`CHROMIUM_LINES` in the script); Info carries the page's own title, Edge's user-agent string as Creator, Skia as Producer and the print date — the script refuses a print whose Info or bytes name a local path | Liberation Sans Regular (SIL OFL 1.1, from `pdfjs-dist`): the two headings in Chromium's synthetic bold, which Skia writes as a Type 3 font; the body line as Type0 / CIDFontType2 |

**Why this one is committed rather than built at test time**: it is Chromium's own PDF writer that makes it, and a
runner without Edge — every Linux one — cannot. The fonts-by-kind fixtures `scripts/research/fontKindFixtures.mjs`
builds need only this repository's dependencies and, for the Type 1 kinds, the MuPDF source its provisioning
extracts under `.tools`, so they are built on demand and not committed.
