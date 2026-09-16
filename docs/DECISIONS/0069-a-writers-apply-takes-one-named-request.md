# ADR-0069 — A writer's `apply` takes one named request

- **Status:** Accepted
- **Date:** 2026-09-16
- **Amends:** `docs/ARCHITECTURE.md` §3.2 — a new standing rule on the writer-of-record seam.
- **Relates:** [ADR-0023](0023-how-the-contained-engine-host-is-built.md) Decision 10 (the seam this changes),
  [ADR-0040](0040-a-command-names-a-second-document-by-docid.md) (the `sources` axis and its one-way binding),
  [ADR-0062](0062-a-page-edited-in-another-application-leaves-as-a-named-file-and-returns-by-the-one-open-route.md)
  (the live run that found the defect).
- **Context:** D9's *Edit page in external app & reimport* live run, 2026-09-16 — the run failed, and the mechanism
  was not in the feature.

## The gap

`CommandExecution<W>.apply` is how a command reaches a session (ADR-0023 Decision 10). It was declared:

```ts
apply<K extends KindsRoutedTo<W>>(
  session: WriterSession[W],
  command: CommandOfKind<K>,
  source?: WriterSession[W],
  reads?: PreReadValue,
): …
```

Four positional parameters, the last two optional — optional because the interface is generic over *the kinds routed to
`W`* rather than over one kind, so it cannot say which commands declare `sources: 'one'` or `reads: 'outline'`. The
obligation to supply them lives at the one place that knows: the bus, which reads `spec.sources` and `spec.reads`.

That is a sound division of knowledge and it left one property unguarded. **A function that ignores trailing parameters
is assignable to one that passes them** — the bivariance ADR-0040's correction already records as the `sources` axis's
limit, there as a convenience. Between the bus and the engine this member is implemented or forwarded **six** times:

| where | shape |
|---|---|
| `commandSpecs.ts` `localMupdfExecution` | `(session, command, source)` |
| `pdfLibWriter.ts` `localPdfLibExecution` | `(image, command, reads)` |
| `pdfiumSpecs.ts` `localPdfiumExecution` | `(image, command, _source?: never)` |
| `signpdfWriter.ts` `localSignpdfExecution` | `(image, command)` |
| `host/remoteEngine.ts` `remoteMupdfExecution` | `(session, command, source)` |
| `host/remotePdfium.ts` `remotePdfiumExecution` | `(image, command)` |

plus two dispatches inside the hosts and two delegates at the composition root. Each of the short ones is correct about
its own table — PDFium is handed no source, signpdf reads no outline — and **none of them is distinguishable from a drop
by the type system**.

One was a drop. `apps/desktop/src/composition.ts`' live MuPDF writer forwarded `(session, command)` to
`remoteMupdfExecution`, from `9c53f05` (2026-08-31) — written before any command could name a second document — until
`631ff46` (2026-09-16). From `238cf2f` (2026-09-05), when `mergeDocument` landed, **every command that copies from a
second open document reached the engine host with `source === undefined`**: Merge PDFs, Insert from PDF, Replace page
and Import page as OCG layer. All four rows read *done*.

Every test was green, and the wired-tools rule's own pair is why: the kernel half proves the command produces the
document effect against a local writer, the UI half proves the control dispatches the command, and **the delegate sits
between them, crossed by neither**. The defect surfaced only in a live run of the packaged application.

## Decision

The seam carries one named request, with every field required.

```ts
export interface ApplyRequest<W extends WriterOfRecord, K extends KindsRoutedTo<W>> {
  readonly session: WriterSession[W];
  readonly command: CommandOfKind<K>;
  readonly source: WriterSession[W] | undefined;
  readonly reads: PreReadValue | undefined;
}

apply<K extends KindsRoutedTo<W>>(
  request: ApplyRequest<W, K>,
): WriterShapeOf[W] extends 'byte-image' ? Promise<ByteImage> : Promise<void>;
```

Three properties follow, and only the first is the headline:

