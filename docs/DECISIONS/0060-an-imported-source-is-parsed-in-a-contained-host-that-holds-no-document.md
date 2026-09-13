# 0060 — An imported source is parsed in a contained host that holds no document

Accepted 2026-09-13.

## Context

Stage 8 opens on D9, and D9's first row is *Markdown → PDF (new or append)*. §3's
matrix already names the writer — *"Content composition: new document generation
(markdown/CSV/TOC/image-to-PDF)"* is `@cantoo/pdf-lib`'s — so the row looked like a
registration. It is not, because of **where the source is read**.

**The threat model settles the placement before any parser is chosen.**
`docs/security/THREAT-MODEL.md` §2 lists what `main` must not reach: *"Native engine
code (invariant 20). Document parsing of any kind"*. A Markdown file a person picks
is input whoever wrote it chose, exactly as §1.1's PDF is. Nothing in §1 listed it,
and nothing in §2 said which process reads it.

So the row cannot be registered into the seam as it stands, and B4 applies.

## What was measured, 2026-09-13

A scratch tree outside the repository installed three parsers at their registry
`latest`: `marked` 18.0.13 (MIT, no dependencies), `markdown-it` 15.0.2 (MIT, six
dependencies) and `micromark` 4.0.2 (MIT, seventeen). Each was run on eight inputs,
**one parser and one input per process**, under `--max-old-space-size=512` and a
90-second limit, so that one parser's abort could not hide another's result. The
first attempt ran all three in one process, and `marked`'s abort ended it at its
third input, the nested list — the second, nested quotes, had thrown a `RangeError`
the probe caught. That is why the second design was needed.

| input | `marked` | `markdown-it` | `micromark` |
|---|---|---|---|
| ~1 MiB of ordinary prose — the control | 467 ms | 385 ms | 2,572 ms |
| 20,000 nested `>` | threw `RangeError` (stack) | 12 ms | 1,651 ms |
| 2,000 levels of nested list | **heap exhausted, Node aborted, exit 134** | 64 ms | **past 90 s** |
| 100,000 unclosed `*a` | 17,950 ms | 361 ms | **past 90 s** |
| 100,000 unclosed `[` | 199 ms | 498 ms | 523 ms |
| 100,000 backticks | 2 ms | 13 ms | 29 ms |
| 100,000 `\|a` | 21 ms | 17 ms | 58 ms |
| 20,000 reference definitions | 151 ms | 489 ms | 3,006 ms |

In an unbounded first run `marked` reached a 2 GB heap on the nested list before
V8's fatal error. `markdown-it`'s two nesting cases answered 200 and 347 tokens,
which is its `maxNesting` of 100 stopping the descent; its `html` and `linkify`
options are both `false` by default. `npm audit` reported no advisories in the tree
holding all three, nor in one holding `markdown-it` alone. `markdown-it`'s closure is
seven packages, each shipping its licence text: five MIT, `entities` BSD-2-Clause,
and `argparse` PSF-2.0 — imported only by its command-line tool, never by the
library.

**What the measurement changes is not only the parser.** *A JavaScript throw is
catchable in the process that made it* is ADR-0039's reason that pdf-lib may run in
`main`. A heap exhaustion is not a throw: V8 aborts the process and no handler runs.
So *pure JavaScript* is not by itself a reason a parser of hostile input is safe
in the process that holds every open document.

## Decision 1 — a file picked for import is parsed in a contained process, never in `main`

The source is attacker-controlled, and §2 already says `main` parses nothing. The
measurement is why this is not a formality: the cheapest parser available ends the
process that reads a crafted file, and no bound written around the call reaches
that ending.

## Decision 2 — that process is a third engine host, through the one host body

§3's *one host body, parameterised by engine* already describes it. What a third
host owes is what ADR-0048 found the second one owed, and each of these is taken
from there rather than re-derived:

- **Its own AppContainer profile.** `EngineHostKind` gains `compose`, and
  `ENGINE_HOST_CONTAINER` and `ENGINE_HOST_ENTRY_FILE` are `Record`s over that kind,
  so the moniker and the entry script are compile errors until written. *The
  separation is in the principal, never in the process count* — a compose host
  sharing a moniker would read every area the other hosts are granted.
- **Its own containment verdict,** taken of its own token at its own start.
- **Built at the first import,** not at startup and not at open: most sessions never
  import, and a `CreateProcessW`, an AppContainer and a job object are not free.
- **An ending that affects no open document.** It holds no document session, so it
  does not call `onEngineHostEnded`, exactly as PDFium's host does not. **This is the
  reason it is not the MuPDF host**: that host's ending poisons every open document,
  and a crafted import would then break every tab.

## Decision 3 — it owes the probe and a granted area, and none of the three command channels

ADR-0048 Decision 2 holds here unchanged: **what a host holds is a granted AREA**,
never directories carried per call, because a call that named its own directories
would be a channel through which a confused `main` could redirect bytes. So the
compose host owes:

- `engine/probe-containment`, whose schemas are module-level — `pathSchema` and
  `probeOutcomeSchema` — and parameterised by nothing;
