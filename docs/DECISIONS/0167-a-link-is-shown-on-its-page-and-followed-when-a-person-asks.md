# ADR-0167 — A link is shown on its page, and followed when a person asks; a web address is opened by `main`, read from the document

- **Status:** Accepted
- **Date:** 2026-10-05
- **Amends:** `docs/ARCHITECTURE.md` invariant 24's *"until the user asks for it, explicitly, for that item"*, by naming
  how a person asks for a link; and the window policy's one route to the browser (`entry.ts`' `openInBrowser`, HTTPS
  only, for a sign-in, ADR-0059 Decision 3), which gains a second caller with its own rule. Keeps `document.pageLinks`
  and its shortened address, the window policy's `deny` for every navigation and window, and ADR-0023 Decision 11's
  placement of the engine host's channels in the kernel.
- **Decided by:** the owner's list for 0.1.10.0, item 14c: *"WEB LINK / PAGE LINK: nothing shows a link exists. Show
  links while editing (outline in Comment mode, address/target on hover), confirm added, prove click works (web asks
  before opening; page goes there)."*

## Context

A link is made by the Comment section's two tools (`linkTools.ts`) and written by MuPDF's `createLink`
(`pageLinks.ts`), which is not an annotation in MuPDF's model: the annotation walk, the select tool and the eraser do
not see one. `document.pageLinks` reads a page's links, an internal one resolved to its page and an external one
carrying its address, shortened past 2,048 characters by the engine host (`ENGINE_LINK_URI_MAX`), because a tracking
link does run past that.

The only place a link is shown is the Links panel. An internal entry jumps to its page; an external one is text with
nothing to press, because invariant 24 asks that nothing a document holds is followed until a person asks for that
item, and nothing in this build has been a way to ask. The renderer cannot open an address and must not acquire a
way (`window.ts`: *"when the app needs it, it becomes a command … not a side effect of `target="_blank"`"*).

So on the page a link is invisible, cannot be followed, and once drawn says nothing.

## Decision

1. **Links are drawn on their page.** Each page slot holds a link layer read from `document.pageLinks`, placed through
   the page's `PageTransform` like every other mark. While the Comment section is on show each link is outlined;
   at any time, the pointer over one shows where it goes (the page, or the address) and the pointer is a hand.
2. **A person follows a link by clicking it** while no drawing tool holds the page. An internal link goes to its page.
   An external one asks first: a dialog that names the address and offers *Open in browser* and *Cancel*. This is how
   a person asks *for that item*.
3. **`main` opens it, reading the address from the document.** A new channel, `document.openLink`, names the link by
   document, version, page and its place in that page's links, never by its address. `main` refuses a version that is
   not the document's, asks the engine host for that one link's address in full (a new engine read, bounded at 32,768
   characters, so a tracking link is opened as written rather than as shown), and opens it only when its scheme is
   `https:`, `http:` or `mailto:`. Any other scheme (`file:`, `javascript:`, a custom handler) is refused, and the
   dialog says so before anything is sent. The renderer never names a URL to `main`.
4. **The Links panel's external entries take the same route**, so there is one way a link is followed.
5. **A link that was added says so**, in a status message, since nothing on the page did.

## Rejected

- **The renderer passing the address to `main`.** A compromised renderer would then open anything it liked, and the
  address it holds is shortened; `main` reading the document's own answer makes the renderer able to choose only
  among links the document already holds.
- **Following a web link without asking.** That is invariant 24 broken by a click on a line of text.
- **`window.open` or an anchor with `target="_blank"`.** The window policy denies both and must keep doing so.
- **Widening `openInBrowser` to `http:` for every caller.** A sign-in must stay HTTPS; the link route carries its own
  scheme rule, and the sign-in's is unchanged.
- **Outlining links at all times.** Most readers do not want rectangles over every link while reading; the pointer
  over a link still shows it, and the outline is the editing view's.
