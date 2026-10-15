# ADR-0248 — A signature is made over a digest read from the prepared file

- **Status:** Accepted
- **Date:** 2026-10-15
- **Amends:** [ADR-0148](0148-signings-parse-runs-in-the-mupdf-host-and-main-keeps-only-the-key.md), *What stays in
  `main`*: *"The prepared bytes, for the length of one signature"*, and its Decision 4's taker; and
  [ADR-0054](0054-the-signing-core-ships-and-the-placeholder-is-ours.md)'s choice of `@signpdf/signer-p12` as what signs.
- **Decided by:** the owner's cloud run 4, item 18 (*"DocuSign and signing streaming"*), and addendum 4's item 1:
  *"Build both, each with a proof and a control."* ADR-0165 names signing as a path that still brings a whole image
  into `main`.

## Where it stood

ADR-0148 left one image in `main` for the length of a signature, and said why: *"`P12Signer` hashes a buffer, so `main`
reads the prepared file to sign it … A signer that takes a digest computed in a stream would; it is a different library
question and is not decided here."* Read 2026-10-15, the cost was more than one image. `remoteSignatureHost` took the
prepared file whole (`takeAnnounced`); `bytesToSign` joined the bytes outside the hole into a second buffer;
`P12Signer.sign` turned that into a binary string for node-forge; and forge's `pkcs7.sign` serialised the content as
DER again to hash it. For a document near `main`'s ceiling that is several times the document, in the process whose
budget §9.17 states.

The library question has an answer in the library. node-forge's `pkcs7.sign` computes the `messageDigest` attribute
from the content it is given and overwrites any value it is handed (`addSignerInfos`, read in
`node_modules/node-forge/lib/pkcs7.js`), and its attribute encoders are private. So no call into either library takes a
digest. What can take one is the structure those calls build, built from the same library's public pieces.

## Decision

1. **`main` signs a digest.** `signedDigest.ts` opens the PKCS#12 credential exactly as `P12Signer.sign` does (forge's
   parse, not strict; the first shrouded key; the certificate whose public key matches it) and builds the detached
   `SignedData` around a SHA-256 computed elsewhere, from forge's ASN.1, its certificate encoder and its RSA signature.
2. **The same bytes as `P12Signer`, or a red case.** RSASSA-PKCS1-v1_5 is deterministic, so `P12Signer.sign(content,
   at)` is one byte string per credential. `signedDigest.test.ts` requires `signedDataOverDigest` to answer that string
   for four contents at two signing times, one inside UTCTime's range and one outside it, with a control that a digest of
   other bytes does not. `P12Signer` stays as the oracle; it no longer signs.
3. **The prepared file is COPIED into `main`'s own storage, never read whole.** A new taker, `copyAnnounced`, holds the
   host's file to its announced size as `readAnnounced` does, copies it from the handle it checked into storage granted
   to no container (`sessionData/taken`, swept at start like the checkpoints), and removes the host's file. Copied and
   not moved: a host that kept a handle on the file it wrote could write through it into a moved file after `main`
   checked it. `announcedOutput.test.ts` writes through such a handle after the copy and finds `main`'s file unchanged,
   with the control that the same handle writes into a file that was moved.
4. **The check, the digest and the fill work on the file in place.** `checkPrepared` reads the hole alone; the digest
   reads the two ranges outside it sixteen MiB at a time; the fill writes the signature's hex into the hole. The signed
   file is then the staged image the bus adopts, moved and never read. ADR-0148's checks are unchanged in what they
   refuse; they read fewer bytes.
5. **A local session signs the same way over bytes in hand** (`preparedInMemory`), so every kernel case drives the one
   path.

## What this costs, said so

`signedDigest.ts` is a transcription of `P12Signer.sign` and forge's `SignedData.toAsn1`, about seventy lines of
ASN.1. Decision 2 is what keeps it one opinion rather than two. A forge or `@signpdf` upgrade that changes what
`P12Signer` writes turns that case red, which is the intended reading: the signature this build writes changed.

## Rejected

- **Patching forge's message-digest object, or its `signers` after `sign`.** Both reach into private state that an
  upgrade can move without a type changing.
- **Writing the CMS with `node:crypto` alone.** It has the key operations and no ASN.1 writer, so the structure would be
  hand-encoded twice over; forge's encoder is the one already shipped and already verifying signatures.
- **Moving the prepared file instead of copying it.** Decision 3's reason.
- **Keeping the whole-file read for small documents.** Two paths for one signature is the second opinion this project
  closes; the bounded path costs a small document nothing it can measure.
