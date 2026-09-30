# ADR-0127 — A pdf-lib command appends its revision (`commit()`), and ADR-0008's conditions 2, 3 and 5 are what allow it

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decided by:** the owner's list of 28 September, item 10, carried to the list of 29 September night as item 3 —
  *"Byte-image route (row 287) on native: resume the parked work, next free ADR number, re-run ADR-0008 conditions 2
  and 3 natively, check redaction's full-save rule against an image with appended revisions."*
- **Takes the question row 287 held open:** whether the pdf-lib commands may write their result by
  `PDFDocument.commit()` — an appended revision — instead of `save()`, a whole rewrite.
- **Rests on:** [ADR-0008](0008-save-mode-is-determined-by-purpose.md) (save mode is the purpose's), whose conditions
  2, 3 and 5 row 287 said must be executed first; [ADR-0121](0121-main-never-holds-two-images.md) Decision 3 (the
  commands run in the MuPDF host); [ADR-0124](0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md) (the
  engine that reads the results back is native).
- **Numbering:** drafted 2026-09-29 as 0122 and parked before it was committed; 0122 went to the native components
  and 0123 to 0126 were taken since, so this is 0127.

## The cost, as row 287 records it

Every pdf-lib command is a whole-document load and save. On `perf-dense-127k.pdf` (25.1 MB, 127,082 objects) that
is **192–239 s each**, re-measured 2026-09-26; `load` + `commit` is **26.6 s** where `load` + `save` is **270.0 s**
for no change at all (`scripts/research/incrementalSaveCost.mjs`). The load is a floor that does not move; the save
is the part that does.

## What was executed — `scripts/research/incrementalDepth.mjs`, on the native engine, 2026-09-30

Read back after each step by **MuPDF**, never by pdf-lib, the library that wrote it. The figures below are the native
engine's; the same script on the WASM engine the day before read the same numbers to the byte.

**Condition 2 — depth.** A 40-page document already carrying **4** versions (three incremental revisions MuPDF
appended), then **100** pdf-lib appends by `commit()`, each drawing a mark on page 1. At every tenth step: not
repaired, 40 pages, versions exactly the starting count plus the steps (104 at step 100), and the step's mark in the
extracted text. Each append took 35–161 ms.

**Condition 3 — growth over a session of 100 commands, on a 49,823-byte document.**

| route | after 1 | after 50 | after 100 |
|---|---|---|---|
| every command appended (a SIGNED document: its serialise appends, so appendices accumulate) | 53,446 | 205,499 | 506,570 |
| the pipeline as built for an UNSIGNED document (MuPDF re-serialises whole between commands) | 49,932 | 79,635 | 109,971 |

The appended route grows faster than linearly — each append rewrites page 1's dictionary, whose `/Contents` array
grows by one — and stays bounded by the session's commands, not by the document. The unsigned route is linear, and
is today's route's own growth: an appendix is folded into the next full save.

**Condition 5 — the burn-in over appendices.** The product's own redaction (`markMatchesForRedaction` +
`applyRedactions` through `localMupdfExecution`, serialised by `mupdfWriter`, which takes the removal save terms):

| input | versions after | secret in extracted text | secret in decompressed raw bytes |
|---|---|---|---|
| CONTROL — the un-redacted input with one appendix (the check can SEE) | 2 | yes | yes |
| CONTROL — burn-in, no appendix (the check can PASS) | 1 | no | no |
| burn-in over one pdf-lib appendix | 1 | no | no |
| burn-in over three MuPDF revisions and a pdf-lib appendix | 1 | no | no |

**The raw search was blind on its first run** and its control said so: pdf-lib writes text as hex strings, so a
search for the literal found nothing in the input that holds it. It searches both spellings.

## Decision

1. **A pdf-lib command writes its result by `commit()`.** The load that allows it (`forIncrementalUpdate: true`) and
   the append are each spelt once, in `pdfLibSession.ts` — `openForWriting` and `appendRevision` — and every pdf-lib
   command takes them; the four that loaded inline take the helper, so the load rule has one spelling.
2. **A command that touches a form updates the fields' appearances itself.** `save()` regenerates the appearance of
   every field a command changed; an incremental save does not (pdf-lib forces `updateFieldAppearances: false` on
   that route), so a command that creates or changes a field asks for it explicitly before appending.
3. **Nothing else changes, and that is the argument.** For an unsigned document the host's serialise is a whole
   rewrite, so the appendix exists for one command and is folded in; for a signed one the serialise appends (ADR-0008
   rule 2). A removal still saves whole with garbage collection and zero prior revisions (rule 1), measured above
   over appendices.

## Rejected

- **Leaving `save()`.** The cost row 287 records, for no property that the conditions above found at risk.
- **`saveIncremental()`.** It answers the appendix alone; MuPDF opens that as a repaired document with no page 1
  (row 287). `commit()` concatenates it onto the input.
- **Compacting the appended route.** Measured bounded by the session's commands; a compaction step would be a
  rewrite, which is what an appended revision exists to avoid.

## Correction, 2026-09-30 — the build: Decision 2 was not needed, and the signer keeps its route

Appended by the build, the same day, and each paragraph answers a sentence above.

**Decision 2 is withdrawn.** The one pdf-lib command that touches a form, `createFormField`, builds each field's
appearance as it places it and already recorded — measured 2026-09-08, 720 marked pixels in the field's box either
way — that the save's appearance pass changes nothing for it and would put its font in front of fields it never
named. The incremental route turns that pass off, which is what the command wanted; nothing asks for it.

**The signer is not one of the eight.** `signDocument` is `signpdf`'s command (ADR-0054) and only borrowed the pdf-lib
loader. A document loaded for an incremental update makes pdf-lib's `save()` append without being asked, so the
signer now takes `openWhole` and its placeholder is written whole, as ADR-0054 decided. Whether a signature should
append is that ADR's question, not this one's.

**What the build proves.** `pdfLibSession.test.ts`: a watermark's result is its input byte for byte with one revision
appended, which MuPDF reads unrepaired with one more version; CONTROL, a whole save of the same edit is not; and
`appendRevision` refuses a document loaded whole. The kernel's 1,785 cases pass on the appended route, the
`reproducible` declarations' byte-equality cases among them.
