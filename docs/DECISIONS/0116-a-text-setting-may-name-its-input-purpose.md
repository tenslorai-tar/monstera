# ADR-0116 — A text setting may name its input purpose

- **Status:** Accepted
- **Date:** 2026-09-27
- **Amends:** `docs/ARCHITECTURE.md` §7's settings registry row, whose fields did not include it.
- **Decided by:** the owner's 27 September list, item 12: *"The Settings entry 'Your name for comments' gets an
  autocomplete purpose (1.3.5); B4 first, since §7 does not list it."*
- **Relates:** [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md) (the
  dialog derives its controls from the schema).

## Decision — `purpose?: 'name' | 'email'` on a setting, carried to the field's `autocomplete`

WCAG 2.1's 1.3.5 *Identify Input Purpose* (AA) asks that a field collecting information **about the user** say which,
from HTML's autofill list, so assistive technology and the browser can fill it or show it with a familiar symbol.
*Your name for comments* asks for the person's own name, and the Settings dialog draws it from the registry — so the
purpose has to be a property of the setting, or the dialog would decide it by reading the setting's id, which is the
second wiring place §7 forbids.

The field is **optional and closed**: two members, the two this application asks for about its user, taken from the
HTML list verbatim, and the `Input` primitive already accepts exactly these (the WCAG pass, 2026-09-27). A setting that
is not about its user — a key, an endpoint, a size — has none, which is 1.3.5's own scope.

## Rejected

- **Decide it in the dialog from the setting's id.** A layout table one field narrower (§7).
- **A free string.** A misspelt token is silently ignored by the platform; a union makes it a compile error.
- **Every member of the HTML list.** A member nothing uses is a declaration nothing can contradict; the union grows
  when a setting asks for something new about its user.
