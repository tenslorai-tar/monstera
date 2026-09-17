# ADR-0081 — An AI provider is one of ten declared adapters, and its models are fetched

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** nothing. It registers into the settings registry and the secret store that
  already exist; no seam moves.
- **Relates:** [ADR-0057](0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)
  (a provider's key is the provider's, not a feature's),
  [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)
  (a secret setting is write-only).
- **Context:** Stage 9's *provider registry* row, and the owner's AI design of 2026-09-15.

## Decision

1. **Ten providers, declared in `packages/contract/src/aiProviders.ts`**: Anthropic, OpenAI,
   Google Gemini, Mistral, xAI, Azure OpenAI, OpenRouter, Groq, Perplexity, DeepSeek. **No
   local models and no custom endpoint** — the owner's design. A request in this application
   goes to a service this build names, and no document or setting can move that address.
2. **Three request shapes, not ten.** Eight of the ten speak the OpenAI chat-completions
   shape and share one adapter that differs only in where it points and which key it sends;
   Anthropic and Gemini have their own. **Azure OpenAI is OpenAI-format and still not
   OpenAI**: its address is the person's resource, so it carries a non-secret endpoint
   setting beside its key, as Azure Document Intelligence does.
3. **One key per provider, each a secret setting**, write-only in the Settings dialog, and
   `SECRET_SETTING_IDS` is derived from the registry's list so a provider cannot arrive
   without a place to store its key. **Anthropic keeps `ai.anthropic-key`**, the id D6's
   Claude recogniser placed: two ids would be two stored copies of one credential, and
   rotating one would leave the other working on the old one. That constant moves into this
   table and `schemas.ts` re-exports it, so every existing reader is unmoved.
4. **Model lists are fetched from the provider**, with a small fallback list per provider
   and capability flags per model (vision, streaming). A surface shows what a model cannot
   do as **disabled, never dropped**: a person who cannot find a model they know exists has
   no way to tell a filtered list from a broken one. **No model id is written into a
   surface** — D6's `claude-opus-5` constant expires when this stage's model setting lands.

## The key list is written out, and that is the direction that matters

`AI_PROVIDER_KEY_SETTING_IDS` is ten literals, not `AI_PROVIDER_IDS.map(...)`. A derived
list tracks growth perfectly and agrees with any shrink, and the failure feared here — a
provider whose key nothing stores — makes the list *smaller*. `aiProviders.test.ts` holds
the list and the table equal **as sets, from both sides**, so an omission on either side is
red.

## Rejected

- **A provider a person can type in**, or a base URL setting. It makes the address a value
  the application does not control, which is the property invariant 24 and the download
  rule spend their effort on elsewhere.
- **One adapter with per-provider branches.** Three shapes with three implementations, or
  one implementation with a `switch` on ten ids in every step; the second is the shape that
  grows a branch per feature.
- **A hard-coded model list.** It is stale the day a provider ships a model, and the owner's
  design says fetched with a fallback.
- **Hiding models a provider's key cannot use.** Disabled and explained is the no-key state's
  own rule, one noun along.
