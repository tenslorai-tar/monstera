# ADR-0063 — An Office file is converted by a pinned LibreOffice in a contained process, and the pin is verified twice

- **Status:** Accepted
- **Date:** 2026-09-14
- **Amends:** `docs/ARCHITECTURE.md` §3, adding the Office-import row, and §8, writing the
  external-converter seam's contract into the native-binaries bullet.
  `docs/security/THREAT-MODEL.md` §1.3, §1.9 and §2.
- **Context:** D9's *Office import (LibreOffice)* is the first Stage 8 row whose engine is a
  program this build did not write, and nothing registers one.

## Context

D9's *Office import (LibreOffice)* makes a PDF from a `.docx`, `.xlsx` or `.pptx` a person
picks. The founding record names the engine and how it arrives:

- `BUILD-PROMPT.md`:399–404 lists LibreOffice among the native binaries, provisioned by a
  pinned, SHA-256-verified script.
- The same lines require: spawned without a shell, an isolated LibreOffice profile,
  kill-all-children on quit, and resolved from `app.asar.unpacked` when packaged. So it is
  **bundled**, not downloaded on demand.

**Nothing registers it.**

- `docs/ARCHITECTURE.md` §3's writer-of-record matrix has no row for converting an Office
  file. Content composition is `@cantoo/pdf-lib`'s, which cannot read one.
- The *external-converter seam* is named only in ADR-0013 and `docs/ENGINE-SPIKE.md`, as the
  place Ghostscript and Poppler would join. It is not in the law, and no code implements it.
- The contained host factory as built launches one program. `HostCreationSurface.createSuspended()`
  takes no arguments, and the Win32 surface forces `ELECTRON_RUN_AS_NODE` on every child. It
  creates the Electron binary in Node mode and nothing else.
- Threat model §1.9 already names Office documents as import input — every byte chosen by
  whoever produced the file — and §2 has no row for a process that parses one.

So B4 applies.

## What was read, 2026-09-13 and 2026-09-14

- **Version.** `download.documentfoundation.org/libreoffice/stable/` lists `25.8.7`, `26.2.5`,
  `26.2.6` and `26.8.0`. `26.8.0` is the newest stable.
- **Artefact.** `26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi`.
  - Its mirrorbrain metadata page gives **374,906,880 bytes** and SHA-256
    `4aa6c6e1895f4055104effcb556bd3362d20c6ad707c149543304f395ef9db95`, last modified
    2026-08-24.
- **Signature.** `LibreOffice_26.8.0_Win_x86-64.msi.asc` is a detached OpenPGP signature.
  - Its hashed subpacket names issuer fingerprint
    `C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3`.
  - `keyserver.ubuntu.com` serves that key with uid *LibreOffice Build Team (CODE SIGNING
    KEY) <build@documentfoundation.org>*, RSA 4096, created 2010-10-11.
  - `keys.openpgp.org` answers 200 for the fingerprint and returns no identity.
  - The Document Foundation's own verification page, `/about-us/verify-libreoffice-signatures/`,
    answers 404.
- **Not measured.** Whether the `.asc` verifies against those bytes — that is the download,
  and it belongs to the provisioning commit.

## Decision 1 — Office conversion is LibreOffice's row in §3's matrix

*Office document → PDF (import)*: **LibreOffice, headless, converting to PDF in a contained
process, never in `main`.** Threat model §2 keeps document parsing of any kind out of
`main`, and an Office file is a document. MuPDF, PDFium and pdf-lib read none of these
formats.

## Decision 2 — the external-converter seam is written down, and it is not a fourth engine host

An external converter is **a program this build did not write, run once per conversion, on
one input it was handed, producing one output**. It is not an engine host:

- it holds no session;
- it speaks no pipe protocol;
- it runs no code of ours.

Making it one would put `hostBody.ts`' framing, session table and failure classification in
front of a program that answers none of them.

What it shares with the hosts is **containment**: invariant 25's four terms — lowest workable
integrity, a job object, no network, no filesystem beyond what it was handed. The mechanism
is the same kernel-enforced one, an AppContainer plus a job object, **generalised to launch a
named executable with arguments**, never copied. `createSuspended` takes the executable and
the command line as parameters; the engine hosts pass the Electron binary exactly as today.

