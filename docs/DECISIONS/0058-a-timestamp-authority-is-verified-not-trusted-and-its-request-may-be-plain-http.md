# 0058 — A timestamp authority is verified, not trusted, and its request may be plain HTTP

Accepted 2026-09-13.

## Context

D7's TSA row carries the founding record's own words: *implemented correctly or
not offered*. `BUILD-PROMPT.md` explains why: *a signing flow that requests a
timestamp and discards the TSA response is decorative*, and B1's corollary bans
that class of feature.

Working the row met the law twice before any code.

**The network rule.** `docs/ARCHITECTURE.md` says *HTTPS only, host-locked per
purpose, with an SSRF guard … for user-supplied URLs*. The widely used timestamp
authorities publish plain-HTTP endpoints only. A timestamp row that obeys the
rule as written can use one volunteer service and nothing else.

**No SSRF guard exists.** Searched 2026-09-13 across `packages/` and `apps/`:
every match for *rebinding* is a PDF.js transport being rebound to a document
version, and nothing implements a private-range blocklist or a DNS-rebinding
pin. So a timestamp server a person types is not buildable today.

Two more facts shape the design:

- **node-forge 1.4.0's PKCS#7 reader refuses a timestamp token.** `_fromAsn1`
  throws *Only wrapped ContentType Data supported*, and a token's content is a
  TSTInfo.
- **The signing apply runs in `main`, and the kernel imports no network.**
  `documentSign.ts` holds no fetch. The recognisers in ADR-0052 and ADR-0057 make
  their calls in the composition root.

## Sources read, 2026-09-13

- **RFC 3161.**
  - A request carries a `messageImprint` (hash algorithm and hashed message),
    an optional `nonce`, and `certReq`.
  - The response's `PKIStatus` is `granted(0)`, `grantedWithMods(1)`,
    `rejection(2)`, `waiting(3)`, `revocationWarning(4)` or
    `revocationNotification(5)`.
  - A nonce in the request MUST be echoed in the TSTInfo.
  - The requester SHALL verify the imprint, the hash algorithm, the TSA
    certificate identifier and the signature.
  - The TSA certificate's extended key usage MUST be `id-kp-timeStamping` alone
    and critical.
  - Media types are `application/timestamp-query` and `application/timestamp-reply`.
  - Appendix A: for a CMS signature the token is the unsigned attribute
    `id-aa-timeStampToken` (1.2.840.113549.1.9.16.2.14), and its imprint hashes
    the SignerInfo's `signature` value.
- **RFC 5652.** §5.4: signed attributes are digested as a DER `SET OF` (tag
  `0x31`), not as the IMPLICIT `[0]` they are carried in. §5.6: the recipient
  MUST NOT rely on the originator's digest values.
- **DigiCert**, *RFC3161 compliant Time Stamp Authority server*, last modified
  04/23/2026: *"The RFC 3161 timestamping URL is http://timestamp.digicert.com"*.
- **Sectigo**, *Time Stamping Server*, dated October 3, 2018:
  `http://timestamp.sectigo.com`, and it asks scripted callers for a delay of 15
  seconds or more between requests.
- **GlobalSign**, *Code Signing for Windows 7, 8 and 10*, dated Jan 6, 2026:
  `http://timestamp.globalsign.com/tsa/r45standard`.
- **FreeTSA**, `freetsa.org/index_en.php`, no date shown: `https://freetsa.org/tsr`,
  content type `application/timestamp-query`.

## Decisions

### 1 — A timestamp request may be plain HTTP, and only a timestamp request

The network rule gains one exception. **An RFC 3161 request may use plain HTTP**,
to a host in the declared authority list (Decision 2), and to nothing else.
HTTPS is used wherever an authority in the list offers it.

The reason is what each protection is for:

- **Integrity.** HTTPS would protect the answer from being altered in transit.
  A token carries its own protection: Decision 3 verifies the authority's
  signature over the TSTInfo, the imprint, the nonce and the certificate's key
  usage. A token altered in transit fails that check, just as it would over
  HTTPS.
- **Confidentiality.** The request carries a hash of a signature value. The
  document never leaves the machine, and neither does the signer's name.
