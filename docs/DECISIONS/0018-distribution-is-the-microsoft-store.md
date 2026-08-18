# ADR-0018 — Distribution is the Microsoft Store

- **Status:** Accepted
- **Date:** 2026-08-18
- **Amends:** `docs/ARCHITECTURE.md` §8. **A correction to the living law, not a
  new decision.**

## Why this is a correction

The founding record describes a two-flavour distribution with a direct download
and a self-update path. That is **false today**: distribution is the Microsoft
Store only, the website's download button links to the Store listing, and no
direct download exists.

`docs/JOURNAL.md` has recorded the correction as owed for some time. That is not
sufficient, and `CLAUDE.md`'s own table says why: **the architecture document is
the law and the journal is not.** A reader following the process correctly —
consult `ARCHITECTURE.md`, build against it — would have built the wrong thing
and been right to. The document being stale *is* the defect; the journal noting
it is not a fix.

## Decision

**Distribution is the Microsoft Store, and only the Store.** The website carries
information; its download button links to the listing.

### The two-flavour design is kept as a seam

Not deleted. Specifically kept:

- the **flavour switch**;
- **`WebUpdateProvider`, registered with no implementation behind it**;
- the **signing certificate as an empty build config value**.

**The reason is recorded here so nobody removes it as dead code in six months.**
A signed direct download may be added later, and when it is, it must be a
*configuration change* rather than an architecture change. Deleting the seam
converts that future config change back into an amendment — it does not simplify
anything, it just moves the cost and hides it.

This is the one case in this project where an unimplemented registration is
correct. It does not violate the wired-tools rule, because nothing mounts a
control for it: the rule bans a control that renders and does nothing, and
`WebUpdateProvider` renders nothing. The registry's `when` predicate is what
keeps it invisible.

### Updates come from Windows

Windows already updates Store apps in the background by default, staging the
package and applying it on close.

**The application must never attempt to install its own package, and must never
override a user who has disabled automatic updates.** Both are absolute. The
second matters more than it looks: a user who turned automatic updates off made
a choice about their machine, and an application that works around it has
substituted its judgement for theirs on their own system.

`StoreUpdateProvider` adds only what the Store does not:

1. **A version check against a static JSON manifest we host.** Fields: current
   version, minimum supported version, and a `security` boolean. A plain HTTPS
   GET of a static file that **sends nothing** — no machine identifier, no
   install ID, no usage data, no query parameters. This is the application's only
   call to our own server, and **its audience will read the network tab**, which
   is the same standard §8 already applies to telemetry.
2. **An in-app indicator** when a newer version exists, with a button opening the
   Store listing via the Store protocol link. A `security` release shows a notice
   requiring acknowledgement.
3. **A settings entry to disable the check**, describing exactly what it sends
   and what it fetches. Default on.

The update-provider registry does not exist yet, so this lands as amendment and
ADR now, and as an implementation when the registries are built.

## The connection to the security work

This is not an adjacent concern. **The advisory tracker decides how fast a fix
can ship; this decides how fast it reaches users**, and the `security` boolean in
the manifest is the join.

That connection is concrete rather than anticipated, because the tracker has
already produced a live verdict: `docs/security/engine-advisories.json` carries
CVE-2026-73066 and CVE-2026-73067 as **AFFECTED** in the vendored Tesseract
5.5.2, fixed in a 5.5.3 that MuPDF 1.28.0 does not vendor. They are not reachable
today, so nothing needs to reach users yet — but the path from "the tracker turns
a verdict red" to "a user is running the fixed build" is the path this ADR
defines, and it existed as an assumption until now.

## Rejected alternatives

**Trigger the update from inside the application through the Store's own update
API.** It exists, and it is the correct route for that behaviour. Rejected *for
now* because it needs **native interop from Electron** and therefore adds another
native surface — and this project's native surface is the thing its threat model
ranks second by consequence. Deferred until the simple version demonstrates that
users are not updating, which is a measurement rather than a guess.

Two conditions if it is ever built: **verify the API surface against current
Microsoft documentation rather than recalling it**, per the standing rule that
versions are researched and never remembered; and note that its silent path
functions **only when the user has automatic updates enabled** — which is exactly
the setting this ADR forbids overriding. The API does not route around that
choice, and an implementation that appeared to would be doing something else.

**Ship a direct download alongside the Store.** Rejected for 1.0: it needs a
signing certificate, a distribution host, and a self-update path, each of which
is a security surface with no user behind it yet. The seam is kept precisely so
this stays cheap to revisit.

**Delete the two-flavour design as unused.** Rejected — see above. It is the
difference between a future config change and a future amendment.

## Consequences

- **`WebUpdateProvider` will look like dead code to a reader who has not read
  this ADR.** That is the cost, and this section is the mitigation.
- The Store's review and rollout cadence becomes the floor on how fast a security
  fix reaches users. Partner Center's **gradual rollout** is the corresponding
  release-checklist item — a bad build can go to a fraction of users and be
  halted — and it belongs to the checklist rather than to the code.
- **MSIX changes assumptions the installer flavour does not share**, and they
  must be checked early rather than at submission: an MSIX application **cannot
  write to its install directory**, and its data paths differ from the
  installer's. Recorded against the packaging-skeleton row in `docs/FEATURES.md`
  rather than left as a note, because it cannot be executed until that skeleton
  exists and a note would be read after submission rather than before.
- One HTTPS GET to a host we control now exists in an application that otherwise
  makes none. It is stated in §8, in settings, and here, because an
  open-source-audience application that quietly acquires a call home has spent
  something it cannot get back.
