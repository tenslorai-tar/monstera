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

## Correction, 2026-09-29 — Google's Picker is part of the sign-in, and needs no key and no page

Decision 7 said the Picker *"needs an API key and a web page of Google's script"*, and the owner's list of
28 September asked for it on the loopback browser page with the API key and project number from build
configuration. That was the web Picker's shape. **Google's desktop Picker is a different mechanism**, it is what a
desktop client is offered, and the owner chose it on 2026-09-29 when the two were put side by side.

### Source read, 2026-09-29

Google for Developers, *Integrate the Google Picker into desktop and mobile apps* (last updated 2026-09-14, general
availability): the Picker opens in the system browser as part of the OAuth authorization request. `prompt=consent`
and `trigger_onepick=true` are added to `accounts.google.com/o/oauth2/v2/auth`; optional `allow_multiple`,
`mimetypes`, `file_ids`, `allow_folder_selection`. The redirect carries `picked_file_ids` — a comma-separated list —
beside `code` and `scope`, or `error` when the person cancels. **Only `drive.file` is permitted, and it cannot be
combined with any other scope.** The Picker *"imposes no additional restrictions"* on the redirect URI. The Cloud
project must have the **Google Picker API** enabled. The page names no API key and no project number for desktop
clients.

### Corrected decision

7. **Google's scope is `drive.file`, and a person reaches any PDF in their Drive through the Picker, which is the
   sign-in with two parameters more.** *Choose a file in Google Drive…* runs ADR-0059's loopback sign-in with
   `trigger_onepick=true` and `mimetypes=application/pdf` (the provider's extras already send `prompt=consent`); the
   redirect's `picked_file_ids` names the file, the code is exchanged as for any sign-in, and the file opens as a
   local working copy by Decision 6. No API key, no project number, no Google script and no page of this
   application's: the browser shows Google's own Picker, and what returns to `main` is the redirect it already takes.

- **The loopback sign-in hands back the redirect parameters its caller names**, beside the code: `picked_file_ids`
  for this caller, nothing for the others. One function still, ADR-0059's.
- **A picked id is an opaque string from a redirect**, checked against Drive's id alphabet and length before it is
  used in a request path, and only the first is opened — no `allow_multiple`.
- **A Picker that returns no file** is its own refusal, `nothing-picked`, said by name.

### Rejected

- **The web Picker on a loopback page** — the route as first asked. It needs an API key and the project number in
  the package, Google's `apis.google.com` script loaded by a page this application serves, and the sign-in's token
  handed into that page: three things this route needs none of, for the same Picker.
- **`drive.readonly` or `drive`** to list every file: restricted scopes needing Google's verification, and more access
  than choosing one file needs.

## Correction, 2026-09-30 — a file the person may not change is a permission, not a sign-in

**What happened.** In the owner's installed 0.1.6.0, Save back worked for the owner's own Drive files and failed for
files others had shared with them. The message was *"The provider no longer accepts this sign-in. Sign in again."*,
and nothing was written to the log. The refusal is Google's and correct. The words were ours and wrong: `call()`
mapped HTTP 401 **and** 403 to one reason, `unauthorised`. A 401 is credentials the server does not accept. A 403 is
a request it understood and refuses for the credentials it did accept (RFC 9110 §15.5.2, §15.5.4). Signing in again
cannot change a 403.

**Decided, the owner's decision A.**

- **Two reasons.** 401 stays `unauthorised`. 403 is `forbidden`, a permission on this file. The API-key services
  (AI, OCR, DocuSign) keep mapping both to one reason: for a key, both mean *this key is not allowed*, and the
  person's remedy is the same.
- **Edit access is read when a file is opened**, with the version: Drive's `capabilities.canEdit`, from Drive v3's
  *files* resource. Graph has no single flag. An item with no `remoteItem` facet is in the person's own drive. An
  item shared from another drive is asked of that drive's permissions, which for a caller who is not the owner list
  only the caller's own (*List who has access to a file*). Any `write` or `owner` role there means yes. **Both come
  from the providers' reference, read 2026-09-30, and were not run live**: the owner closed the live runs, and the
  fakes in `cloudStorage.test.ts` answer what the references say. A provider answer that does not say is `null`,
  unknown and never yes.
- **Said before an edit.** `cloud.access` answers the provider and the flag. A file whose flag is `false` opens with
  *Shared with you as view-only*, which offers a copy in the person's own storage.
- **Save back on such a file** saves the working copy, as every Save back does, sends nothing, and answers
  `read-only`. A 403 from a file not known to be view-only answers `forbidden`. Both offer the copy, which is
  `cloud.uploadCopy` and links the document to it, so the next Save back goes to the copy.
- **Every cloud failure is logged** as `cloud-failed`: the request, the provider, the reason and the provider's host
  and status. One wrapper runs every public call, so no call can fail without a line.
