# ADR-0046 — A strict XFDF reader, not an XML parser

**Date:** 2026-09-08
**Status:** accepted. **Amends nothing.** `BUILD-PROMPT.md` names XFDF once, in
a feature list, with no guidance about how it is read; `docs/ARCHITECTURE.md`
has no clause about parsers this build writes. So this is a decision the
founding record left open rather than a departure from it, and there is no B4.

---

## The problem, measured

XFDF is XML, and **no workspace in this repository declares an XML dependency**.
Reading one therefore needs either a new production dependency or a parser of
this build's own, on a path a stranger's file arrives by.

`scripts/research/formDataFormats.mjs` (2026-09-07) printed the input set the
decision should be taken against rather than a feature list:

| shape | bytes | what it does |
|---|---|---|
| the ordinary case | 149 | the only shape to ACCEPT, and the control for the rest |
| external entity (XXE) | 158 | reads a file off this machine into a field value |
| entity expansion | 223 | expands to gigabytes **inside the parser**, before any bound on the values can apply |
| external DTD | 96 | a network fetch during a parse |
| a field with no name | 82 | the model is keyed by name, so this must be refused rather than skipped |
| deep nesting | 85,034 | exhausts a recursive parser's stack by structure alone, with no entities |

**Three of the six are DTD features**, which is the finding rather than the
list.

## The decision

A **strict XFDF reader** in `packages/kernel`, refusing `<!DOCTYPE` outright and
bounding depth, field count and text length. No XML dependency is taken.

### 1. The refusal policy removes what a general parser is valuable for

Refusing `<!DOCTYPE` answers **XXE, entity expansion and the external DTD
together** — three of the six shapes, in one line. A depth bound answers the
fourth. The nameless field is a refusal in the model rather than in the syntax.
What is left is a fixed, shallow schema: an element, a name attribute, some
text.

A general parser's value is that it handles everything. Here *everything* is
precisely the part being switched off, and every one of those three is a feature
somebody has to remember to disable.

**And a bound on the VALUES is not one of the answers.** Entity expansion
happens inside the parser, before any value exists to bound — which is why the
policy has to be a refusal of the construct rather than a limit on the result.

### 2. This project already owns the grammar

`scripts/research/formDataExport.mjs` measured that MuPDF declares no FDF symbol
at all, and the export row's conclusion is that **every byte of all three
formats is this build's**. This project *writes* XFDF. Taking a dependency to
read what we hand-write splits one format across two owners, which is B3a's
shape — and the two would agree on everything except the inputs that matter.

### 3. A dependency on a hostile-input path is its own attack surface

*A dependency is a probe*: one production dependency took a generator here from
39 packages to 114 and fired four latent defects. This one would sit on the path
an attacker's file arrives by. If it is ever taken, it goes into a scratch tree
and is counted first.

Note also that a parser which does not process DTDs **at all** would satisfy the
policy by construction rather than by configuration, which is the stronger
shape; the survey for one has not been run, and this decision does not claim it
was.

## Against this decision, and it is recorded rather than answered

**A hand-written reader on a hostile-input path has its own bug surface.** That
is true, it is the strongest argument against, and nothing above disposes of it.
What it buys is a surface small enough to enumerate: this reader accepts one
element vocabulary and refuses everything else, where a general parser accepts a
language and is then constrained.

So the reader ships with the refusals as **declared cases**, negative fixtures
for all six measured shapes, and a re-argue trigger.

## The trigger that reopens this

**If the reader ever needs to grow past the XFDF shape, the dependency question
reopens.** Concretely: a namespace-prefixed vocabulary this build has to
resolve, an encoding other than UTF-8, or a second XML format arriving in this
codebase. Each of those is the reader becoming a parser by increments, and the
argument in §1 stops holding the moment the schema is no longer fixed and
shallow.

## What this does not decide

- **Writing** XFDF, which already exists and needs no reader.
- Whether an XML dependency would be acceptable for a non-hostile path — a build
  script, say. This is a decision about the import path only.
- Which parser would be chosen if the trigger fires. That is a survey, and
  running it now would be choosing against a requirement nobody has.
