# ADR-0225 — The Electron caller scan reads contained host calls

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

Guards at `6ba1712e` rejected the live app harness. The local
`proof:electronbinary` reproduced exactly one failure: Playwright's
`_electron.launch({ executablePath: electronBinaryPath(root), ... })` had no
contained program kind. That launch starts the desktop application, not a
contained engine host. Adding `runs: 'electron-node'` would describe the wrong
program and is not a Playwright launch option.

The scanner's stated subject is contained hosts, but its assignment expression
collects every `executablePath` property in every script. Its nearest-brace
search then treats all of them as contained programs. The property name alone
cannot identify the API that owns it.

## Decision

Use the installed TypeScript compiler's JavaScript syntax tree to locate calls
whose callee is `createWin32HostSurface`, directly or as a member. Read the
literal `program` object of each call and its literal `runs` and
`executablePath` properties. Keep the existing resolver-to-kind table and the
two subject-file exclusions unchanged. An unrelated Playwright launch is not
a contained host call and contributes no host site.

Every contained-host call must have an inspectable, direct program object and
path. A spread, shared config, missing property or otherwise unreadable call
is reported even when another call in the same file is valid. The site walk
and creator walk retain their independent known-present controls. Syntax-tree
traversal replaces the textual expression scan; no second JavaScript parser
or executable-resolution mechanism is introduced.

## Rejected alternatives

- Exempt the live harness: the next unrelated launcher hits the same defect,
  while any contained host later added to that file would evade the rule.
- Rename, compute or hide the launch property: changes what the scan sees
  without correcting its subject.
- Add a dummy program kind: claims a contained Node-mode host for a desktop
  launch and supplies an option Playwright does not own.
- Skip every file without a textual factory mention: a file containing both
  kinds of launch still fails, and comments can masquerade as factory calls.
- Build a regular-expression JavaScript parser: recreates syntax ownership
  beside the compiler already installed in this repository.

## Consequences and proof

The guard still rejects `process.execPath`, unsanctioned resolvers, wrong
program kinds and unreadable host calls. Its existing refusal, tolerance,
blind-search and CLI cases remain. New cases separate unrelated launches,
mixed launch APIs, multiple host calls and factory mentions in comments or
strings. The actual unmodified app-launch harness must pass. Restoring the old
scan must reproduce its failure, then restoring this correction must pass.

This records the decision before implementation; no scanner code is changed
in this commit. No product command, host runtime or app-launch option changes.
