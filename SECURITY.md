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
- The version and install channel shown in **Help › About** (or the commit, for
  a build from source), and your Windows version.

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

Monstera PDF Editor is a Windows desktop application, so the interesting
boundaries are these:

**In scope**

- Escaping the renderer sandbox, or reaching Node, the filesystem or a
  filesystem path from renderer code.
- Executing code by opening a crafted PDF, image or imported document.
- Escaping the **contained engine host** that parses documents: reaching the
  network, a file it was not handed, or another process.
- Anything that **runs or fetches on open**: embedded JavaScript, an automatic
  action, an external request, or an embedded file written to disk without the
  user asking for that item.
- Reading or exfiltrating a stored API key, token or password.
- Bypassing the pinned-hash verification on a downloaded native binary, or
  anything that lets an unverified binary execute.
- Sending document content anywhere the user did not explicitly direct it.
- A redaction that does not actually remove content, or a signature that
  verifies when it should not. These are correctness bugs with security
  consequences and we treat them as security issues.
- SSRF or DNS-rebinding against **Open from web address** and the **OneDrive /
  Google Drive** integrations.

**Out of scope**

- Findings that require an attacker who already has code execution or an
  administrator account on the user's machine.
- Vulnerabilities in a dependency with no exploitable path in Monstera PDF
  Editor. Report them upstream; tell us if you think we expose the path and we
  will look.
- Missing hardening headers on `monsterapdf.com` pages. The site links to the
  Store and serves no download. (When the update check's file is hosted there,
  anything that could alter it becomes in scope.)

## Supported versions

No version has been released yet; until then fixes land on `main`. After release,
the **latest Microsoft Store version** is supported, and Windows updates Store
apps.

## How this project reduces its own attack surface

Stated so you know where to look, and so the claims are falsifiable:

- The renderer runs sandboxed, with context isolation on and Node integration
  off. It never receives a filesystem path — it holds unguessable capability
  handles, so a handler that forgets a permission check cannot exist.
- Every native binary the **build** downloads is verified against a pinned
  SHA-256 **before** any parser or unzipper reads it, over HTTPS, from a host
  checked on every redirect hop, with a byte ceiling that does not trust
  `Content-Length`; a provisioned tree must hold exactly the files its script
  pins.
- Secrets are encrypted with Windows' own protection via `safeStorage`. If it is
  unavailable the app says so and **refuses to store the key**; there is no
  plaintext fallback.
- There is no telemetry, and today the app makes no network call on its own. The
  Store build's update check is built and off until its address is live; it is
  one request with no query, cookie or body, carrying only the headers the
  runtime adds itself (its user agent and language among them), and it reads
  version numbers back. Crash reports are written on your
  computer and leave it only if you share one.
- Secret scanning runs on every commit locally and over the full history in CI.

If you find a place where one of those claims is not true, that itself is a
report worth making.
