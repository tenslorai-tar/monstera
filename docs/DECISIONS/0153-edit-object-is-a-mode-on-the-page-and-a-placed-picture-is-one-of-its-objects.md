# ADR-0153 — Edit object is a mode on the page, and a placed picture is one of its objects

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decided by:** the owner, in the 0.1.10.0 addition to the cloud-4 list, item 14g: *"EDIT OBJECT: replace list
  dialog with direct editing on the page (PDF-XChange Edit Objects): button dropdown All/Text/Images/Shapes; chosen
  kind outlined; click to select; drag move, handles resize, colour/remove from Properties or right-click; no dialog.
  Page with two photos listed only Text and Shape: prove pictures found and editable."*
- **Amends:** ARCHITECTURE §7's `Placement` union, whose context menu takes four contexts and gains a fifth,
  `object`.
- **Keeps:** [ADR-0096](0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)'s mode shape,
  [ADR-0101](0101-a-ribbon-placement-may-name-a-menu.md)'s ribbon menu,
  [ADR-0102](0102-a-selection-survives-a-command-that-keeps-the-walk.md)'s rule for a selection across a command,
  and the three page-object commands and their undo shapes unchanged.

## The problem

Edit object opened a dialog listing the page's objects by kind and box, and a person chose one and typed a move, a
scale, a colour or a removal. Two things are wrong with it, and only one is the dialog.

**The list could not name the pictures a person had placed.** Reproduced on 2026-10-04, against PDFium 155.0.8044.0
and MuPDF's own placement, on one page with a line of text and a rule:

| how the two photos are on the page | what `document.pageObjects` lists |
|---|---|
| drawn into the page's content stream | text, path, image, image |
| the same page wrapped in a Form XObject | form (shown as *Group*) |
| placed with *Comment › Image* | **text, path** |

*Comment › Image* is the only control in this build that puts a picture on an existing page, and it writes a
`/Stamp` annotation (`applyPlaceImage`). The object walk reads the content stream, which no annotation is in, so the
owner's page with two photos listed *Text* and *Shape* and nothing a person could recognise as either photo.

**And a list cannot say where.** An object is named to a person by where it is, and the dialog named it by a box in
points, beside a page the person could see but could not point at.

## Decision 1 — a mode in the tool slot, Edit text's shape

Edit object is a mode drawn over each page, as Edit text is (ADR-0096): the page's objects of the chosen kind are
outlined in place, a click selects one, a drag on it moves it, a corner handle resizes it, and Escape or a click on
blank paper clears. It lives in the **tool slot**, so choosing a drawing tool leaves it and choosing it leaves the
tool: one question, *what does a press on the page do*, with one answer.

**The page list's one `editing` slot becomes a union of the two modes**, discriminated by `mode`. Its own comment
says the two *"share one slot and never mount together"*; a second prop would let a type hold both, and a union is
that sentence made a type (B5).

**Not a tool.** The select tool's shape was considered and rejected: a tool's overlay takes the pointer only while
the tool is held and draws only while a gesture is in flight, and the outlines are the mode's whole surface while
nothing is pressed, which is the property Edit text's mode was built for.

## Decision 2 — the ribbon's Edit object is a menu of four filters

*All*, *Text*, *Images*, *Shapes*: four commands in one ribbon menu (ADR-0101), each entering the mode with its
filter and checked while that filter is on. What each outlines:

| filter | page content | annotations |
|---|---|---|
| Text | `text` | none |
| Images | `image` | a stamp the walk calls `pictured` |
| Shapes | `path`, `shading` | none |
| All | every kind, a Form XObject as *Group* | a pictured stamp |

## Decision 3 — a placed picture is one of the objects, and its own writer edits it

**The walk carries `pictured`**, present and true on a stamp whose appearance draws an image (27bb90d0). The mode
offers that stamp as an object beside the page's own, and edits it through the commands that own it:
`placeAnnotation` to move and resize, `removeAnnotation` to remove. Page content goes through PDFium's
`placePageObject`, `recolorPageObjects` and `deletePageObjects`.

The surface names what a person sees, a picture; the command names the writer of record (B3). The two walks are
never joined: an object is `{ source: 'content', index }` against PDFium's walk or `{ source: 'stamp', index }`
against the annotation walk, each at the version its read answered.

## Decision 4 — one object is selected, and it survives a command that keeps its walk

A selection is one object, on one page, at one version. **Measured 2026-10-04** on the five-object page above: a
move, a resize and a recolour each leave PDFium's walk with the same objects in the same order, the edited one at
its own index; a removal shifts every later index. So after `placePageObject` or `recolorPageObjects` the mode
re-reads the page and selects the same index, ADR-0102's rule for the annotation walk applied to this one, and after
a removal the selection is dropped. A stamp follows ADR-0102 as it stands.

Selecting several objects is not built. The commands take lists, so it is a surface change when it is asked for.

## Decision 5 — a fifth context menu: `object`

A right-click on an outlined object selects it and opens the `object` context menu, drawn from placements like the
other four. It carries *Properties*, which shows the Properties tab, and *Delete*. Colour is chosen in the Properties
tab, where the object's own fill is shown: a swatch row in a context menu would be a second colour control.

**Delete is the one Delete command**, acting on whichever selection there is. A second command claiming the key
would be refused by the shortcut map, and two commands with one meaning is the second wiring place.

## Decision 6 — the dialog is removed

Its numeric move and scale are what the drag and the handles express, and keeping it beside the mode would be two
ways to do one thing, one of which still cannot show where. `EDIT_PAGE_OBJECT_DIALOG_ID`, its body and its result
schema are deleted with the command that opened them.

## Rejected

- **Keeping the dialog beside the mode.** Decision 6.
- **The select tool's shape.** Decision 1.
- **Listing stamps through `document.pageObjects`.** Main would join MuPDF's annotation walk into PDFium's object
  numbering, a cross-parser identity join, and a removal by index would then name one engine's object in the other's
  walk.
- **Placing pictures as page content instead.** It would change what *Comment › Image* makes for every document,
  lose a picture's removability as a mark, and still leave every existing document's stamps unfound.
- **A colour submenu in the context menu.** Decision 5.
