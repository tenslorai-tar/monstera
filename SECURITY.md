# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's private vulnerability reporting:

> **[Report a vulnerability](https://github.com/tenslorai-tar/monstera/security/advisories/new)**
> — or, from the repository, the **Security** tab → **Report a vulnerability**.

This creates a private advisory visible only to you and the maintainers, with a
place to collaborate on a fix and coordinate disclosure. It needs no email
address and leaks nothing while the issue is unfixed.

### What to include

- What an attacker can do, and what they need in order to do it.
- The steps to reproduce, ideally with a **generated** file rather than a real
  one — see the note on documents below.
- The version or commit you tested.

### What to expect

- **Acknowledgement within 3 working days.** If you do not hear back, assume the
  message went astray and ping the maintainers publicly *without disclosing the
  issue* — "I sent a private report on <date>" is enough.
- An assessment and a target timeline once the report is triaged.
- Credit in the advisory and the release notes, unless you prefer otherwise.

We ask for a **90-day** disclosure window, and will move faster where a fix is
straightforward. If you believe the issue is being actively exploited, say so —
that changes the schedule.

### Do not send us confidential documents

If a PDF triggers the bug, **do not attach a real one.** Attach a minimal file
that reproduces it, or the script that generates one. A real document may carry
personal or confidential data, and a bug report should not create a second
incident on top of the first.

## Scope

Monstera is a desktop application, so the interesting boundaries are these:

**In scope**

- Escaping the renderer sandbox, or reaching Node, the filesystem or a
  filesystem path from renderer code.
- Executing code by opening a crafted PDF, image or imported document.
- Reading or exfiltrating a stored API key, token or password.
- Bypassing the pinned-hash verification on a downloaded native binary, or
  anything that lets an unverified binary execute.
- Sending document content anywhere the user did not explicitly direct it.
- A redaction that does not actually remove content, or a signature that
  verifies when it should not. These are correctness bugs with security
  consequences and we treat them as security issues.
- SSRF or DNS-rebinding against the "open from URL" and cloud-import paths.

**Out of scope**

- Findings that require an attacker who already has code execution or an
  administrator account on the user's machine.
- The unsigned direct-download installer warning. Store builds are signed by
  Microsoft; the website NSIS and portable builds are unsigned, and that is a
  documented, deliberate tradeoff rather than an oversight.
- Vulnerabilities in a dependency with no exploitable path in Monstera. Report
  them upstream; tell us if you think we expose the path and we will look.
- Missing hardening headers on `monsterapdf.com` marketing pages, unless they
  affect the release feed or a download.

## Supported versions

The project has not yet reached 1.0. Until it does, **only `main` is supported**
and fixes land there. This table will list supported release lines once 1.0
ships.

## How this project reduces its own attack surface

Stated so you know where to look, and so the claims are falsifiable:

- The renderer runs sandboxed, with context isolation on and Node integration
  off. It never receives a filesystem path — it holds unguessable capability
  handles, so a handler that forgets a permission check cannot exist.
- Every downloaded native binary is verified against a pinned SHA-256 **before**
  any parser or unzipper reads it, over HTTPS, from a host checked on every
  redirect hop, with a byte ceiling that does not trust `Content-Length`.
- Secrets go to the OS keychain via `safeStorage`. If it is unavailable the app
  says so and **refuses to store the key**; there is no plaintext fallback.
- There is no telemetry. The update check is the only call the app makes on its
  own.
- Secret scanning runs on every commit locally and over the full history in CI.

If you find a place where one of those claims is not true, that itself is a
report worth making.
