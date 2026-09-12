# 0054 — The signing core ships; the placeholder is ours

Accepted 2026-09-12.

## Context

`docs/ARCHITECTURE.md` §3's matrix has held one line about signatures since the
founding record:

> | Digital signatures (PKCS#7) | **@signpdf** | node-forge (verify) |

ADR-0006 executed the matrix's MuPDF and pdf-lib rows and left three named, each
owed by the stage that first runs against that engine. This is the last of them:
Stage 7 is the first stage that signs anything, so it is the first that can run
the row rather than assert it. The gate is in `docs/FEATURES.md` and this is it
being paid.

Two of the three claims the line makes turned out to need checking, and the one
that mattered is not in the line at all.

## What was executed, 2026-09-12

A scratch tree, a self-signed P12 minted with node-forge, a placeholder written
by **this build's own writer** (`@cantoo/pdf-lib`), and the signature verified
without asking the signer whether it had worked.

| | |
|---|---|
| placeholder written by `@cantoo/pdf-lib` | 18,084 bytes |
| signed file | **18,084 bytes** — the signature goes *into* the hole |
| `/ByteRange` after signing | `[0, 1271, 17657, 427]`, and `b + d + hole` is exactly the file |
| PKCS#7 blob | 1,295 bytes in an 8,192-byte hole |
| parsed by node-forge | `signedData`, one certificate, `CN=Monstera Spike`, `O=Tenslor Inc.` |
| signature against the certificate's public key | **verifies** |
| `messageDigest` attribute against SHA-256 of the covered ranges | **matches** |

The last two lines are the row. A signature that "worked" over the wrong bytes is
the failure nothing else here would see, so the digest is recomputed from the two
covered spans and compared with what the signature actually attests.

## Decision

### 1 — The signing core ships: four packages

`@signpdf/signpdf`, `@signpdf/signer-p12`, `@signpdf/utils` and `node-forge`.
Measured: **4 packages installed, every one carrying its own licence file, none
deprecated** — three MIT and node-forge's `(BSD-3-Clause OR GPL-2.0)`.

`node-signpdf` is **deprecated** and says so in its own metadata; the scoped
`@signpdf/*` family at 3.3.0 (published 2025-12-29) is what the founding record's
name now means.

### 2 — THE PLACEHOLDER HELPERS DO NOT SHIP, and that is this ADR's substance

`@signpdf/placeholder-plain` is the obvious way to write a signature placeholder.
Measured in a scratch tree: installing it takes the total from 4 packages to
**125**, because it depends on `@signpdf/placeholder-pdfkit010`, whose peer is
`pdfkit@~0.10.0` — and npm installs peers.

What arrives with it:

- **seven packages shipping no licence file while declaring MIT** — `fontkit`,
  `linebreak`, `dfa`, `brotli`, `buffer-equal`, `magic-string`, `@swc/helpers`;
- **two packages whose licence field is `undefined`**;
- **`crypto-js@3.3.0`, deprecated by its own author**;
- `pdfkit@0.10.0`, from 2019, and a font-shaping stack, to write a dictionary.

That is ADR-0050's refusal exactly, at seventeen times the scale.
`generateNotice.mjs` refuses a NOTICE that drops a package, correctly, and that
refusal is not waivable by an ADR.

`@signpdf/placeholder-pdf-lib` is rejected for a different reason: its peer is
`pdf-lib@^1.17.1` — the package ADR-0006 found cold since 2021-11-06 and which
this build replaced with the `@cantoo` fork.

**So this build writes its own placeholder**, which it is well placed to do: a
signature placeholder is a dictionary, an annotation and an `/AcroForm` entry,
and `@cantoo/pdf-lib` writes all three today for the form rows.

### 3 — The contract between the writer and the signer is a LITERAL TOKEN SHAPE

Measured, and it is the thing the matrix's one line cannot carry.
`findByteRange` requires the array to be **exactly**:

```
/ByteRange [0 /********** /********** /**********]
```

Slot 0 is the string `'0'`; slots 1 to 3 are PDF **name** objects of ten
asterisks. A placeholder written as four numbers — the obvious shape — is refused
with *"No ByteRangeStrings found within PDF buffer"*, which names the wrong thing:
they were found, and they were not the shape it wanted.

Two more constraints fall out of the same execution and are recorded because each
costs a debugging session to rediscover:

- **`useObjectStreams: false`.** The signer locates the `/Contents` hole in the
  raw bytes, so a signature dictionary compressed into an object stream is
  invisible to it.
- **`@signpdf/signpdf` is CommonJS with a `default` export**, so an ESM import
  hands back `module.exports` and the instance is one level in. Getting it wrong
  says `sign is not a function`.

### 4 — node-forge verifies, and the matrix's own words understate it

The column says *node-forge (verify)*, which is right. It is also what **signs**:
`@signpdf/signer-p12` declares `node-forge` as a peer and uses it for the PKCS#12
parse and the PKCS#7 construction. So forge is not the verification half of a
pair — it is the cryptography, and `@signpdf` is the PDF-shaped wrapper around it.

Worth stating because the reading matters for the verification row: verifying a
signature this build did not write needs no `@signpdf` at all.

## Rejected

**`@signpdf/placeholder-plain`.** Measured above: 121 extra packages, seven with
no licence text, one deprecated with weak crypto. Not waivable.

**`@signpdf/placeholder-pdf-lib`.** Peers on the unmaintained `pdf-lib`, which
ADR-0006 already moved this build off.

**`node-signpdf`.** Deprecated by its author in favour of the scoped family.

**Writing the PKCS#7 ourselves with node-forge and no `@signpdf`.** It is four
packages against three, and what `@signpdf` contributes is exactly the part that
is easy to get subtly wrong — locating the hole, rewriting the ranges so they
describe the file they are in, and padding so the length never changes. The spike
measured that the signed file is byte-for-byte the same length as the
placeholder, which is the property the whole scheme rests on.

## What this does not claim

**Nothing here is a timestamped or certified signature.** TSA timestamping is its
own row and the founding record's rule for it is *implemented correctly or not
offered*; certification is another. This row proves a detached PKCS#7 over a
correct byte range, which is what the matrix line says and no more.

**And the certificate was self-signed by the spike.** Chain building, revocation
and trust anchors are the verification row's subject, not this one's.

## Correction, 2026-09-12 — two of Decision 3's three constraints are sharper than written

Both were found by **building the row**, which is the difference between a
spike's reading and a shipped caller's.

### The instance is TWO levels in, not one

Decision 3 says `@signpdf/signpdf` is CommonJS with a `default` export and *the
instance is one level in*. Measured with the package installed:

```
namespace keys:              SignPdf, SignPdfError, Signer, __esModule, default, module.exports
typeof namespace.default:    object
namespace.default keys:      SignPdf, SignPdfError, Signer, default
namespace.default.sign:      undefined
namespace.default.default.sign: function
```

So `module.exports` is what `default` gives, and the singleton is `default`
again inside it. The sentence describes the shape from one side and a caller who
follows it literally gets `sign is not a function` — the exact failure it
warned about.

**What ships takes neither route.** `SignPdf` is on the namespace directly, so
`documentSign.ts` constructs its own instance: no interop reasoning at all, and
it avoids the singleton's `lastSignature`, which is per-instance state two
concurrent signs would share.

### The byte-range shape is a TOKEN requirement, not a byte-exact string

Decision 3 writes the requirement as `/ByteRange [0 /********** /**********
/**********]`. `@cantoo/pdf-lib` serialises an array with spaces inside the
brackets — `[ 0 /********** /********** /********** ]` — and `@signpdf` signs it
without complaint, which the row's own gate case proves by recomputing the
digest over the ranges that came back.

So what the ADR pins is the **tokens**: a number, then three name objects of ten
asterisks, in that order. Four numbers is still refused. The distinction matters
because a caller asserting the literal string would fail against a correct
placeholder, which is how a pinned shape becomes a pinned *formatter*.