The seam's contract, for LibreOffice first and Ghostscript second (ADR-0013):

- **The executable is resolved from the provisioned tree**, never from `PATH` and never from
  an installed copy. This machine has LibreOffice installed, and a converter that found it
  would be running an unpinned build.
- **No shell.** The argument vector is built as a list, and the file names are the granted
  area's own. A picked file's name never reaches a command line; it is copied in under a
  fixed name.
- **One input, one output directory, both granted.** Nothing else is readable or writable.
- **An isolated profile.** LibreOffice's user installation is pointed at a fresh directory
  inside the granted area (`-env:UserInstallation=`), so no setting, macro or extension of the
  person's own LibreOffice is loaded, and none of ours persists.
- **No macros.** LibreOffice's macro security is set to never run macros for the conversion.
  *Opening a document runs none of its content* is invariant 24, and it applies to this
  parser as much as to MuPDF.
- **A time bound and a memory bound**, from the job object. A hung conversion is terminated,
  and its whole process tree with it.
- **Kill-all-children on quit**, from the same job object.
- **The output is §1.1 again.** The PDF it writes opens by the one open route, parsed in the
  contained host.

## Decision 3 — provisioning verifies the pin TWICE, and pins the key by fingerprint

`scripts/lib/fetchVerified.mjs`' four guarantees: HTTPS, host-locked on every hop, a ceiling
counted from received bytes, and SHA-256 in quarantine before any parser touches the bytes.
Plus one this artefact offers:

- **The detached signature is verified against a key pinned by its full fingerprint** in the
  provisioning script, `C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3`, before the bytes are
  unpacked.
  - A signature that does not verify, or verifies under another key, refuses the provision.
  - The key's source is recorded as read: the Ubuntu keyserver's copy, with TDF's own
    verification page gone (404).
- **The check is Node's, and it is one module**, `openpgpVerify.mjs` in the bootstrap layer's `lib`. It implements
  RFC 9580's version-4 subset once, with `node:crypto`: armor and its CRC-24, the packet
  framing, the primary key's fingerprint **computed** as SHA-1 over `0x99 ‖ length ‖ body`,
  and the signature's hashed trailer. It accepts exactly what this artefact is — a v4
  signature of class `0x00`, RSA, SHA-256 or SHA-512, made by the pinned primary key — and
  refuses everything else by name.
  - `gpg` is not the verifier, because it is ambient: Git for Windows ships 2.4.8 here, and
    which build a runner has is not pinned by anything in this repository. It was used once
    as the **independent reading**: a key and signature it made verify, and it agrees on
    the TDF key's fingerprint.
  - Read 2026-09-14 in a scratch probe: gpg's signature verifies. Four refusals each name
    their own rule: a flipped bit in the file, a pinned fingerprint belonging to another
    key, a signature from another key, and the TDF signature over the wrong file. A
    tampered signature value with the 16-bit quick check intact is refused by the RSA
    verification itself, so that line is reached.
- The SHA-256 pin is still the authority on *these exact bytes*. The signature is the
  independent statement that *The Document Foundation built them*. Neither alone is both.

## Decision 3a — the MSI comes from a pinned set of mirrors, because TDF's hosts serve none of it

**Read 2026-09-14, headers only.** `download.documentfoundation.org` answers the MSI with
`302` to a mirror chosen by location (`libreoffice.mirror.garr.it` on that request).
`downloadarchive.documentfoundation.org` does the same (`mirror.faigner.de`). Only the
833-byte `.asc` is served by TDF itself, with `200`.

So *host-locked on every hop* **cannot be met** by following TDF's redirect. The hop that
delivers the bytes goes to a host nobody can name in advance. Loosening the lock to accept
any HTTPS host would be the check that went red, disabled.

**Decision:**
- The provisioner requests the MSI **directly** from a pinned, ordered list of mirrors that
  TDF's own `.mirrorlist` names for this file. Each request is locked to its own one host.
