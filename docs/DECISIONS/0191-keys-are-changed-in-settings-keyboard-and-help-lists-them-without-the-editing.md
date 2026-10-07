# ADR-0191 — Keys are changed in Settings › Keyboard, and Help lists them without the editing

- **Status:** Accepted
- **Date:** 2026-10-07
- **Supersedes:** [ADR-0111](0111-a-key-a-person-chose-is-a-setting-applied-before-the-registry-is-built.md)'s *where* —
  the dialog Help opens was also the place a key was changed, and Settings › Keyboard pointed at it. Its other decisions
  (one setting, applied before the registry is built; validation where a choice is made; the spelling of a chord; further
  chords; the keyboard is the dialog's) stand.
- **Found by:** the owner's review, 2026-10-06 — *Help › Keyboard shortcuts lists commands and shortcuts only, with no
  Change/Remove column; Settings › Keyboard, empty today, lists commands, shortcuts and Change/Remove, plus Reset all.*

## Context

Two surfaces named the same list. Help › Keyboard shortcuts was a dialog of every command with *Change*, *Reset* and
*Remove* on each row and *Reset all shortcuts* in its foot; Settings › Keyboard held one sentence saying to go there. A
person looking for where to change a key looked in Settings and found an empty page, and a person who only wanted to
read the list met three buttons per row.

## Decisions

1. **One list component, two modes.** `ShortcutList` draws the rows — the command and its key — and draws the *Change /
   Reset / Remove* column only when it is given an editor. Help's dialog gives it none; Settings' Keyboard page gives it
   one, with *Reset all shortcuts* beneath. The list is still the command registry's rows (`ShortcutRow`s read when the
   command runs), so nothing is wired a second time.
2. **The editing is one hook, `useShortcutEditor`,** holding what the dialog's body held: the chords as they stand, the
   row waiting for a key, a refusal and which command it names. The rules are unchanged and are still the one set
   (`validateChord` against the chords as they stand).
3. **Settings reports each change and the opener writes it,** by the report ADR-0094 gave dialogs and ADR-0158's reply:
   `shortcut` carries the same `choose` / `reset` answer the dialog used to report, and `showSettings.ts` applies it with
   the function that was the Help command's, now exported once (`applyShortcutAnswer`) — so there is one writer of
   `keyboard.shortcuts` (B3), taking a difference from the registered key and nothing else.
4. **Help's dialog reports nothing.** It reads the rows and shows them; it has no `update`, so a key cannot be changed
   there by any route.

## Rejected alternatives

- **Leaving the editor in Help and linking to it from Settings.** The page the owner found empty would still be a
  sentence, and the list would still carry editing for a person who only reads.
- **Two copies of the table.** The columns would drift (B3a); the mode is an argument, not a second table.
- **Moving the list's rows into Settings' props as titles resolved to strings.** Titles cross as keys, as in the dialog,
  so a locale change re-renders the list.

## Consequences

- `SETTINGS_DIALOG`'s props gain `shortcuts` (the rows and the dropped choices) and its result gains `shortcut`; the
  Keyboard page's note is rewritten; the Help article says the list is for reading and Settings is where keys change.
- The wired pair: `keyboardShortcuts.test.ts` (the command opens a view-only dialog and writes nothing),
  `showSettings.test.ts` (a `shortcut` report is stored normalised, as a difference; a refused report changes nothing) and
  `SettingsBody.test.tsx` (the Keyboard page draws Change and Remove and reports; Help's list does not draw them).
- The screens that change: Help › Keyboard shortcuts, and Settings › Keyboard.
