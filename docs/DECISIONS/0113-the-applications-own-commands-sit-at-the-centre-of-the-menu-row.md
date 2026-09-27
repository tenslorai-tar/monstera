# ADR-0113 — The application's own commands sit at the centre of the menu row, in their own colours

- **Status:** Accepted
- **Date:** 2026-09-27
- **Amends:** `docs/ARCHITECTURE.md` §7's `Placement` (the `title-bar` variant) and §10.3's menu-bar and title-bar
  clauses. **Supersedes [ADR-0095](0095-the-title-bar-projects-the-applications-own-commands.md) as to WHERE and HOW
  THEY LOOK**; its reason — the buttons are a projection, never a list in a surface — is kept whole.
- **Decided by:** the owner's 27 September list, item 2: *"DONATE AND RATE US: move both from the tab row to the TOP ROW
  (the menu row), centred on it, so the tab row keeps its full width for many open PDFs."* With the colours: *"fixed
  brand tokens that do NOT follow the accent: Donate = warm gold … with DARK text and its heart icon; Rate Us = soft
  violet … quieter than Donate."*
- **Relates:** [ADR-0107](0107-the-menu-bar-is-a-projection.md) (the menu bar), ADR-0003 (token roles).

## Decision 1 — a placement surface of its own, named for where it is drawn

`{ surface: 'menu-bar-commands'; tone: 'gold' | 'violet' | 'plain'; order: number }` replaces `{ surface:
'title-bar'; emphasis; order }`. **Three tones, because three commands are placed there**: Donate is gold, Rate Us
violet, and *Update available* (ADR-0110, dormant) the row's ordinary outlined button — it is a notice, and giving it
either brand colour would make it read as a third appeal. The menu bar draws it; the title bar keeps the tabs, the command search and the layout switcher, which hold
values and were never commands.

**Renamed rather than moved under its old name.** A `title-bar` placement drawn by the menu bar is a name that lies at
every call site, and the union's `never` case is what makes a rename cost one compile per surface instead of a search.

**`tone` replaces `emphasis`, on the placement for ADR-0095's reason unchanged:** a bar that chose a colour by reading
a command's id would be the layout table one field narrower. The tones are named for their treatment because that is
what the owner specified; a fourth command placed here chooses one of them or the ADR is amended.

## Decision 2 — the two tones are fixed brand tokens, not the accent

`--gold-top`, `--gold-bottom`, `--on-gold`, `--violet-edge`, `--violet-mark` and `--violet-wash` in `tokens.css`, per
theme: the owner's values in dark (about `#F7C948 → #E8A317`, about `#A78BFA`), deeper in light, and flat in high
contrast — one solid gold with black text, a pale violet edge on black — because that theme has no gradients. They are
declared roles, so `check:tokencontrast` holds the gold's dark label at 4.5:1 (7:1 in `hc`) on both stops, the violet
edge and star at 3:1, and Rate Us's own label, which is `--text`, on the violet wash over the menu row. **They do not move with `appearance.accent`**: a gold that turned blue
with the accent would stop being the owner's gift button.

## Decision 3 — centred while it fits; otherwise just after the last menu, never over anything

The menu row is three tracks: the mark and the menus, the commands, and a drag track that is never narrower than
`--menu-drag-min`. The outer tracks share the free space equally, so the commands sit at the row's centre; when the
menus are wider than their half, their track takes their width and the commands follow them. The window controls'
space is the row's end padding (Window Controls Overlay), so nothing can be drawn under them.

When even that cannot hold the labelled buttons, **they draw as their icons alone**, keeping the name as accessible
name and tooltip; the menu row measures its own overflow and says so in a `data-` attribute rather than guessing a
breakpoint, because the menus' width depends on the language. Checked in the proof locale, whose menu names are longer.

## Rejected

- **Keep `title-bar` and draw it in the menu bar.** The name would lie; see Decision 1.
- **A breakpoint in CSS for the compact form.** The width that matters is the menus', which a language changes; a
  number chosen in English is wrong in the proof locale by construction.
- **Follow the accent.** The owner's words, and a gift button that changes colour with a theme preference is not a
  brand.
- **Hide them in narrow windows.** A control that exists at one width and not another is a capability the width takes
  away; §10.3's *modes hide chrome, never capability* is the same rule.