- Chosen: four operated by university and research networks, each answering `200` with
  `Content-Length: 374906880` and no redirect:
  - `ftp.fau.de/tdf/…`
  - `ftp.gwdg.de/pub/tdf/…`
  - `ftp.osuosl.org/pub/tdf/…`
  - `mirror.aarnet.edu.au/pub/tdf/…`
- A mirror that **delivered nothing** moves the provisioner on to the next one: no
  answer, a `5xx` after retries, or a `404` from a mirror that has not synced the file.
- **Bytes that arrived and verified wrong stop the provision**: a digest mismatch, a
  ceiling breach, or a bad signature. It never moves on to the next mirror, for
  `fetchVerified.mjs`' own reason: trying until something matches is downloading until
  the hash matches.
- That split needs the two refusals to be **named**. `fetchVerified.mjs` exports
  `DigestMismatch` and `DownloadTooLarge`, so the loop keys on a class, not on a message.
  `proof:fetchverified` asserts each class. `proof:verifieddownload` compares what the two
  derived forms **refuse**, not what they are called, so the kernel's form does not change.
- A mirror is untrusted by construction. What makes its bytes acceptable is the SHA-256 pin
  and TDF's signature, never the host. The host lock bounds **where this build connects**,
  which is all it was ever for.
- The `.asc` comes from `download.documentfoundation.org`, pinned by its own SHA-256
  (`d8d8a96a…e08f`).

**The key is committed, not fetched.** The public key block is committed at
`scripts/provision/keys/libreoffice-build-team.asc`, and every use **computes** its
fingerprint and requires the pinned one.
- A keyserver's copy carries a `Comment:` header that changes between servers, so a digest
  pin on a fetched key would break with no change to the key.
- An unpinned fetch would put a network read in front of the check that decides trust.
- The file is public text, and it is vetted by that computed fingerprint, not by where it
  came from.

## Decision 4 — the binary is never committed, and its size is stated

`.tools/` is gitignored. The MSI is 358 MiB, and the installed tree will be larger. That is
**the Store package's size question**, and it is stated here rather than settled: bundling is
the founding record's decision (BUILD-PROMPT:399–404), and this ADR does not reopen it. The
provisioning commit measures the unpacked size.

## Unmeasured, and each is the provisioning commit's to read before anything is built on it

1. **Unpacking without administrator rights.** `msiexec /a <msi> TARGETDIR=<dir>` — an
   administrative install — is expected to extract the tree without installing. Not run yet.
2. **Headless conversion from the unpacked tree.**
   `soffice --headless --convert-to pdf --outdir <out> <in>` with the isolated profile, on a
   `.docx`, `.xlsx` and `.pptx` generated in the test (B10: no pasted fixture). Not run yet.
3. **Whether `soffice.exe` starts at all inside an AppContainer** with only the input and
   output granted. It loads fonts, a profile and its own program files. **This is the premise
   most likely to be false**, and ADR-0023 Decision 16's install-root question is its sibling.
   If it does not start, the seam's containment is the open question, and the feature waits.
4. **Whether macro security can be forced off from the command line**, or needs a profile
   `registrymodifications.xcu` written into the isolated profile before launch.
5. **The unpacked size**, for Decision 4.

## Rejected

- **Converting in `main`.** Threat model §2.
- **A fourth engine host running LibreOffice through `hostBody.ts`.** It holds no session and
  speaks no protocol; see Decision 2.
- **The installed LibreOffice on the machine.** Unpinned, unverifiable, and absent on a clean
  Store install.
- **An online conversion service.** It sends the person's document away; nothing in D9 asks
  for that.
- **SHA-256 alone, without the signature.** It proves the bytes are the ones pinned, not who
  built them. The signature exists and costs one verification.
- **Trusting `keys.openpgp.org`'s copy without an identity**, or a key fetched at provisioning
  time. The fingerprint is pinned in the script, so the key's source cannot change what is
  accepted.

## Consequences

- `ARCHITECTURE.md`:
  - §3 gains the Office row;
  - §8's native-binaries bullet names the external-converter seam and its contract;
  - the amendment log gets a row.
- `docs/security/THREAT-MODEL.md`:
  - §1.9 names the converter;
  - §2 gains a *converter* row: runs LibreOffice; may reach the input and output it was
    handed; must not reach the network, the user's profile, or any document.
