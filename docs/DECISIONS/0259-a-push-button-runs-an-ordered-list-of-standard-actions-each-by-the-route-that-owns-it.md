# ADR-0259 — A push button runs an ordered list of standard actions, each by the route that already owns it

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amends:** `docs/ARCHITECTURE.md` invariant 24, by naming how a person asks for a button's action; §9's network rule,
  whose guard for a URL a person chose (ADR-0061) gains a request that sends; and the contract's push-button member
  `buttonAction: 'none' | 'reset'` (the owner's F7, which went through the existing seams with no ADR), which becomes a
  list. Keeps ADR-0167's route for a web address, ADR-0074's print, the existing *Import form data* command and
  `resetFields` (cloud run 14, R23) as the one reset.
- **Decided by:** the owner's R22, cloud run 15: a button's Action offered only *None* and *Reset the form* — *"it's so
  basic"* — and cut its own text. The actions to build, the triggers and the condition are the owner's, quoted in the
  run's brief: *"the agent has to ensure that all these options are carefully and perfectly built and that they do what
  is requested"*, and *"an action you cannot prove this way is not offered."*

## Context

ISO 32000-1 §12.6 gives an annotation one action in `/A`, run when it is activated (a mouse up), more actions after it
through each action's `/Next`, and further triggers in `/AA`: `/D` mouse down, `/E` the pointer entering, `/X` it
leaving, `/U` mouse up. The standard actions a form button uses are `GoTo`, `URI`, `ResetForm`, `Hide`, `Named`
(`/Print` is Acrobat's and every major reader's), `ImportData`, `SubmitForm`, `GoToR` and `Launch`; `JavaScript` is a
script.

Today `formFieldPropertiesSchema.buttonAction` is `none` or `reset`, written as a bare `/A /ResetForm` by pdf-lib, read
as `none`, `reset` or `other` by `fieldRules.ts`, and a press of a reset button sends `resetForm` naming the button, so
the kernel reads `/Fields` from the document. Every other action is `other`: kept, never run, and not offered a change.

What a second reader sees was read from PDF.js 5's worker (`parseDestDictionary`, `pdf.worker.mjs` in this tree,
2026-10-21): it reports a widget's `/A` for `GoTo`, `URI`, `GoToR`, `Launch`, `Named` and `ResetForm`; it reads no
`/Next`, and `Hide`, `ImportData` and `SubmitForm` reach its `default:` and are dropped.

## Decision

