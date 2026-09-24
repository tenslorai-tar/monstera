# ADR-0102 — A selection survives a command that keeps the walk, and the Properties tab edits it

- **Status:** Accepted
- **Date:** 2026-09-24
- **Amends:** `docs/ARCHITECTURE.md` §6 (how an existing annotation is named) and §7 (`Placement` gains
  `properties`).
- **Relates:** [ADR-0041](0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md) (a handle is
  a walk position plus the version of that walk), [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md)
  (a surface that projects commands beside controls that hold values).
- **Context:** Stage 10, the owner's v5 design. v5-02 draws the right panel's Properties tab for a
  selected highlight: colour swatches, an opacity slider, line width, blend, author, a comment field, a
  *Use as default for new highlights* checkbox, and **Reply** and **Delete** at the foot. Every control
  changes the selected mark as it is used. There is no *Apply*.

## The gap

**A selection does not outlive the command it causes.** ADR-0041 makes a handle a position in one walk
at one version, and `App` drops a selection whose version is not the document's. That is right for a
removal, where the positions after the removed mark move. But it means every control on the design's
tab would empty the tab it sits on: pick a colour, the version moves, the selection goes, and the panel
shows *nothing selected*. The same rule is why an arrow key moves a selected mark once and not twice.

Today's panels avoid it by not acting on use: the style controls set what the **next** mark is drawn
in, and the comment styles panel has an *Apply* button that sends the whole authoring style to the
selection in one command. That is two steps for one change, and the design has one.

**And the footer's two buttons are commands with no surface to be placed on.** *Reply* and *Delete*
are `annotate.reply-selection` and `annotate.delete-selection`, placed today on the annotation context
menu. A panel that drew its own two buttons naming those ids would be the hand-kept layout §7 forbids.

## Decision 1 — a command that keeps the walk carries the selection to its version

The contract names the annotation commands that leave the page's walk as it was — every mark at the
same position, of the same kind, none added or removed:

```ts
KEEPS_THE_ANNOTATION_WALK = new Set(['placeAnnotation', 'styleAnnotation', 'editAnnotationText'])
```

After one of these applies to a selection, the renderer **re-reads** the walk at the version the command
produced and selects the same indices there, taking each mark's style, contents and rectangle from that
answer. It never computes them: a carried selection is a fresh read that happens to name the same
positions, and if the answer's version is not the one the command produced — something else moved the
document in between — the selection is dropped, as today.

**Measured, and proven by the kernel rather than asserted by the list** (2026-09-24, MuPDF 1.28.0,
`pageAnnotations.test.ts`): on a page carrying a square, an ink stroke, a highlight and a note, each of
the three commands leaves the walk `0:square, 1:ink, 2:highlight, 3:sticky-note` exactly as it was —
including an edit of the note, whose `update()` writes a `/Popup` into `/Annots` that the walk does not
count. The cases are keyed by a `Record` over the set's own type, so a member added without a case does
not compile. The control: `removeAnnotation` and `replyToAnnotation` both change the walk on the same
fixture, and neither is in the set.

ADR-0041's rule is unchanged. A handle still means nothing across versions; what this adds is that a
command in the set is a version change whose answer the renderer asks for again, by position, because
the kernel has shown the position still names the same mark.

## Decision 2 — the Properties tab edits the selection

With marks selected, the tab's controls **are** the marks' style: colour, opacity and line width each
send one `styleAnnotation` for the whole selection when used — a slider when it is released, not on
every step, so a drag is one undo entry. With one mark selected, its comment is a text field that sends
one `editAnnotationText` when it loses focus with a changed value. **Use as default for new annotations**
is a remembered setting, on by default because the design draws it ticked; while it is on, a change made
to the selection is also written to the authoring settings, so the next mark is drawn the same way.

With nothing selected, the tab shows the authoring settings, as the style controls do today. *Apply* is
retired: a control that acts on use has nothing left for it to do.

## Decision 3 — a `properties` placement

```ts
{ surface: 'properties'; order: number }
```

A command placed there is drawn at the foot of the Properties tab while a selection exists and its
`when` holds, in `order`. *Reply* and *Delete* take it.

## What the design draws that this does not build

**Author, blend and the creation line are not mounted.** The walk carries no `/T`, no `/BM` and no
`/CreationDate`, and there is no command to write them. A field that showed nothing, or a blend control
whose choice went nowhere, is the display-only defect. They are listed for the owner to decide, which is
§3b of the work order.

## Rejected alternatives

**Keep dropping the selection.** Every control would empty the tab it sits on.

**Carry the selection by arithmetic in the renderer** — keep the old items and bump their version. It
agrees with the kernel most of the time and is a second opinion about what the command did (B3a); a
restyle's new colour, and a moved mark's new box, would be the renderer's guess rather than the walk's.

**A per-command flag on the execute answer.** Main would say *the walk is kept* on each answer. The
fact is a property of the command's kind, not of one application, so it belongs where the kinds are;
and the kernel's proof reads the same set the renderer does.

**Keep *Apply*.** Two steps for a change the design makes in one, and a panel whose controls do nothing
until a second button is pressed reads as broken to anyone who has used another editor.

**Draw *Reply* and *Delete* in the panel by id.** The second wiring place §7 forbids, and a button that
would stay drawn while the command's `when` had hidden it everywhere else.

## Consequences

- An arrow-key nudge carries its selection, so a mark can be moved more than one point at a time.
- The comment field shows a highlight's comment, which is the trigger `EDITABLE_TEXT_KINDS` records for
  widening itself: *"the day anything renders a markup's comment, the kind joins this list in that
  commit."* The Properties tab renders every selected mark's comment, so *Edit* is offered on every kind.
- *Use as default* writes the same four settings the style controls write today; nothing new is stored
  about a mark.
