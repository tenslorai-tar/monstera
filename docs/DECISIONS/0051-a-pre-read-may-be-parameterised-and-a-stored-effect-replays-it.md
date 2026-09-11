# 0051 — A pre-read may be parameterised by the command, and a stored-effect replay re-applies the one it stored

Accepted 2026-09-11.

## Context

D6 row 3 writes the recognised text of a page into that page as an invisible
selectable layer. Both halves of it exist and neither can reach the other:

- **The writer** is `@cantoo/pdf-lib` by §3's content-composition row, and
  `ocrTextLayer.ts` (2026-09-11) is built and proven. A pdf-lib command is a
  **byte-image** command, so its `apply` is `(image, command)` and holds **no
  engine session**.
- **The reader** is `ocrRecognise.ts`, which runs **inside the engine host** beside
  the rasteriser that feeds it, because a page's bitmap is 1.7 MB against ~20 KB
  of answer and ADR-0014's constraint 1 keeps the model and the datadir ours.

That is exactly the shape ADR-0040's 2026-09-05 extension was written for — *an
apply may need a value read through another engine, and the bus resolves that* —
and the axis it built cannot express this one. Two walls, measured by writing the
caller:

**1. A pre-read takes no argument.** `PreReadAccess` is
`{ readonly outline: () => Promise<PreRead['outline']> }`, and `#preReadFor`
indexes it with the declared member. An outline is a property of *the document*,
so a zero-argument accessor was the whole shape it needed. A recognition is a
property of *a page*, and there is nowhere to say which. `Apply` hard-codes
`R extends 'outline'` beside it, so a second member would be resolved and then
dropped on the way to the apply.

**2. Recognition is not reproducible, and `redo` refuses by design.** `§3a` names
it: *"OCR output moves with the engine version"*, and `§4` reserves checkpoints
for *"redaction, flatten, encryption and OCR"*. So `ocrPage` declares
`reproducible: false, replay: 'stored-effect'` — and `CommandBus.redo` carries
`const replay: 'reapply-intent' = spec.replay` as a **compile-time trigger**,
written in 2026-09-04 with its own instructions: *"the day any spec declares
`replay: 'stored-effect'`, this line stops compiling. That is the prompt to build
stored-effect replay, arriving at the moment the path becomes reachable and not
before."* The trigger has fired. It is the first one in this repository to fire
**as designed**, rather than by being found stale.

Both are amendments rather than registrations, which is what makes this a B4: the
seam cannot express the command, and bending either in place would be bending the
seam rather than amending it.

## Decision 1 — a pre-read declares what it needs, and the declaration says how to get it

**`PreRead`'s members carry a `needs` type beside their value type, and the
command's declaration carries the one expression that turns a command into that
value.**

```ts
export interface PreReadKinds {
  readonly outline: { readonly needs: void; readonly value: readonly OutlineEntry[] };
  readonly ocr: { readonly needs: OcrRequest; readonly value: RecognisedPage };
}
export type PreRead = { readonly [K in keyof PreReadKinds]: PreReadKinds[K]['value'] };
export type PreReadAccess = {
  readonly [K in keyof PreReadKinds]: (needs: PreReadKinds[K]['needs']) => Promise<PreRead[K]>;
};
```

Four properties, and each of them is the reason one of the alternatives below is
refused:

- **Each member keeps its own signature.** `access.outline(page)` does not
  compile and neither does `access.ocr()`. An optional argument on every member —
  the cheap widening — makes both of those legal and leaves the rule in a
  comment, which is the shape this project pays for repeatedly (QQQ-3).
- **The two halves cannot drift**, because `PreRead` and `PreReadAccess` are
  *derived* from one declaration. `CommandReads` is still `'none' | keyof PreRead`,
  so a member added here widens the axis, breaks every implementer of the access
  object, and cannot be declared without saying both what it answers and what it
  must be told.
- **`Apply` is generalised from `R extends 'outline'` to `R extends keyof PreRead`**
  and hands the apply `PreRead[R]`. The old spelling named one member in a type
  parameterised over the axis — correct while the axis had one member and a
  silent dropper the moment it had two.
- **The declaration carries the resolution**, as one expression per command:

  ```ts
  reads: 'ocr',
  read: (access, command) => access.ocr({ page: command.page, language: command.language }),
  ```

  `reads` and `read` are one arm of a union, so neither can be written without the
  other and a `reads: 'none'` command **cannot** carry a resolver. The bus calls
  `spec.read(access, command)` and still indexes nothing, decides nothing and
  reads nothing.

