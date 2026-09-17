# ADR-0078 — The accessibility check is PDF/UA-1's object rules, and it names what it cannot see

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** nothing. [ADR-0065](0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md)
  Decision 6 left the check's standard to be decided; the owner's answer (2026-09-16) decides it:
  PDF/UA machine rules, with what cannot be machine-checked reported as such and never as a pass.
  veraPDF validates in development only and never ships (the owner's answer to Q10).
- **Context:** D8's *accessibility check* (`BUILD-PROMPT.md`:491).

## The authority

ISO 14289-1's machine-checkable requirements, as veraPDF writes them: the PDF/UA-1 validation
profile, `veraPDF-validation-profiles` `PDF_UA/PDFUA-1.xml` at commit `e462c0a7` (2026-05-30),
106 rules, each with a clause, a test number, the object it applies to and a test expression.

## Decision

1. **Fifteen rules this build can decide from MuPDF's object model**, each keyed to its clause and
   test number and written from veraPDF's test expression: the PDF/UA identification (5-1),
   `Marked` (6.2-1), `Suspects` (7.1-4), standard or mapped structure types (7.1-5), metadata
   (7.1-8), a `dc:title` (7.1-9), `DisplayDocTitle` (7.1-10), a structure tree (7.1-11), figure
   alternative text (7.3-1), the accessibility permission of an encrypted file (7.16-1), an
   annotation's description (7.18.1-2), a field's `TU` (7.18.1-3), `/Tabs /S` (7.18.3-1), a link's
   `Contents` (7.18.5-2), and embedded fonts (7.21.4.1-1).
2. **Four verdicts, none of them "accessible"**: `passed`, `failed`, `not-applicable` and
   `not-determined`. Where veraPDF's test reads something the object walk does not resolve — an
   annotation's `Alt` on the structure element that encloses it — the verdict is `not-determined`,
   counted beside failures and never as a pass.
3. **The checks only a person can make are reported on every run**, as a list without verdicts:
   reading order, meaningful alternative text, headings, table headers, colour, the language of
   passages, link text.
4. **It runs in the engine host**, `engine/accessibility-check`, as a read of MuPDF's objects, and
   answers a fixed set of rules with counts and at most sixteen pages each — bounded by the rule set,
   never by the document.

## Measured, 2026-09-17

Each verdict was compared with veraPDF 1.30.2's `--flavour ua1` report on four constructed fixtures
and the eleven corpus documents: a verdict of `failed` against the rule in veraPDF's failed list,
anything else against its absence, `not-determined` left out.

- **First run: 201 agree, 21 disagree.** Two causes, both this build's. 5-1 and 7.1-9 are rules on
  the XMP package, which veraPDF does not evaluate when there is no metadata stream — 7.1-8 fails
  instead; this build failed them (twenty disagreements). And a form field's Helvetica reached only
  through its widget's appearance stream is a font veraPDF checks and this build's page-resource walk
  did not reach (one).
- **After both were corrected: 222 agree, 0 disagree, 3 not determined.**

Not exercised by any file: 7.1-4 with `Suspects true`, and 7.16-1 on an encrypted file.

## Rejected

- **Shipping veraPDF** — the owner's answer; it needs a Java runtime.
- **All 106 rules** — most read content streams (marked content, artifacts, glyphs, `ToUnicode`),
  which is a content parser of this build's own; they are not claimed, and the dialog says the
  automatic checks do not show a document is accessible.
- **A single score or a pass** — a PDF/UA pass needs the human checks, which no file can.

## Consequences

- A font declared in resources and never drawn is counted as used; veraPDF's exception for text
  rendering mode 3 needs the content stream.
- The engine host gains an eighteenth MuPDF read; §3's host paragraph counts it.
