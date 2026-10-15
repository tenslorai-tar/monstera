# ADR-0236 — About says what Monstera is, not how it is updated

- **Status:** Accepted
- **Date:** 2026-10-13
- **Supersedes:** `BUILD-PROMPT.md` E4's *"show 'Updates are managed by Microsoft Store' in About"*. E4's other About
  clause, *"Update checks are the only phone-home in the app, and the About panel says so"*, is kept.
- **Decided by:** the owner's O1 (2026-10-12): *"Remove the updates sentence ("Updates are managed by the Microsoft
  Store. Monstera does not check for updates itself."). Add two or three very short lines on what Monstera is (a PDF
  editor for Windows; documents stay on the computer). Keep the rest."*

## Where it stood

`AboutBody.tsx` drew one line about updates for every run: per install channel (`ABOUT_UPDATES_STORE`, `_WEB`,
`_DEVELOPMENT`), or, on a run that asked monsterapdf.com (ADR-0110), `ABOUT_UPDATES_CHECKED`.

## Decision

1. **The channel's updates line goes.** A Store build is updated by Windows, and saying so in About was E4's own
   wording; the owner decided About is not the place for it. The install channel itself is still shown, as a fact.
2. **The phone-home line stays, and only where it is true.** `ABOUT_UPDATES_CHECKED` is drawn on a run that DID ask
   (ADR-0110's status), which is E4's second clause and the only network call the update path makes. The check is
   dormant (cloud rule 9), so in practice the line is not drawn today; it is kept so the day the check is live, About
   says so without anyone remembering to add it back.
3. **What Monstera is, in two short lines:** a PDF editor for Windows, and that documents stay on the computer unless
   the person sends one. The condition is not decoration: the assistant, cloud storage and DocuSign each send a
   document when the person asks, so *"documents stay on your computer"* alone would be a claim this build breaks.

## Rejected

- **Removing the phone-home line with the rest.** It is not the sentence the owner named, and E4 makes it the one
  place a person learns that the app ever contacts the network for updates.
- **Moving the updates sentence to Settings.** Nothing asked for it, and a sentence moved rather than removed is the
  owner's decision undone by placement.

## Correction, 2026-10-13: About carries no line about updates at all

**Decision 2 read the owner's instruction more narrowly than it was given, and its first rejected alternative is the
owner's actual decision.** The owner, Part 7 C: *"remove ALL reference to updates in this dialog"*, including the
conditional line. Decision 2 kept `ABOUT_UPDATES_CHECKED` on the ground that it was not the sentence O1 named; O1
named the sentence as an example of what About should not say, and this decision answered the example rather than the
instruction.

So, superseding Decision 2 and the first rejected alternative:

1. **About draws no line about updates on any run.** `ABOUT_UPDATES_CHECKED` is deleted, the dialog's props lose
   `checksForUpdates`, and `app.about` no longer asks `app.updateStatus`. `checksForUpdates` in `updateStatus.ts`
   had About as its only caller and goes with it; the title bar's indicator and the security notice read the status
   through `isUpdateOffered` and `offerSecurityNotice`, unchanged.
2. **E4's other About clause is superseded as well:** *"Update checks are the only phone-home in the app, and the About
   panel says so."* The first half stays true and stays ADR-0110's to keep true. The second half moves out of About.
   Where a person learns that a check contacts monsterapdf.com is the *Check for new versions* setting, which ADR-0110
   registers with the check going live and which says what is fetched and sent. While the check is dormant there is
   nothing to say.
3. **The install channel stays, as a fact about the build.** It names where the build came from, and it says nothing
   about how the build is updated.

Decided by the owner. The architecture's amendment log carries a row for this correction.

## Correction, 2026-10-15: About keeps one of the two lines

The owner's cloud run 4 addendum, C1: *"Delete 'Your documents stay on your computer unless you send one.' Keep
'Monstera is a PDF editor for Windows.' and everything else."* Decision 3's second line is gone from the About window
and from the catalogue. The reason Decision 3 gave for its wording still holds of any such sentence; the owner chose to
carry none. The help centre's *About Monstera* article keeps the sentence under *Good to know*, where it describes the
application rather than the window.
