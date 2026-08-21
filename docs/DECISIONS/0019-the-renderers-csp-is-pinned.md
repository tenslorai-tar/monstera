# ADR-0019 — The renderer's CSP is pinned, and its one unproven grant is dropped

- **Status:** Accepted
- **Date:** 2026-08-21
- **Amends:** `docs/ARCHITECTURE.md` §2 and §9 (new invariant 27).

## Context

`docs/ARCHITECTURE.md` §2 has always listed "CSP set" among the renderer's
non-negotiables. That is a configuration item, not a policy: it is satisfied by
any header at all, including one that grants everything.

The threat model recorded the gap as §4.13 and deliberately deferred the value —
*"the renderer does not exist and the policy would be a guess; an invariant
relaxed in its first week teaches that relaxing invariants is normal."* The
`docs/FEATURES.md` row that carries the obligation names three requirements: the
exact directive list written into §9 as an invariant, the policy **read back
from the running renderer** and compared to it, and a control proving the
comparison can fail.

Two of the three landed with the window unit: `proof:rendererpolicy` reads the
`Content-Security-Policy` header out of the response as Chromium received it,
observes the renderer refusing a `connect-src` fetch and an `eval`, and carries
a control asserting a policy we do not serve. What was missing is the pin
itself — and without it, the read-back compares the constant against the
constant's own delivery, which no relaxation would ever fail.

## Decision

### 1. The directive list is pinned in `ARCHITECTURE.md` §9 as invariant 27

Eleven directives, one per line, in a fenced block the proof parses.

### 2. The document is the writer of record; the constant is derived

`proof:rendererpolicy` extracts the pinned block and fails when
`CONTENT_SECURITY_POLICY` differs from it, naming §9 as the side to change
first.

**This is the opposite direction from the memory budgets, and the difference is
the point.** `check:docs` fails if §9.17 restates a budget number, because there
the code holds the pen (ADR-0012) and prose would be a second copy. Here the
entire value of pinning is that loosening the policy becomes a diff in the law
that someone has to justify — which only works if the law is the authority.

Both are B3, one writer per concern. **Which side holds the pen is a decision
per concern, not a house style**, and this ADR exists partly so the next person
who finds two opposite patterns does not pick by taste.

### 3. `style-src`'s `'unsafe-inline'` is dropped rather than pinned

The list carried `style-src 'self' 'unsafe-inline'` from the day the header was
written. Nothing in this repository needs it: the renderer document is empty and
carries no `<style>` element and no `style` attribute.

Pinning it would have made an **unproven grant into law by arriving early**.
After the pin, every relaxation must be argued; a grant already inside the pin
never is. That is the exact failure the pin exists to prevent, wearing the
pin's own clothes.

The asymmetry of the two failure modes decided it:

| direction | how it fails | when |
|---|---|---|
| keep a grant nothing needs | **silently** — an injected `<style>` simply works | never observed |
| drop a grant something needs | **loudly** — a console violation naming `style-src`, and the style does not apply | at development time, on the first component |

Rule 0 and B5 both prefer the loud one, and this project's standing rule is that
a limit must be **proven to exist** before anything is designed around it.
"React or PDF.js will need inline styles" is a model, not a measurement.

**The most likely trip is named here so it is recognised rather than debugged:
Vite's dev server injects `<style>` elements for HMR.** When that happens the
response is a measured amendment — possibly one scoped to development, which is
its own architecture question — and not an edit to the constant, which the proof
would reject anyway.

## Rejected alternatives

**Pin all eleven directives as they stood, with a dated trigger requiring the
design substrate to re-examine `'unsafe-inline'`.** This was the first draft. It
is the shape this repository uses for invariant 25's containment trigger, so it
is not obviously wrong — but it is the wrong shape *here*, because a trigger
that fires when the substrate lands fires at precisely the moment the grant is
most convenient to keep. A note that asks a future author to give up something
they are already using is not a mechanism. Dropping it now inverts that: the
grant has to be argued for by whoever wants it, at the moment they want it, with
the failure in front of them.

**Leave the policy in `windowPolicy.ts` and check nothing.** This is what
existed. The read-back then proves only that the header the constant sets is the
header that arrives — true for any policy, including `default-src *`. A relaxation
would pass every check in the repository.

**Put the list in the code and have `ARCHITECTURE.md` reference it, matching the
memory budgets.** Consistent, and it loses the property being bought: a CSP
relaxation would be a diff in a `.ts` file among other `.ts` files, reviewed by
whoever reviews the change that needed it. The budgets are numbers derived from
measurement and belong with the measuring code; a security policy is law.

**Compare the directives as a set rather than as a string.** Chromium does not
care about directive order, so a set comparison is the semantically faithful
one. Rejected because it lets the block be reordered with no diff to read, and
because the tempting repair for a failing string comparison is to sort both
sides — which spends the property to silence the check. Order is part of the pin
as a legibility choice, and §9.27 says so out loud.

**Serve the policy from a `<meta>` tag in `index.html` instead of a response
header.** A meta tag cannot express `frame-ancestors`, and it is written in the
file the renderer bundle rewrites, so the policy would live wherever the build
put it. One writer, and it is the shell.

## Consequences

- Any change to the renderer's CSP is now a diff in `docs/ARCHITECTURE.md` with
  an amendment-log row, not an edit to a constant.
- `proof:rendererpolicy` grows from 2 string cases to 4, and from 5 to 7 where
  an Electron runtime is provisioned. The two new ones run **everywhere**,
  including where the runtime is absent — the pin is checked on every machine
  even when enforcement cannot be.
- Enforcement evidence still covers two directives of eleven. §9.27 states that
  rather than letting "verified against a running renderer" read as complete.
