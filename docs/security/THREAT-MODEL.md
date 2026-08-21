# Threat model

**Status:** first full version, 2026-08-18. Written before `DocumentService` and
`CommandBus`, deliberately — four of its requirements are properties of those
components, and building them first would turn all four into restrictions fitted
underneath finished code.

This document is the source. Every security item in `docs/FEATURES.md`, every
security invariant in `docs/ARCHITECTURE.md` §9, and every entry in
`docs/security/engine-advisories.json` carries a reason that resolves to a
section here. An item without one is either unnecessary or evidence that this
document is incomplete.

---

## 1. What an attacker controls

Ordered by how much of it there is and how routinely it arrives.

### 1.1 The opened document — the primary surface

Everything else on this list is a rounding error beside it. A PDF is a container
format with an object graph, embedded streams, embedded files, embedded
JavaScript, external references and its own compression codecs, and every byte of
it is chosen by whoever produced the file. Users open documents from email, from
the web, and from shared drives, which is the whole purpose of the application.

**Assume every document is hostile.** Not "may be" — the design must not have a
path that is only safe for well-formed input.

Sub-surfaces, each parsed by different code:

| Surface | Parsed by | Note |
|---|---|---|
| Object graph, xref, streams | MuPDF (PDF handler) | The bulk of it |
| Embedded images | MuPDF codecs — libjpeg, openjpeg, jbig2dec, zlib | Attacker picks the codec by choosing the filter |
| Fonts | FreeType, HarfBuzz; CFF subsetting on export | CVE-2026-7233 and Artifex 709567 both live here |
| Embedded JavaScript | MuJS | See §4.2 — must never execute on open |
| Embedded files / attachments | MuPDF, then whatever opens them | See §4.6 |
| Content chosen by the FILENAME | handler dispatch | Closed — see §4.1 |
| Images fed to OCR | **Leptonica** | See §4.3 |
| OCR language models | Tesseract | Trust boundary differs — see §4.3 |

### 1.2 Update feeds

The updater fetches a manifest and a payload over the network. An attacker with
network position, or control of the distribution host, controls both. The worst
outcome is code execution as the user, persistently, with no document involved.

### 1.3 Provisioning downloads

Build-time rather than run-time, but the same shape: `scripts/provision/*` fetch
archives and executables. This is developer-machine and CI compromise, and it
reaches every subsequent release. Already mitigated by pinned-hash verification
before any parser touches the bytes (invariant 9); the archive **extraction** path
is not yet (§4.6).

### 1.4 Cloud provider responses

Any cloud storage integration returns bytes and metadata under someone else's
control — filenames, sizes, redirects, and document content that is §1.1 again
with an extra hop.

### 1.5 AI provider responses

Model output is untrusted input. It arrives as text that may be rendered,
inserted into a document, or acted upon. The distinctive risk is that it is
*meant* to influence behaviour, so the boundary between "content" and
"instruction" has to be drawn by us and not inferred.

### 1.6 Clipboard

Arbitrary attacker-influenced content, pasted by the user into a document or a
field. Format-bearing (HTML, RTF, image) clipboard payloads are parsed.

### 1.7 File associations and drag-drop

The OS hands us a path chosen by whatever the user clicked. It selects §1.1 but
also controls the *filename*, which is why a filename must never select
behaviour (invariant 23).

### 1.8 Command line

Arguments from a shortcut, a browser handler, or another application. Chooses
which file is opened and, if we ever allow it, which options are applied.

---

## 2. What each process can reach

Windows-only, Microsoft Store distribution ([ADR-0001](../DECISIONS/0001-agpl-on-the-microsoft-store.md)).

| Process | Runs | May reach | Must not reach |
|---|---|---|---|
| **Main** | Electron main, `DocumentService`, `CommandBus`, `CapabilityRegistry` | Filesystem via `FileHandle`s it minted; child process lifecycle; settings; keychain | Native engine code (invariant 20). Document parsing of any kind |
| **mupdf-host** (utility) | The MuPDF shim, all native parsing | The document bytes handed to it; its own scratch space | Network. Filesystem beyond what it was handed. The user's profile. Other documents |
| **pdfium-host** (utility) | PDFium rendering | Same as mupdf-host | Same as mupdf-host |
| **Renderer** | React UI, PDF.js | Only the contract's IPC channels | Node. Filesystem paths (invariant 2). Any absolute path at all |