- **What HTTP does NOT give the authority, and does give an observer.** An
  observer on the network learns that this machine asked for a timestamp at
  that moment. That is stated in the dialog's own words beside the option.

This does not widen the rule for any other purpose. A request to a recogniser, a
provider, a cloud store or an update manifest stays HTTPS.

**Invariant 9 does not govern a timestamp reply, and it is not loosened here.**
Its four guarantees — HTTPS, host-locked hops, a ceiling counted from received
bytes, SHA-256 verified in quarantine — are for *artefacts this project
fetches*: bytes pinned by digest before anyone asks for them. A timestamp reply
cannot be pinned in advance, because it is new on every request, which is also
true of a recogniser's answer. What stands in for the pin is Decision 3's
verification, and the reply is still size-bounded by received bytes before it is
parsed, which is invariant 9's third guarantee applied to it anyway.

### 2 — The authorities are a declared, host-locked set

The contract declares the authorities, each with its one URL, as a closed set.
The signing payload names an authority by its id, never by a URL, so a renderer
cannot send a request anywhere. The first set is the four authorities sourced
above, each with the date the URL was read.

**No authority a person types**, until an SSRF guard exists. D9's *Open from URL*
row is the first row that owes that guard, and adding a custom authority is
recorded as its trigger.

### 3 — The token is verified before it is embedded, by the one signer check

Before a token is written into a signature, all of this must hold, or the signing
is refused with a named outcome:

1. `PKIStatus` is `granted` or `grantedWithMods`, and a token is present.
2. The token is a SignedData whose `eContentType` is `id-ct-TSTInfo`.
3. The TSTInfo's `messageImprint` is the hash of **this** signature value, under
   the algorithm the request named.
4. The TSTInfo's `nonce` equals the request's.
5. The token's signer verifies over the TSTInfo, by **`signedDataCheck.ts`** —
   the same module that verifies a document signature. Two verifiers of RFC 5652
   would be B3a's second opinion.
6. The certificate the token's SignerInfo names carries `id-kp-timeStamping` as
   its only extended key usage, marked critical.

Because node-forge's reader refuses non-Data content, the token is read with
node-forge's own `signedDataValidator`, called directly. That is the same
library's reading of the same structure, not a second parser.

**A person who asked for a timestamp never gets a signature without one.** A
refusal leaves the document unsigned and says why. Signing again without a
timestamp is a separate choice the person makes.

### 4 — The network reaches the kernel through a port, and the composition supplies it

The kernel's signing apply takes a `requestTimestamp(query) → reply` function at
the writer's construction, not a URL and not a fetch. The composition root builds
the function over the declared authority list. The kernel stays free of network
code, and its tests drive the whole flow with an authority minted in memory,
including a token signed by a certificate without the timestamping usage.

`signDocument` stays **not reproducible**, and replay re-applies the stored
effect, so undo, redo and replay never ask an authority again.

### 5 — The reader reports a token's time, and whether it verified

`readSignatures` reads an embedded `id-aa-timeStampToken`, applies Decision 3's
checks 2 to 6 against the signature it sits on, and reports the time and whether
it verified. A token that does not verify is reported as such, never shown as a
time.

## Rejected

**FreeTSA as the only authority, keeping HTTPS-only as written.** A free volunteer
service with no stated availability commitment, standing alone behind a feature
people rely on for evidence.

**A URL field for the authority.** It needs the SSRF guard the law requires for a
user-supplied URL, and no guard exists.

**Fetching inside the kernel.** It would make the kernel the first module to
reach the network directly, where ADR-0052 and ADR-0057 placed every call in the
composition root.

**Signing without a timestamp when the authority fails.** That is the decorative
defect the founding record names.

**Parsing the TSTInfo with a hand-written ASN.1 reader.** node-forge already
parses the structure; a second reader would be a second opinion about DER.

## What this does not decide

- **Long-term validation** — embedding revocation data or a document timestamp
  (PAdES-LTV). A signature timestamp proves when a signature existed; keeping it
  checkable after the authority's certificate expires is a different row.
- **Trust in the authority's certificate chain.** As with document signatures, the
  panel says trust is not checked.
- **A custom authority**, which waits for the SSRF guard (Decision 2).
