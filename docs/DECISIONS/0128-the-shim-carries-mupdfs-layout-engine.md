# ADR-0128 — The shim carries MuPDF's layout engine; every HTML-family document handler stays off

- **Status:** Accepted
- **Date:** 2026-10-01
- **Amends:** `docs/ARCHITECTURE.md` §3, the *Annotations (all types), appearance streams* row. The shim's build
  (`scripts/provision/mupdf.mjs`, `scripts/lib/documentHandlers.mjs`).
- **Relates:** [ADR-0016](0016-the-document-handler-set-is-named.md) (the handler set is named — unchanged here, and its
  measured table is corrected for two parsers below), [ADR-0124](0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md)
  (the native shim).
- **Context:** the owner's list (29 September, night, item 5): Hebrew and Arabic in the text box, the callout and typed
  text, the real letters in order, proven by a second library with a control; a setting and Help. Row 268 recorded it
  as waiting for native MuPDF, because *"the shipped shim carries Noto for every script"*.

## What was measured

On 2026-10-01, on the native shim as provisioned that morning: a `FreeText` written as the kernel writes a text box —
`setContents`, `setDefaultAppearance('Helv', 24, …)` — holding Hebrew, Arabic, or Latin with Hebrew between.

**The native engine did not draw them either.** The appearance named only `/Helvetica /Type1` and put the letters' bytes
in a `Tj` string, so the page showed dots. Row 268's premise was half true: Noto is in the shim, and nothing on this
path reaches it.

**The mechanism is MuPDF's, and it is a flag this build switched off without deciding to.** `pdf-appearance.c` lays a
`FreeText` (and a widget) out through its HTML engine whenever `text_needs_rich_layout` finds a character no base-14
font carries — which is how bidi, shaping and the Noto fallback fonts reach an appearance — but only
`#if FZ_ENABLE_HTML_ENGINE`. `config.h` derives that flag when nothing defines it: on only if one of the HTML, EPUB,
MOBI, FB2, TXT, Office or Markdown handlers is. ADR-0016 turned every one of them off, so the layout engine went with
them, unasked.

**With `FZ_ENABLE_HTML_ENGINE=1` defined and every handler still off**, the same writes give:

| text | fonts in the appearance | drawn |
|---|---|---|
| Latin | `/Helvetica /Type1` | unchanged — the simple path, since no character needs the engine |
| Hebrew | `/Noto Serif Hebrew Regular /Type0` | the word, right to left |
| Arabic | `/Noto Naskh Arabic Regular /Type0` | the word, its letters joined, right to left |
| Latin, Hebrew, digits | Nimbus Sans and Noto Serif Hebrew | in the order UAX #9 gives a left-to-right paragraph |

Read back by **pdf.js 6.2.108** (not MuPDF) after MuPDF's own bake put the appearance into the page: the Hebrew
letters in logical order marked right to left; the Arabic as its joined presentation forms, which NFKC maps back to the
typed letters; the mixed line as typed. **Control:** before the bake pdf.js reads nothing, so every letter it read came
from what MuPDF drew.

**What else the binary now carries.** `scripts/security/handlerFootprint.mjs` after the rebuild: PDF, HTML, Office,
**SVG** and **FB2** markers present; EPUB, XPS and MOBI absent. ADR-0016's table (2026-08-18, an older MuPDF) had SVG
and FB2 absent; the 1.28 binary without the engine was not measured before this rebuild, so the change for those two
is stated against that table, not against a reading taken today. They are parser code the layout engine shares — it
lays out embedded SVG and the FB2-style XML it reads — and **none is registered**: `proof:documenthandlers` refuses an
SVG and an FB2 file at recognition, before any parse, on the rebuilt binary. The shim is 42.3 MB.
`check:advisories`: 18 symbols verified, none newly reachable; `proof:activecontent`: no JavaScript interpreter.

## Decision

1. **The shim is built with `FZ_ENABLE_HTML_ENGINE=1`**, named in `LAYOUT_ENGINE_FLAGS` beside the handler list it
   would otherwise follow, and passed by both builds.
2. **Every HTML-family document handler stays off** (ADR-0016). The engine opens no file: nothing selects it by name or
   content, and the shim registers the PDF handler alone.
3. **What the engine is given is a document's own text.** It lays out an annotation's or a widget's text when MuPDF
   builds that appearance — the person's text in a box this build writes, or a document's own `/RC` rich text and
   `/DS` style when an appearance is regenerated. That is a document parsed in the engine host, which is where §3 and
   threat model §2 put every parse, and it is stated as new surface rather than left implied.
4. **No layout of ours.** Order, shaping and fonts are the engine's; this build chooses the alignment and nothing else.

## Rejected

- **Bidi and shaping in TypeScript, or a second shaping library**, beside the engine's own: B3a's second opinion about
  an authority the binary already carries.
- **Turning a document handler back on** to bring the engine with it: ADR-0016's point is that a handler is chosen, and
  no feature here opens an HTML file.
- **Writing the appearance ourselves with pdf-lib and an embedded font**: pdf-lib shapes nothing and orders nothing.
- **Leaving it until a later MuPDF**: the switch is this build's, not upstream's.

## Superseded in part, 2026-10-05 — page text has its own ordering and shaping

[ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md) Decision 10, on the
owner's approval of the text-editing plan's decision 7, supersedes the rejected alternative *"bidi and shaping in
TypeScript, or a second shaping library"* **for page text only**: composed documents now, and the in-place editor in
Phase 4, order right to left text with `bidi-js` (held to Unicode's conformance file, 91,707 of 91,707 cases) and
shape it with HarfBuzz's WebAssembly build inside the host. Annotations keep this ADR's route: MuPDF's engine lays them
out and this build chooses the alignment alone. So the product carries two UAX #9 implementations and two HarfBuzz
builds, one per kind of text, which ADR-0172 states as a cost rather than leaving the B3a reason above to read as
still true everywhere.