**The renderer holds an opaque `DocId` and a `DocVersion`, never a path and never
mutable document bytes.** That is invariant 2, and it is what makes a renderer
compromise a UI problem rather than a filesystem problem.

**The engine hosts are the boundary that matters most**, because they are the
only processes that parse §1.1. See §4.4 — today they contain a *crash*, and
containing a *compromise* is owed.

---

## 3. Worst outcome per boundary, ordered by consequence

The order is the priority order for the work.

| # | Boundary | If it fails | Consequence |
|---|---|---|---|
| 1 | Update feed integrity | Attacker-chosen code runs as the user, persistently | **Total, silent, permanent** |
| 2 | Engine host containment | Memory-safety bug in MuPDF becomes code execution with the app's full privileges | **Total, from an emailed file** |
| 3 | Active content on open | Document JavaScript or an auto-action runs, or an external reference fetches — disclosure of the document's existence at minimum, exploit delivery at worst | **High, and invisible to the user** |
| 4 | Removal completeness (redaction, sanitize) | The user publishes a document believing content was removed when it was not | **High, irreversible, and caused BY us** |
| 5 | Signature verification correctness | A forged or untrusted signature is shown as valid | **High — we assert a falsehood the user relies on** |
| 6 | Egress disclosure | Document content leaves for AI or cloud without the user knowing | **High, and a breach of trust rather than of a boundary** |
| 7 | Extraction path traversal | An archive or attachment writes outside its destination | **High — arbitrary file write** |
| 8 | Crash-recovery sidecar handling | A copy of the user's unsaved document sits somewhere they did not choose, with permissions they did not set | **Medium-high, and persistent** |
| 9 | Bounded work per operation | A crafted file hangs the application indefinitely | **Medium — denial of service, no data loss** |
| 10 | Renderer sandbox / CSP | Renderer compromise, contained to the IPC surface | **Medium, because of invariant 2** |
| 11 | Provisioning integrity | Compromised build inputs | **Total, but pre-release and already mitigated** |

Note the ordering puts **removal completeness above signature correctness**: a
failed redaction publishes data that was already the user's to lose, while a
false signature verdict misleads about someone else's document. Both are lies we
tell; the first has no recovery.

---

## 4. The items, each with its reason

### 4.1 The permitted document-handler set — DONE

`fz_open_document` scores every registered handler against the stream's
**content** as well as the filename and takes the best, and the shim's "not a
PDF" refusal came from `pdf_specifics` *after* that returned. A file that
content-scored as EPUB was parsed by the EPUB handler before being refused.

Fourteen handlers were registered; the set was **inherited from MuPDF's build
defaults, not named by us**. It is now named: PDF only, by build-time
`-DFZ_ENABLE_<FORMAT>=0`, by registering `pdf_document_handler` by name rather
than calling `fz_register_document_handlers`, and by keeping the post-hoc check.
EPUB, SVG, MOBI and FB2 left the binary; HTML and Office remain present but
unregistered.
([ADR-0016](../DECISIONS/0016-the-document-handler-set-is-named.md))

**Reason:** §1.1, §3 row 2. Adding a format is now an ADR.

### 4.2 Active content on open — INVARIANT OWED, §3 row 3

On opening a document, **no embedded JavaScript executes, no automatic action
runs, no external reference is fetched, and no embedded file reaches disk without
an explicit user action.**

This is probably already true, and that is exactly why it is pinned now. MuJS is
linked into the shim (ISC, 1.3.8), so a JavaScript interpreter is present in the
binary that parses §1.1. Nothing today calls it on the open path — and "nothing
calls it today" is the shape of claim this project has twice found to be resting
on a guard that did not exist.

**Reason:** §1.1, §3 row 3. Cheap to pin before the open path grows; expensive to
retrofit after annotations, forms and JavaScript actions land at Stages 3–4.

### 4.3 Leptonica on the untrusted-document path — RECORDED, build at Stage 6

**Leptonica parses image formats.** When OCR becomes reachable it decodes
attacker-controlled image bytes taken directly out of the document, which puts it
on the untrusted-document path — the path this whole document is about.

