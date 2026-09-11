# 0053 — The download rule is law, and two layers enforce it

Accepted 2026-09-11.

## Context

D6 row 7 needs the shipped application to fetch a model at a user's request.
`scripts/lib/fetchVerified.mjs` already states the rule such a fetch must obey,
in four guarantees its header lists, and row 7's FEATURES body recorded the
question as *the one open thing blocking the build*: that module cannot be
shared, because provisioning runs before any package is built and `main` cannot
import `scripts/` (invariant 26).

**The three options that question offered — move the rule into a package, ship
the script with the application, keep two implementations held by a proof —
shared a premise that is false.** They all assume provisioning and the
application must reach *one module*. §1.1 says why they must not:

> `scripts/` contains the code that runs **before dependencies exist** — the git
> hooks that gate the very first commit, and the provisioning that installs the
> toolchain. Code responsible for installing a toolchain cannot depend on that
> toolchain being installed.

An on-demand model download is not that code. It runs in the shipped
application, at a user's request, long after every build. Measured on the
ordering rather than argued from the principle: `ci.yml` provisions the pinned
Electron runtime at its *Provision* step and builds at the *Typecheck and build*
step after it, and the Guards job runs no `npm ci` at all — so a bootstrap module
importing `dist` would be importing something that does not exist yet on one job
and can never exist on the other.

So the question is not *which module do both use*. It is **what is the rule, and
where is it written down** — which this project has a named discipline for, from
invariant 27's own paragraph: *copy only where the reader cannot reach the
source, and a copy that exists must be proven equal.*

## Decision

### 1 — Invariant 9 states the four guarantees, and this document is the writer of record

It read *"Downloaded executables are hash-verified before any parser touches
them"*, which is one of the four and is also narrower than what the code does on
two axes: the subject is every fetched artefact rather than executables, and the
digest is the last of four checks rather than the only one.

The amended invariant carries all four — HTTPS only · host-locked on every
redirect hop · a ceiling counted from received bytes, never from
`Content-Length` · SHA-256 verified in quarantine before any parser touches the
bytes — and names the two derived forms. That is invariant 27's shape exactly,
and for its reason: the value of pinning a rule is that loosening it becomes a
diff in *this file* that someone has to justify, which only works if this file is
the authority.

### 2 — The bootstrap layer keeps `scripts/lib/fetchVerified.mjs`

Unchanged, and it stays plain `.mjs` under §1.1. What changes is its header,
which named *"the on-demand OCR runtime"* among its future callers. That claim
was false when it was written and is corrected in the body rather than appended
to, a comment being the kind of document that is edited.

### 3 — The application gets `packages/kernel/src/verifiedDownload.ts`

Placed by asking both of §1's axes, because they agree here and the agreement is
worth writing down rather than assuming:

- **Subject.** Its first caller is the OCR runtime's cache, and OCR's kernel
  modules are where that concern lives. It is not tooling and it is not shell.
- **Mode** ([ADR-0024](0024-execution-mode-is-a-placement-axis.md)). It executes
  in `main`, where Electron's APIs are present — so `apps/desktop/` would be
  *permitted* by the mode axis rather than required by it. It needs none of
  those APIs: `fetch`, `node:crypto`, `node:fs` and `node:stream`, all of which
  the kernel already uses. `packages/nodemode` is wrong for the opposite reason
  — its subject is code whose runtime is Node mode, and this runs in Electron's.

It binds no engine, so it is exported from the kernel barrel without touching
ADR-0026's discipline: `proof:kernelload` covers that, and covers it by measuring
what the barrel loads rather than by anyone remembering this sentence.

### 4 — A copy that exists must be proven equal, and equal means BEHAVIOURALLY

One proof drives **both** implementations through one table of cases — each
guarantee with a control, and each control built from an input the absent guard
would let through. It is named `proof:verifieddownload` and it lands in the
commit that builds the kernel's form, not in this one: this is the amendment,
and nothing is built on it here.

That last clause is the whole design. A negative probe whose input would fail
anyway cannot tell a working guard from a deleted one, so every refusal case here
serves bytes that are **correct in every other respect**: the right digest, under
the ceiling, from a fetch that would have succeeded. The `http://` case would
download cleanly if the scheme check were removed; the redirect case's second hop
serves the pinned bytes; the ceiling case's `Content-Length` header claims a size
that clears the limit while the body does not.

And for the guarantees where an *end state* is ambiguous, the case asserts the
**decision**: the scheme refusal asserts that the injected fetch was never
called, and the digest case asserts it was called exactly once, because a
mismatch retried is *downloading until the hash matches* on the one check that
stands between a pin and whatever the host served.

## Rejected

**Moving the rule into a package.** The route the row's own question named
first, and it inverts §1.1: the bootstrap layer would import the thing it
bootstraps. Measured above — on the CI job that provisions, `dist` does not exist
at that step; on Guards it never exists.

**Shipping `scripts/` with the application.** It puts the git hooks, the
provisioners and the launcher inside the installer, and it walks straight into
invariant 26, whose whole reason for keeping the launcher in `scripts/` is that
the directory is outside both enforcers — ESLint's boundary rules are per-package
and the main-guard scan's root stops there. A directory deliberately outside
every boundary check is the last one to ship.

**Generating one form from the other at build time.** A build step cannot run
before the build, which is the same objection with an extra artefact. It also
puts a generated file in the tree that a reader cannot tell from an authored one.

**Comparing the two implementations as text.** This is the vacuous shape the
audit checklist names: two implementations in two languages compared as strings
agree only by accident, and a comparison that moves both sides together is
indistinguishable from absence. The equality that matters is what each *refuses*.

**One implementation, tested once, with the second trusted.** It is what a
reader assumes is happening whenever two files state one rule. Each guarantee's
case runs against both, and the roster's count is a literal, so an implementation
dropping out of the table is a red proof rather than a smaller number.

## What this does not claim

The two forms are not proven **identical**: retry policy, backoff, the
quarantine's filename and the error text are each implementation's own, and only
the four guarantees are pinned. That is deliberate — pinning the message text
would make a reworded error a law change — and it means a difference outside the
four is a difference nothing here reports.

The SSRF guard Part C8 requires for **user-supplied** URLs is still not written,
and this does not write it. Both forms take a compile-time host list, where
host-locking *is* the guard; a URL a document or a user chooses is a different
threat and gets its own decision when a feature accepts one.
