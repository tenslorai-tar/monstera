# Build journal

Actual effort per stage, recorded as stages run. Part G fixes baseline
estimates in advance so the Stage 1 trajectory gate has a number to measure
against — **a gate with no recorded baseline is inert**, and one recorded after
the fact is not a baseline, it is a rationalisation.

| Stage | Baseline estimate | Actual | Verdict |
|---|---|---|---|
| 0 — walking skeleton | 15 working days | in progress (started 2026-08-16) | — |
| 1 — viewer core | 10 working days | — | — |

**The gate:** exceeding an estimate by **3×** arms a decision, which is taken in
writing and is one of *continue*, *cut scope*, or *halt and reassess with the
user*. A project with no defined abort condition dies slowly.

---

## 2026-08-16 — Stage 0 opens

**First actions (Part G), in order.**

1. Committed `BUILD-PROMPT.md` and `DESIGN-DRAFT.html`. Both are plain text
   carrying no secret, binary or fixture, so nothing in them was a thing the
   not-yet-existing guards could have caught.
2. Committed the pre-commit guards, their proofs, and the CI mirror. The
   ordering is the point: the guards exist before there is anything they could
   fail to catch.

**Decisions taken with the owner.**

- Repository is public with GitHub secret-scanning push protection enabled,
  confirmed before the first push. Retained-by-hash permanence is exactly why
  it cannot be enabled retroactively.
- The supplied `logo.png` is the official logo, used as-is; the earlier
  circular-mark-plus-wordmark treatment is withdrawn. Recorded as
  [ADR-0002](DECISIONS/0002-brand-mark-treatment.md) because it amends design
  law, and B4 does not exempt the design system.

**Mechanisms found, not patched around.**

- *Line-ending churn.* The founding-document commit emitted
  `LF will be replaced by CRLF`. Root cause: no normalisation policy was
  declared, so each clone's `core.autocrlf` decided independently what landed in
  a blob and identical source churned between checkouts. Fixed with
  `.gitattributes` (`* text=auto eol=lf`), with hooks and shell scripts pinned
  to LF because Git for Windows' `sh` reads a trailing CR as part of the command
  word and dies with `bad interpreter`.
- *Hook root resolution.* `preCommit.mjs` initially derived the repository root
  from its own file location. A git worktree keeps its checkout outside the main
  clone, so that path would have pointed the scan at the wrong tree — reporting
  success for a tree nobody committed to. Now asked of
  `git rev-parse --show-toplevel`.
- *No pinned gitleaks build for every platform.* `BUILDS` covers five
  platforms; linux-armv7 and the 32-bit targets have published releases but no
  pin, leaving a contributor there with no route to a working hook at all.
  Closed with a `MONSTERA_GITLEAKS` override that is still verified by spawning
  it — it selects a binary, it does not excuse one from working.

**Verification, not assumption.**

- Every gitleaks archive digest was taken from the release checksums file **and
  independently recomputed locally** before being pinned. A summarising model
  transcribing 64-character hex is a silent-corruption risk not worth taking.
- `gitleaks protect` no longer exists in 8.30; the staged-scan invocation is
  `gitleaks git --staged`. Checked against `--help` rather than recalled.
- `actions/checkout` and `actions/setup-node` were both at versions **two and
  one majors newer** than assumed. Both are now pinned by commit SHA, not by
  tag: a tag is mutable and its target runs with the workflow's token, which is
  the same class of risk as an unpinned binary download.
- The guard proofs were run against three deliberate mutations of the guard
  (size limit raised, magic-byte detection disabled, allowlist widened) and each
  turned them red. A proof that cannot fail proves nothing.
- **CI was red on all three pushes, and only checking said so.** The badge had
  not been looked at; the assumption was that green locally meant green in CI.
  Root cause: `preCommit.proof.mjs`'s pass-path case needs a working scanner —
  the gate is *designed* to block without one — and the workflow ran the proofs
  before anything provisioned gitleaks. Reproduced locally by parking `.tools`.
  Fixed at the class rather than the instance: every entry point now provisions
  what it needs, so the steps are order-independent. A step order that must be
  remembered is one that will eventually be got wrong.
- **A second, unrelated defect surfaced during that investigation.** Timestamps
  showed `.tools` being rebuilt mid-test, leaving a stray archive that the
  success path deletes. `provisionGitleaks` cleared the destination and
  extracted into it, so two concurrent provisioners — CI steps, a hook racing a
  proof, two terminals — could have one delete the directory the other was
  extracting into. What survives is a half-populated tree that `fileExists`
  accepts. Now it builds in a per-process staging directory and publishes by
  atomic rename. This matters well beyond gitleaks: the same primitive
  provisions `pdfium.dll`, `mutool` and Ghostscript, where a half-written native
  library is a crash with no useful stack rather than a clean error. Its proof
  races three provisioners from a cold cache and checks the published binary
  *runs*, not merely that it exists; under a shared-staging mutation two of the
  three racers fail, so the proof is not vacuous.
- The design draft's token seed was audited against M2's contrast law **before**
  being encoded, and failed it in 13 places. Root cause was not the values: the
  token file declared colours but not which foreground may sit on which surface,
  so the specified check was over-broad in one direction (failing
  `--muted` on `--accent-soft`, a pairing that never renders) and unable to
  express the other (a decorative hairline and an input's outline are the same
  token at 1.13:1, and only one of them owes WCAG 1.4.11 its 3:1). Resolved by
  [ADR-0003](DECISIONS/0003-token-role-typing-and-declared-pairings.md) before
  any token code exists. Finding it later would have meant thirteen violations
  spread across a hundred components, and the cheap escape would have been the
  blanket exemption M2 bans by name.
