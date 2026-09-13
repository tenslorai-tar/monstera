# 0061 — A URL a person chose is fetched through one guard that pins every resolution

Accepted 2026-09-13.

## Context

D9's *Open from URL (SSRF-guarded)* is the first feature that fetches an address the
application did not write. Every fetch before it goes to a compile-time host list: the
model download (ADR-0053), the recognisers (ADR-0057), DocuSign (ADR-0059) and the
timestamp authorities (ADR-0058). For those, host-locking *is* the guard.

The law already names this one. `BUILD-PROMPT.md` Part C8 and `ARCHITECTURE.md` §8
require, *for user-supplied URLs*, *"an SSRF guard with a private-range blocklist and a
DNS-rebinding pin — re-validated on every resolution, not just the first"*. ADR-0053
recorded that the guard was unwritten and that *"a URL a document or a user chooses is a
different threat and gets its own decision when a feature accepts one"*. This is that
decision.

**No seam exists to register into.** `main` has no node-level network code: every
existing fetch uses the global `fetch`, and nothing in the tree resolves a name itself.
So B4 applies, and the threat model gains §1.10.

## What was measured, 2026-09-13

A probe on loopback only, with no outside network, run under Node 24.12.0 and again
under the pinned Electron 43.4.1 binary in Node mode (Node 24.18.1). Both gave the same
answers:

| question | answer |
|---|---|
| does `https.request` call a custom `lookup` for `127.0.0.1`? | **no** — zero calls, straight to connect |
| for `::1`? | **no** |
| for a name? | **yes**, once, with `{ hints: 0, all: true }` |
| does `net.BlockList` holding `127.0.0.0/8` as IPv4 block `::ffff:127.0.0.1`? | **yes**, and `::ffff:7f00:1` too |
| CONTROL: does it block a public address, or that address mapped? | **no**, and **no** |

The first two rows are why a literal host needs its own check: a guard living only in
`lookup` would never see `https://127.0.0.1/`.

**The registries were read, not recalled**, on 2026-09-13:

- IANA's IPv4 and IPv6 Special-Purpose Address Registries, both last updated 2025-10-09;
- the IPv4 Multicast Address Range Registry, updated 2026-08-20: 224.0.0.0 through
  239.255.255.255, RFC 1112;
- the IPv6 Address Space Registry, updated 2025-10-23: `ff00::/8` is multicast.

**The alternatives' premises were read too.**

- `undici` is in the lockfile only as an *optional* dependency of `@electron/get`, a dev
  dependency.
- `electron.d.ts` 43.4.1's `ClientRequestConstructorOptions` has no `lookup`; the only
  resolver it offers is `session.resolveHost`, which resolves apart from any connection.
- `atomicWrite` takes a whole `Uint8Array` for its temporary file.
- `budget.ts` records that `main` holding a second document-sized image is unmeasured.

## Decision

### 1. One module, and it lives beside the download rule

`packages/kernel/src/guardedFetch.ts` is the only route by which a URL a person or a
document chose is fetched. It is placed by both of §1's axes:

- its **subject** is §8's network rule, whose application form already lives in the
  kernel as `verifiedDownload.ts`;
- it **executes** in `main` and needs no Electron API.

It takes that module's `receivedByteMeter` rather than a second counter (B3a).

### 2. The pin is the `lookup` the socket connects through

Each hop is one `https.request` with `agent: false`, so no pooled socket carries a hop
past its own resolution. Its `lookup`:

1. resolves with `dns.lookup(host, { all: true })`, the system resolver, so a hosts-file
   entry is resolved and then judged like any other answer;
2. **refuses the whole answer if any address in it is blocked** — a name answering one
   public and one private address is the rebinding shape, and filtering it would let
   the attacker keep the half that passes;
3. hands the callback **exactly the addresses it checked**, in the `all: true` shape the
   caller asked for.

The address the socket connects to is therefore one checked in the same resolution, and
because every hop is a new request, every resolution is checked — the law's *"not just
the first"*. The TLS server name and certificate check stay on the host name, which
`lookup` does not change.

### 3. A literal host is checked before the request

Because `lookup` is never called for one (measured). An IPv6 literal's brackets are
removed before the check.

### 4. The blocklist is the registries, with the transition prefixes judged by what they carry

**Refused:**

- every block IANA's IPv4 and IPv6 special-purpose registries mark *Globally Reachable:
  False*;
