# ADR-0111 — A key a person chose is a setting, applied before the registry is built

- **Status:** Accepted
- **Date:** 2026-09-27
- **Amends:** `docs/ARCHITECTURE.md` §7 (the command registry's `shortcut`, and the shortcut map as a projection).
  Builds the founding record's Part F *Keyboard* line (`BUILD-PROMPT.md`:625): *"shortcut editor (rebind any registry
  command; conflict detection)"*, and D12's *"keyboard shortcut reference (F1) + customizable bindings"* (:514).
- **Decided by:** the 26 September work list, item 8 (*F1 shortcut reference with customizable bindings*), with the
  owner away; every choice below is inside what the founding record already asks for.

## Context

A command's chord has one writer today: its registration (`UiCommand.shortcut`). Every surface that shows a chord —
the shortcut map, the F1 list, the menu bar, the palette, the title bar, the start screen, context menus and the
ribbon's More menus — reads `command.shortcut` directly. A person's choice of key is a **second writer** of that
property, which is B3's shape and why this is an amendment.

Three defects in the chord substrate came up in the audit of the keys (helpers' read, each verified at its line) and
sit under any editor, because an editor that records a chord records it through the same spelling:

1. `chordOf` spells a key from `event.key`, the character the layout produces — so every Ctrl+letter chord is dead on
   a Cyrillic, Greek, Hebrew, Arabic or Thai layout, and Ctrl+0 / Ctrl+1 on French AZERTY.
2. `normaliseChord` splits on `+`, so the `+` key cannot be spelt: Ctrl+plus sign and numpad plus reach nothing.
3. The dispatcher listens on the document and acts behind an open modal dialog — PageDown in the F1 dialog turns the
   page behind it.

## Decision 1 — the chosen keys are ONE setting, applied to the commands before the registry is built

`keyboard.shortcuts` holds `{ [commandId]: chord | null }` — a chosen chord, or `null` for *no key*. It is a setting
because §10.4 says configurable behaviour lives in the settings registry, and exported like any setting. It is applied
by one function, `withChosenShortcuts(commands, chosen)`, to the command list **before** `new CommandRegistry`, so every
surface keeps reading `command.shortcut` and none of them learns there are two sources. The registration stays the
writer of the DEFAULT; the setting is the writer of the choice; the composition is where the one meets the other.

## Decision 2 — a choice is validated where it is made, and never reaches the map unvalidated

`ShortcutConflict` is thrown while rendering, so a saved binding that collided would take the shell down at every start.
`validateChord(chord, commandId, commands)` answers `ok` or one refusal — `conflict` (naming the other command),
`reserved` (a key the platform, the input method or the application's own navigation owns: Windows-key chords, Alt+Tab,
Alt+F4, Ctrl+Esc, Ctrl+Alt+anything, Ctrl+Space, Shift+Space, F10, Tab, Escape), or `typing` (a key a text field keeps
for itself, for a command that must work everywhere). The editor offers only a validated chord to save; at composition,
a stored choice that no longer validates (a later default took its key) is dropped for the default and the Keyboard page
says which — a stored value is data from an older build, never trusted.

## Decision 3 — a chord is spelt from the key's POSITION for letters and digits, and `+` has a name

`chordOf` takes `event.code` for a letter or digit whose layout character is not one — so Ctrl+S is Ctrl+S on every
layout, and Ctrl+1 is Ctrl+1 on AZERTY. The plus key is spelt `plus`, from `event.key === '+'` or `NumpadAdd`; zoom in
declares `Ctrl+=` and also answers `Ctrl+Plus`, through Decision 4.

## Decision 4 — a command may declare further chords it answers, and only the first is shown or chosen

`UiCommand.alsoShortcuts?: readonly string[]` — Ctrl+Shift+Z for Redo, Ctrl+Plus for Zoom in. The map holds them as it
holds the first, so a conflict among them is refused the same way; the F1 list shows them on the command's row; a
person's choice replaces the first and leaves these.

## Decision 5 — the keyboard is the dialog's while one is open

The document-level dispatcher does nothing while a modal dialog is open, and leaves the arrow and page keys to a
focused control that uses them (a slider, a list, a scrolling region). F1 still names the reference from anywhere.

## Decision 6 — surfaces that found a command by its chord find it by id

`FocusHint` looked for the command on `Escape` and `StartFooter` for the one on `F1`; once a person can move a key,
those hints would vanish with it. Both look the command up by id and show whatever key it has now.

## Rejected

- **A keymap file** — the second wiring place §7 forbids.
- **Validating at render** — the crash above.
- **Chords stored per surface** — a menu that showed one key and a map that answered another is the failure a single
  `shortcut` exists to prevent.
- **Rebinding the keys outside the registry** (the Organize grid's Delete and Enter, F10, a dialog's Escape) — they
  belong to a component's own interaction and are listed on the Keyboard page as fixed.

## Corrections, 2026-09-27, in the commit that built it

Three sentences above said more than was built, each found while building it:

1. **Decision 5's *"F1 still names the reference from anywhere"* is withdrawn.** Every dialog is modal and shown one at
   a time, so F1 over an open dialog would replace that dialog and lose what was in it. The dispatcher does nothing
   while any dialog is open, F1 included.
2. **Decision 6 is not built, and the reason is a check.** `check:secondwiring` refuses a surface that names a command
   id, so `FocusHint` and `StartFooter` keep finding their command by its key. That is honest rather than stale: each
   draws its sentence only while that key runs the command, so a person who moves the key loses the hint rather than
   reading one that has become false.
3. **The fixed keys are not listed on the Keyboard page.** The list in *Rejected* stands as the decision; the page
   still carries its one note (press F1, or Ctrl+K), and a listing of the component keys is owed to the Help centre's
   keyboard article (the 26 September list, item 9).
