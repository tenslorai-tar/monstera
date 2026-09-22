# ADR-0090 — A vision ask sends one picture of a page, drawn in the engine host

- **Status:** Accepted
- **Date:** 2026-09-22
- **Amends:** nothing. It adds a scope to `ai.ask` ([ADR-0088](0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md))
  and an image to the chat request each provider adapter already shapes
  ([ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md)); the
  picture comes from the page-image read the Excel table route already uses
  ([ADR-0086](0086-a-scanned-table-is-read-by-a-service-that-answers-tables.md)).
- **Context:** D11's *vision analysis (table reading assist)*, and `BUILD-PROMPT.md` E5's adapter
  shape, `vision?(image, prompt)`. A page whose table is a scan, a photograph or a drawing has no
  text for ADR-0088's window to carry; a model that can see can read it.

## Decision

1. **A sixth scope, `page-image`: a `docId` and a page.** Bytes of intent: the renderer never
   holds the picture and never sends one.

2. **The picture is drawn in the engine host and weighed in `main`**, by the route the table
   service takes: the page's displayed size from the host's geometry, a scale from Claude's
   documented image limits (a 2576 px edge, 4784 visual tokens, 5 MB encoded — `ocrClaude.ts`,
   read 2026-09-13), the host's `engine/pageImage` read — the page written into the granted
   directory, so no raster crosses the pipe — and `rasterWithinLimit`'s retake while
   the bytes are over. **Claude's limits for every provider**, because they are the tightest of
   the three shapes' documented limits and one picture that every adapter accepts is simpler than
   three sizes; a page too large to fit them even at the snapshot floor is refused by name
   (`page-too-large`), never cropped.

3. **Each adapter attaches it to the last user turn in its own form**: Anthropic's `image` block
   with a base64 source, the OpenAI format's `image_url` with a data URL, Gemini's `inline_data`
   part. It is sent once, with the ask that named it; earlier turns are sent as text, so a
   conversation does not re-send a picture per turn.

4. **What went says a picture went.** The answer's `sent` covers that page and carries
   `picture: true`, and the turn's line says *a picture of page N* rather than a count of
   characters. The instruction tells the model the picture is of that page and asks it to cite
   the page as every other ask does.

5. **A model that cannot see is not offered it.** The model list's `vision` flag, where a
   provider states it, disables the choice with that model; where it is unknown the choice is
   offered and a provider's refusal is worded as any other.

## Rejected

- **The renderer sends its canvas.** It would put a document-sized picture on the boundary from
  the side that must not originate document content, and it is PDF.js's drawing, which the
  architecture's non-negotiables say is never a source of truth.
- **One size per provider.** Three limits to keep true for one picture; the tightest serves all.
- **Resend the picture with every later turn.** A conversation about a page would cost a picture
  per question; the model's own answer carries what it read into the next turn as text.

## Consequences

- A table read this way is the model's reading, and the answer says what it is: an answer in a
  conversation, not a table the application vouches for. The Excel route (ADR-0086) remains the
  one that writes a table into a file.
