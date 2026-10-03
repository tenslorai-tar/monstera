# ADR-0148 — Signing's parse runs in the MuPDF host, and `main` keeps only the key and the byte ranges

- **Status:** Accepted
- **Date:** 2026-10-03
- **Decided by:** the owner, 2026-10-03, on the code review of c89e7266 (CR-SEC-16): *"signing's parse moves out of
  main into a contained host (ADR first), like ADR-0121. The signature picture is decoded there too."*
- **Takes the trade [ADR-0121](0121-main-never-holds-two-images.md) left open** in *What stays in `main`, said so*:
  signing trades the budget against key custody, *"and that trade is the owner's."* It is taken here.
- **Amends:** `docs/ARCHITECTURE.md` §3's digital-signatures row, which names the writer and not where it runs, and
  `writerShapes`' `signpdf: 'byte-image'`.
- **Keeps:** invariant 25's premise that a host is hostile, so it never holds the private key or the passphrase; §9.17's
  `main` *"never parses"*; [ADR-0054](0054-the-signing-core-ships-and-the-placeholder-is-ours.md)'s placeholder and its
  literal token shape; [ADR-0058](0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md)'s
  timestamp port, which stays in `main`'s composition.

## The problem, in one sentence

`signpdfWriterWith` is registered as a byte-image writer in `main`, so `withSignaturePlaceholder` calls
`PDFDocument.load` on the whole document, `embedPng` and `embedJpg` decode the signature picture, and `@signpdf` scans
the whole file for its placeholder, all in the process that holds the filesystem, the keychain and the private key.

Read 2026-10-03: `documentSign.ts` `withSignaturePlaceholder` → `openWhole` → `PDFDocument.load(image, …)`;
`embeddedPicture` → `document.embedPng` / `embedJpg`, whose own comment says *"this decode runs in `main`"*;
`SignPdf.sign` → `findByteRange`, `indexOf('/Contents ')`, `indexOf('<')`, `indexOf('>')` over the whole buffer
(`@signpdf/signpdf` 3.x, `dist/signpdf.js`).

## Where the cut is, read from `@signpdf`'s own code

`SignPdf.sign(pdf, signer)` is one call with two halves:

1. **No key.** Find the `/ByteRange` placeholder, find the `/Contents` hole after it, compute
   `[0, hole start, hole end, length − hole end]`, write those numbers over the placeholder padded to its length, and
   cut the hole out of the bytes.
2. **The key.** `signer.sign(bytes outside the hole)`, refuse a signature larger than the hole, hex it, pad it with
   zeros to the hole's length, and write it between the hole's brackets.

The first half is the parse and the scan; only the second needs the certificate, and it needs no parse at all: the
ranges are four numbers.

## Decision

1. **`signpdf` becomes a hosted writer on the MuPDF host**, as pdf-lib did (ADR-0121 Decision 3): `writerShapes` says
   `'hosted-image'` and `hostedOn` says `'mupdf'`. The bus hands its execution the MuPDF session, and `main` never
   serialises the document for it.
2. **The host prepares; `main` signs.** A new channel, `engine/prepareSignature`, runs beside the session: the host
   serialises it, writes the placeholder and the appearance with pdf-lib (the picture is decoded here), then runs
   **`@signpdf`'s own `SignPdf.sign` with a signer that answers no bytes**. That is half 1 exactly, by the library's
   own rule, and its output is the prepared file: ranges written, the hole all `0`. The host writes it to its output
   directory and answers the count and the four numbers.
3. **The credential never crosses.** The wire command is `signDocument` with `bytes` and `passphrase` removed, so the
   host's schema cannot hold either. The picture crosses as an asset, by `engine/applyPdfLib`'s door.
4. **`main` checks the ranges against the bytes, never by scanning them.** It takes the prepared file out of the host's
   area by the one taker (`takeAnnounced`: a regular file of exactly the announced size, removed whatever happens), so
   nothing the host writes afterwards reaches the signature. Then, in time proportional to the hole and not to the
   document: `byteRange[0] = 0`, `byteRange[1] < byteRange[2]`, `byteRange[2] + byteRange[3] = length`, `<` at
   `byteRange[1]`, `>` at `byteRange[2] − 1`, and between them exactly twice the reserved length of `0`. A host that
   answers anything else is refused by name.
5. **One fill.** Half 2 is spelt once, in `main`'s signing module, and its proof runs `@signpdf`'s `SignPdf.sign` over
   the same placed bytes with the same signer output and requires the two results to be byte-identical. So `main`'s
   half cannot become a second opinion about where a signature goes without a red case.
6. **`main`'s signing module cannot reach the parser.** The placeholder writer moves to its own module, loaded by the
   host on demand; `main`'s signer imports neither it nor `@cantoo/pdf-lib`, and `proof:hostload` is extended to say
   so from the emitted JavaScript.

## What stays in `main`, said so

- **The PKCS#12 parse and the PKCS#7 build** (`@signpdf/signer-p12` over node-forge): that is the credential, and
  holding it is the point. Invariant 25 forbids the alternative.
- **The timestamp reply's parse** (`acceptTimestampReply`): it is an answer from a declared authority, verified before
  it is embedded, and not the document.
- **The prepared bytes, for the length of one signature.** `P12Signer` hashes a buffer, so `main` reads the prepared
  file to sign it. That is a read and not a parse, and it is still a second image beside the canonical one while it
  lasts: this ADR does not bring signing under §9.17's 1.5× budget, and claims nothing about it. A signer that takes a
  digest computed in a stream would; it is a different library question and is not decided here.

## Rejected

- **The key in the host.** Invariant 25's premise is that the host is hostile; a host that holds the key can sign
  anything.
- **A signing host of its own, holding no document**, as the compose host does (ADR-0060). The placeholder is written
  on the session's own serialise, which is beside the session already; a third process for one command is a copy of
  the host body's lifecycle, which §3 forbids.
- **`main` finding the ranges itself.** That is `findByteRange` and three `indexOf`s over the whole file: the scan this
  ADR exists to move.
- **Trusting the announced ranges unchecked.** The check is a few comparisons and the hole's bytes; without it a host
  could hand `main` ranges that leave part of the file unsigned while the signature still reads as covering the
  document.
- **Splitting `@signpdf` by patching it.** Its range step runs unmodified in the host; only the fill is ours, and a
  proof holds it to the library's.

## Amendment only

Nothing is built on this in the commit that records it.
