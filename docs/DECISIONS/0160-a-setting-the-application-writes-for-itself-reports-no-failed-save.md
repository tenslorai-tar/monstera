# ADR-0160 — A setting the application writes for itself reports no failed save

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** `docs/ARCHITECTURE.md` §7's registry table, the **Settings** row, whose entry had no way to say that a
  person's action is not what writes a setting.
- **Decided by:** a failure CI found on `work/cloud-4` at 9d16327e and 17578de5, and the reason the settings problem
  dialog gives for existing (`dialogs/settingsProblem.ts`): *"the failure is invisible at the moment it is
  diagnosable"*, a moment that belongs to a person who changed something.
- **Relates:** [ADR-0159](0159-a-tip-is-registered-names-its-commands-and-is-shown-in-the-status-bar.md) (the tips and
  their remembered round), [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)
  (the Settings dialog's rows).

## Context

`persistSettings` saves the whole settings document whenever a setting changes, and when the save fails it opens
*Preference not saved*, naming the setting. That dialog is for a person: they changed a preference, it took effect,
and it will not survive a restart, which they would otherwise learn in another session with nothing to connect it to.

ADR-0159's tips write the round they have shown to `appearance.tips-shown` as each tip is chosen: on opening, then
every 40 s. No person did anything. Measured on 2026-10-04, `AppClose.test.tsx`, whose client answers no
`settings.save`: the first tip's write failed, *Preference not saved* opened as a modal, and 18 of its 19 cases could
no longer find a control under it. In the product the same failure (a full disk, a locked file) would name *Tips shown
this round* to a person who never touched it, and again with every tip.

Every setting that is `remembered` today comes from a person's action: a panel dragged, a tab chosen, a toolbar shown.
So `remembered` does not separate the two, and nothing in a setting's entry can.

## Decision

**A setting may declare `background: true`: the application writes it on its own, and no person's action does.** A
failed save of a change to it opens no dialog. It must also be `remembered`, since a background value is never a row,
and the registry refuses one that is not. The tips' round is the first.

A save is of the whole document, so a person's change made while storage is failing is still reported, by its own
title, at its own change. A background write does not hide that, and does not stand in for it.

## Rejected

- **Report it once per session.** Still names a setting the person never changed, in a dialog about their
  preferences.
- **Silence every remembered setting.** A panel width is a person's drag; losing it on restart is exactly what the
  dialog is for.
- **Keep the round in memory and save it only when the window closes.** A crash loses the round, and the close is the
  one moment a failure cannot be shown at all.
- **Answer `settings.save` in the test client and change nothing else.** The test client is right to be added to, and
  it is, but the dialog it exposed is the product's.
