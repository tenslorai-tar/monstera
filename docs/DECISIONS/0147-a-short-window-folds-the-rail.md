# ADR-0147 — A short window folds the rail

- **Status:** Accepted
- **Date:** 2026-10-03
- **Amends:** `docs/ARCHITECTURE.md` §10.3's left-section-rail clause (*"the eight feature sections … as labeled icons,
  and at its foot the commands placed on `rail`"*), which has one form for every height.
- **Decided by:** the owner's CLOUD-4 list, Group 1's rule for screen work: *"no stray scroll bars … controls sized for
  their content"*, and ADR-0146's reason (a narrow window folds the chrome; it never overflows).
- **Relates:** [ADR-0098](0098-a-ribbon-placement-may-be-secondary-and-the-rail-has-a-foot.md) (the rail's foot),
  [ADR-0146](0146-a-narrow-window-keeps-the-page-and-folds-the-chrome.md).

## The problem, in one sentence

The rail draws ten buttons in one column with no rule for a window too short to hold them, and v5's `overflow:
visible` draws the rest past the rail's own box. Measured 2026-10-03 on Chromium 151: ten buttons need 410 px at their
content height, against 318 px of rail at 760 × 560 and 274 at 960 × 516, the work area of a 1080p display at 200%.
There *Float bar* runs off the rail and *Settings* is not on screen at all.

## Decision

**The buttons keep their content height first, as they already do.** Each is 48 px when there is room and shrinks
towards its content, its icon over its label, when there is not. **When even that cannot hold all of them, the last ones
fold into a final *More*** at the rail's foot, as the ribbon and the menu row fold. They fold from the end of the column,
the foot's commands first and then the sections from *Tools* backwards. **The active section never folds**: the one
before it goes instead, so the rail always shows where the person is. *More* opens a menu of the folded entries in their
order. A section chosen there becomes the active one, and a command there runs.

Whether a button fits is decided from a **ruler**: one hidden button under the rail buttons' own rule, measured at its
content height. So the answer depends on the rail's height alone, never on what is folded. Every section and command
stays one step away. *More* is itself a rail button and is counted in the room.

## Rejected

- **Scroll the rail.** A column of ten controls that scrolls is a stray scroll bar beside the page, and its last
  entries are the ones a person cannot see are there.
- **Icon-only buttons at a breakpoint**, Studio's form. Without labels ten buttons still need about 380 px, more than
  516 px of window leaves the rail. And a height chosen in English is wrong in the proof locale, ADR-0113's reason.
- **Fold from the top, or by importance.** The order on screen is the owner's v5 order (ADR-0105). Folding from the end
  keeps the drawn part in that order, and a ranking would be a second order nobody chose.
- **Let the active section fold.** A rail whose highlighted entry has gone into a menu no longer says where the person
  is.
