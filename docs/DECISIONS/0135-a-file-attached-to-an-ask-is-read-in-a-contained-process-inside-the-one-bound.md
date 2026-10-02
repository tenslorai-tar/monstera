# ADR-0135 — A file attached to an ask is read in a contained process, inside the one bound

- **Status:** Accepted
- **Date:** 2026-10-02
- **Amends:** nothing in `docs/ARCHITECTURE.md`'s invariants. It adds a renderer channel, `ai.attach`, widens
  `ai.ask` with `attachments`, adds one compose host channel, `engine/image-size`, and lets a chat request carry more
  than one picture.
- **Decided by:** the owner's brief of 2 October, item 5: *a paperclip in the assistant; any type; each file a chip;
  the renderer holds a FileHandle and nothing else; the file is parsed in a contained host (ADR-0060's import host,
  x2t); what is read goes inside the bound; a file that cannot be read is named with its reason.*
- **Relates:** [ADR-0060](0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md) (the
  compose host), [ADR-0071](0071-layout-preserving-text-is-popplers-pdftotext-in-a-contained-process.md) (the contained
  pdftotext), [ADR-0120](0120-office-import-is-onlyoffices-x2t-contained.md) (the contained x2t),
  [ADR-0088](0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md) (the window and its bound),
  [ADR-0090](0090-a-vision-ask-sends-one-page-picture-drawn-in-the-engine-host.md) (a picture with the last turn),
  [ADR-0134](0134-an-ask-about-every-open-document-carries-one-window-each-inside-the-one-bound.md) (an equal share
  each, never refusing for one source).

## Context

Every ask so far is about a document the person has open. People also want to ask about a file they have not opened:
a spreadsheet beside a contract, a photograph of a receipt, a page of notes. Three rules decide the shape before any
feature thinking does. The renderer never holds a path (FileHandles, not paths). Main parses no document of any kind
(threat model §2; measured, `marked` aborted Node on a crafted Markdown file). And a person is never refused because of
their document, so a file that cannot be read must not cost them the question.

What already exists, contained, is enough to read every family the brief names, so this is a registration, not a new
parser: pdftotext reads a PDF's text page by page (ADR-0071), x2t turns an Office file into a PDF (ADR-0120), and the
compose host already reads image headers for its own import (ADR-0060).

## Decision

1. **Main picks; the renderer holds handles.** `ai.attach` takes nothing, runs a picker that accepts any file and
   several at once, mints a `FileHandle` for each path and answers each file's handle, name and byte size. The
   renderer shows each as a chip it can remove, and sends the handles with the question. At most
   `MAX_ASK_ATTACHMENTS` (8) go with one question; past that the picker's answer names the files it did not keep.

2. **`ai.ask` carries `attachments`**, distinct handles, at most eight. Main resolves each; a handle it never minted is
   named as not found rather than refusing the ask.

3. **The family is read from the file's first bytes, then its extension, in that order.** `%PDF-` is a PDF; the PNG
   and JPEG signatures are pictures; `.docx`, `.xlsx` and `.pptx` are Office files (`OFFICE_IMPORT_FORMATS`, the set
   x2t was measured to read); anything else that decodes as UTF-8 with no NUL is text; the rest is named as a kind this
   build does not read. The extension only chooses which contained reader is asked, never native code inside one
   (invariant 23: x2t reads the format from the bytes).

4. **Where each family is read:**
   - **PDF**: the contained pdftotext, its pages split at the form feed it writes between them.
   - **Office**: the contained x2t to a PDF, then the same pdftotext.
   - **Picture**: the compose host's new `engine/image-size` reads the header (PNG's IHDR, JPEG's frame header through
     the same pdf-lib reader the image import embeds with) and answers the size, or `unreadable`. Main sends the
     picked bytes **unchanged** as a picture with the last turn when they are within Claude's documented limits —
     8000 px on each side and 10 MB once base64-encoded (*Vision*, read 2026-10-02 at
     platform.claude.com/docs/en/build-with-claude/vision), the tightest of the adapters, as ADR-0090 chose — and
     names it as too large otherwise. A model whose list says it cannot see gets the file named as not read, for that
     reason; unknown is sent, ADR-0090's rule.
   - **Text**: decoded in main with a fatal UTF-8 decoder. This is the one family read in main and the reason is
     measured rather than convenient: decoding UTF-8 is what main already does to every frame a hostile host sends it
     and to a settings file a person imports, so a host round trip would add a process and remove no operation from
     main.

