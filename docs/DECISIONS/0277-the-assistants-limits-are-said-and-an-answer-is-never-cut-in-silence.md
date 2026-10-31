# ADR-0277 — The assistant's limits are said, and an answer is never cut in silence

- **Status:** Accepted
- **Date:** 2026-10-29
- **Decided by:** the owner, 2026-10-29 (cloud run 26): *the figure stays at 16,384 characters per question; when a
  question is over the limit, or a conversation is full, the person is told clearly and encouraged to start a new
  conversation; an answer is never cut without saying so.* And the owner, 2026-10-30: *keep the old conversation and
  extend the store, built in this run* (Decision 6).
- **Supersedes:** [ADR-0083](0083-the-contextual-panel-holds-tabs-and-the-assistant-is-one.md) Decision 4 (*one
  conversation per document*) and [ADR-0093](0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md)'s
  one saved conversation per file. **Amends** ADR-0093's saved turn, whose text was bounded at the question's bound
  (`savedTurnSchema`), the bound of `window.copyText`, and
  [ADR-0192](0192-saved-assistant-conversations-are-listed-by-file-name-and-read-or-deleted-without-their-file.md)'s
  list, which now lists each file's conversations. Everything else ADR-0093 decided stands: history is off by default,
  encrypted in `main` with the same cipher, keyed by the digest of the file's canonical path, `main` reads the setting at
  every save, turning it off stops saving, and *Clear chat history* removes every conversation.

## Context

`channels.ts` bounds what the assistant's channels carry: `MAX_CHAT_TEXT` (16,384 characters) for every message of an
`ai.ask` and `MAX_CHAT_TURNS` (64) messages. Read in the code at `0a44647d`, the bounds are enforced in one place and
said in none:

- **A question over the bound** is refused by `ai.ask`'s schema in `main`'s boundary (`wrapHandler`), which answers
  `internal` and records an incident. The panel shows its generic *rejected* sentence. The question was written into the
  conversation before the ask (`ask()` in `AssistantPanel.tsx`), so every later question resends it and is refused the
  same way: the conversation is stuck, and nothing says why. The draft is kept, so the words are not lost.
- **The 65th message** reaches the same refusal, for the same reason, by the count.
- **An answer has no character bound** — `aiChat.ts` asks for at most `MAX_OUTPUT_TOKENS` (4,096) tokens — so an answer
  longer than 16,384 characters is shown whole, and the next question resends it and is refused: stuck again.
- **A provider's refusal of a conversation too long for its model** is any non-OK answer, and reads as *rejected*.
- **Copy** sends `turn.text.slice(0, MAX_CHAT_TEXT)`, because `window.copyText` is bounded at `MAX_CHAT_TEXT`; **the
  history save** sends each turn sliced to `MAX_CHAT_TEXT`, because `savedTurnSchema` bounds a saved turn there. Both cut
  a longer answer and say nothing. The saved turn's bound is also what bounds the history file: `chatHistory.ts` keeps a
  count of conversations *"because each conversation is already bounded by the contract's turn limits"*.

## Decisions