- `engine/open` and `engine/close` in the **byte-image wire's** form, which
  registers a granted area and releases it. `byteImageWire` gives `open` no extra
  fields and no declared failures, and parses nothing.

It owes none of `engine/apply`, `engine/capture` or `engine/invert`. Those three
carry an engine's command union, derived per writer from the routing table, and a
compose host is not a writer: it changes no open document. A host that declared
them and stubbed them would be a process answering questions with nothing behind it
— ADR-0048 Decision 1's sentence, one host further on.

Today all six are built inside `coreEngineChannels`, which is parameterised by the
command schemas. The probe and the byte-image `open` and `close` are not, so they
move to definitions the writer factory and the compose set both take. One
definition of each, three hosts.

## Decision 4 — what crosses is names and counts, never bytes or a tree

`engine/extract`'s shape, which already writes a new document inside a host:

- **Main writes the source** into the area's snapshot directory, the one the host
  holds read on, under a name main chose.
- **The host writes the composed PDF** into the area's output directory, under a
  name main chose.
- **The answer is a byte count or a declared refusal.** Main compares the count
  against the file it reads, which separates *the host wrote nothing* from *the read
  found nothing*.

No path, no token tree and no document bytes travel on the pipe.

## Decision 5 — the composed PDF enters only by routes an opened file already takes

The output is a PDF, and it becomes part of the application the way any PDF does:

- **New:** written to a destination the person picked, then opened through
  `DocumentService.open` — where MuPDF's host parses it, as it parses every file.
- **Append:** combined with the open document through ADR-0040's `mergeDocument`,
  which names a second document by `DocId`.

**Not verified here, and named so:** whether `main` can hold a composed document
open for one merge without a tab the renderer knows about. That is the row's to
measure. If it cannot, append is a separate question, not an exception to this
decision.

## Decision 6 — the Markdown parser is `markdown-it`

It is the one of the three that bounded every input above, and its bound is its
own `maxNesting` — a rule the parser owns, not a depth pre-check this repository
would write as a second opinion about Markdown's grammar. The input byte limit is
the row's, chosen against the table above.

## Rejected

- **Parse in `main` with the bounded parser and a byte limit.** It keeps the letter
  of §2 broken, and its safety would rest on one library's nesting rule holding for
  every shape nobody has tried. Heap exhaustion is the failure no catch reaches, and
  `main` is where every open document lives.
- **The MuPDF host.** Its ending poisons every open document; a crafted import would
  break every tab. It would also put a second, unrelated parser inside the principal
  that holds every document's bytes.
- **The PDFium host.** §3 says each entry binds exactly one engine. PDFium's entry
  binds `pdfium.dll` at startup, and its principal holds the editing engine's areas.
- **A worker thread in `main` with `resourceLimits`.** It would turn a heap
  exhaustion into a catchable termination — nothing in this repository sets
  `resourceLimits` today — and it contains nothing else. A thread shares `main`'s
  token, filesystem and network, and invariant 25's four properties are properties
  of a principal.
- **Directories per call instead of an area.** It would spare the compose host
  `open` and `close`, and it is the shape §3 already refuses for a byte-image host,
  for the redirection reason in Decision 3.

## Recorded, not decided

- **ADR-0039's stated reason does not cover every failure.** The byte-image
  `pdf-lib` writer and the signer load the canonical image in `main` for every
  command routed to them, and D2's insert-from-image, routed to `pdf-lib`, embeds a
  picked image there. §2 says `main` parses no document; ADR-0039 argued only
  invariant 20. Whether a crafted PDF or image can drive `pdf-lib` to exhaust
  `main`'s heap is **not measured**. This decision does not move those writers; it
  records that their written justification is narrower than the sentence that
  carries it.
- **A memory budget for a host that holds no document.** §9.17's machine-read line
  names `main`, `mupdf-host` and the renderer. Neither PDFium's host nor this one
  has a line, and no record decides whether a no-session host owes one. The absolute
  bound on both is the job object's `ProcessMemoryLimit`, the one constant
  `ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES`. The question stays open, with its trigger:
  the first time either host's peak is measured against a real import or edit.
- **A Store install.** A contained host is granted nothing under the install root
  (ADR-0023 Decision 16, undecided and unmeasured). A third host is a third process
  in that state. That changes nothing about which route is taken.

## Consequences

- `docs/security/THREAT-MODEL.md` gains §1.9, *Files picked for import*, and a
  `compose-host` row in §2's table.
- §3's content-composition row says where a new document composed from an imported
  source executes, and §3's host-body section says what the third host owes.
- `EngineHostKind`, `ENGINE_HOST_CONTAINER` and `ENGINE_HOST_ENTRY_FILE` gain
  `compose`, and `engineHostPrograms.test.ts`' literal entry list grows by one — the
  anchor a copied moniker would otherwise pass.
- `markdown-it` is a dependency of the kernel's compose entry and must not be
  reachable from the kernel's barrel. **Nothing asserts that today**:
  `proof:kernelload` forbids the two native engines' adapters and no other module.
  The row that installs it owes that proof a third forbidden module, with the same
  positive control the other two have. NOTICE is regenerated in that commit.
- The D9 rows that compose a new PDF from a picked source take this route, not a
  second one.
