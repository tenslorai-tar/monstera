# ADR-0251 — A host reaches its pipe before it loads its handlers

- **Status:** Accepted
- **Date:** 2026-10-17
- **Amends:** [ADR-0023](0023-how-the-contained-engine-host-is-built.md)'s connect bound (`HOST_CONNECT_TIMEOUT_MS`,
  finding YYYY-1), by changing what a host does before it reaches it; [ADR-0048](0048-what-a-second-engine-host-owes-and-what-it-holds.md)'s
  entry shape (an entry composes its channel set and handlers), which now happens after the pipe is connected.
  `docs/ARCHITECTURE.md` §3's engine host paragraph.
- **Decided by:** the owner's addendum 2 of 2026-10-17, item 2: the cold-start failure (two of the walk's first documents
  poisoned on 2026-10-16) is a launch risk; find the mechanism with timings and fix the cause; the deadline is not changed.

## The problem, in one sentence

`main` gives a created host ten seconds to reach its pipe as the line past which *the host is not coming*, and a host
reached it only after its whole module graph was read and evaluated, so the bound measured how long 293 files took to
load on the machine at that moment rather than whether the host had started.

## What was measured

All on this laptop (Windows 11, 11.9 GB), 2026-10-16 and 2026-10-17:

| reading | where | figure |
|---|---|---|
| the MuPDF host's start, in the application | `hostStartWalk.mjs`, 32 starts (idle, both processors busy, 0.7 GB free, a disk and scanner load, just after a build) | runtime ready 44–562 ms; modules evaluated 0.9–2.9 s; engine bound 20–80 ms later; no start missed the bound |
| the same, outside the application | the pinned Electron in Node mode on `hostEntry.js`, three runs | modules evaluated 1,082–1,155 ms, engine bound 37–66 ms later |
| what that phase loads | a `registerHooks` load counter, same command | **293 files** before the entry's first statement: kernel 124, zod 79, node-forge 42, shared 21, contract 16, and 11 more |
| where its time goes | a V8 CPU profile of that run, self time | 1,179 ms sampled: about 300 ms in file calls (stat 115, open 80, lstat 36, close 36, read 41), 190 ms compiling, the rest Node's own loader |
| the two failures | the walks' own folders, `shell.log` and the host files | `text-regression` at 20:48 and 22:48 local, 2026-10-16: both attempts for the first document refused at `no connection within 10000ms`, the second 31 minutes after an unexpected restart (System 6008, 22:14:51) |
| the regression walk since | `textRegressionWalk.mjs`, five runs, 2026-10-17 | 13 of 13 each; no refusal |

The two failures were not reproduced, and they are not explained by an event in any Windows log in either window (every
enabled log was read). What the measurements do establish is the shape: the host's start is dominated by a phase whose
cost is **file I/O over hundreds of files plus compilation**, which is the cost a cold file cache, a busy disk or an
antivirus pass on each opened file multiplies — and the second failure came half an hour after a restart, when the
cache is coldest. The bound had a margin of about three on a warm day for a phase that is not what it is about.

## Decision

**1. Each host entry is a launcher that reaches its pipe before it loads anything else.** Its static imports are the
engine binding and the pipe stream only. It binds its engine library, connects, and then imports the module that
composes its channel set and handlers, handing it the connected stream.

**2. The engine is bound BEFORE the pipe**, as now. A library Windows will not load ends the host with
`ENGINE_UNLOADABLE_EXIT` before it connects, which `main` reads as *could not start on this computer* and not as a death
— a death counts towards poisoning the document (ADR-0023 Decision 9a), so a bind moved past the connection would turn a
missing DLL into a poisoned document. Binding takes 20–80 ms.

**3. The stream holds what arrives before the handlers do.** A request `main` sends while the handlers load waits in the
socket, which stays paused until the body registers for data; an ending in that window is kept and reported when the body
registers for it. Nothing is answered before the handlers exist, and nothing is lost.

**4. The bound is unchanged at ten seconds**, and now covers the runtime's start, the bind and the connect: 0.1–0.6 s in
the readings above. A slow load of the handlers is a slow first answer, which the document's open already shows as
opening.

## Rejected

- **Raise the bound.** It would pass a slow start and keep the bound measuring the wrong thing; and it is weakening a check,
  which the owner reserved.
- **Retry a third time.** The two attempts are the same load on the same machine a second apart; a third is the banned
  reflex of trying again until something passes.
- **Bundle each entry into one file** at build time. It would cut the file calls (about a quarter of the phase) and keep
  compilation and evaluation inside the bound, so the bound would still measure a load, only a smaller one. It is a build
  change for every host and may still be worth having for the first answer's time; it is not what this needed.
- **Node's compile cache.** It would make the cache a file one contained host writes and the next one reads, a channel
  between hosts that invariant 25 assumes may be compromised.

## Proofs

- `hostLaunch.test.ts`: the launcher's order, recorded through its surfaces — bind, connect, then load — and a request
  written before the handlers loaded is answered once they have; **control**: a launcher that loads before connecting is
  refused by the same case, which reads the order rather than the outcome.
- The pipe stream case: data and an ending that arrive before the body registers are delivered when it does; **control**:
  a stream that registers its listeners only on `onData` loses the early ending, and the case says so.
- In the application, `hostStartWalk.mjs` reports `connected at` from the host's own line, which must fall before
  `modules evaluated`.

## Consequences

- The connect bound now means what ADR-0023 said it meant. The handlers' load still happens, after it.
- A host that hangs while loading its handlers is no longer caught by the bound. Loading modules has no hang to fall into
  short of the disk itself, and the first request still waits visibly, as any slow answer does.
- `hostEntry.ts`, `pdfiumHostEntry.ts` and `composeHostEntry.ts` each split into a launcher and a body; the body keeps
  its name's content and the launcher is the file `main` starts, so `main` and the packaging are unchanged.
