# ADR-0091 — Cloud storage: a declared provider, a build-configured client, and a local working copy

- **Status:** Accepted
- **Date:** 2026-09-22
- **Amends:** `docs/ARCHITECTURE.md` §8 (Network) and the amendment log; corrects
  [ADR-0059](0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md) Decisions 1 and 2 for
  two providers' registration rules, recorded there as a correction.
- **Relates:** [ADR-0056](0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)
  (secrets), [ADR-0061](0061-a-url-a-person-chose-is-fetched-through-one-guard-that-pins-every-resolution.md)
  (a fetched body streams into the save pipeline), [ADR-0018](0018-distribution-is-the-microsoft-store.md)
  (Store only).
- **Context:** Stage 9's cloud-storage row, Microsoft and Google first (the owner, 2026-09-21).
  The owner registered an Entra application — any organisation and personal accounts, a *Mobile
  and desktop* redirect of `http://localhost`, public client flows enabled, delegated
  `Files.ReadWrite`, `offline_access`, `User.Read`, no secret — and a Google *Desktop app* client
  with the `drive.file` scope, in Testing mode. The three values are in the owner's environment as
  `MONSTERA_MS_CLIENT_ID`, `MONSTERA_GOOGLE_CLIENT_ID` and `MONSTERA_GOOGLE_CLIENT_SECRET`, and the
  owner's standing rule is that none of them is printed, logged or committed. `BUILD-PROMPT.md`
  lists a cloud-provider registry — *id, auth, list, fetch* — projected into a cloud storage panel.

## Sources read, 2026-09-22

- Google, *OAuth 2.0 for iOS & Desktop Apps* (updated 2026-09-14): the token request's
  `client_secret` is listed **optional**; *"installed apps are distributed to individual devices,
  and it is assumed that these apps cannot keep secrets"*; loopback redirects
  `http://127.0.0.1:port` and `http://[::1]:port`, any port; PKCE `S256`; endpoints
  `accounts.google.com/o/oauth2/v2/auth` and `oauth2.googleapis.com/token`.
- Microsoft Learn, *OAuth 2.0 authorization code flow* (updated 2026-06-15): public clients *"must
  not use secrets or certificates when redeeming an authorization code"*; PKCE `S256`; the
  `common` tenant's `/oauth2/v2.0/authorize` and `/token`.
- Microsoft Learn, *Redirect URI best practices* (updated 2026-06-15): *"the port component … is
  ignored for the purposes of matching a localhost redirect URI … This is only true for localhost
  redirect URIs"*; an `http` redirect on `127.0.0.1` cannot be added in the portal and needs the
  application manifest; a redirect with no path is returned with a trailing `/`.

## Decision

1. **A cloud provider is a declared entry**, as an AI provider is
   ([ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md)): an id, its sign-in
   endpoints and scopes, the hosts its API and its downloads may be reached on, and how its files
   are listed, fetched and replaced. The first two are OneDrive (Microsoft Graph, personal and work
   accounts) and Google Drive; Dropbox and Box are later entries, and SharePoint through Graph may
   need a tenant administrator's consent, which a person's own OneDrive does not.

2. **A client identifier is build configuration, never source.** `main` reads each provider's
   values from the environment by the names above, and a packaged build reads the same names from
   `oauth-clients.json` in the package's resources, which the packaging step writes from the
   packager's environment — owed with Stage 10's packaging. No value is in the repository, a log
   line or an error message. A provider whose values are absent answers **not configured in this
   build**, which the surface says, rather than offering a sign-in that cannot work.

3. **Google's Desktop client carries a secret that Google says installed apps cannot keep.** It is
   build configuration exactly as the identifier is, sent only to Google's token endpoint. This is
   a correction to ADR-0059 Decision 1's *"no client secret exists in this repository or the
   package"*: none exists in the repository; the package may carry this one because its issuer
   declares it non-confidential, and the owner's rule keeps it out of source like the id. Google
   lists it optional; the live run records whether it is required.

4. **Microsoft's redirect is `http://localhost:{port}/`, and the listener is still bound to
   `127.0.0.1`.** Entra ignores the port only for `localhost`, and the owner's registration is
   `http://localhost`. ADR-0059 Decision 2's binding rules stand — ephemeral port, loopback IP
   literal, one request, one path, one `state` — and only the redirect *string* differs, which the
   browser resolves to the loopback interface. Google keeps `http://127.0.0.1:{port}/google`. The
   loopback sign-in takes its redirect host and path as parameters: one function, DocuSign's.

5. **Tokens are secrets**, one per provider in `secretStore` (ADR-0056), never in the settings
   document; signing out removes them. A refresh token that stops working is a signed-out provider,
   said as such.

6. **A cloud file is opened as a local working copy, and *Save back* uploads it.** The download
   streams through the save pipeline into the application's own data directory, bounded by the
   document ceiling and refused without `%PDF-` (ADR-0061's route), and the copy is opened as any
   document is — so every command, the undo log and the save work unchanged. `main` records the
   copy's cloud origin. *Save back* saves to the working copy and uploads those bytes to the same
   file, **refusing by name when the cloud file changed since it was opened**, rather than
   overwriting someone's edit.

7. **Google's scope is `drive.file`**: the application sees the files it created or that were
   opened with it. So the Google list shows files put there from Monstera, and *Upload a copy* is
   how a local document gets there. Google's Picker, which lets `drive.file` reach a file a person
   chooses, needs an API key and a web page of Google's script; it is not built, and the row says so.

## Rejected

- **The identifiers committed as constants.** They are public in principle, and the owner's rule
  forbids committing them; a constant would also bind every fork to this registration.
- **A back end that holds a secret and brokers tokens.** A server this project would have to run,
  for secrets neither provider requires a desktop client to keep.
- **Opening from memory without a working copy.** `main` owns a document by a path it can save to;
  a document with no file would need a second save pipeline.
- **Overwriting on Save back without checking.** A conflict is a person's work on another device.
- **A `127.0.0.1` redirect for Microsoft through a manifest edit.** It would make the registration
  a step the owner has not taken, for a string the browser resolves to the same interface.

## Consequences

- Stage 10's packaging owes `oauth-clients.json` and a check that it is not in the repository.
- Each provider's live run is sign in, open, edit, save back, reopen — and it needs the owner's
  browser, so it is theirs to perform or watch.
