# ADR-0035 — Extracted text is never resident in main, and search is a per-page query

**Date:** 2026-09-02
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §9.17**, whose `main`
clause reads *"holds canonical bytes and never parses"* and names nothing else
`main` may hold. The amendment is a separate commit (B4). Answers D1's gate row —
*IPC payloads bounded per invariant 11* — for the first channel that can break it.

---

## The problem, in one sentence

`findInPages(pages, query)` is pure and correct, and nothing decided who
materialises that array of pages or holds it — which is two invariants' worth of
question sitting under a function signature.

## Why it had to be decided before the channel

Invariant 11 forbids a channel whose payload scales with document size per
**operation**. §9.17 argues `main`'s budget from what `main` holds. A document's
extracted text is **neither canonical bytes nor a parse `main` performs** — it is
a third thing, produced by the engine host and handed back — so it is governed by
neither sentence, and a channel written first would have settled the question by
accident.

## What was measured

`scripts/research/textRetention.mjs`, 2026-09-02, against a **text-heavy**
document — no images, no vectors, 50 lines a page. That shape is deliberate: the
perf corpus's 200 MB fixture is one large image, and a budget argued against it
says nothing about a file that is all words, which is the case this question is
about.

| pages | document | text retained | ratio | largest page |
|---|---|---|---|---|
| 40 | 0.1 MB | 0.3 MB | **3.56×** | 2.5% of the whole |
| 200 | 0.5 MB | 1.7 MB | **3.59×** | 0.5% of the whole |

The ratio is stable across a 5× change in size, and the per-page figure falls as
`1/N` — which is the property, not the speed.

**A control runs on every invocation**: both shapes must find the same number of
matches, because a per-page loop that silently read fewer pages would report a
smaller footprint and look like the better shape.

## Decision

**`main` never holds a document's extracted text, transiently or otherwise, and
search is a per-page query.**

- One page's text is read, searched and dropped. What is resident at any moment
  is bounded by the **largest page**, never by the document.
- The channel carries a **bounded** result: a match limit the caller states, with
  truncation reported rather than implied.
- The renderer drives the page loop, which it must anyway — it decides what to
  show, when to stop, and what to cancel.

### The arithmetic that settles it, rather than a preference

§9.17 gives `main` **1.5× the file size**, and the ratio is measured as peak RSS
above baseline. `main` already holds the canonical bytes at 1.00×. Extracted text
at **3.59×** takes the total to 4.59× — **over three times the budget, from the
text alone.**

That is not a close call and it does not depend on the fixture being large:
the ratio is a property of the content shape, so any text-heavy document breaches
it. **Transient does not help**, because the budget measures *peak*.

## Rejected alternatives

**Retain the whole document's text in `main`, so a second search is free.** The
attractive one, and it is dead on the number above: a permanent second
document-scaled structure at 3.59× against a 1.5× ceiling. It would also make
§9.17's `main` sentence false in a way no check would catch, since the sentence
names two things and this is a third.

**Extract the whole document transiently inside one call, search, drop it.**
Fails identically, because the budget is a peak and not a residency. It reads as
the cautious middle and is not one.

**Keep it in the engine host instead**, whose budget is 3 GB. The host is where
the text is produced, so this is nearly free — and it is rejected because it
makes the host stateful about a query. ADR-0023's host answers about a document,
and a per-search cache there is state whose invalidation is a second version
question beside the one `DocVersion` already answers. The cost it saves is a
re-extraction the measurement shows is cheap relative to the budget it protects.

**A channel that returns a page's text and lets the renderer search.** Moves the
whole problem across the boundary: the renderer would then hold what `main` may
not, and PDF.js is *never a source of truth* (§3.2). It also puts a second
extraction path one step from existing, which is Part E2's K.0 regression.

**An unbounded match list.** For a common word in a long document this is
document-scaled by another name, which is exactly what invariant 11 forbids. The
bound is a stated parameter rather than a default, so *exhausted* and *truncated*
stay distinguishable — a default cap makes them the same observation for every
caller that did not set one.

## Consequences

**§9.17's `main` clause gains a third thing it does not hold**, so the sentence
stops being true only about the two it names.

**A document-wide search is N round trips**, and that is the design rather than a
cost to reduce later: the row already specifies *cancellable background
indexing*, which needs a per-page grain to cancel at.

**What is NOT measured, and is named rather than implied:** the round-trip
latency of a per-page search across a large document. The count is known and the
wall clock is not, and this ADR takes a dated correction if it turns out that a
per-page search is too slow to be the only shape — in which case the answer is a
bounded window, not a resident document.

**The ratio is a text-heavy figure and the corpus has one shape.** A scanned
document with an OCR layer, or a CJK document where a line's text is longer than
its geometry suggests, may differ. The measurement is repeatable by one command,
which is the point of it living in `scripts/research/` rather than in this file.