1. **A question stays at `MAX_CHAT_TEXT`** (the owner's figure). A long passage is nearly always from the PDF, so the
   person is pointed at asking about the page or a selection; more text sent costs the person more on their own key. The
   box shows a count as a question nears the bound and, over it, how much is over with that suggestion, announced to a
   screen reader. Send cannot be pressed while over, and the typed words are never taken away.
2. **One rule says whether a conversation can take another question**, `conversationRoom` in the contract, and every
   route that asks takes it (Send, a command's question, Regenerate): the count (the next question would be past
   `MAX_CHAT_TURNS` messages), a turn that would be resent past `MAX_CHAT_TEXT`, and the provider's own refusal of the
   conversation as too long for the model. A full conversation is said in one sentence, with a new conversation one
   press away. Nothing is sent that `main` would refuse, so no question is written into a conversation and stuck there.
3. **An answer is bounded, by `main`, and the bound is said.** `MAX_ANSWER_TEXT` is four times the question's bound,
   65,536 characters. `streamChat` stops an answer that reaches it, keeps every character up to it, and ends it with the
   refusal `answer-cut`, which the panel words as *the answer was stopped at its length limit*. So an answer is never
   longer than the bound, and nothing that carries one — Copy, the history — has to cut it.
4. **Copy and the history carry the whole answer.** `window.copyText` and a saved turn are bounded at `MAX_ANSWER_TEXT`,
   and neither the panel nor the history sync slices. The history file stays bounded by the contract: at most
   `MAX_CHAT_TURNS` turns of at most `MAX_ANSWER_TEXT` each, per saved conversation.
5. **A provider's too-long refusal is recognised only where its answer is established** from the provider's own
   documentation or official SDK, as the refusal `too-long`; any other provider's stays *rejected*, and which providers
   are recognised is listed in `aiChat.ts` with where each was read. Text is never guessed.

6. **A new conversation keeps the old one.** A file holds up to `MAX_FILE_CONVERSATIONS`, 20, saved conversations, each
   whole; *Start a new conversation* (offered when one is full) and *New chat* put the current one in the History, where
   each file's conversations are listed newest first, each openable and removable. Twenty because a conversation is
   full at `MAX_CHAT_TURNS` messages, so twenty are some 640 messages about one file, while the store stays bounded:
   at most `MAX_SAVED_CONVERSATIONS` (200) files, as ADR-0093 kept, each with at most twenty conversations of at most
   `MAX_CHAT_TURNS` turns of at most `MAX_ANSWER_TEXT`. **A file at twenty is never trimmed in silence**: starting a new
   conversation there says the file keeps twenty and asks the person to remove one in the History first. The 200-file
   bound keeps ADR-0093's least-recently-saved rule, stated in the History's description.
7. **History saved by 1.1.2610.0 loads unchanged.** An entry in the old shape, one list of turns per file, is read as
   that file's first conversation, byte for byte the turns it held; nothing saved before this decision is lost or
   rewritten until the file's conversations are next saved.

## Rejected alternatives

- **Saying clearly that a new conversation replaces the saved one, and changing nothing.** The owner's rule is to
  preserve, never drop: offering a full conversation's way out as one press that deletes it would make losing a long
  saved conversation the easy path.

- **Raising `MAX_CHAT_TEXT`.** The owner's decision: the box is for questions about the document, not a replacement for
  a general chat, and every character is paid for on the person's own key.
- **Cutting a long answer when it is resent.** The conversation the model would see is not the one the person reads, and
  a follow-up question about the part cut would be answered from nothing.
- **Dropping the oldest turns to make room.** A conversation that forgets its beginning in silence is the failure this
  decision exists to end.
- **Leaving Copy and the history unbounded.** Every channel and the history file are bounded by the contract (invariant
  L11, `payloadBounds.test.ts`); an answer bound kept by `main` keeps that true without a cut.

## Correction, 2026-10-30 — a resent answer does not fill a conversation, and the dates

**Decision 2 named a third way a conversation is full, and it was wrong.** *A turn that would be resent past
`MAX_CHAT_TEXT`* applies the question's bound to every message an `ai.ask` carries. Decision 3 lets an answer run to
`MAX_ANSWER_TEXT`, 65,536 characters, so any answer longer than 16,384 would have made its conversation full after one
question. That is not what the owner decided: 16,384 is the bound on what a person TYPES, for the reasons Decision 1
gives (a long passage belongs to the page or a selection, and what is sent is paid for on the person's own key).

So, decided by the owner on 2026-10-30:

- **`ai.ask` bounds each message by who wrote it**: a person's message at `MAX_CHAT_TEXT`, an assistant's earlier answer
  at `MAX_ANSWER_TEXT`. The bound is the message's own, carried by its role, so a long answer is resent whole.
- **A conversation is full by two routes only**: the count (the next question would be past `MAX_CHAT_TURNS` messages)
  and the provider's own refusal of the conversation as too long for its model (Decision 5). `conversationRoom` takes
  those two and nothing else.
- **The payload bound that results**: at most `MAX_CHAT_TURNS` (64) messages, a person's at most 16,384 characters and an
  assistant's at most 65,536. With turns alternating that is about 32 × 16,384 + 32 × 65,536, some 2.6 million
  characters, and never more than 64 × 65,536 (4,194,304) whatever the order. Checked against invariant L11: the bound
  is a constant of the contract, the same for a one-page document and a thousand-page one, so no payload grows with the
  document; `payloadBounds.test.ts` already exercises `ai.ask` by schema, and only its prose naming the bound changes.
  A conversation that long is far past most models' context windows, which is what the provider's too-long refusal
  answers, and why that route matters more than the count.

**Dates.** The Date line above says 2026-10-29, the day of Decisions 1 to 5. Decision 6, and with it Decision 7, was
decided on 2026-10-30, as the *Decided by* line records; the Date line is left as written.

## Correction, 2026-10-31: the count takes the answer too, and New chat keeps the last answer

Found by the stage audit of f32c8c39..0d48e788 (the local agent); the decisions' text above is unchanged.

- **The count above, "the next question would be past `MAX_CHAT_TURNS` messages", let a conversation outgrow what is
  kept.** An ask that fails keeps its question and gets no answer, so a conversation can stand at 63; the question went,
  its answer made 65, and the save keeps the newest 64 (`savedTurns`), so the first question was dropped in silence —
  the shape this ADR's rejected alternatives refuse. `conversationRoom` now counts the question AND its answer: full
  when the conversation would pass 64 once answered. At an even count nothing changes; the full sentence now appears as
  the last question is asked rather than when its answer lands. `channels.test.ts` and `AssistantPanel.test.tsx` carry
  it, each with the old count as the control.
- **Decision 6's New chat lost the last answer when pressed within `SETTLE_MS` of it.** One settle timer per document
  served every conversation, so New chat's change cancelled the old one's pending save, and the save that ran was the
  empty new one's. Each save now carries the conversation it is about and that conversation's own key, and a new
  conversation begun while the old one's last change was settling saves that change first, as the old one's
  (`chatHistorySync.ts`; two cases in `chatHistorySync.test.ts`, each red on the old module).

## Correction, 2026-10-31: a long conversation carries on, with a recommendation; a ceiling guards the app

The owner's decision of 2026-10-31; the decisions' text above is unchanged, and this replaces Decision 2's **count** as a
stop. The provider's own too-long refusal stays a stop (Decision 5).

- **At 32 questions the conversation carries on.** A quiet note recommends a new chat and blocks nothing: *This
  conversation is now long. We recommend starting a new chat to save cost.* It shows from the 32nd question, or earlier
  once the conversation's own text reaches **100,000 characters** — about 25,000 tokens sent again with every further
  question, the size of one full document window (`MAX_ASK_CONTEXT`). Read in `contractHandlers.ts`' `ai.ask`: a
  question's documents and attached files go with that question only and are not sent again, so what makes each later
  question cost more is the conversation's own text, and that is what the note counts.
- **A safety ceiling stays, far above normal use, only to protect the app from a broken file:** at most **512
  messages** and at most **4,194,304 characters** of conversation text (`MAX_CONVERSATION_MESSAGES`,
  `MAX_CONVERSATION_TEXT`). The text ceiling is today's own payload bound, 64 messages of `MAX_ANSWER_TEXT`, so an ask
  and a saved conversation are never larger than Decision 4's bound already allowed (invariant L11 unchanged in bytes).
  `conversationRoom` is full by that ceiling alone, counted with the answer it would get (the correction above), and
  says so in Decision 2's sentence.

## Correction, 2026-10-31 — Decision 6 proposed to be superseded by ADR-0279

[ADR-0279](0279-saved-conversations-are-kept-without-caps-each-in-its-own-file-and-history-reads-one-log.md), proposed
and awaiting the owner's approval, would supersede Decision 6's twenty conversations per file and its *file-full*
refusal: no cap on conversations, nothing dropped. Until it is approved and built, Decision 6 describes what ships.
