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