1. **A push button carries an ordered list of actions, each with its trigger.** `buttonActions` is a list of
   `{ trigger, action }`, at most eight (`MAX_BUTTON_ACTIONS`, sized so one button's list fits a frame); `trigger` is `up` (the default), `down`, `enter` or `exit`.
   The actions of one trigger run in the list's order. Written by pdf-lib, `editFormFields`' writer, in the single-edit
   shape (like `options`): `up` is `/A`, the next `up` action its `/Next`, and so on; `down`, `enter` and `exit` are
   `/AA /D`, `/E` and `/X`, chained the same way. Other `/AA` keys (focus, blur, a page's) are left as they are.
2. **The actions Monstera writes, and what a press does with each.** Every action that leaves the machine, opens
   something or names something outside the document is asked for first, in words, and nothing goes until the person
   agrees.

   | action | written as | a press |
   |---|---|---|
   | Go to a page | `GoTo /D [page /XYZ null null null]`, `[page /Fit]` or `[page /FitH null]` | the page is shown, at the view named |
   | Open a web link | `URI` (an `https:` address) | ADR-0167's question, then `main` opens it, read from the document |
   | Reset the form | `ResetForm`, with `/Fields` for chosen fields | `resetForm` names the button, the trigger and the step; the kernel reads `/Fields` and runs `resetFields` |
   | Show or hide fields | `Hide /T [names] /H` | a command naming the step; the kernel sets the named fields' Hidden flag, one undo step |
   | Print the document | `Named /N /Print` | the application's Print command, whose system dialog is the question |
   | Import form data | `ImportData /F (name)` | the application's *Import form data*: the person picks the file; the name the document holds is never opened |
   | Submit the form | `SubmitForm /F` (a URL file specification), `/Fields`, `/Flags` for the format | a question naming the address, the format and the fields; then `main` sends, read from the document |
   | Open a file | `GoToR /F (name) /D [0 /Fit] /NewWindow true` | a question naming the file; `main` resolves it beside the document and opens a PDF that exists, in Monstera |

3. **A press names the step; the document says what it is.** The renderer reads one button's list
   (`document.buttonActions`, bounded by one button) to draw its questions. What it then sends names the button by its
   place in the widget walk, the trigger and the step at a version, never an address, a path or a field list, and the
   kernel or `main` reads the action again from the document. So a compromised renderer can choose only among actions
   the document already holds, ADR-0167's argument for links.
4. **Triggers, while filling.** `up` is a click, by pointer or keyboard; `down` a pointer press; `enter` and `exit` the
   pointer crossing the field. The listing names, per widget, the triggers that have actions to run, so a button with
   none says so and runs nothing.
5. **What is kept and never run.** `JavaScript`, `Launch`, `SetOCGState`, a `GoTo` to a named destination, a `Named`
   other than `/Print`, a `URI` whose scheme `isFollowable` refuses, and an `/AA /U` are the document's own content:
   the button lists them as kept, runs none of them, and is not offered the editor, so no edit drops them (the rule
   F7's `other` already had).
6. **A submission.** The formats are the four `SubmitForm` defines: FDF (no format flag), XFDF (bit 6), HTML form data
   (bit 3) and the whole PDF (bit 9), with chosen fields as `/Fields` and the Include/Exclude flag clear. To an
   `https:` address `main` POSTs the data through ADR-0061's guard — HTTPS only, every private range refused, every
   resolution pinned — with the format's media type, and says whether the server took it. To a `mailto:` address the
   person's mail app opens with the data in the message, and Monstera never sends mail. A `mailto:` address longer than
   2,000 characters with the data in it (POLICY, not a measurement: the operating system hands the address to the mail
   app whole, and not every mail app takes a long one) is not cut: the question says so and offers to save the data
   instead, through the existing *Export form data*, and opens the message without it.

## Rejected

- **Running `JavaScript`.** Invariant 24, and the owner's decision of 2026-10-18.
- **`Launch`.** It starts a program. *Open a file* is `GoToR`, opened only by Monstera and only as a PDF.
- **The renderer naming the address, the path or the fields to `main`.** ADR-0167's reason.
- **A second reset.** `resetFields` is the one (B3a); a press and *Reset form* cannot clear a form differently.
- **Attaching the data to an email.** Neither Electron nor anything this build binds can attach a file to a message in
  the person's mail app (that is Simple MAPI's `MAPISendMail`), and nothing on this run's Linux CI could prove it. The
  data goes in the message's text instead; an attachment is the owner's to decide on.
- **One command for a whole press.** A press may print after a reset, and the print must show the reset document; the
  steps run in order, each awaited.
- **The full list in `document.formFieldProperties`.** It reads up to 16 fields in one frame; sixteen lists of addresses
  and field names do not fit (ADR-0125's bound).

## Proof

Each action, in its own commit: a kernel case writes it and a second reader reads it back (PDF.js for `GoTo`, `URI`,
`ResetForm`, `Named`, `GoToR`; MuPDF's object model for `Hide`, `ImportData`, `SubmitForm` and every `/Next` chain,
which PDF.js does not read); a rendered case makes the button in *Edit fields*, switches to filling, presses it and
observes the effect, with a control.

## Correction, 2026-10-22 (cloud run 15, as built)

Recorded as built, the Decision above left as written.

1. **A submission is sent as FDF, XFDF or HTML form data, not as the whole document.** Sending the document means
   streaming the staged image into the request, since the document is never read into `main` (ADR-0165), and that
   route was not built in this run. A document's own `SubmitForm` with bit 9 is listed kept and never run, as one asking
   for a GET, for coordinates, for every field but some, or for two formats at once is. `SUBMIT_FORMATS` is the list.
2. **The data is encoded where the form is read**: `engine/exportFormData` takes HTML form data (`URLSearchParams`, the
   encoding's own authority) and an optional list of field names, read by the one rule a reset and a show or hide take
   (`namedAmong`). `main` posts what it answers through `postGuarded`, ADR-0061's `checkedUrl` and pinned lookup with a
   POST; a redirect is not followed, since it asks for the data to go somewhere the person was not asked about.
3. **A `mailto:` submission whose data would pass 2,000 characters** opens the mail app without it and runs the
   application's Export form data in the action's encoding (FDF for HTML form data, which has no export), whose save
   dialog is its own question. The editor offers HTML form data for a `mailto:` address too; it is text.
4. **A hidden widget is marked in the field listing** (`hidden`, present only where true) and filling offers it nothing,
   so a Show or hide is seen where it lands. Before this a field set hidden in Properties stayed fillable through a
   control nobody could see.
