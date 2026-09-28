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
