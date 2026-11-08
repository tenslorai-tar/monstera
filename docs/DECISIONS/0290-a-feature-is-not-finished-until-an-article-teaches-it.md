# ADR-0290 — A feature is not finished until an article teaches it

- **Status:** Accepted
- **Date:** 2026-11-08
- **Decided by:** the owner, 2026-11-08: *"Nothing requires a new feature to have an article, which is why these two
  slipped through. Add a check that fails when a user-facing command has no article, with a written list of exemptions
  and a control case."*
- **Amends:** `docs/ARCHITECTURE.md` §7's opening, and so `BUILD-PROMPT.md` Part H's definition of done, by one clause.
- **Relates:** [ADR-0112](0112-the-help-centre-is-bundled-articles-and-f1-opens-the-one-for-where-you-are.md) (*one article
  per feature*, checked in one direction only), [ADR-0141](0141-every-command-declares-how-a-person-learns-it-worked.md)
  (the same move for feedback: declaring nothing does not pass).

## The problem, in one sentence

ADR-0112 Decision 2 checks that what an article names exists in the application, and nothing checks the other direction,
so a command can ship with no article and every check stays green.

Measured on 2026-11-08 at `52414223`: 282 commands registered, 50 listed by no article. Two of the 50 are the features the
owner found, *Document properties* and *Convert text to curves*, both live in 1.1.2613.0. `docs/manual-test-checklist.md`
had been printing the gap all along: a line with no *Help:* on it. Nothing read it, which is what a printed gap with no
reader comes to.

## Decision

1. **Every command the registry holds has an article or a written reason.** A command is taught when an article lists its
   id in `commands:`. A command that needs no article is listed in `packages/ui/src/help/noArticleNeeded.ts` with its
   reason. Anything else fails a case, and the failure names the commands.
2. **A listing has to be backed by the body.** The id is what F1 and *Show me* read, and it costs one word, so a list that
   only asked for the id could be met without a sentence of help. The article's body must also say a name the person
   reads on screen, the command's title or its ribbon label. The title, summary and keywords do not count: a keyword is
   a word to find the article by. Where an article teaches a command in other words (an arrow key for a
   nudge), that pair is listed in `TAUGHT_IN_OTHER_WORDS`, in the same file, with the reason.
3. **Every setting the Settings dialog shows is named by an article**, or is listed in `SETTINGS_NO_ARTICLE` with its
   reason. A setting marked `remembered` draws no row, so it is left out by that flag. The settings are in the same
   check because they are the same gap.
4. **The lists cannot go stale in silence.** An exemption for an id nothing registers, for a command an article now
   teaches, or with no reason written fails the same case.
5. **A dialog is not in the check.** The registry cannot tell a tool's window from a message. Of the 33 dialogs no
   article named on 2026-11-08, 24 are messages or confirmations that say what they mean where they appear, six are
   windows of tools an article already teaches, and three belong to the two features above. A window is reached through
   its command, and the command is checked. Named here so nobody reads the check as covering dialogs.

## What the check cannot see

It proves that an article exists, lists the command and says its name. It cannot prove that the article is right. That is
what running the feature before describing it is for, and it stays a discipline: no check here replaces it.

## Rejected

- **A count of articles against a count of commands.** A count agrees with any pairing, and 144 articles for 282 commands
  says nothing about which commands are missing.
- **A proof script outside the test suite.** The registry is what the shell builds, so the check sits beside
  `App.test.tsx`'s case for the opposite direction, where the same registry is already in hand.
- **Requiring each command to have an article of its own.** Thirteen formatting commands are one section of one article,
  and a page for *Italic* would help nobody. ADR-0112's *one article per feature* is about features, not ids.
- **Listing the id alone.** See Decision 2.
