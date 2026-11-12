# ADR-0293 — The font catalogue is read once by a host that holds no document, and kept for the hosts that do

- **Status:** Accepted
- **Date:** 2026-11-12
- **Decided by:** the owner, 2026-11-12: route A of the local agent's report on the close of 2026-11-11, *keep the
  catalogue between hosts, without deferring it*; written by *a separate reader*, *the existing host body,
  parameterised, as ADR-0060's import host is, never a copy*; *main hands over only the folders and ADR-0237's
  fingerprint and never parses the file*.
- **Amends:** [ADR-0172](0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)
  Decision 2 and [ADR-0177](0177-a-word-a-type-3-page-cannot-draw-is-set-in-the-resolvers-face-or-the-box-by-the-mupdf-host.md),
  under which each host that sets text reads the bundled and installed font folders itself, on first need;
  `docs/ARCHITECTURE.md` §3's host list (three hosts become four).

## Context

The read on open (`document.blockFaces`, ADR-0271 section 5) took 11.6 to 19.1 s in every round on 2026-11-11 and
4.6 to 6.8 s in a faster run, and every write to that document waited for it (ADR-0274). Most of it is the MuPDF
host's first load of the font catalogue, which it makes on its first block read, and hosts end when the last document
closes, so a person who works on one document at a time pays it for each document.

Measured 2026-11-12 on a build fresh for `312597b1` (each script refuses a stale one), this machine:

| reading | figure | instrument |
|---|---|---|
| the catalogue read from the two folders a host is handed | 3,353–5,223 ms, three reads; 521 faces from 455 MiB | `scripts/research/catalogueCost.mjs` |
| its first load through the MuPDF host's binding, five corpus documents | 3,320–3,935 ms | `scripts/research/blockFacesCost.mjs` |
| the read on open once that is loaded | 11–615 ms | the same |
| the same catalogue kept as a file: its size, and its load and rebuild, five times | 1.3 MiB; 116–164 ms | `scripts/research/keptCatalogueCost.mjs` |

A file one host writes and every later host reads would carry a compromise from one document to every later one: a
host taken by a hostile document could write a catalogue that steers which face every later document's words are set
in, until the fonts change. Today a compromise ends with its host (invariant 25). So the writer must be a process no
document reaches.

## Decisions

1. **A fourth engine host kind, `catalogue`, through the one host body** (§3's *one host body, parameterised by
   engine*; ADR-0060 Decision 2's shape, taken rather than re-derived). `EngineHostKind` gains it, so its AppContainer
   moniker and its entry script are compile errors until written; it has its own principal, never a moniker shared with
   another kind; its own containment verdict, of its own token, at its own start; and it holds no document, so its
   ending affects none. It binds no native library: it reads font files through HarfBuzz's WebAssembly build in a thread
   that ends (`readCatalogueApart`), as every host does today.
2. **It owes the probe, a granted area's `open` and `close`, and one channel of its own**, `engine/keep-catalogue`
   (ADR-0060 Decision 3's set, one host further on). None of `apply`, `capture` or `invert`: it is not a writer.
3. **`main` hands it the two font folders and the fingerprint, and nothing else.** The folders are the ones a host is
   handed today (the bundled set and `%SystemRoot%\Fonts`, ADR-0172 Decision 2); the fingerprint is ADR-0237's, over
   the same two folders from `readdir` and `stat`, which `main` already computes for the font list. `main` opens no
   font file and never reads the kept file: it knows the file only by the name the fingerprint gives it.
4. **The kept catalogue lives in its own granted area, written by the catalogue host alone.** One directory under the
   app's session data, which survives between runs; its DACL grants modify to the catalogue host's principal and read to
   the principals of the hosts that set text (MuPDF, PDFium, compose), from `hostDacl.ts` as every handed directory's
   is. The file is named by the fingerprint and written whole, then renamed into place; the catalogue host removes the
   files of other fingerprints after writing. A host that sets text cannot write there, so no document reaches it.
5. **When it runs:** `main` starts the catalogue host once it has the fingerprint, when no file of that name is in the
   area, in the background; it is not on any document's path, and nothing waits for it.
6. **A host that sets text loads the kept file on first need, and reads the fonts itself where it cannot.** It is
   handed the area read-only and the fingerprint. A file of that name is parsed against a schema, and refused unless
   every face's path lies inside one of the two folders the host was itself handed; refused or absent, the host reads
   the folders as it does today. The kept file can only make the load faster, never choose a face the folders would not.
7. **The catalogue is never deferred** (the owner's decision): a host loads it on its first block read as now.

## Consequences

- A block's first read in a host costs the kept file's load, measured at 116–164 ms, instead of 3.3–5.2 s, from the
  second launch after the fonts change; the first launch after a change pays today's cost while the catalogue host
  writes the file.
- One more contained process, started only when the fonts change.
- A hostile installed font reaches the catalogue host, which parses what every host that sets text parses today, so it
  gains nothing it does not have now.

## Rejected

- **The hosts that set text write the kept file.** The cross-document channel above.
- **`main` reads or writes the catalogue.** Threat model §2 keeps font parsing out of `main`, and a file `main` parses
  is the same thing one step on.
- **Keeping hosts alive between documents.** Removes the cost for later documents in a session, not the first, and holds
  a host's memory while idle.
- **Deferring the catalogue until a new word needs a face.** The owner's decision: a face that switches while the person
  types is what the owner notices.
- **A copy of the host body for the reader.** §3: a second host is a generalisation of the first, never a copy.

## Correction, 2026-11-12 — no host writes the kept area, and `main` places the file by copying it

Decision 4 gave the catalogue host modify on the kept area and had it remove the other fingerprints' files. Read
against the area machinery before building it, that needs a directory granted to four principals and a second kind of
area handed to a host, where an ordinary one already does the job:

- **The catalogue host writes into the ordinary area it is handed**, as every host's output goes (ADR-0023 Decision 7):
  a session pair granted to its own principal alone, and swept at startup. `engine/keep-catalogue` takes the session and
  the fingerprint and answers the file's name and the faces it holds.
- **`main` copies that file into the kept area, by the name the fingerprint gives it, and removes the other
  fingerprints' files by name.** A copy, not a rename: a new file takes the kept area's inheritable ACEs, where a
  moved one keeps the output directory's. `main` opens it only as bytes to copy and never parses it; it reads no
  font. The kept area's DACL grants the user full control and read to the three hosts that set text, and nothing to
  the catalogue host.
- **So no host can write the kept area**, the catalogue host included, which is narrower than Decision 4 and is what
  its own reason asks for. The text hosts' side (Decision 6) is unchanged.
- **The fingerprint is `main`'s, computed once a launch** in the background from ADR-0237's listing; a host started
  before it is known is handed none and reads the folders, as every host does today. A font changed during a launch is
  seen at the next one, as a host's catalogue is today seen at its next start.
