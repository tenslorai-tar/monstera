# ADR-0001 — AGPL-3.0 on the Microsoft Store

- **Status:** Accepted
- **Date:** 2026-08-16
- **Amends:** nothing; records the founding decision in `BUILD-PROMPT.md` Part J.

## Context

Monstera is licensed **AGPL-3.0-or-later**. The licence is not a preference —
it is forced by MuPDF, which the app links as WASM and ships as a bundled
`mutool.exe`. MuPDF is AGPL, so the combined work is AGPL.

The Microsoft Store is the project's **primary** distribution channel. That
raises a question with a long history of confused folklore: whether a copyleft
licence can be distributed through the Store at all. The confusion has a real
source — Microsoft's **Standard Application License Terms** contain provisions
(notably restrictions on redistribution and reverse engineering) that a GPL-family
licence cannot accept, and for years this was read as a blanket prohibition.

What resolves it is that those Standard Terms are a **default**, not a mandate.
The App Developer Agreement lets a publisher supply their own licence terms in
the listing, and those **supersede** the Standard Application License Terms for
that app. Once the app's own AGPL terms govern, the conflict disappears.

The empirical check matters more than the reading: GPL-family applications ship
on the Microsoft Store today. VLC, Krita and Inkscape are all present, all
copyleft, all distributed through the same channel this project targets. A
policy reading that concluded "impossible" would have to explain them.

## Decision

Ship Monstera on the Microsoft Store under AGPL-3.0-or-later.

1. Declare **AGPL-3.0-or-later** as the app's licence terms in the Partner
   Center listing, so the provider-supplied terms supersede the Standard
   Application License Terms.
2. Keep a **source code link** in both the Store listing and the in-app About
   panel.
3. Ship a `NOTICE` file **generated from the lockfile**, never hand-maintained,
   and a source offer covering the shipped MuPDF version.
4. **Re-verify the current Store Policies once at submission preparation** — as
   a checklist item with a named owner, not as an open question carried through
   the whole build. Policy text changes; the analysis above is a snapshot dated
   above, and treating a snapshot as permanent is how a launch gets surprised.

## Rejected alternatives

- **Relicense to avoid the question.** Not available. MuPDF's AGPL propagates
  through both the WASM linkage and the bundled `mutool.exe`. Avoiding it would
  mean replacing the structural writer of record, which is the single most
  load-bearing engine in the architecture.
- **Buy a commercial MuPDF licence to ship under a permissive licence.**
  Rejected on project identity: Monstera is free and open-source, and the
  codebase being readable is stated as half the product. A commercial licence
  would also introduce a per-seat cost structure incompatible with free
  distribution.
- **Skip the Store; ship only from monsterapdf.com.** Rejected because the
  Store is where the target users already look for a PDF editor, and because
  Store-signed MSIX avoids the unsigned-installer warning that the direct
  download flavor carries as a documented tradeoff. Both channels ship; the
  Store is primary.
- **Ship on the Store under the Standard Application License Terms and hope.**
  Rejected outright. It would distribute AGPL code under terms that contradict
  the AGPL — a licence violation, and a conspicuous one for a project whose
  audience reads licences.

## Consequences

- The Partner Center listing has a required, non-default configuration step. If
  it is skipped, the app ships under terms it cannot legally ship under, so it
  belongs on the submission checklist as a blocking item.
- Store review may ask about the licence. The answer is the precedent list plus
  the provider-supplied-terms mechanism.
- The source offer must track the **shipped** MuPDF version, so it is generated
  at package time from the lockfile rather than written once.
- AGPL compliance is now a packaging concern with tests, not a README claim.