5. **Inside the one bound, an equal share each.** Every text source in an ask — each document window the context reads
   and each attached file that is not a picture — gets `askShareOf(n)` of `MAX_ASK_CONTEXT`, `n` counted from what was
   asked, not from what turned out readable (ADR-0134's rule). A file's text is read through `readAskWindow` with its
   own label, so its pages are marked `[File 2 page 3]` and the model is asked to cite `[File 2 p. 3]`. A file
   citation is **text, never a link**: there is no open document to go to.

6. **Never refused for a file, and what was read is said.** Each file is answered in `files`, in order: what went (its
   pages and characters, or that it went as a picture) or why it did not (`not-found`, `too-large`, `not-supported`,
   `unreadable`, `cannot-see`, `cannot-read-here`). The instruction names the unread files too, so the model does not
   answer as though they were empty. The turn shows one line per file.

7. **Where a contained reader does not exist the file is named, not read elsewhere.** pdftotext, x2t and the compose
   host are built only where their containment is (every non-Windows run, and any build whose launcher did not
   provision them). A file whose reader is absent is `cannot-read-here`; it is never read in main instead.

8. **A chat request carries a list of pictures.** `ChatRequest.image` becomes `images`, each adapter attaching every
   one to the last user turn in its own form, labelled `File n:` before it as *Vision* advises for several. The page
   picture of ADR-0090 is the first when the context is a picture. Media types are PNG and JPEG.

## Rejected

- **Reading the file in the renderer.** It would hold the bytes of a file it named by path, which is the boundary this
  project is built on; a handle and a size are all it needs to draw a chip.
- **Reading PDFs and Office files in main**, with pdf.js or a zip reader. Threat model §2, and the measured abort.
- **Opening an attached PDF as a hidden document**, to reuse the MuPDF window. A document has a tab, a recent entry, a
  history key and a lifecycle a person owns; a file asked about once has none of those, and hiding them is a second
  meaning of *open*.
- **A MuPDF text channel in the compose host.** It needs exports the shim does not carry today and a native build;
  pdftotext is contained, measured and already reads a PDF's text in page order.
- **Recognising a picture's text (OCR) instead of sending it.** A person who attaches a photograph means the picture:
  a table, handwriting and a chart survive as a picture and do not as recognised words. A model that cannot see is
  told so by name.
- **Re-encoding pictures smaller.** It needs a decoder and an encoder in a contained host that the shim does not carry;
  the limits above are generous enough that a phone's photograph passes as it is, and one past them is named.
- **Weighting the share by file size.** ADR-0134's reason: an equal share is one stated number.

## Consequences

- An ask with a document and three text files gives each a quarter of the bound, said on the turn.
- On Linux, in CI and in development without provisioning, every PDF, Office file and picture is named as
  *cannot be read here*; text files are read. The contained paths are crossed by the main cases with fakes and, for
  the new host channel, by the host body's cases; the live route is crossed only by a run on Windows.
- Chat history keeps each turn's file names, never a handle, since a handle means nothing after a restart.

## Correction, 2026-10-02 (the same day, while building it)

Three details differ from the text above, each found by writing the code, and the text above is left as it was
decided:

- **Files past the eight are COUNTED, not named.** `ai.attach` answers `dropped` as a number: a picker can return any
  number of paths, and a list of their names would be an answer with no bound. The chip row says how many were not
  attached.
- **Main answers the share it applied**, as `share` on `ai.ask`'s answer whenever the bound was divided. The renderer
  cannot compute it any more: it does not know which files are pictures until main has read their first bytes, so a
  number it worked out itself would be a second opinion that is wrong whenever a picture is attached (B3).
- **A carried selection or comment is not cut to a share.** It has its own smaller bound, `MAX_ASK_SELECTION`, and
  stays whole; the shares divide what is left of `MAX_ASK_CONTEXT` after it, so the ask stays inside the one bound
  (`askShareOf(count, carried)`).
