# 0056 — The Settings dialog derives a control from a setting's schema, and a secret is write-only

Accepted 2026-09-12.

## Context

`docs/ARCHITECTURE.md` §7's Settings row says the registry derives *"the entire
Settings dialog, persistence, export"*. `BUILD-PROMPT.md` Part F says the same —
*"every setting is declared once … and the Settings dialog is derived"* — and E5
says of keys: *"write-only field with `••••` placeholder; the UI can replace or
remove a key but never read it back"*.

Measured 2026-09-12, while answering the owner's question *which screen does the
Azure key go in*:

- **No Settings dialog exists.** Nothing in `packages/ui/src` calls the
  registry's `inCategory`, `settings.loadSecrets` or `settings.saveSecret`, and no
  component renders a setting by category. Searched with a positive control — the
  renderer's `settings.load` caller is found by the same search.
- **So registered settings with no command of their own have no surface at all.**
  `appearance.theme` is read and applied, and nothing in the application changes
  it. The Azure Document Intelligence endpoint and key cannot be entered.
- **D6 row 8's tool cannot appear.** Its visibility reads the key from the
  renderer's settings store, which is hydrated only from `settings.load` — which
  never carries a secret.
- **`settings.loadSecrets` answers decrypted values to the renderer**, which is
  the one thing E5 says a key-bearing UI must not be able to do.

Building the dialog is registration, except for one thing the registry cannot
say. An entry carries **one** title. An enumerated setting's members — `system`,
`pt`, `small` — are values, not words, and B9 bans showing them: the entry has no
way to name its own choices, so a derived dialog cannot render an enum.

## Decisions

### 1. An enumerated setting titles its options

`optionTitles`: one message key per member of the setting's enum. Every
registered setting whose schema is an enum carries it, and a case over the whole
registered set asserts each enum's members and its titled members are the **same
set** — iterating either alone would make it the universe. Existing name maps
are reused rather than respelt (`OCR_LANGUAGE_NAMES`).

### 2. One control per schema kind

| Schema | Control |
|---|---|
| boolean | checkbox |
| enum | select, labelled by `optionTitles` |
| number | number input, bounded by the schema's own minimum and maximum |
| string | text field |
| string, `secret: true` | **write-only** field (Decision 5) |

The bounds are read from the schema, never restated beside it: a number input
offering a value the schema refuses is a control that fails on apply.

### 3. Kinds with no generic control are excluded BY NAME

A union with a pattern (`appearance.accent`, `editing.annotation-colour`) and an
array (`editing.personal-dictionary`) have no control that is honest for every
member of the kind — a colour typed as text satisfies the schema and offers no
colour. They are not in this dialog, and a case pins the excluded ids, so a
setting of such a kind arriving later is a visible decision rather than a silent
omission. Whether each has another surface is **not** claimed here.

### 4. The dialog answers the command that opened it

ADR-0038's shape. Props are the current non-secret values, the ids of the secrets
that are stored, and whether secret storage is available. The result is the
values that changed and, per secret id, a replacement or a removal. The command
writes ordinary values through `SettingsStore.set` and secrets through
`settings.saveSecret`, and shows `secret-storage-unavailable` to the person
rather than swallowing it.

### 5. A secret never reaches renderer state

`settings.loadSecrets` answers **which secret ids are stored** and whether storage
is available — never a value. The write-only field shows whether a key is set,
and can replace or remove it. The cloud tool's visibility reads that answer.

## Rejected alternatives

**A dialog for the Azure credentials alone.** It is a second place settings are
surfaced, which §7's registry exists to forbid, and it would be copied for the
Anthropic key and again for Stage 9's providers.

**Showing enum values as they are stored.** B9: a value is not a word, and a
select reading `pt / mm / cm` is a literal the lint rule would ban in source.

**Keeping `loadSecrets`' decrypted answer and masking it in the field.** Renderer
state holds the key whatever the field draws. E5's rule is about the state.

## What this does not decide

- **Part F's full inventory.** The dialog shows what is registered; settings
  Part F lists and nothing has registered are not added by this.
- **An `ai` category.** Part F groups the Azure pair under AI; the registry has no
  such category and they sit under Editing. Reaching them does not need the move.
