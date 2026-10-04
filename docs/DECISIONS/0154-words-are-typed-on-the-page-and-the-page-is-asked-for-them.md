# ADR-0154 — Words are typed on the page, and the page is asked for them

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decided by:** the owner, in the 0.1.10.0 addition to the cloud-4 list, Group 15: *"Text box and Typewriter: no
  dialog; draw box (or click for Typewriter), cursor appears, type on page; click outside or Esc to finish;
  double-click to edit. Font size/colour from Properties."* and *"Same class (AnnotationTextForm's callers,
  AnnotationReplyBody): Comment/Note click places note and its box opens on the page; Callout types into its box;
  editing existing comment and replying in that box or Comments panel; Form text field (name) and Web link (address):
  small box beside what was drawn, not a centred dialog."* With 15c, a placement hint for every tool waiting for a
  press, and Escape leaving it.
- **Amends:** [ADR-0038](0038-a-dialog-answers-the-command-that-opened-it.md)'s shape as the text tools use it: a tool
  that needs words from a person asks the PAGE, not a dialog. ARCHITECTURE §6's tool lifecycle gains a double-click on
  no gesture (`reopen`) and a tool's hint.
- **Keeps:** ADR-0038 itself, for every dialog that asks something other than words typed where they will go — the
  stamp chooser, a field's options, a link's page number. The holder of the means to ask is still the tool or the
  command, constructed with it; nothing about which dialog belongs to which tool moves into the overlay.

## The problem

Six tools and two commands collect a person's words through a centred dialog: Text box, Typewriter, Callout and the
sticky note collect what the annotation says; a form text field its name, a web link its address; *Edit comment* and
*Reply* what a mark says. The dialog is somewhere else from where the words go, so a person types into a box that is
not on the page, about a place they can no longer see under the dialog.

## Decision 1 — the means to ask for words is `write`, held like `ask`

A tool or command that needs words holds `write(request): Promise<string | undefined>`, beside `ask`, constructed with
it. The request names the page, a box in PDF space where the words will be, the shape of what is asked, the words to
start from, an accessible label, the style the words are drawn in, and a check for a line:

- **A block** — what an annotation says. Enter is a new line. Escape, a click outside, or Ctrl+Enter FINISHES and keeps
  the words, which is the owner's *"click outside or Esc to finish"*. Nothing typed is no annotation.
- **A line** — a field's name, a link's address. Enter or a click outside commits once the check passes; Escape
  abandons. The check is the dialog's own result schema, so the rule a name or an address meets is still written once
  (B3a), and its message is shown under the box.

A box can **grow**: a typewriter's click gives a point and not a box, so the editor widens and lengthens with the
words, and the tool sizes the annotation from them afterwards, as it did from the dialog's answer (`clickedRect`).

**Not a fourth `commit` parameter.** `ToolController.commit`'s own comment rejects one — every tool would receive it
and a few use it — and a command has no overlay to receive it from. Held like `ask`, it reaches commands as well as
tools, which is what lets *Edit comment* and *Reply* type on the page too.

## Decision 2 — one request at a time, drawn over its own page

The application holds the one pending request and the page list draws it over the request's page, as `InlineWriter`,
placed through that page's `PageTransform` and set in the request's style at the zoom on screen. A second request while
one is open finishes the first, as a click outside would. A document closed or switched away from finishes it the same
way, so a promise is never left unanswered.

The page list takes it as its own prop, required and `| undefined` (`search`'s reason): it is not a drawing tool's
state, since a command writes with no tool in hand.

## Decision 3 — a double-click on no gesture is the tool's `reopen`

A double-click with no gesture in flight is handed to the controller as `reopen(point, page, transform)`, which answers
a command or nothing, like `commit`. `pointerPath` answers nothing, so a tool that does not reopen says nothing (the
`complete` default's reason). The select tool, Text box and Typewriter reopen a mark that says something — its words
in the box they are drawn in — and send `editAnnotationText`; a typewriter's or a text box's single click on such a mark
edits it rather than starting another, so the first click of a double-click does not place a second one.

## Decision 4 — a tool waiting for a press says what it waits for

`UiTool.hint` is a message the status bar shows while the tool is on and no gesture is in flight — *Click where you
want the note*. Every tool that places by a click or a drag declares one. Escape with no gesture in flight leaves the
tool, which is what the hint's *Esc to cancel* promises.

## Correction before building, 2026-10-04 — a request belongs to its document

Decision 2 said a document closed or switched away from *finishes* the pending request. Finishing takes the editor's
draft at the moment of the switch, and the switch happens in many handlers, none of which has the draft; doing it in an
effect is a state write in an effect body, which the React compiler's lint refuses for a reason (a render that writes
state renders twice). So the request **belongs to its document**: while another document is on show it is kept and
not drawn, and it is drawn again, with its draft, when its document returns — *preserve, never drop*. A document
**closed** with a request open drops it, and nothing is sent, as a dismissed dialog sent nothing. Only a second request
in the same window finishes the first, as a click outside would, because that is a moment the application is already in.

## Correction while building, 2026-10-04 — a block its rule refuses stays open

Decision 1 has Escape and a click outside FINISH a block and keep its words. A block has a rule too — no more than the
payload's `MAX_ANNOTATION_TEXT`, which the dialogs said at once and refused to apply — and finishing a block past it
could only drop the words, since the command cannot carry them. So a block whose rule refuses its words **stays open
with the dialog's message at every ending a person chose**, Escape included, and only a second request, which cannot
wait, answers nothing for it: *preserve, never drop*. An edit left empty changes nothing, the edit dialog's own rule
(*a comment cannot be empty; to remove it, delete the mark*), so nothing typed is nothing for an edit as for a new mark.

Words the page does not draw where they are typed — a note's comment — are typed in the application's own field, on a
card beside the point, rather than in a style the page will never draw them in.

## Correction while building, 2026-10-04 — where the hint is said, and who owns Escape

Decision 4's hint is said in the status bar's start region, where the line naming the tool that was on already sat
(v5-02), and it is the hint alone with one sentence for *Esc to stop*: a tool's title is written for its tooltip
(*Hand — drag to move the pages*), and its control already shows pressed. It is shown **while the tool is on, a gesture
in flight included**, not only between gestures: a corner tool's hint is how to finish, which is when it is needed.
`UiTool.hint` is required, so no tool can wait for a press nobody is told about; Edit text, Edit object and the hand,
which share the tool slot without being drawing tools, say theirs beside it.

**Escape is not a command.** A chord names one command and `view.leave-focus` holds Escape, and the order is a
person's: the innermost state goes first, as a dialog's, the palette's and Edit text's Escape already do before the
registry sees the key. So the application's shortcut handler, with its guards (a dialog open, a field or a control
answering the key), stops the tool before it dispatches a chord, and the order is: an autoscroll, a box being typed in,
a gesture, marks or an object selected, the tool, then Focus. Each nearer one stops the key where it handles it.

Rejected: a `tools.stop` command on Escape, which the shortcut map refuses beside `view.leave-focus` and which would
leave Focus's Escape unable to wait its turn; and a chord shared by several commands in an order, which is a change to
the map's one-command rule for one key.

## Rejected

- **A fourth `commit` parameter.** Decision 1.
- **The overlay rendering the editor.** It exists only while a drawing tool is on, and a command writes without one.
- **Keeping the dialogs beside the page for the same words.** Two ways to type one thing, one of which still covers the
  page.
- **A per-request choice of what Escape does in a block.** The owner named Escape as finishing, and a block that some
  tools abandon on Escape would be a key that means two things on one surface.
