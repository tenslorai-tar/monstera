# ADR-0190 — Settings asks the provider for its models, and a saved model is never called *not offered* before anyone asked

- **Status:** Accepted
- **Date:** 2026-10-07
- **Supersedes:** the last clause of [ADR-0117](0117-an-ai-model-is-chosen-per-provider-from-the-fetched-list.md)'s second
  correction (2026-09-28) — that the Settings row shows only what `main` already holds. The dialog still OPENS on that
  (it is props-only, ADR-0038); what changes is what it does next.
- **Found by:** the owner's screen recording of 2026-10-06 — on every launch Settings › AI showed two Anthropic models
  with the saved one marked *(not offered now)*, and DeepSeek *No models to choose from*; only after the Assistant had
  asked did Settings show the real list. In the same recording the Assistant said *no models are listed* for a moment
  each time its tab was shown again.

## Context

`main` holds the list it last fetched this session, or this build's fallback. Nothing fetched on launch, and nothing but
the Assistant's own read and Settings' *Check* ever did, so a fresh launch held the fallback for every provider. The row
then drew two untruths from it: a stored model the fallback does not name was marked *not offered now* — a claim about
the provider the build had not asked — and a provider with no fallback said it had no models although a key was stored
that could ask.

The flash is the same fact one panel over. The right panel mounts one tab (ADR-0083), so the Assistant is built again
each time it is chosen, and it began with an empty list that said *no models are listed for this provider yet* until its
read returned. A list not yet asked for was drawn as a list that is empty.

## Decisions

1. **Settings asks, once the AI page is shown or the provider changes, for each provider with a stored key.** The dialog
   reports `refresh` (ADR-0094's report, ADR-0158's reply): the opener asks `ai.models` and replies with that provider's
   list and a `refreshed` count. It is the key check's read without the key check's verdict — nothing is said about the
   key, and `checked` does not move. Once per provider per opening; *Check* still asks again and still says the key works.
   Opening Settings never waits on the network: the row says it is asking, and shows what it holds meanwhile.
2. **A model is called *not offered now* only by a list the provider gave.** A stored model the list does not name is
   marked only when the list is `fetched`, carries no problem, and is not being asked for. Against this build's own list,
   an unanswered ask or a read that failed, it is shown as the person's choice, plainly.
3. **A list that has not arrived is not an empty list.** The Assistant keeps the lists it was answered, per provider for
   the session (`assistantModels.ts`), starts from the last one on a rebuild, and says nothing while the first answer is
   awaited; *no models are listed* is said only of an answer that listed none. The picker reads *Loading models…* until
   then.
4. **Nothing is persisted across launches.** A list is the provider's answer of the moment; a copy kept on disk would be a
   second opinion that goes stale unseen. A launch asks again, which is what Decision 1 is for.
5. **The only calls are `ai.models` reads, with a key held in `main`.** No key crosses, none is logged, and no model is
   asked a question.

## Rejected alternatives

- **Fetch every provider's list at launch.** A network call per stored key before anyone opened an AI surface, for lists
  most launches never read.
- **Persist the last fetched list.** See Decision 4.
- **Make the dialog fetch while it opens.** It is props-only (ADR-0038) and would hold the dialog on a provider that
  never answers; the report-and-reply route is the one ADR-0158 built for exactly this.
- **Hide *not offered now* altogether.** A model the provider has dropped is worth saying once the provider has said so.

## Consequences

- `SETTINGS_RESULT` gains `refresh`, the dialog's props gain `refreshed`, and `showSettings.ts` serves it through the same
  read as a check. The wired pair: `showSettings.test.ts` (a refresh asks `ai.models` once and replies with the list, with
  no `checked`) and `SettingsBody.test.tsx` (the AI page reports it when a key is stored and not otherwise; a stored model
  against a fallback list is not marked, against a fetched one it is).
- `AssistantPanel.test.tsx` holds the flash: a rebuilt panel with a list already answered says nothing, and a panel whose
  first read is still pending says nothing, while an answer of no models still says so.
- The screens that change: Settings › AI (the model row and its note), and the Assistant for the moment a list loads.
