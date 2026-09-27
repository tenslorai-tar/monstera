# DRAFT — not legal advice; for review by Tenslor Inc.'s counsel before launch.

# Monstera PDF Editor — Individual Contributor Assignment Agreement (draft)

This draft is based on the **Harmony Individual Contributor Assignment Agreement (HA-CAA-I),
version 1.0, 4 July 2011**. It uses **Option Five** as the outbound licence.

- Source: <https://www.harmonyagreements.org/docs/ha-caa-i-v1.pdf>, read in full on 2026-09-26;
  every operative sentence below compared on 2026-09-27 with the combined template at
  <https://www.harmonyagreements.org/docs/ha-combined-v1>, whose assignment variant is this one.
- The template is licensed under the Creative Commons Attribution 3.0 Unported licence
  (<https://creativecommons.org/licenses/by/3.0/>), stated on the template itself and at the
  foot of every page of harmonyagreements.org (read 2026-09-27). This draft is an adaptation of
  it, and the attribution line at the end has to stay.

---

## Read this first: notes for the owner and counsel (not part of the agreement)

### What this agreement does, in plain words

1. **The contributor gives Tenslor Inc. the copyright** in what they contribute (§2.1(a)).
   Where a country's law does not allow copyright to be transferred, the contributor instead
   gives an exclusive licence (§2.1(b)). Where even that is not possible, the contributor
   promises not to enforce those rights (§2.1(c)).
2. **Tenslor immediately licenses the contribution back to the contributor** (§2.1(d)). The
   licence is permanent, worldwide, free and as broad as possible, so the contributor can still
   do anything they like with their own work. It covers their contribution only, not the rest
   of Monstera.
3. **The contributor gives a patent licence** for any of their patents that the contribution
   would infringe (§2.2).
4. **Option Five, the outbound licence** (§2.3). Tenslor may release the contribution under
   *any* licence, including a commercial or proprietary one. The condition is that Tenslor also
   keeps it available under the licence Monstera used on the day of the contribution, which is
   AGPL-3.0-or-later today (`LICENSE`, and the `license` field of every `package.json`). Both the assignment and the patent
   licence depend on Tenslor keeping that promise.
5. **Moral rights** (the right to be named, to object to changes) are waived to the extent the
   law allows (§2.4).
6. **The contributor is credited by name** (§2.7, added to the template at the owner's
   instruction), unless they ask not to be.
7. The contributor confirms the work is theirs to give, and that their employer has agreed if
   needed (§3). Everything else is provided "as is", and neither side is liable for indirect
   losses (§§4–5).

### Which "Option Five" this is, and why it matters

There are two template families, and each has an "Option Five":

| Family | Has a CAA? | What its "Option Five" means |
|---|---|---|
| **Harmony Agreements 1.0** (harmonyagreements.org, 2011) | **Yes**: HA-CAA-I and HA-CAA-E | Any licence, **plus a promise** that the contribution also stays under the licence of the day |
| **Contributor Agreements 1.2** (contributoragreements.org, the successor) | **No**: its FAQ says the new templates are *"based on copyright license agreements only"* | *"No commitment to any specific outbound license"* (the chooser's label). Its numbering differs: its Option 4 is Harmony's Option One |

A **Contributor Assignment Agreement** only exists in the Harmony family, so this draft follows
Harmony's text. The successor's pages (contributoragreements.org's chooser and FAQ) were read on
2026-09-26 and not re-read since; Harmony's template was re-read on 2026-09-27.

### A question to settle before choosing Option Five

Option Five mainly buys the freedom to release contributions under other licences, including
proprietary ones. **For the Monstera application as a whole, that freedom is limited by
something this agreement cannot change.** Monstera is AGPL because it is built on MuPDF, which
Artifex licenses under the AGPL (README's *Licence* section, ADR-0001). It also ships
Ghostscript, which is AGPL too (its entry in `NOTICE`). Owning every contribution would not let
Tenslor ship the combined application under different terms without a commercial licence from
Artifex, and ADR-0001 rejected that option.

So what an assignment with Option Five does in practice:

- Tenslor holds the copyright in all first-party code. That gives Tenslor clear standing to
  enforce the AGPL, and a single owner for any future change of licence. **This benefit comes
  from the assignment, not from Option Five.** Harmony's Option One would give it too.
- Tenslor could release **its own parts** of the code (for example `packages/shared` or
  `packages/contract`, which do not link MuPDF) under other terms. It could also relicense the
  whole product if a commercial MuPDF licence were ever bought.
- The cost is the contributors' trust. Some people will not sign an agreement that lets their
  work become proprietary. The promise back in Option Five, and the licence back in §2.1(d),
  are what reduce that cost.

Whether that trade is worth it is the owner's decision. This draft only makes it visible.

### What has to change in the repository if this is adopted

- **`CONTRIBUTING.md`'s licence section** said *"By contributing you agree your work is licensed
  under AGPL-3.0-or-later, the same as the project."* Under this agreement the contributor
  assigns rather than licenses, so that section was replaced in the commit that added this
  draft; otherwise the repository would publish two contradictory sets of contribution terms.
- There needs to be a way to sign (see `[SUBMISSION_INSTRUCTIONS]`), and pull requests must not
  be merged until the author has signed. How that is enforced (a signing bot, a manual check) is
  not decided here.
- No outside contributor has contributed so far. `git shortlog -sn HEAD`, run 2026-09-27 on the
  commit before the one that added this file, lists only the owner's two identities, so nothing
  already merged needs to be covered afterwards.

### Blanks for counsel to fill (kept exactly as the template names them)

| Placeholder | Where | Note |
|---|---|---|
| `[SUBMISSION_INSTRUCTIONS]` | preamble | How a contributor signs and sends the agreement |
| `[NONOWNER_INSTRUCTIONS]` | §1 "Contribution", §3(d) | What to do when a contribution contains work the contributor does not own (third-party code, AI-generated or employer-owned material) |
| `[or Your Affiliates]` | §2.2 | An optional bracket in the template. Keep it or remove it |
| `[LIST_OF_MEDIA_LICENSES]` | §2.3, Media paragraph | Licences for non-software parts, such as documentation and images. The repository has not chosen one |
| `[JURISDICTION]` | §6.1 | Governing law. Tenslor Inc.'s place of incorporation is not stated anywhere in the repository |
| Signature block, "Us" | end | Name and title of Tenslor's signatory, and Tenslor's address |

### What was changed from the template

- `[PROJECT_NAME] ("We" or "Us")` is filled in as **Tenslor Inc.**, the publisher of Monstera
  PDF Editor. "We" has to be the legal person that receives the assignment. A project name
  cannot hold copyright.
- Options One to Four of §2.3 are removed and **Option Five is kept, word for word**.
- **§2.7 Attribution is added**, because the owner's instruction is that contributors are
  credited. It is the only operative sentence that is not the template's, and counsel should
  read it as new text.
- Section numbering, headings and every other operative sentence are the template's own. The
  template's US spelling ("license") is kept inside the agreement so counsel can compare it
  line by line with HA-CAA-I. These notes use the repository's British spelling.
- **The entity version (HA-CAA-E) was not read or drafted.** Anyone whose employer owns their
  work needs it: HA-CAA-I §3(c) asks the employer to approve this agreement or sign the entity
  version.

---

## Individual Contributor Assignment Agreement

Thank you for your interest in contributing to Monstera PDF Editor, which is published by
Tenslor Inc. ("We" or "Us").

This contributor agreement ("Agreement") documents the rights granted by contributors to Us. To
make this document effective, please sign it and send it to Us by mail, email, fax, or electronic
submission, following the instructions at [SUBMISSION_INSTRUCTIONS]. This is a legally binding
document, so please read it carefully before agreeing to it. The Agreement may cover more than one
software project managed by Us.

### 1. Definitions

"You" means the individual who Submits a Contribution to Us.

"Contribution" means any work of authorship that is Submitted by You to Us in which You own or
assert ownership of the Copyright. If You do not own the Copyright in the entire work of
authorship, please follow the instructions in [NONOWNER_INSTRUCTIONS].

"Copyright" means all rights protecting works of authorship owned or controlled by You, including
copyright, moral and neighboring rights, as appropriate, for the full term of their existence
including any extensions by You.

"Material" means the work of authorship which is made available by Us to third parties. When this
Agreement covers more than one software project, the Material means the work of authorship to
which the Contribution was Submitted. After You Submit the Contribution, it may be included in the
Material.

"Submit" means any form of electronic, verbal, or written communication sent to Us or our
representatives, including but not limited to electronic mailing lists, source code control
systems, and issue tracking systems that are managed by, or on behalf of, Us for the purpose of
discussing and improving the Material, but excluding communication that is conspicuously marked or
otherwise designated in writing by You as "Not a Contribution."

"Submission Date" means the date on which You Submit a Contribution to Us.

"Effective Date" means the date You execute this Agreement or the date You first Submit a
Contribution to Us, whichever is earlier.

"Media" means any portion of a Contribution which is not software.

### 2. Grant of Rights

#### 2.1 Copyright Assignment

(a) At the time the Contribution is Submitted, You assign to Us all right, title, and interest
worldwide in all Copyright covering the Contribution; provided that this transfer is conditioned
upon compliance with Section 2.3.

(b) To the extent that any of the rights in Section 2.1(a) cannot be assigned by You to Us, You
grant to Us a perpetual, worldwide, exclusive, royalty-free, transferable, irrevocable license
under such non-assigned rights, with rights to sublicense through multiple tiers of sublicensees,
to practice such non-assigned rights, including, but not limited to, the right to reproduce,
modify, display, perform and distribute the Contribution; provided that this license is
conditioned upon compliance with Section 2.3.

(c) To the extent that any of the rights in Section 2.1(a) can neither be assigned nor licensed by
You to Us, You irrevocably waive and agree never to assert such rights against Us, any of our
successors in interest, or any of our licensees, either direct or indirect; provided that this
agreement not to assert is conditioned upon compliance with Section 2.3.

(d) Upon such transfer of rights to Us, to the maximum extent possible, We immediately grant to
You a perpetual, worldwide, non-exclusive, royalty-free, transferable, irrevocable license under
such rights covering the Contribution, with rights to sublicense through multiple tiers of
sublicensees, to reproduce, modify, display, perform, and distribute the Contribution. The
intention of the parties is that this license will be as broad as possible and to provide You with
rights as similar as possible to the owner of the rights that You transferred. This license back
is limited to the Contribution and does not provide any rights to the Material.

#### 2.2 Patent License

For patent claims including, without limitation, method, process, and apparatus claims which You
[or Your Affiliates] own, control or have the right to grant, now or in the future, You grant to Us
a perpetual, worldwide, non-exclusive, transferable, royalty-free, irrevocable patent license, with
the right to sublicense these rights to multiple tiers of sublicensees, to make, have made, use,
sell, offer for sale, import and otherwise transfer the Contribution and the Contribution in
combination with the Material (and portions of such combination). This license is granted only to
the extent that the exercise of the licensed rights infringes such patent claims; and provided that
this license is conditioned upon compliance with Section 2.3.

#### 2.3 Outbound License

Based on the grant of rights in Sections 2.1 and 2.2, if We include Your Contribution in a
Material, We may license the Contribution under any license, including copyleft, permissive,
commercial, or proprietary licenses. As a condition on the exercise of this right, We agree to also
license the Contribution under the terms of the license or licenses which We are using for the
Material on the Submission Date.

In addition, We may use the following licenses for Media in the Contribution:
[LIST_OF_MEDIA_LICENSES] (including any right to adopt any future version of a license if
permitted).

#### 2.4 Moral Rights

If moral rights apply to the Contribution, to the maximum extent permitted by law, You waive and
agree not to assert such moral rights against Us or our successors in interest, or any of our
licensees, either direct or indirect.

#### 2.5 Our Rights

You acknowledge that We are not obligated to use Your Contribution as part of the Material and may
decide to include any Contribution We consider appropriate.

#### 2.6 Reservation of Rights

Any rights not expressly assigned or licensed under this section are expressly reserved by You.

#### 2.7 Attribution

If We include Your Contribution in a Material, We will credit You by name as a contributor to it,
in its source repository's history and in any list of contributors We publish with it, unless You
ask Us in writing not to.

### 3. Agreement

You confirm that:

(a) You have the legal authority to enter into this Agreement.

(b) You own the Copyright and patent claims covering the Contribution which are required to grant
the rights under Section 2.

(c) The grant of rights under Section 2 does not violate any grant of rights which You have made to
third parties, including Your employer. If You are an employee, You have had Your employer approve
this Agreement or sign the Entity version of this document. If You are less than eighteen years
old, please have Your parents or guardian sign the Agreement.

(d) You have followed the instructions in [NONOWNER_INSTRUCTIONS], if You do not own the Copyright
in the entire work of authorship Submitted.

### 4. Disclaimer

EXCEPT FOR THE EXPRESS WARRANTIES IN SECTION 3, THE CONTRIBUTION IS PROVIDED "AS IS". MORE
PARTICULARLY, ALL EXPRESS OR IMPLIED WARRANTIES INCLUDING, WITHOUT LIMITATION, ANY IMPLIED WARRANTY
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT ARE EXPRESSLY DISCLAIMED
BY YOU TO US AND BY US TO YOU. TO THE EXTENT THAT ANY SUCH WARRANTIES CANNOT BE DISCLAIMED, SUCH
WARRANTY IS LIMITED IN DURATION TO THE MINIMUM PERIOD PERMITTED BY LAW.

### 5. Consequential Damage Waiver

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL YOU OR US BE LIABLE FOR ANY
LOSS OF PROFITS, LOSS OF ANTICIPATED SAVINGS, LOSS OF DATA, INDIRECT, SPECIAL, INCIDENTAL,
CONSEQUENTIAL AND EXEMPLARY DAMAGES ARISING OUT OF THIS AGREEMENT REGARDLESS OF THE LEGAL OR
EQUITABLE THEORY (CONTRACT, TORT OR OTHERWISE) UPON WHICH THE CLAIM IS BASED.

### 6. Miscellaneous

6.1 This Agreement will be governed by and construed in accordance with the laws of
[JURISDICTION] excluding its conflicts of law provisions. Under certain circumstances, the
governing law in this section might be superseded by the United Nations Convention on Contracts
for the International Sale of Goods ("UN Convention") and the parties intend to avoid the
application of the UN Convention to this Agreement and, thus, exclude the application of the UN
Convention in its entirety to this Agreement.

6.2 This Agreement sets out the entire agreement between You and Us for Your Contributions to Us
and overrides all other agreements or understandings.

6.3 If You or We assign the rights or obligations received through this Agreement to a third
party, as a condition of the assignment, that third party must agree in writing to abide by all
the rights and obligations in the Agreement.

6.4 The failure of either party to require performance by the other party of any provision of this
Agreement in one situation shall not affect the right of a party to require such performance at
any time in the future. A waiver of performance under a provision in one situation shall not be
considered a waiver of the performance of the provision in the future or a waiver of the provision
in its entirety.

6.5 If any provision of this Agreement is found void and unenforceable, such provision will be
replaced to the extent possible with a provision that comes closest to the meaning of the original
provision and which is enforceable. The terms and conditions set forth in this Agreement shall
apply notwithstanding any failure of essential purpose of this Agreement or any limited remedy to
the maximum extent possible under law.

---

**You**

Signature: ________________________

Name: ________________________

Address: ________________________

Date: ________________________

**Us — Tenslor Inc.**

Signature: ________________________

Name: ________________________

Title: ________________________

Address: ________________________

---

<sub>This agreement is adapted from the Harmony Individual Contributor Assignment Agreement
(HA-CAA-I), version 1.0, 4 July 2011, by Project Harmony
(<https://www.harmonyagreements.org/>), used under the Creative Commons Attribution 3.0
Unported licence. What changed: the project and party name are filled in, Options One to Four of
Section 2.3 are removed, Section 2.7 (Attribution) is added, and a date line is added to the
signature block. Every other operative text is the template's own.</sub>