- **A dropped field is a compile error.** `source` and `reads` are declared `| undefined` rather than `?`, so under
  `exactOptionalPropertyTypes` — set repository-wide since Stage 0 — a caller that omits the key fails with *property
  is missing*. `liveWriter().apply({ session, command })` does not compile. This is B5 over a test: the illegal state
  is unrepresentable rather than caught.
- **A forwarding delegate has one thing to forward.** `apply: (request) => liveWriter().apply(request)` names nothing
  and therefore drops nothing. The previous spelling had to restate four parameters to pass them on, and restating is
  where the drop lived.
- **The placeholder parameters disappear.** `localPdfiumExecution` declared `_source?: never` with the comment *"the
  slot exists because the bus passes positionally"*. An implementation now destructures what it uses; a writer that is
  handed no source simply does not name it, and the fact that PDFium is handed none stays where it belongs — in
  `Apply`'s resolution of byte-image × `sources: 'one'` to `never`.

`WriterFor<K>` in `commandBus.ts` — the narrowed structural view of the same member — takes the same request, because it
cannot be narrower than what it views.

**The argument order this replaces was load-bearing and its reason is preserved, not discarded.** `commandRouting.ts`
spelt `(source, reads)` everywhere because *two optional parameters of different types, absent for almost every command,
are exactly the pair a transposition hides in*. Naming them ends that question rather than answering it again: there is
no order to keep.

## What this does not close

**`session` and `source` are the same type.** An object literal that names both and swaps them compiles, exactly as the
positional pair did. Naming removes the *dropped* field, not the *wrong* value.

The guard for that is a wiring test, and it exists: `apps/desktop/src/compositionHost.test.ts`' case *"sends the source
document's session to the host, and not the target's (replacePage)"*, which mints a different handle per open and
asserts which one arrived in `engine/apply`'s `source`. It is the same shape as `pageMerge.test.ts`, which is what
ADR-0040's one-way binding leans on for the same reason: where the type system binds in one direction only, the other
direction is a document effect somebody asserts.

Stated here rather than left implicit because an amendment that closed one half of a class reads as having closed it.

## Rejected alternatives

- **Fix the four rows and leave the seam.** `631ff46` did exactly this and it is what the fix had to be at the time —
  the live run was failing and the mechanism was known. As the *whole* answer it is Rule 0's banned reflex: the class is
  *any delegate on this member*, there are ten call and implementation sites, and nothing would have stopped the
  eleventh. Rule 0's own words: closing one vulnerable handler and leaving its siblings is the classic half-fix.
- **A lint rule requiring a delegate to forward every parameter.** It would have to recognise *a function whose body is
  a single call to a same-named member* and compare arity, which is decidable only for the literal shape; a delegate
  that wraps, logs or awaits defeats it. And it would be a second opinion about assignability, which the compiler
  already owns (B3a).
- **Make `source` and `reads` required positional parameters.** It closes the same hole, and a caller must then write
  `apply(session, command, undefined, undefined)` at the eleven sites where neither applies — two bare `undefined`s in a
  row, adjacent, at every call. That is the transposition risk restored in its worst form.
- **Derive the parameters per command kind, so a writer handling no source has no slot.** `CommandExecution` is generic
  over `KindsRoutedTo<W>`, a union, and a conditional over a union distributes to a union of signatures rather than to
  one signature — which is the correlated-union limit every writer file in this repository already carries a cast for.
  It would replace four honest `undefined`s with six more casts.
- **Branded types for `session` and `source`, closing the swap as well.** A brand on a *position* is not a brand on a
  *value*: the same `MupdfSession` is the target of one command and the source of the next, so the brand would have to
  be applied at the call site — which is precisely the site that could be wrong. It moves the mistake rather than
  removing it, and the wiring test above catches what it would have.

## Evidence

- `npm run proof:contract` — the compile probe. The reject case *a writer delegate that drops `source` does not
  compile* is the whole point of this change, and the allow case beside it is the forwarding delegate. Both are
  compiled against the built declarations, so a stale build cannot make yesterday's seam pass.
- `apps/desktop/src/compositionHost.test.ts` — the runtime half, from `631ff46`: which session reached the host.
- `packages/kernel/src/pageMerge.test.ts` — the document effect, from 2026-09-05.