Tesseract's exposure is *different in kind*, and conflating them gets the
priority backwards. Its two live advisories (CVE-2026-73066, an out-of-bounds
write; CVE-2026-73067, an out-of-bounds read; both AFFECTED in the vendored
5.5.2, both fixed in a 5.5.3 MuPDF 1.28.0 does not vendor) are reached through a
crafted **`.traineddata` model**, which this application ships and an attacker
does not supply. They stay unreachable only while that holds —
[ADR-0014](../DECISIONS/0014-ocr-stays-inside-the-engine.md) constraint 1.

**Reason:** §1.1. Neither is reachable today: no shipped code references any of
the eleven derived OCR doors, and walking forward from all 24 exports reaches
5583 functions and none of them.

### 4.4 Engine host containment — OWED, §3 row 2

Invariant 20 puts native engine code in utility processes so a native fault is
contained. **That contains a crash. It does not contain a compromise.** A
memory-safety bug in MuPDF that reaches code execution currently inherits
everything the process has.

Required, and stated as policy now because the hosts do not exist yet:

- **Lowest workable integrity level.**
- **Job object limits** — memory, process count, no new processes.
- **No network.** An engine host has no legitimate reason to open a socket.
- **No filesystem reach beyond what it was handed**, which the `FileHandle`
  design already expresses.

**Reason:** §1.1 meets §2's engine-host row. This is row 2 of §3, and the highest
item the application itself can fix.

### 4.5 Fuzzing the document input path — OWED, start now

Corpus-guided mutation feeding **open, page walk, render and save**, with crashes
and hangs as failures. A short nightly run that grows. **Every crashing input
becomes a permanent regression fixture**, per B2 — a crash found once and not
kept is a crash found again later.

`scripts/security/makeCffFixture.mjs` is the first seed.

**Reason:** §1.1. This is the check a security researcher asks about first, and
the one a rival runs before publishing a CVE against you. It is also the only
item here that finds defects nobody has thought of.

### 4.6 Extraction path traversal — OWED, §3 row 7

On **every** extraction path, including provisioning: an entry name inside an
archive must not escape its destination directory. Absolute paths, `..`
segments, drive letters, and symlinks all express the same attack.

This is tied to §4.1 and the two must be read together: the risk exists for the
**container formats that are permitted**, so naming the handler set is what
scoped it. CBZ, XPS, EPUB and Office are zip containers, and before §4.1 they
were reachable through content scoring — an attacker-supplied archive reaching a
zip parser in an application that believes it only opens PDF.

Still live regardless of the handler set: **embedded files inside a PDF** (§1.1)
and **provisioning archives** (§1.3).

**Reason:** §1.1, §1.3.

### 4.7 Signature verification — RECORDED, build at Stage 7

Falls under the rule the founding record already applies to TSA timestamping:
**correct, or not offered.** It must validate the certificate chain to a trust
anchor and **report an untrusted chain as untrusted**.

Showing a signer name and "valid" for a self-signed certificate is a security
lie. It is also the exact shape of green check Rule 0's corollary bans — a check
that reports success without verifying what it claims.

**Reason:** §3 row 5.

### 4.8 Egress disclosure — RECORDED, build at Stage 9

Before any document content leaves the machine for AI or cloud, **the user is
told what is being sent and where.**

Key handling is already correct (invariant 12: OS keychain or refused). This is
about the **data**, not the credential — the two are separate failures and
solving one does not touch the other.

**Reason:** §1.4, §1.5, §3 row 6.

### 4.9 Redaction and sanitize completeness — RECORDED, build at Stage 7

Across the **structure tree, XMP metadata, thumbnails and OCR text layers**.

Invariant 19 covers the save *mode* — a removal save is never incremental and
carries zero prior revisions, so the old bytes are not recoverable from the file.
**Nothing covers whether the removal was complete.** A redaction that blacks out
a region but leaves the text in the structure tree, the thumbnail, or an OCR
layer has produced a file that looks redacted and is not.

**Reason:** §3 row 4, the highest-consequence failure this application can cause
by itself.

### 4.10 Crash-recovery sidecar and temp files — RECORDED, build with autosave

Location, permissions and lifetime, all three stated.

**A sidecar holding an unsaved document is a copy of the user's data in a place
they did not choose.** It outlives the session by design, which is the point of
it, and that is also what makes it a disclosure surface.

**Reason:** §3 row 8. Belongs to the per-document state `DocumentService` owns,
which is why it is written before that component.