**This is the first function in `commandDeclarations.ts`, and that is the cost
being taken deliberately.** That file's property is that it holds no
implementation — ADR-0026 put it there so nothing could value-import an engine
through it — and this expression imports nothing: it names two members and
copies two fields. What it buys is the only spelling in which the command's kind
and the pre-read's needs are correlated *by the checker* rather than by a cast or
a runtime refusal.

**Rejected: the recognised text in the command's payload.** The obvious shape,
and it loses twice. L11 — *"any design where payload size scales with document
size per operation is wrong"* — and ADR-0035, which measured extracted text at
**3.59× a document's bytes** and forbids it being resident in main at all. A
whole-document scope would hold every page's text in one payload.

**Rejected: one access member taking the whole command union**, with the
implementation narrowing by kind. It type-checks, and it puts a
`if (command.kind !== 'ocrPage') throw` in main for a state the declaration table
makes unreachable — a check that cannot fail, wearing a green tick.

**Rejected: building the access object per command**, closing over the page.
`documentCommands.ts` already builds it per call and does hold the command, so
this looks free — but every *other* command must still supply an `ocr` member,
and with no page to give it the member becomes a branch on the command's kind in
the composition root. That is the second routing place §6 spends its mapped types
to prevent.

**Rejected: a second accessor object beside `PreReadAccess`.** `CommandInputs`'
own comment says why the first one was not a parameter: *"a fifth positional
parameter would have edited every call site of `execute` for a value almost none
of them may use, and again for the next resolver."*

**Rejected: routing the command to MuPDF** so the read and the write share a
session. §3's matrix assigns content composition to pdf-lib, and ADR-0040's
extension already refused this for `generateToc` in terms that apply unchanged:
*"classifying by convenience, which is how a matrix stops being evidence."*

## Decision 2 — a stored-effect command's entry carries the pre-read, and redo re-applies it

**A terminal log entry carries the pre-read value the command was applied with,
and `redo` uses the stored one for a `replay: 'stored-effect'` command instead of
resolving a fresh one.**

```ts
| {
    readonly kind: 'terminal';
    readonly command: CommandOfKind<K>;
    readonly checkpoint: Checkpoint;
    readonly reason: string;
    /** What the apply was handed, for a command whose replay may not re-read. */
    readonly read: PreReadValue | undefined;
  }
```

Re-running recognition on redo is wrong in two different ways, and only the
second is about time. It costs **3.8–4.4 s per page** again (measured 2026-09-10,
`proof:ocrrecognise`), and a model or an engine upgrade between the undo and the
redo makes the redone document **different from the one that was undone** — which
is the silent divergence `§3a` was written ahead of any command to prevent.

The value is **required and nullable rather than optional**: every construction
site has to say what it is, and `CommandLog.trimTo`'s own rule is the precedent —
*"an obligation that arrives as an absent value is one a caller forgets to
check."* It is not document-scaled: a page's recognition is bounded by
`engine/ocr-page`'s own limits, 2,048 lines of 4,096 characters, against a
checkpoint that is a whole document image and already governs retention.

**Rejected: declaring OCR reproducible** so the existing replay path serves it.
It contradicts `§3a`'s own example, and the failure is invisible — a redo that
quietly produces different text than the undo removed.

**Rejected: storing the resulting bytes as the effect.** A terminal entry already
holds one whole document image for undo; a second for redo doubles the most
expensive thing in the log, and a redo that installs bytes rather than re-applying
the command would be a second write path into the document.

**Rejected: a third entry kind.** `retainedBytes` and `trimTo` both classify on
`kind === 'terminal'`, and a third state those two do not know about is exactly
the asymmetry DDD-1 names — *when one half of a classifier carries three states
and the other carries two, the asymmetry is the finding.*

## Consequences

- **`outline` must not change behaviour**, and it is the evidence the amendment
  widened nothing: it is the existing implementer, its cases are unmoved, and its
  member is the one that takes no argument.
- The axis now has a member whose value is **not** a document-level property, so
  *resolved at apply time, inside the lane* means something stronger than it did:
  a recognition read before the lane was entered would describe a page another
  command may since have rotated.
- `ocrPage` is the first `stored-effect` command. The next one arrives with the
  path built rather than with a compile error, and the trigger that produced this
  amendment is spent — `redo`'s branch is now a real branch with a real case.
- `PreReadAccess` moves from `commandBus.ts` to `engineSeam.ts`, where `PreRead`
  is: `commandDeclarations.ts` needs the type to declare a resolver and the seam
  cannot import the declarations back (ADR-0040's own correction).
