# ADR-0112 — The Help centre is bundled articles in one dialog, and F1 opens the one for where you are

- **Status:** Accepted
- **Date:** 2026-09-27
- **Amends:** `docs/ARCHITECTURE.md` §10.3's start screen footer (*"Press F1 for keyboard shortcuts"*), and so the
  founding record's D12 line *"keyboard shortcut reference (F1)"* as to WHICH key: the reference keeps everything else.
- **Decided by:** the owner's 26 September list, item 9: *"Help centre: offline, searchable, one article per feature, HOW
  with numbered steps and screenshots, 'Show me' highlights the real control. F1 opens the article for what the person
  is doing."* — and item 2h's start screen footer: *"Settings, About, Help centre"*. The owner is away; the conflict
  between the list's F1 and §10.3's is resolved here in the list's favour, as the later instruction, and recorded.
- **Relates:** [ADR-0111](0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md) (the
  shortcuts editor, which moves key), [ADR-0038](0038-a-dialog-answers-the-command-that-opened-it.md) (a dialog answers
  the command that opened it).

## Decision 1 — articles are files in the renderer bundle, one per feature, in a small fixed Markdown

`packages/ui/src/help/en/*.md`, loaded at build time by the bundler, so the Help centre works with no network and the
CSP is untouched (`connect-src 'none'`). Each file carries front matter — `id`, `title`, `summary`, `keywords`, the
`commands` it teaches and the `contexts` (rail sections, panels, dialogs) it belongs to — and a body in a subset this
project parses itself: headings, paragraphs, numbered and bulleted lists, bold. **No HTML is rendered**: the parser
builds React elements, so an article cannot carry markup, and a Markdown library is not a dependency the renderer takes
for text this project writes.

## Decision 2 — the articles are checked against the application, not trusted

An article that names a command id the registry does not have, or a **bold** interface word the English catalogue does
not contain, fails a case — so a renamed tool or a moved group reddens its article rather than leaving a person
following steps that no longer exist.

## Decision 3 — F1 opens the Help centre on the article for where the person is

With a tool in use, its article; otherwise the articles for the rail section on show; on the start screen, the
getting-started list. The keyboard shortcuts move to **Ctrl+/** and stay in Help › Keyboard shortcuts and the palette;
the start screen's hint reads *"Press F1 for help"*, and its footer gains *Help centre* beside *Settings* and *About*.

## Decision 4 — *Show me* finds the real control by its command

A step's command with a control on screen — a ribbon or toolbar button carries `data-command` — gets *Show me*, which
closes the dialog, brings the ribbon section that holds it to the front, and rings that button for a few seconds. A
command with no such control gets no *Show me*: a button that highlights nothing is the display-only defect.

## Not built with it, and stated

**Screenshots.** Each article names the ones it needs; none is captured yet, and an article draws no picture rather than
a placeholder that looks like one. Owed to a capture pass over the rendered application. **Other languages**: the
articles are English, like the catalogue's only shipped locale.

## Rejected

- **A web help site.** It needs the network the renderer cannot have, and help that stops working offline is the case
  where it is most needed.
- **Rendering Markdown to HTML.** A string of HTML in the renderer is the one thing the CSP and the component discipline
  exist to keep out.
- **Keeping F1 for the shortcuts** and giving help another key: the owner's list names F1, which is also the key
  Windows applications give help by convention (Microsoft's Win32 keyboard guidance lists it so — read by a helper on
  2026-09-26, not re-read here).

## Corrections, 2026-09-27, in the commit that built it

1. **Decision 1's subset is wider by two things.** A web address written `<https://…>` is read as an *address* and
   drawn as text to select and copy — never a link, because the renderer has no route to open a page and an article is
   not the place to grow one; only `https:` is read, so no other scheme can be named. And front matter takes an
   `outside:` list: bold words that name another application's controls (the Azure portal's *Keys and Endpoint*),
   exempt from Decision 2's catalogue check and visible in review because they are listed.
2. **Decision 2 checks more than it said, and the words it said were not enough.** A bold word is compared in every
   form the catalogue can show — each plural branch, each placeholder as *…* — or *This page* and *Add … to dictionary*
   read as stale. The catalogue check cannot see a word in the wrong PLACE, and the drafts had several (Home's
   secondaries had moved to Tools › Convert and the File menu), so two more checks read the registry: every
   *"choose SECTION, then TOOL in the GROUP group"* and its two other phrasings must be where the ribbon puts that
   tool, and a section an article is listed under must hold one of its tools. A place said across two steps is outside
   the sentence check, and a menu-bar route is checked for its words only.
3. **Decision 4's *More* was not reachable.** A closed menu's items are not in the page, so a tool folded into a
   group's *More* or a named menu had no element to ring. The trigger now carries its members in `data-holds`, and the
   ring lands on it. The ribbon re-finds the control whenever the row changes until the ring's time is up, because the
   fold measures a newly shown section after it is drawn and can move the button after it was rung. *Show me* also
   moves focus to the control, and is not offered in Focus, where the ribbon is not drawn.
4. **Ctrl+/ is the US layout's key.** A layout that types `/` with Shift produces Ctrl+Shift+/, which the list's
   default does not answer; the Help menu and the editor, where any key can be chosen, are the routes there.
5. **The `dialog.*` contexts are inert for F1.** No application shortcut runs over an open dialog (ADR-0111), so F1
   is never pressed from one and its articles are never listed first by it; the contexts are checked and kept for a
   dialog that later gains a help link.
