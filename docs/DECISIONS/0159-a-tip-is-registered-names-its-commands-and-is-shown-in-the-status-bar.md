# ADR-0159 — A tip is registered, names its commands, and is shown in the status bar

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** `docs/ARCHITECTURE.md` §7's registry table, which had no tips, and §7's status bar clause, whose start
  held only what a tool waits for.
- **Decided by:** the owner's items 18a to 18c: *"Tip in the empty part of the status bar between tool name and page
  controls, every time the app opens; changes every so often, fades in/out; hides when bar too narrow."* *"Well over
  100 tips, plain words, every area … Every tip true of this build. Derive tool names and shortcuts from the command
  registry; check fails when a tip names something that no longer exists. Random order without repeat until all
  shown, remembered across sessions. All i18n keys."* *"Settings switch to turn tips off, on by default."*
- **Relates:** [ADR-0067](0067-the-status-bar-is-a-projection-around-two-value-controls.md) (the status bar),
  [ADR-0029](0029-how-the-registries-are-built.md) (how the registries are built).

## Context

A tip is neither a command, which the status bar projects, nor a value the bar holds. Nothing in §7 can register one,
and a list of sentences written into the bar would be a second wiring place whose words go stale the day a command is
renamed or moved: the defect the owner's *"check fails when a tip names something that no longer exists"* names.

## Decision 1 — tips are a registry, and a tip names commands by id

`TIPS` is one list. An entry has an id, its words as a `MessageKey`, and the commands it names, each under a
placeholder: `{name}` is drawn as that command's title, `{nameKey}` as its shortcut, both read from the built command
registry when the tip is shown. So a renamed command renames every tip that names it, a rebound key is the key a tip
says, and a tip can only name a key that exists.

**The check is the help articles' own** (`App.test.tsx` resolves every article's command ids against the application's
registry): every id a tip names must be registered, and a tip that says a command's key must name one that has a key.
An id that stops being registered turns that case red.

## Decision 2 — most tips are derived from the registry, so they cannot be untrue

Besides the written tips, two are derived from every command, at the moment they are shown:

- **Its key**, for a command with a shortcut: *"{title}: press {key}."*, as *"Open PDF: press Ctrl+O."*;
- **Its place**, for a command on the ribbon: *"{title} is in {section}, under {group}."*

A derived tip says only what the registry says, so it is true of this build by construction and every area is
covered by the commands that serve it. About 237 commands are registered, so the derived tips alone are well over the
owner's hundred. The written tips say what no registry field holds: that F1 opens Help on the tool in use, that a
hidden bar comes back from its command. Each names the commands it relies on, and is read against the code that does
what it says before it is written.

## Decision 3 — shown at the start of the status bar, one at a time, never cut

- **Where:** the free part of the bar's start, after what a tool waits for and before the page controls. A tool's hint
  and a page-number problem come first and the tip yields to them.
- **When:** on every start, and the next after an interval; each fades in and out, without motion under reduced
  motion.
- **Whole or not at all:** a tip that does not fit the space it has is hidden rather than cut with an ellipsis, so a
  narrow window shows none.
- **Order:** random, never repeating until every tip has been shown, then again. The ids shown in the current round are
  a remembered setting, so the round carries across sessions.
- **Off:** a switch in Settings, on by default.

## Decision 4 — the tip is not announced

The status bar is a live region (`role="status"`), so a sentence that changes every so often inside it would be read
aloud each time, over whatever a person is doing. The tip is `aria-hidden`. A screen reader user meets the same
guidance where it is asked for, in Help.

## Rejected

- **Sentences written into the status bar.** The second wiring place, and the words go stale silently.
- **Only written tips.** A hundred hand-kept sentences about commands are a hundred claims that each go false on a
  rename or a move, and nothing checks the ones that name a place.
- **A tip naming a command by its title in prose.** Exactly the stale claim the owner's check is about.
- **Cutting a long tip with an ellipsis.** A cut sentence tells a person less than none, and the Settings and sent-line
  rules already refuse truncation for that reason.
- **Announcing each tip.** A live region that speaks every few seconds is noise over work.
- **Order kept in memory only.** Every start would begin a new round and show the same few tips first.
