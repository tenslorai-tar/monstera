# ADR-0117 — An AI model is chosen per provider, from the list the provider answers

- **Status:** Accepted
- **Date:** 2026-09-28
- **Amends:** [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)
  Decision 2's list of controls, and `docs/ARCHITECTURE.md` §7's settings registry row.
- **Completes:** [ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md) Decision 4's
  *"D6's `claude-opus-5` constant expires when this stage's model setting lands"*.
- **Decided by:** the owner's 27 September list, item 8: *"Build AI provider and model. Remove `ocrClaude.ts:49`'s
  `'claude-opus-5'`; use the chosen Anthropic model; a model without vision shows disabled, never dropped."*

## The problem

Part F lists *provider* and *model* on the AI page (`BUILD-PROMPT.md`:622). The Assistant holds both in component
state today, so nothing persists them, and the Claude recogniser (D6) sends a model id written into `ocrClaude.ts`.

Two properties decide the shape, and neither fits a control ADR-0056 knows:

1. **A model's choices come from a query.** ADR-0081 fetches each provider's list from the provider, with a small
   read-spec fallback, because a list written from memory names models that do not exist. So no enum can hold them,
   and a text box accepts any string — Decision 3's own argument against a generic control that offers nothing.
2. **The choice is per provider.** The OCR recogniser reads with Anthropic's model whatever provider the Assistant is
   on. One `ai.model` string would be Anthropic's while the Assistant is on Anthropic and something else the moment
   the person tries another provider — and then OCR would send an OpenAI model id to Anthropic.

## Decision

1. **`ai.provider`** — the provider the Assistant asks, an enum of `AI_PROVIDER_IDS`, Anthropic by default. An
   ordinary enum control.
2. **`ai.models`** — one chosen model id **per provider**, a record keyed by provider, empty by default. Switching
   provider keeps every other provider's choice, and Anthropic's is always the recogniser's.
3. **A `model` control** joins ADR-0056's list, declared by the setting (`control: 'ai-models'`) rather than
   recognised from a schema shape, as a colour is: it lists the chosen provider's models as `ai.models` answers them
   (fetched, or the fallback, with the source said), selects the stored id for that provider, and writes only that
   provider's entry. A stored id the list no longer has is still shown, marked as not offered now — never silently
   replaced.
4. **Disabled, never dropped** (ADR-0081): where the chosen model will read an IMAGE — Anthropic's, which the
   recogniser uses — a model whose provider says it has no vision is listed disabled, with the reason. A model whose
   capabilities are unknown (`null`, what a list endpoint says) is offered: refusing everything a provider does not
   describe would refuse every fetched model.
5. **One default, in the contract**: `defaultModel(models, { vision })` — the first listed model the use can take.
   The Assistant's picker shows it when nothing is stored, and `main` takes it for the recogniser when Anthropic has
   no stored choice, from the same fetched-or-fallback list. A choice is stored only when a person makes one, so an
   updated list moves the default with it.
6. **No model id in a surface** — `CLAUDE_OCR_MODEL` is removed; the recogniser's credentials carry the model.

## Rejected

- **Keep the model in the Assistant only.** Part F puts it in Settings, and the recogniser must read it in `main`.
- **One `ai.model` string.** Decision 2's reason: the recogniser and the Assistant would share one value that means a
  different provider's model half the time.
- **A text field for the model.** Accepts any string and offers nothing; ADR-0056 Decision 3.
- **Dropping models without vision.** ADR-0081 Decision 4: a filtered list cannot be told from a broken one.
- **A model id written as the recogniser's fallback.** ADR-0081's own rule; the fallback list is where a read-spec id
  lives, and `defaultModel` reads it from there.

## Correction, 2026-09-28 — Decision 3 cannot be built on the dialog seam as it stands

Found while building, the same day. Decision 3 puts the model list in the Settings dialog, fetched for the provider
chosen there. A dialog is **props-only** ([ADR-0038](0038-a-dialog-answers-the-command-that-opened-it.md)): its props are
validated data given when it opens — a function is refused, which is that ADR's own rule — and `update`
([ADR-0094](0094-a-dialog-may-report-before-it-answers.md)) reports outward only. So an open dialog cannot ask for a
list, and fetching every provider's list before opening would hold Settings on network calls with no bound of their
own (`listModels` sets none; the Assistant carries the same gap).

The two ways forward are not this ADR's to take, since each bends something recorded: a dialog able to query after it
opens is a change to ADR-0038's seam, and a model chosen only in the Assistant moves a row Part F places in Settings
(`BUILD-PROMPT.md`:622). **Put to the owner.**

**Built meanwhile**, everything that does not depend on the answer: Decisions 1, 2, 4, 5 and 6. `ai.provider` is a
Settings row and the Assistant's picker; `ai.models` is written by the Assistant's model picker, per provider, and is
marked `remembered` until a Settings row exists for it; the picker lists a model without vision disabled where the
choice reads images and keeps a stored model the list no longer names; the recogniser reads Anthropic's choice or
`defaultModel`, and `CLAUDE_OCR_MODEL` is gone.

## Correction, 2026-09-28 (later) — the owner answered from the record, and neither route was taken

The question above offered two routes and both bent something. The owner's answer took neither, and pointed at this
ADR's own words: Decision 3 already says the list is *"fetched, or the fallback, with the source said"*. So the row
shows **the list `main` already holds when the dialog opens** — the one it last fetched this session for that provider,
or else the fallback — with its source stated in words. Nothing is fetched on open, so ADR-0038's seam does not change;
the Assistant's picker stays the live list; both write the one setting.

**The premise the two routes shared was that the dialog's list had to be FRESH** — fetched for the dialog — which
Decision 3 never said. That is CLAUDE.md Rule 0's *state whether the question is the right one*, arriving from the
owner rather than from the author.

Built:

- **`ai.models.held`**, a query that asks no provider: every provider's list from what `main` holds, an exhaustive
  record. `main` keeps the last list `ai.models` or a key check FETCHED, per provider, for the session; a failed ask
  never replaces a fetched list, and a provider not fetched answers `unaskedList` — the same function `listModels`
  answers with no key, so the two cannot describe an unasked list differently. The Settings command asks it before
  opening, as it already asks for the stored secrets' ids, and a failed query opens the dialog with no lists, each row
  saying so.
- **The row**, declared by the setting (`control: 'ai-models'`) as Decision 3 said: the chosen provider's held list,
  the stored choice or `defaultModel` selected, a blind model disabled where the choice reads images, a stored id the
  list no longer names kept and marked, and a line saying where the list came from — fetched this session, this
  build's own list because the provider has not been asked, a provider that publishes none, or a list that could not
  be read. `ai.models` is no longer `remembered`.
- **One provider drop-down on the AI page.** Decision 1's row and the page's own chooser of which key to show were two
  answers to *which provider* on one page; the page's chooser is now `ai.provider` itself, and the page shows that
  provider's key, its address where it has one (Azure OpenAI), and its model.
- **`choiceReadsImages(provider)`**, in the contract: which provider's choice must read images was spelt
  `provider === 'anthropic'` in the Assistant, and the row would have been the second spelling (B3a).
- **`listModels` is bounded** (`MODEL_LIST_TIMEOUT_MS`, ten seconds, one signal over the request and the body): the gap
  the correction above named. A provider that never answers is outside this repository, so a stated bound is the
  correct response; on expiry the answer is the fallback with `unreachable`.
