# ADR-0278 — Words a write refused are never left without a question

- **Status:** Accepted
- **Date:** 2026-10-30
- **Decided by:** the owner, 2026-10-30, answering the local agent's question at the run 25 merge: *an editor holding
  refused words never loses them silently and the bar never says Saved over them; any way of leaving asks "Your words
  were not written. Keep editing / Discard", Keep editing the default.*
- **Amends:** [ADR-0169](0169-a-pdfium-rewrite-is-saved-only-when-it-reads-back-as-edited.md) Decision 5 (what a person
  reads, and the words they typed stay), which held only against the press away and another block's press.

## Context

A refused write leaves the Edit text editor open with the person's words and the sentence saying why (ADR-0169
Decision 5), and its hint says *Press Esc to put the text back*. Two routes respected that: the press away, whose
`finish` does nothing while a problem stands, and a press on another block, which `choose` ignores. Every other route
unmounts the editor without asking it, because the layer decides from state on every render which editor is open.

Measured 2026-10-30 in the development app at e61f77b9, with the boundary's refusal of a one-line block's reach put
back for the run (839930f8's control): the marker editor held *[13] [1] with added words* and the sentence; a press on
the ribbon's Edit text button closed it, the page said *[13] [1]* again, the status bar said *Saved*, and a save wrote
the old words. The routes that do the same, read from the code: another tool, the rail's Organize, a tab switch, opening
another file, closing the tab, closing the window, split view on or off, and undo or redo from the ribbon or the menu.

The status bar says *Saved* where the document's version is its saved version, which refused words never change, so it
is right about the file and wrong about the person's work.

## Decisions

1. **One rule, `leaveOpenEditor`, in the open-editor registry (`editorKit/openEditor.ts`), and every route that would
   end an editor awaits it first.** Where no editor is open, or the open one holds no refused words, it answers *go on*
   at once and changes nothing: an editor whose words are unwritten for any other reason is finished by the route as
   before. Where the open editor holds refused words it asks the question below and answers *go on* only on Discard.
2. **The question is a dialog of the one primitive: "Your words were not written." with Keep editing and Discard.**
   Keep editing is the default button and what dismissing it answers; it puts the focus back in the editor, with the
   words and the sentence as they were. Discard puts the page's text back, as Escape in the editor does, and the route
   then goes on.
3. **The routes are the ones decided outside the editor:** the tool changing (`setToolId`, which the Edit text button,
   every other tool and the rail's Organize go through), the active document changing (a tab, an opened file, the
   start screen), a tab or the window closing (`requestClose`), split view on or off, and a command that moves the
   document's version while the editor is open (undo, redo). Each is a case with today's silent loss as its control.
4. **While refused words are held the status bar says *Unsaved changes*, never *Saved*.** The words are the person's
   unsaved work; the bar reads the registry's held state beside the document's version.
5. **Refusals the document causes are defects to remove at their source, not causes for this question.** The owner's
   rule is that Edit text never refuses because of the document
   ([ADR-0270](0270-edit-text-writes-what-the-person-typed-and-never-refuses-it.md)); this ADR is the net under a
   refusal that still happens, and the list of today's refusal classes is in the run 25 merge report.

## Rejected alternatives

- **Keep the editor and refuse to leave until Escape.** The person who pressed another tool gets nothing and no reason;
  a question names the choice.
- **Close silently, as today.** It is the measured defect: the words go and the bar says Saved.
- **Ask in each route its own way.** Ten callers each spelling *is an editor holding words* is the second-opinion shape
  B3a names; the eleventh route would be written without it.
- **Have the editor refuse to unmount.** A component cannot stop its parent removing it; the decision has to be made
  before the state that removes it changes.

## Proofs

- `openEditor.test.ts`: the rule answers *go on* with no editor, and with an editor holding no refused words, asking
  nothing; with refused words it asks, and Keep editing answers *stay* and refocuses while Discard puts the text back and
  answers *go on*. **Control:** the old behaviour, a route that does not await the rule, loses the words.
- A rendered case per route in `editTextLeaving.pw.ts`, each holding refused words made by a refusal the shim answers,
  asserting the question, Keep editing keeping the words and the sentence, and Discard putting the text back; and the
  status bar saying *Unsaved changes* while they are held.