- `docs/DECISIONS/README.md` gains the index row.
- **The verifier commit**, before the provisioner:
  - the verifier module, `openpgpVerify.mjs`, with its proof `openpgpVerify.proof.mjs` as
    `proof:openpgpverify` on the Guards job, beside `proof:fetchverified`. Its signatures
    are built in the process (B10), and every refusal case asserts which rule refused.
  - `fetchVerified.mjs` exports `DigestMismatch` and `DownloadTooLarge`.
  - The key at `scripts/provision/keys/libreoffice-build-team.asc`, checked by its
    computed fingerprint in that proof.
- **The provisioning commit** writes the LibreOffice provisioner, `libreoffice.mjs`: download, SHA-256,
  signature against the pinned fingerprint, unpack. It reads unmeasured items 1–5 above and
  records them in a dated correction to this ADR. **No feature commit before those readings.**
- **The feature commit** generalises `createSuspended`, adds the converter surface, and
  builds the Office import row, with the pair and a control.

## Correction, 2026-09-14 — what the provisioning run measured, and the item it could not

The first run of the LibreOffice provisioner read the five items this ADR left
unmeasured. Two are answered, one is blocked on something this machine does
that nothing here can see, and two are not reached, because the blocked one
gates them.

### Answered

- **Download and verification work as decided (Decisions 3 and 3a).** A pinned
  mirror served the MSI directly. SHA-256 matched the pin, and TDF's detached
  signature verified under the pinned key, through the verifier module, before
  anything unpacked it. The 833-byte `.asc` came from
  `download.documentfoundation.org` against its own digest.
- **Item 1: an administrative install unpacks without elevation.** `msiexec /a
  <msi> /qn TARGETDIR=<dir>` exited 0 from a shell at *Medium Mandatory Level*.
  Read through `whoami.exe /groups`: Administrators is present in the token but
  not enabled.