### 4.11 Bounded work per operation — RECORDED, build with `CommandBus`

A crafted document must not be able to hang the application indefinitely. Every
operation over document-controlled structure needs a bound — page count, object
count, recursion depth, wall-clock — and exceeding it is a refusal, not a hang.

**Reason:** §3 row 9. Belongs to `CommandBus`, which is why it is written before
that component.

### 4.12 The browser shim never reaches a distributed build — RECORDED, SHIP 1.0

`packages/testing`'s browser shim stubs the kernel. In a distributed build it
would be a UI wired to nothing, and worse, a bypass of every boundary in §2.

**Asserted by the existing packaging-test row, not by a separate test.** Both need
a built application to assert against, and building the same harness twice is how
one of them rots.

**Reason:** §2.

### 4.13 The exact CSP, pinned as an invariant — DONE

Not "a CSP is set" — the **exact policy**, pinned, so a later relaxation is a
diff someone has to justify rather than a default nobody re-reads.

`docs/ARCHITECTURE.md` §9 invariant 27 pins eleven directives and is the writer
of record; `apps/desktop/src/windowPolicy.ts` is derived from it and
`proof:rendererpolicy` fails when the two disagree. The policy is read back from
a running Chromium as it received it, and the renderer is observed refusing a
`connect-src` fetch and an `eval` — **enforcement evidence covers two directives
of eleven**, which the invariant states rather than implies
([ADR-0019](../DECISIONS/0019-the-renderers-csp-is-pinned.md)).

**Reason:** §3 row 10.

### 4.14 Engine advisory tracking — DONE

74 advisories across MuPDF, Tesseract and Leptonica, each triaged against the
pinned version **from upstream commit history**, never from CVE text or a
distribution's version mapping
([ADR-0011](../DECISIONS/0011-engine-upgrade-cadence.md)). Untriaged advisories
fail the build. Verdicts resting on a symbol being uncalled expire automatically
when shipped code references it.

**Reason:** §1.1. `docs/security/engine-advisories.json`.

### 4.15 Compiler mitigations — DONE

Verified in the PE image rather than in the build flags: the shipped DLL carries
the mitigations it claims.

**Reason:** §3 row 2 — mitigations are what stand between a memory-safety bug and
code execution, and a flag that did not take effect is indistinguishable from one
that did until it matters.

### 4.16 Source that reads differently than it compiles — DONE

The attacker here is **a contributor**, and the target is **the reviewer** — not
the application, not a document. Bidirectional overrides reorder the glyphs a
reviewer sees while leaving the codepoint sequence the compiler consumes
untouched, so a line that reads as an access check inside a comment is compiled
as a call (Trojan Source, CVE-2021-42574). Zero-width characters do the quieter
half: two identifiers that render identically are different symbols.

`guardFiles.mjs` rejects `U+202A`–`U+202E`, `U+2066`–`U+2069`, `U+061C`,
`U+200B`–`U+200D`, `U+2060`, `U+FEFF` and `U+00AD` in any text file, at both the
staged and tree scopes, so CI sees what the hook sees. Ordinary non-ASCII prose
is explicitly accepted — a control case exists for it, because a guard that
rejected em dashes and CJK would be discovered as broken rather than as wrong.

**Reason:** this project is developed in public under AGPL with outside
contributions expected, and **review is the control** on what enters it. Every
other item here defends the application from a document; this one defends the
review from the source. It also completes the guard's own stated purpose — it
already existed to catch characters *invisible to a reader*, and covered only the
byte range it could see, since these codepoints are all multi-byte UTF-8 and a
byte-wise scan cannot express them.

**Not covered by it:** homoglyphs — Cyrillic `а` beside Latin `a` — which render
*differently in principle* and identically in most fonts. That is a confusable-
script problem needing a normalisation policy rather than a codepoint set, and
listing it here is the honest boundary rather than an implied claim.

---

## 5. What this document does not cover

- **Physical access and malware already running as the user.** Out of scope; at
  that point the attacker has what the application has.
- **The user deliberately opening a document they know to be hostile.** In scope
  — that is §1.1 — but "warn the user" is not a control this document counts.
- **Denial of service by resource exhaustion at the OS level.** §4.11 bounds the
  application's own work; it does not defend the machine.
- **Supply chain beyond pinned hashes.** A malicious upstream release that
  hash-verifies correctly is not addressed here.