- `224.0.0.0/4` and `ff00::/8`;
- `2002::/16` (6to4) and `2001::/32` (Teredo), whole. The registry marks them N/A: each
  embeds an IPv4 address, and no document host needs either.

**Judged by the IPv4 address inside:**

- `::ffff:0:0/96` (IPv4-mapped) — `BlockList` already does this, as measured;
- `64:ff9b::/96` (NAT64). The registry marks it globally reachable, but through a
  translator `64:ff9b::7f00:1` *is* 127.0.0.1.

**Where a globally reachable block sits inside a refused one**, the refusal wins. For
example, `192.0.0.9/32` sits inside `192.0.0.0/24`. Those are anycast service addresses,
not places a document is served from, and a narrower exception would be a list to keep
in step with the registry for no user.

### 5. Every hop is `https:`, carries no user information, and there are at most five

Redirects are followed by hand, `verifiedDownload.ts`' shape, and each `Location` is
resolved against the current URL before it is checked. A URL carrying a user name or
password is refused: it would send a credential to a host the person did not see. Any
port is allowed — the threat is the address, and `https://host:8443/` is an ordinary
link.

### 6. The body is streamed into the save pipeline's temporary file

A download held whole in `main` and then handed to `writeDocumentCopy` puts two
document-sized images in `main` while it opens — the shape `budget.ts` states is
unmeasured. So `atomicWrite`'s first stage is generalised to take a **writer** rather
than a byte array. The ordering is unchanged:

1. temporary file;
2. sync;
3. backup;
4. rename.

The response streams through `receivedByteMeter` into that temporary file, and the save
pipeline remains the one writer of a destination.

- **The ceiling is `MAIN_DOCUMENT_BYTES_CEILING`**, because a larger file could not be
  opened anyway.
- **A body that does not begin with `%PDF-` within its first 1,024 bytes is refused**
  before the rename. It is a signature check on a prefix, not a parse: an HTML error
  page answered with `200` would otherwise be saved where the person chose and then
  poison on open.

### 7. What crosses the boundary

The renderer sends a URL, bounded by the contract's `MAX_LINK_URI`, which is already the
bound on a URI a person types. `main` runs the destination picker, checks the
destination, fetches, writes and opens through the one open route. What returns is:

- an open's outcome;
- a refusal naming its reason;
- the destination's outcomes.

No response byte reaches the renderer.

### 8. Stated limits

- **The system proxy is not used.** A machine that reaches the internet only through a
  proxy cannot open a URL. Honouring one means asking Chromium's resolver or a proxy's,
  and neither can be pinned (§ Rejected).
- **The timeouts are policy, not measurements.** A hop that sends no response headers in
  30 s, or no byte for 30 s once the body has started, is refused as unreachable. There
  is no total limit, because a large document on a slow link is legitimate. Both figures
  stand until something measures a reason to move them.

## Rejected

- **The global `fetch`.** It has no hook between resolution and connection. Its
  `dispatcher` option needs an `undici` `Agent`, and `undici` is here only as an optional
  dev dependency of `@electron/get`, so this would add an application dependency to reach
  what `node:https` offers with none.
- **Electron's `net` module or `session.fetch`.** `ClientRequestConstructorOptions` has no
  `lookup`, and `session.resolveHost` resolves apart from any connection. A check made
  with it leaves exactly the gap between check and connect that the pin exists to close.
- **Resolving first, then connecting to the address with a `Host` header.** It pins the
  same way with more code, and it moves TLS's server name onto a second parameter that
  every call site must remember.
- **Checking the first resolution only.** The law refuses it by name, and a redirect to a
  name whose answer changed is the attack.
- **Filtering blocked addresses out of a mixed answer.** See Decision 2.
- **Holding the body in memory and writing it with `writeDocumentCopy`.** See Decision 6.
- **Trusting `Content-Type` or `Content-Length`.** The first is the sender's claim about
  bytes the header check reads anyway. The second is why `receivedByteMeter` exists.

## Consequences

- `ARCHITECTURE.md` §8's network bullet states the guard; the amendment log records it.
- The threat model gains §1.10.
- `atomicWrite`'s temporary-file stage takes a writer. Every existing caller passes one
  that writes its bytes, so a save's behaviour does not change, and the cases that prove
  the ordering stay the proof.
- The timestamp paragraph's *"until the SSRF guard above does"* no longer holds: the guard
  exists and a typed authority is still not built, which remains ADR-0058's to reopen.