- **Where the executable lands.** It is `program\soffice.exe` directly under
  `TARGETDIR`, not `LibreOffice\program\` as the provisioner first guessed. The
  guess failed the first run at its last line, which also exposed a publish-order
  defect: the tree was renamed into place before it was confirmed. Both are fixed
  in the provisioner commit.
- **Item 5: the unpacked tree is 1,596,517,458 bytes in 19,421 files** (`du -sb`,
  2026-09-14). That includes a 19.8 MB administrative-image `.msi`. It is the
  Store-size figure Decision 4 said this run would supply, and it is recorded
  here, not decided.

### Blocked: item 2, headless conversion

`soffice.com --headless --convert-to pdf` **crashes `soffice.bin`** on this
machine, every time. It exits 0 and writes nothing, and the Windows Application
log records the crash:

| | |
|---|---|
| provisioned 26.8.0.3, six attempts 04:59–05:04 | `APPCRASH`, `KERNELBASE.dll`, exception `0x00000000`, offset `0xc41ca`, one fault bucket |
| the machine's installed 26.2.3.2, as a control | `ucrtbase.dll`, `0xc0000409` (fail-fast) |
| `--version` on both | prints and exits 0 |

Each of these was measured and ruled out:

- **Git Bash's argument layer.** PowerShell crashes the same way.
- **A missing environment variable.** PowerShell carries all of them.
- **A first start on a fresh profile.** The profile is populated, and later
  runs crash too.
- **The input format.** `.txt`, `.txt` with an explicit filter, and `.fodt` all
  crash.
- **The administrative-image tree.** The installed build crashes as well.
- **This session's command sandbox.** Disabling it for one command crashed in
  the same bucket.

Each attempt got past profile creation and made a `lu*.tmp` directory before
dying.

**This is a symptom, and it is not recorded as a cause.** *LibreOffice cannot
convert on this machine* is not the finding. The finding is that two builds
crash in different system modules from every context this session can launch,
and that the reason is not visible from here. The question that separates the
remaining explanations is the owner's: whether the installed LibreOffice
converts a file headless when started from their own session.

### Not reached

- **Item 3, the AppContainer start.**
- **Item 4, forcing macros off.**

Both need a conversion that works outside containment first, and there is none
yet. **No feature commit before they are read**, as the Consequences section
already requires.

## Correction, 2026-09-14 afternoon — item 2 is read: headless conversion works, and the morning's crash is unexplained

The owner returned the question above: their installed copy crashes too, so the
investigation is ours, and the AppContainer is not the cause. Every conversion
this afternoon, 13:20–13:35, exited 0 and wrote a PDF. Each run varied one thing
the morning's crashing runs had:

- the launcher, `.com` or `.exe`;
- the flags;
- a fresh profile, a copy of the default profile, or a copy of a morning profile
  that crashed;
- an ASCII input, or the morning's own non-ASCII input;
- the provisioned 26.8.0.3, or the installed 26.2.3.2.

The machine showed no change across the gap, as far as can be read:
- no restart, hotfix or runtime install;
- no Defender or Resource-Exhaustion-Detector event;
- no `soffice.bin` fault after 05:04.

The table and every reading are in `docs/JOURNAL.md` under this date.

**Item 2 is therefore read as working, with the premise stated rather than
claimed:** the morning's crash is not explained, and the minidump that would name
its exception is unread for want of a debugger. If it recurs, those controls are
the first thing to repeat. **Items 3 and 4 are now reachable**, and they still
come before any feature commit.

## Correction, 2026-09-16 — item 3 is attempted, and what it measured is that Decision 2's generalisation is UNBUILT

Item 2 was re-read first, because a premise two days old is a premise: same
command, fresh `-env:UserInstallation=`, exit 0, a 16,191-byte `%PDF-1.7`.

Decision 2 says the containment mechanism is *"generalised to launch a named
executable with arguments, never copied"*, and that `createSuspended` *"takes the
executable and the command line as parameters"*. **In code it does not yet.**
`win32HostSurface.ts` prepends three Node interpreter flags to every child's
command line — `--preserve-symlinks`, `--preserve-symlinks-main`,
`--no-stdio-init`, each with its own measured reason about Node under a LowBox
token — and forces `ELECTRON_RUN_AS_NODE=1` into the environment of everything it
creates. Its `executablePath` is branded `ElectronBinaryPath`, which says the same
thing in the type.

Measured 2026-09-16, `scripts/research/libreofficeContained.mjs`: four cells, each
with its own session directory pair DACL'd to this user and the container SID, the
input written in under a fixed name, and the profile inside the writable half.

| cell | launcher | contained | outcome | the child's own diagnostic |
|---|---|---|---|---|
| 1 | `soffice.exe` | no | no PDF; still running at 45 s | *(empty)* |
| 2 | `soffice.com` | no | no PDF; exited | `Error in option: --preserve-symlinks` |
| 3 | `soffice.bin` | no | no PDF; exited | the same |
| 4 | `soffice.bin` | **yes** | no PDF; exited | the same |

**The contained cell fails exactly as the uncontained ones do.** That is what the
uncontained control is for: this run measures the command line this repository
builds, and says nothing whatever about whether an AppContainer would have let
LibreOffice start. **Item 3 remains UNREAD.** Cell 1 is worth its row — the GUI
front end reports nothing at all and stays alive, so a reading taken through
`soffice.exe` alone would have produced a timeout with no diagnostic and no cause.

**What the run does settle:** the pinned tree needs an ACE of its own.
`containerGrants.mjs` now carries `libreOfficeRoot(root)` at `RX`, **not required**
— a checkout that has not provisioned LibreOffice offers no Office import, which
is a decided state rather than a machine that cannot start a host — and
`proof:containergrants`' hand-kept optional list names three rather than two.
That list is kept by hand on purpose (audit item 4c): the danger is an entry
quietly becoming optional, which a derived set would agree with.

**What item 3 needs before it can be attempted again:** the interpreter flags and
`ELECTRON_RUN_AS_NODE` conditioned on the child being the Electron binary in Node
mode, rather than applied to everything the surface creates. That is Decision 2's
own wording arriving in code, it touches a security-sensitive module with its own
proofs and acceptance test, and it is therefore its own commit — before any
further attempt at items 3 and 4, and before any feature commit.
