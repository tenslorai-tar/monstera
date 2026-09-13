# 0059 — A sign-in redirect returns on loopback, for one request

Accepted 2026-09-13.

## Context

D7's last row is *DocuSign integration*. `BUILD-PROMPT.md` Part F lists its
settings under *Integrations (all secret)*: *DocuSign key/account/basePath*. Sending
a document to DocuSign means acting as a signed-in DocuSign user, and that means
an OAuth sign-in.

**The law has nothing to register this into.** Searched 2026-09-13 across
`docs/ARCHITECTURE.md`, every ADR and the founding record for protocol handlers,
deep links, `setAsDefaultProtocolClient`, custom URL schemes, loopback redirects,
`open-url`, `second-instance`, OAuth and redirect URIs. The one match was ADR-0031
rejecting a custom scheme for PDF.js, which is a different question. So a sign-in
that brings a browser's redirect back into `main` is a new way for outside input to
reach the application, and B4 applies.

Stage 9 owns the cloud providers — Google Drive, Dropbox, OneDrive, Box,
SharePoint — each an OAuth sign-in by the same route. So this decision is taken
once, for every sign-in, and DocuSign is its first caller.

## Sources read, 2026-09-13

- **RFC 8252**, *OAuth 2.0 for Native Apps*, October 2017 (Best Current Practice).
  - §7 gives a native app three redirect options: a private-use URI scheme (7.1),
    a claimed `https` URI (7.2), and the loopback interface (7.3).
  - §7.3: *"http://127.0.0.1:{port}/{path}" for IPv4, and "http://[::1]:{port}/{path}"
    for IPv6*; *"The authorization server MUST allow any port to be specified at the
    time of the request for loopback IP redirect URIs"*; clients should try both
    IPv4 and IPv6.
  - §8.1: *"multiple apps can typically register the same scheme, which makes it
    indeterminate as to which app will receive the authorization code."*
  - §8.3: loopback's plain HTTP *"is acceptable … as the HTTP request never leaves
    the device"*; *"open the network port only when starting the authorization
    request and close it once the response is returned"*; *"listen on the loopback
    network interface only"*; `localhost` is *"NOT RECOMMENDED"*.
  - §8.4: native apps *"are classified as public clients"*, and redirect URIs must
    match exactly *"except for the port URI component"* of a loopback redirect.
- **Electron**, `app` API documentation. `setAsDefaultProtocolClient` in a Windows
  Store (appx) package *"will return `true` for all calls but the registry key it
  sets won't be accessible by other applications"*; the protocol must be declared
  in the package manifest. On Windows a launching URL reaches a running instance
  through the second instance's `argv`.
- **Microsoft Learn**, *App capability declarations*, updated 2026-09-08: *"Medium
  IL apps—which are also known as full trust apps—don't run in an AppContainer"*,
  and capabilities that grant what a user can already do apply only to AppContainer
  apps.
- **Microsoft Learn**, *Interprocess communication — Windows apps*, updated
  2026-07-14: *"loopback connections for IPC are blocked by default for packaged
  applications"*, enabled by `privateNetworkClientServer`. It does not say whether
  that covers full-trust apps.
- **Docusign's developer blog**, *Docusign adds support for PKCE* and *How to Set Up
  JavaScript OAuth Authorization Code Grant with PKCE* (neither dated): public
  applications had been limited to Implicit Grant, PKCE removes that, and a public
  client's token request omits `client_secret`.
- **Docusign's discovery documents**, `account-d.docusign.com` and
  `account.docusign.com`, fetched 2026-09-13: authorize at `/oauth/auth`, token at
  `/oauth/token`, userinfo at `/oauth/userinfo`; `token_endpoint_auth_methods_supported`
  lists `client_secret_post` and `client_secret_basic` only, and advertises no
  `code_challenge_methods_supported`.

## Decisions

### 1 — A sign-in is Authorization Code with PKCE, as a public client

The application is a public client (RFC 8252 §8.4): it is distributed, and a
secret inside it is a secret every copy carries. So no client secret exists in this
repository or the package, and every sign-in uses PKCE with `S256`. Implicit Grant
is not used.

### 2 — The redirect returns on loopback, for one request

The redirect URI is `http://127.0.0.1:{port}/{path}`, on a port the operating system
assigns when the sign-in starts.

- **Opened when the sign-in starts, closed when its one redirect arrives**, or when
  the person cancels, or after a bounded wait — never a standing listener.
- **Bound to the loopback interface only**, by IP literal, never `localhost`.
- **One request, one path, one `state`.** Anything else that reaches the port is
  refused, and the `state` a redirect carries must be the one this sign-in sent.
- **The page it answers says nothing but that the person may return to the
  application.** The code is exchanged in `main`, never in a page.

### 3 — The browser is the person's own

The sign-in opens in the system browser, where the person's password manager and
existing session are, and never in a window this application controls — so the
application never sees a DocuSign password (RFC 8252 §8.12, embedded user-agents).

### 4 — Tokens are secrets, in the store that already exists

Access and refresh tokens go through `secretStore` (`safeStorage`), exactly as the
Azure and Anthropic keys do, and never to the plaintext settings file (ADR-0056).
Where `safeStorage` is unavailable, sign-in is a declared refusal and never a
plaintext fallback.

### 5 — Each provider's hosts are declared, and the network rule applies unchanged

DocuSign's account hosts and its REST base path are HTTPS, host-locked per purpose.
The base path comes from the userinfo answer and is accepted only when its host is
one the contract declares for DocuSign. No part of this decision relaxes §9's
network rule.

## Rejected

**A private-use URI scheme.** In a Store package it needs a manifest declaration
(Electron), so it cannot be exercised before Stage 10's packaging. And another
application can register the same scheme and receive the code (RFC 8252 §8.1). PKCE
stops that code being redeemed, but it still arrives somewhere else.

**A claimed `https` redirect.** It needs a domain this project controls, serving
association files, which the Store-only distribution (ADR-0018) does not provide.

**Implicit Grant.** Tokens in a URL fragment, and no refresh, which is what PKCE
exists to replace.

**An embedded browser window.** The application would see the password (RFC 8252
§8.12).

**A client secret shipped in the package.** It is a secret in every copy.

## What this does not decide, and what would change it

- **Whether Docusign accepts a loopback redirect with a varying port.** RFC 8252
  §7.3 requires it of authorization servers. Docusign's own documentation could not
  be read to confirm it: its developer pages render client-side, its support article
  rendered empty, and a community thread says only to contact support. **Trigger:**
  the owner's integration key, registered with a loopback redirect. If Docusign
  requires an exact port, the port becomes a declared constant and this decision
  records that in a correction.
- **Whether a packaged full-trust application may receive a loopback connection.**
  Microsoft states full-trust apps do not run in an AppContainer; the loopback note
  says packaged applications without saying which. **Trigger:** Stage 10's first
  packaged build, before this sign-in ships.
- **Docusign's discovery documents advertise only client-secret token
  authentication**, while its blog describes public clients. The first sign-in
  against the owner's key settles which is current.
