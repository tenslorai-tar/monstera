# Architecture Decision Records

Every amendment to `docs/ARCHITECTURE.md` under rule B4 is recorded here, and
so is every decision a future reader would otherwise have to reverse-engineer
from the code.

## Why these exist

The expensive question in an inherited codebase is never "what does this do" —
it is "why is it like this, and what happens if I change it". An ADR answers
that in the place where it will still be found in three years.

The **rejected alternatives** section is the load-bearing one. A decision
recorded without its rejected alternatives reads as arbitrary, and the next
person re-derives the same options from scratch, or worse, adopts one that was
already ruled out for a reason nobody wrote down.

## Format

One file per decision, numbered sequentially, never renumbered:

```
NNNN-short-kebab-case-title.md
```

Each contains:

- **Status** — Proposed / Accepted / Superseded by ADR-NNNN. ADRs are never
  deleted or edited to say something different; a reversal is a new ADR that
  supersedes the old one, and the old one stays as the record of what was
  believed and why.
- **Date**
- **Context** — the forces at play, including what was actually verified versus
  assumed.
- **Decision** — what is now true.
- **Rejected alternatives** — each with the reason it lost.
- **Consequences** — including the unpleasant ones. An ADR that lists only
  benefits is marketing.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-agpl-on-the-microsoft-store.md) | AGPL-3.0 on the Microsoft Store | Accepted |
| [0002](0002-brand-mark-treatment.md) | Brand mark treatment — composite logo used as supplied | Accepted |
