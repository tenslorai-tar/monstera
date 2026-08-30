# ADR-0032 — The view model is a query scoped to the pages the renderer draws, not a delta the command returns

**Date:** 2026-08-30
**Status:** accepted. **Amends `docs/ARCHITECTURE.md` §2**, whose "Mutations are
commands" paragraph says `doc.command` bumps `DocVersion` *"and returns a
view-model delta"*. The amendment is a separate commit (B4).
[ADR-0031](0031-the-renderer-reads-the-document-by-demand-paged-ranges.md) is
unchanged and this is its sibling on the other half of what §2 says crosses.

---

## The problem, in one sentence

A command's effect cannot reach the screen, and no amount of rebinding the byte
transport changes that.

## The finding it comes from (OOOOO-1, measured 2026-08-30)

`DocumentRecord.bytes` is `readonly` and a command never replaces it. The
mutation lands in the **engine session**; main's canonical image stays the bytes
the document was opened with; `document.readRange` therefore serves the
pre-command document for the whole life of an open file.

Measured, in `apps/desktop/src/documentCommands.test.ts`: a rotate that MuPDF
applies returns a byte length **equal** to the one `document.open` reported. The
assertion is written as that equality rather than deleted, because an equality
that passes is what says the bytes route has nothing to act on.

The first reading of this was that it is a B4 question about **refreshing main's
image** — a full serialise per command, against ADR-0021's retained image and
§9.17's 1.5× budget. That reading was wrong, and it was wrong by taking one of
§2's two routes for the only one.

## Why no amendment is needed to make a rotation visible

§2 already names two things crossing:

> The renderer receives a **view model** (page count, page sizes and transforms,
> annotations, form fields, outline — structured data, bounded size) **and** no
> document bytes at all until it asks for them.

A rotation is a page transform. §3.2 says the same from the other side — *PDF.js
is never a source of truth. It renders.* The effect had nowhere to go because
half of §2 had never been built: `grep -rl "viewModel\|ViewModel" packages apps`
returned nothing on 2026-08-30.

**The fact the route rests on, executed rather than read.** `page.getViewport({
scale, rotation })` takes an **absolute** rotation that replaces the page's own
`/Rotate`. A type declaration is not behaviour, so it is a proof:
`proof:viewportrotation`, six cases against a fixture authored with `/Rotate 90`
— because at zero, absolute and additive are the same function and *passing the
page's own rotation* is the same call as passing nothing. Passing `own + 360`
agrees with `own` rather than landing a quarter turn short, which is what says
absolute; and that is why the model carries where a page **ended up** rather than
the turns a command applied.

## The decision

The renderer reads `document.viewModel({ docId, pages })` and is answered
`{ version, pageCount, rotations }`, with `rotations` positionally aligned to the
request. It reads it once per `(document, version)` pair — the same cadence at
which it already rebuilds its byte transport — and hands the rotation to
`renderPage`, which passes it to `getViewport`.

Three properties, and each is a rejection of something:

**The request names the pages.** One rotation per page scales with the document,
so a channel answering the whole vector is correct exactly once — at open — and
becomes the payload-scales-with-document defect invariant L11 forbids the moment
anything re-reads it. A renderer must re-read after every command. So the caller
names the window it is about to draw, the same shape `document.readRange` has,
bounded by `MAX_VIEW_MODEL_PAGES`.

**The version is on the answer, not on the request.** `readRange` takes a version
because a byte offset means nothing outside the one that produced it. A geometry
read has no offset to be wrong about; what it needs is to recognise a **late**
answer, because a command can bump while the read is in flight.

**It carries rotations and not sizes.** A page's box comes from `/MediaBox`,
`/CropBox` and their intersection rules, which PDF.js already implements in
`page.getViewport`; restating them would be a second opinion that agrees most of
the time (B3a). Rotation is the one piece of geometry the parser reads from bytes
that have moved on.

---

## Rejected alternatives

**Refreshing main's canonical image after each command.** The first reading, and
the expensive one: a full serialise per command, a second image for the duration
of the send at 2.00× against a 1.5× ceiling (`perf:gate`, quoted by ADR-0031),
and a rewrite of the file's bytes for an operation whose intent is a dictionary
key. It also answers a question nobody had: the renderer does not need new bytes
to draw a rotated page.

**A view-model delta returned by the command, as §2's sentence says.** This is
the clause being amended, and the reason is not cost — it is that a delta needs
somebody to know *which pages a command moved*, and that knowledge does not
generalise past the one command that exists. For `rotatePages` it is
`command.pages`. For a future `deletePages` the delta is a new page count and a
re-index, which is a different shape entirely; for a text edit it is not
expressible as a transform at all. Building the mechanism now would fix a design
against one data point, which is the retrofit B4 exists to prevent — and it would
add a per-kind declaration whose second entry contradicts its first.

The delta's *purpose* — a bounded payload on the command path — is satisfied by
the scoped query instead, and satisfied more directly: the bound is what the
renderer displays rather than what a command happened to touch.

**Answering the whole model per version, unscoped.** Simpler, and it puts a
document-sized array on every command. Rejected on L11, above.

**Letting the renderer keep its model and apply the command's answer to it.**
The renderer discards its parser on a version bump — `openDocumentView` closes
itself and the caller reopens — so there is no retained base a delta would be
relative to. A model that survived the parser would be state whose lifetime
differs from everything around it, for a saving of one small message.

**Simulating rotation in the browser shim** so a UI test can watch the model
move. Rejected as a second implementation of what rotation means (B3a): MuPDF's
snap, inheritance, and the absolute-versus-relative question all live in
`pageGeometry.ts`, and a shim that got any of them subtly right would agree with
the kernel until the day it did not — in the component whose whole purpose is
that tests trust it. The shim answers a **scripted sequence**; the arithmetic is
proven against a real engine.

---

## What this makes true that was not

§2's *"The renderer receives a view model"* now describes something that exists.
§3.2's *"the renderer's annotation and form models come from the kernel via the
view model"* now names a seam rather than an intention — those members are still
absent, deliberately, for §10.4's reason: a field nothing reads is the
display-only sin one layer down. They land with the features that read them.

## What it does not close

**A trigger, so this is a decision with an expiry.** The view model carries
structure and geometry. A command whose effect **cannot be expressed in the view
model** — a text edit is the obvious one — puts the byte-refresh question back on
the table, and the rejection above is not evidence against it then. The first
such command is the trigger, and it is written into `docs/FEATURES.md` rather
than here, because the register watches symbols and this expires on an event.

**The rotate reaching real pixels end to end** is proven in two halves —
`pageGeometry.test.ts` against a real engine, and `App.test.tsx` for the
renderer's chain — and not yet in one. That needs a real Chromium driving a real
engine host, which is `proof:canvaspixels` plus a session, and it is the first
thing to build once a host can be created from that harness.
