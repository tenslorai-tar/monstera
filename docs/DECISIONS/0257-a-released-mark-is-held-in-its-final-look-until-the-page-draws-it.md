# ADR-0257 — A released mark is held in its final look until the page draws it

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amends:** `docs/ARCHITECTURE.md` §6, *Annotations use one geometry vocabulary*: what is drawn between a release and
  the page's drawing of the result. Extends [ADR-0166](0166-a-tools-preview-is-placed-as-its-commit-is.md) Decision 4
  (the held shape) and the R17 handover (064881ba); supersedes ADR-0166's *What this does not do*, whose premise — that
  PDF.js cannot leave one annotation out of a draw — R17 measured false and built on (`drawWithout`).
- **Decided by:** the owner, 2026-10-21, answering R19 (a): *"the 'final look at once, kept until replaced' route for
  every Comment mark … ONE design with R17's fix: reuse it rather than building a second mechanism beside it."*

## The problem, measured

R19 timed every Comment tool from the release to the result drawn as it really looks (`markLatencyWalk.mjs`): 0.5 to
1.3 s, in 0.1.16.0 and 0.1.17.0 alike. What is on screen meanwhile is a **placeholder**: the overlay holds the drag's
preview, which is geometry alone — a box or an outline in the accent at 14% (`.m-annotation-preview`) — whatever the
tool, its colour and its content. A survey of every tool (2026-10-21) found it worse than one placeholder:

| route | what is drawn from release to the page's redraw |
|---|---|
| rectangle, ellipse, line, arrow, ink, polygon, cloud, polyline, measures, highlight area, redact area | the held accent outline; no colour, no fill, no arrowhead, an open polygon |
| highlight, underline, strikeout, redact text (from a selection) | **nothing**: the selection is cleared at the release and no overlay is mounted |
| text box, typewriter, callout, link | the writer unmounts, then an **empty** accent box is held |
| sticky note, caret, typewriter click | **nothing** |
| built-in stamp | the held accent box; a picture stamp and a signature: **nothing** |
| eraser | the mark stays, then vanishes when the page redraws |

The style every new mark will have is not lost on the way: **every value is in the command the tool returns** —
`addAnnotation`'s draft carries colour, opacity, width, ending, border, words, size, family, direction and look. The
preview simply never reads it.

Trimming the pipeline will not reach the owner's 150 ms: after R19's worker fix (91b3972b) the rest is spread across
`main`'s reads (~170 ms), React (~140 ms), PDF.js (~60 ms) and the graphics process (~235 ms).

## Decision

1. **A released mark's FINAL LOOK is drawn from its command**, by one function, `markLook.ts`' `lookOf`: the one
   mapping from a command to what it draws while the page has not yet drawn it. It reads only what the command carries
   and, for a picture the command names by id, the picture the renderer already holds (a signature's strokes or
   outline, a kept stamp picture's `blob:`). A tool's `preview` stays the drag's; what is held after the release is
   no longer the last preview but the command's look, so **what is held is what was sent** (ADR-0166 Decision 3,
   carried from the drag to the release).
2. **The look is the mark's own:** its stroke colour and width, its opacity, a highlight's colour multiplied over the
   words, a line's ending, a polygon closed and a cloud scalloped, a measurement's reading where `measureCaption` sets
   it, a text mark's words in its family, size, colour and direction as the writer laid them out, a sticky note's
   icon, a caret, a redaction's hatching (the one `RedactMark` the page layer draws), a built-in stamp's word and
   border, a signature's strokes or picture. Where MuPDF's appearance follows a rule the contract states, the look
   takes that rule; where it does not, the look is drawn from the command's values and the difference at the
   handover is **measured and reported per tool**, never assumed away.
3. **ONE holder per page**, lifted out of `AnnotationOverlay` (`committed`) into the page slot: a look and the view it
   was released over. Every route holds through it — the overlay's release (in the same update for a command known at
   once, R17; when answered for one that waits on a person), the text-selection markups at their release, the writer
   tools when the words are done, stamps when chosen, signatures when placed. A second holder beside it is the defect
   this ADR exists to prevent.
4. **The handover is R17's, unchanged in kind:** the look is dropped when the page presents a view newer than the one
   it was released over, in the same task as the pixels (`flushSync`), so no frame shows neither. **A tiled page counts
   as presented only when every tile shown has drawn the newer view** — the slot set `drawnWith` when it measured a
   tiled page, before its tiles drew, which is the one gap the survey found in R17's handover.
5. **A mark that leaves the page leaves at once:** an erasure, like a move (R17), leaves the mark out of the view the
   gesture began on, so the page's own drawing of it disappears in the frame the release is answered, not at the
   redraw. A refused command drops its look at once and restores the mark, as now.
6. **Not covered, and why:** Comment › Image. Its picture is picked by `main`'s file dialog and read there; the renderer
   never holds its bytes, so there is no look to draw before the page draws it. Giving the renderer one would mean a
   picture decoded for it — in a contained host, never in `main` — and a channel to carry it: a change the owner is
   asked about rather than made here.

## Proof

Per tool — rectangle, ellipse, line, arrow, ink, polygon, cloud, polyline, the three measurements, highlight area,
redact area, highlight, underline, strikeout, redact text, text box, typewriter, callout, sticky note, caret, built-in
stamp, picture stamp, signature, eraser — a rendered case samples every frame from the release until the page has drawn
the saved mark: the mark's look is on screen within about 150 ms of the release, and **no frame shows an empty or a
placeholder state** (the accent preview class held after a release fails it). The live instrument re-times every tool R19
timed, with Comment marks, rotate, page delete and Edit text, against R19's figures.

## Rejected

- **A second holder for the routes the overlay does not mount** (text selections, writers, stamps, signatures). It is the
  shape the owner named: a second mechanism beside R17's.
- **Asking the engine for the mark's appearance after the command** (a MuPDF render of the one annotation). Truer pixels,
  but they arrive after `main` has applied the command, about 35 ms plus a render plus the wire: never at the release,
  so a placeholder would still be drawn first.
- **Drawing every annotation in the renderer over a page drawn without them.** Exact at every moment, and a change to how
  every page is drawn for a gap that lasts under a second.
- **Keeping the drag's preview and colouring it.** The preview is the gesture's, and a text box's words, a stamp's word
  and a signature are not in a gesture.

## Correction while building, 2026-10-21 — the request for words leaves the shell's state, as the holder did

Decision 3 holds a writer's look *when the words are done*, and it is: the overlay's `hold` runs in the same task as the
key that finishes them. But the look reached the page **31 to 89 ms** after that key, against 6 to 11 ms for a mark with
no words, read by `markLook.pw.ts` on 2026-10-21 with a mark at each `App` render and commit: every writer's finish
started an `App` render 1 to 2 ms after the key, and the look entered the page 4 to 12 ms after that render committed.
The mechanism is the one this ADR already removed for the holder. Finishing the words clears `usePageWriting`'s pending
request, which is `App`'s state, so the held look is committed in the same batch as a render of the whole shell. One run
took 351 ms.

So the pending request moves to **a store of its own beside the holder**, which the page pane alone subscribes to.
Finishing the words renders the pane that drew the editor, never the shell. ADR-0154's decisions are unchanged: the
application still holds the one pending request, the page list still takes it as its own prop, and a second request,
a closed document and a switch away still settle it as they did.

Rejected: **deferring the request's removal to a transition** so the look commits first. The editor would then stay on
screen over the look that replaces it, the same words drawn twice for a render's length. That is a second state between
release and handover, which Decision 4 exists to forbid.
