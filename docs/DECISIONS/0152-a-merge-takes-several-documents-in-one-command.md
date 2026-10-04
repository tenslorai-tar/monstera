# ADR-0152 — A merge takes several documents in one command

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decided by:** the owner, in the 0.1.10.0 addition to the cloud-4 list, item 13d: *"MERGE: At the start / At the
  end / After page N; 'Choose file…'; several files in an order the person sets."*
- **Amends:** [ADR-0040](0040-a-command-names-a-second-document-by-docid.md) Decision 4's `sources: 'none' | 'one'`,
  which said of itself *"The day a command needs two sources this widens"*; and
  [ADR-0069](0069-a-writers-apply-takes-one-named-request.md)'s `ApplyRequest.source`, whose one session becomes a
  list.
- **Keeps:** ADR-0040 Decisions 1 to 3 unchanged. Every source is an open document, named by `DocId`, and its session
  reaches the bus as a resolved map.

## The problem

The merge dialog places one other document. The owner asks for several, in an order the person sets. Two readings
of that are possible and only one is sound:

- **One `mergeDocument` per file, sent in order.** Every piece exists today. It is also N log entries for one
  intent, which ADR-0009 §4 forbids for exactly this reason, and `replacePage`'s own comment in `commands.ts` names
  it: one action would take N undos, and a document could rest between them with some of the files merged and the
  rest not. A failure on the third file leaves two merged with nothing on screen saying the action was half done.
- **One command naming every document.** One intent, one log entry, one checkpoint as its inverse, and a failure on
  any file changes nothing. It cannot be expressed today: `sources` is `'none' | 'one'`, `Apply` takes one source
  session, `ApplyRequest.source` is one session, and `engine/apply`'s `source` is one handle.

The second is the decision. ADR-0040 predicted it, and chose `'one'` over a count because nothing yet asked for
two; something now does.

## Decision 1 — a third value on the axis: `sources: 'several'`

`CommandSources` becomes `'none' | 'one' | 'several'`. `'several'` is one or more documents, in the payload's order,
the same document allowed more than once (a person may want a cover sheet twice). The bus resolves each id through
`sourceIdsOf`, which already answers a list, and refuses by name when the map lacks any of them, as it does for one.

**A third value rather than replacing `'one'` with a count.** `replacePage` and `importPageAsLayer` take exactly one
other document, and a list type there would make *how many* a runtime question at their applies, which is the reason
ADR-0040 gave against a count. The type says how many each declaration takes.

## Decision 2 — the request carries a LIST of source sessions, typed by the axis

`ApplyRequest.source: WriterSession[W] | undefined` becomes `sources: readonly WriterSession[W][]`, required as every
field there is (ADR-0069): empty for `'none'`, one for `'one'`, the payload's order for `'several'`. `Apply`'s third
parameter follows the declaration:

| `sources` | the apply's third parameter |
|---|---|
| `'none'` | none |
| `'one'` | `readonly [WriterSession[W]]` |
| `'several'` | `readonly [WriterSession[W], ...WriterSession[W][]]` |

So a one-source apply destructures `[source]` and cannot read a second, a several-source apply cannot be handed none,
and every writer's adapter passes the one list through without reading the declaration a second time. `engine/apply`
carries `sources`, a bounded list of handles, in place of `source`.

**One field, not `source` beside a new `sources`.** Two fields that mean the same thing is two writers of one fact
(B3), and every forwarding site would have two things to forward, which is ADR-0069's defect restored.

## Decision 3 — the payload is a list of parts

`mergeDocument` becomes `{ kind, documents: [{ source, sourcePages }], at }`: one to `MAX_MERGE_DOCUMENTS` parts,
placed one after another from `at` in the order given. The parts' page sets together are bounded by
`MAX_PAGE_SET_ENTRIES`, the one bound a single set already has, so the message's worst case is the worst it has today
plus the ids.

`MAX_MERGE_DOCUMENTS` is 32. It is a bound the schema needs so the message has a size, chosen and not measured: it is
not a figure for how many files people merge, and each part costs the message one id, so raising it moves nothing
else.

## What this does NOT do

- **Merge files that are not open.** ADR-0040 Decision 2 stands: *Choose file…* opens the file as a tab, then it is a
  source like any other.
- **Change any other command's payload.** `replacePage` and `importPageAsLayer` keep `source: DocId`.

## Rejected alternatives

**N commands in order.** One action, N undo steps, and a half merge after a failure. See *The problem*.

**A batch or transaction around N commands.** The bus has none, and building one to avoid widening an axis that
said it would widen is a second seam for a question the first already answers.

**Merging the files into one document first, out of sight, then merging that.** An intermediate document the person
never opened, which is ADR-0040's rejected *transient handle* by another route.

**Replacing `'one'` with a count.** See Decision 1.

---

## Correction, 2026-10-04, before building — the bound is in the SHAPE, and the payload has two

**Decision 3's *"their page sets together bounded by `MAX_PAGE_SET_ENTRIES`"* could not hold as written.** It was
built as a refine over the parts' total, and `hostRoutes.test.ts` read `mergeDocument` as past the MuPDF host's frame
at its worst: 32 parts each free to carry a paired set. That reading is correct, because `maxEncodedBytes` reads the
schema's shape through zod's JSON Schema and a refine has no representation there. The check that owns a message's
size is the authority on it (B3a), so the bound has to be a shape it can read, not a rule beside it.

**Decided:** `documents` is a union of two shapes, which are the two intents the dialogs ask for:

- **one document with the pages chosen of it** — a one-tuple carrying `sourcePagesSchema`, *Insert from PDF*'s part;
- **one to `MAX_MERGE_DOCUMENTS` documents, each taken whole** — `sourcePages: 'all'`, *Merge*'s parts.

Its worst is one paired set plus an id, the size the command had before this ADR. No dialog asks for several
documents with pages chosen of each; that would be a widening of the union, made on purpose. A *later document that
lacks a page* is therefore not a state the payload can express, and the case that refuses a later failure with
nothing placed is now a later document whose session is closed.

**Rejected:** a per-part set bounded at `MAX_PAGE_SET_ENTRIES / MAX_MERGE_DOCUMENTS` (256 entries), which would
refuse an *Insert from PDF* that today takes 4,096; and routing MuPDF's apply through a file, a transport change for
a bound the shape can state.
