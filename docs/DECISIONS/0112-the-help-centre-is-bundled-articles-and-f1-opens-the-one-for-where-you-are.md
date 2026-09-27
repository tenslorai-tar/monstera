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
