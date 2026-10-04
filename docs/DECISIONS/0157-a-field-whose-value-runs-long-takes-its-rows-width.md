# ADR-0157 — A field whose value runs long takes its row's width

- **Status:** Accepted
- **Date:** 2026-10-04
- **Amends:** `docs/ARCHITECTURE.md` §7's settings registry row, whose fields did not include it.
- **Decided by:** the owner's item 17a: *"Inputs sized for content: API key field short in "Set up the AI assistant"
  and Settings › AI. Key fields full width; the class: keys, web addresses, endpoints, file paths, OAuth and timestamp
  settings. Gallery check: an input with a long value must not render narrower than its row's control column."*
- **Relates:** [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md) (the
  dialog derives its controls from the schema), [ADR-0116](0116-a-text-setting-may-name-its-input-purpose.md) (a text
  setting's declared purpose, the same shape).

## The measurement

Measured 2026-10-04 on Chromium 151 through the browser shim: every key and endpoint field is **168 px** wide, the
browser's own twenty characters, in Settings' rows of 672 px at 1280 x 800 and 488 px at 760 x 560, and in *Set up the
AI assistant*'s row of 576 px. A provider's key runs past a hundred characters, so the field shows about a fifth of it,
and an endpoint cuts its host name. No rule sized them: `.m-input` has no width, and neither row gives its control one.

## Decision 1 — the `Input` primitive takes `runsLong`, and a field that runs long fills its row

`runsLong?: boolean` on `Input`: the value is one a person reads whole and that runs past the browser's twenty
characters. The owner's class is its definition: **a key, a web address, an endpoint, a file path, an OAuth value, a
timestamp**. Such a field takes its own line under the row's words and the row's whole width, in a dialog row and in a
Settings row alike, as a multi-line field already does (`.m-field--text`). Every other field keeps the browser's own
width: a page number, a size or a name is short, and a box as wide as the dialog asks for a long answer.

In this build the class is: *Set up the AI assistant*'s key and endpoint; *Open from URL*'s address; and in Settings,
every key (eleven providers', Azure Document Intelligence's and DocuSign's integration key, which is its OAuth client
id) and both endpoints (Azure OpenAI's and Azure Document Intelligence's). No file path or timestamp field exists:
paths never reach the renderer (FileHandles), and the signing timestamp is not typed.

## Decision 2 — a setting says it, and a text setting must

A setting's field is drawn by the Settings dialog from the registry, so whether it runs long is the setting's to say
(§7), never the dialog's from an id.

- **A secret runs long by definition**: every secret setting is a key or a token, and a document's password is never a
  setting. A secret carries no `runsLong`; the registry refuses one that does.
- **A text setting MUST declare `runsLong`**, true or false, and the registry refuses one without it at construction,
  naming the setting. Two of the three today run long; *Your name for comments* does not. A path setting added tomorrow
  cannot arrive at the browser's twenty characters by nobody deciding.

## Decision 3 — the check reads the class, not the list

The dialog gallery's capture reads every field whose value overflows it, in every sample state, and reports one
narrower than its row's control column. That is the class by its symptom, so a field missing the declaration is
found by its value rather than by being on a list. The capture's positive control requires at least one such field to
have been seen, so an empty reading cannot pass. A rendered case holds the declared fields in CI: each fills its
control column with a long value typed, and *Your name for comments* keeps its own width.

## Rejected

- **Every text field full width.** A page number or a name in a box the dialog's width reads as a request for a long
  answer, and the owner's words are *sized for content*.
- **Deciding it from the setting's id or the field's label.** A layout table one field narrower (§7), and it agrees
  with the class only until the next field.
- **Deriving it from `purpose`.** Whether a field is about the user and whether its value runs long are different
  questions; a proxy agrees with the real rule most of the time, which is the dangerous shape (B3a).
- **A width in characters per field (`size`).** A fixed count is wrong both ways at once: short for a key, and wider
  than a narrow window.
- **Keying the style on `type="password"`.** It covers the keys and misses every endpoint and address.
