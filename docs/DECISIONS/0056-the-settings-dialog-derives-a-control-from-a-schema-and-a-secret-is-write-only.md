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

## Correction, 2026-09-15 — a colour is a schema kind, and its no-choice state carries a title

**Decision 3 left the default style colour with no surface a person can reach
before a document is open.** `editing.annotation-colour` is set today from the
comment styles panel, which draws beside an open document only. The owner's
ruling of 2026-09-15: *"add a colour control to the Settings dialog, as a new
schema kind, so the default style colour can be set with no document open …
Build it through the settings registry"*.

Decision 3's reason stands for the kind it named — *"a colour typed as text
satisfies the schema and offers no colour"* — and is answered by a control that
offers a colour, not by a text field.

### Corrected decisions

**Decision 2 gains a row.**

| Schema | Control |
|---|---|
| colour | a checkbox for the setting's no-choice value, labelled by the entry's **unset title**, and a colour input used while it is off |

- **A colour schema is one the registry built**, with its own colour constructor,
  and the dialog asks the registry whether a schema is one. It is never
  recognised from the shape of a union: a literal beside a pattern is not always
  a colour, and a dialog deciding so would be a second opinion about what a
  colour setting is (B3a).
- **The no-choice value is a value, and it needs a word.** `'auto'` means *each
  tool's own* for this setting; another colour setting's no-choice value would
  mean something else, which no generic label can say. So the entry carries an
  **unset title**, and the registry refuses a colour setting without one and an
  unset title on any other kind — both directions, as it does `optionTitles`.
- **The colour input starts on the colour the comment styles panel already
  starts on**, taken from one constant, so the two surfaces of one setting cannot
  offer two different first colours.

**Decision 3 narrows.** `editing.annotation-colour` moves into the dialog.
`appearance.accent` stays excluded, for a different reason than before: the
accent can be **refused when applied** — `applyAccent` answers a refusal when no
adjustment clears the contrast floor (`BUILD-PROMPT.md`:608, *"auto-adjusted or
rejected"*) — and a dialog control for it would have to show that refusal where
the colour is chosen. That is its own piece of work, not a consequence of this
kind. `editing.personal-dictionary` stays excluded: it is an array.

### Rejected

- **Recognise any union of a literal and a hex pattern.** A partial
  reimplementation of the registry's own knowledge, and one a future
  `literal | /id-pattern/` setting would satisfy.
- **A generic "Default" label on the checkbox.** It names no behaviour; the
  panel's own label already says what the value does.
- **A text field with a hex pattern.** Decision 3's own sentence.
- **Leave the colour on the styles panel alone.** The ruling's reason: with no
  document open there is no panel.
- **Bring the accent in with the same control.** The control would accept a
  colour that is then refused on apply, which is a control that fails on apply —
  Decision 2's own objection to an unbounded number input.

## Correction, 2026-09-22 — WHEN the result travels, and the accent's own control

Two of the decisions above now read as less than the whole truth, and both changed with the owner's
design of 2026-09-22 rather than by preference.

**Decision 4 said the dialog answers the command.** It still does, and the command is still the only
writer — but the answer no longer waits for a button. There is no *Save*: each change is REPORTED as
it is made through `update`, validated by this dialog's own result schema, and applied at once
([ADR-0094](0094-a-dialog-may-report-before-it-answers.md)). *Done* closes, carrying nothing left to
apply. Decision 4's shape — props in, `{ values, secrets }` out, the command writing both — is
unchanged; how often that value crosses is what moved. The result gained one optional field,
`action`, for the buttons that are not settings: *Reset to defaults*, *Export settings…* and
*Clear chat history*.

**Decision 3 excluded the accent, and it still has no GENERIC control** — a colour typed into a text
box satisfies its schema and offers no colour, which is why the derivation refuses it. What the
dialog draws now is a control of the accent's own: the design's swatches, each refused where it
cannot reach WCAG 1.4.11's 3:1 against the theme's surfaces. That is the opposite of *a control that
fails on apply*: the refusal happens in the offer. The pinned exclusion list is unchanged, because it
is about what the SCHEMA derives.

**And a third clause is now narrower than the dialog**: every renderable setting used to be a row.
State the application remembers for a person — a panel's width, which tab was open — is marked
`remembered` and is not drawn, because its control is the splitter or the tab.
