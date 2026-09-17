# ADR-0082 — `main` may push to the renderer, on declared event channels with the same discipline

- **Status:** Accepted
- **Date:** 2026-09-17
- **Amends:** `docs/ARCHITECTURE.md` §5, which defines the renderer-facing contract as
  request-and-answer over one `invoke` and names four generated surfaces. It gains a
  **second direction**, declared the same way and validated in the same wrapper.
- **Relates:** [ADR-0020](0020-the-preload-is-bundled.md) (the preload is a bundle and its
  bridge is one function), [ADR-0019](0019-the-renderers-csp-is-pinned.md) (the renderer
  reaches no network), [ADR-0081](0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md).
- **Context:** Stage 9's assistant, whose composer streams an answer and turns its send
  button into **Stop** while it does (the owner's design, 2026-09-15).

## The gap

A provider streams; the renderer cannot ask it. Keys never leave `main` and the renderer's
CSP gives it no network, so `main` makes the request — and `main` has no way to hand the
renderer a piece of an answer. The bridge is `invoke(channel, params)` and nothing else:
one question, one answer, no push. `document.awaitExternalEdit` already met this wall and
worked around it with a **bounded wait** (ADR-0062), which suits one event and does not
suit a hundred small ones.

## Decision

1. **A second direction, declared like the first.** `packages/contract` gains an **event
   registry**: a channel id and a zod schema per payload, exactly as a channel has one.
   `main` may send only a declared event, and it is validated where it is sent; the
   renderer validates it again on arrival, because a boundary validates what crosses it
   rather than trusting the other side (§5's *all validation happens once, in the generated
   boundary wrapper*, applied to the new direction).
2. **The bridge gains `subscribe(channel, handler)` and nothing else.** It answers an
   unsubscribe function. No filesystem path, no document bytes and no key may be declared
   in an event payload — the same rule the channels have, and `payloadBounds` covers both
   registries so a new event owes a bound.
3. **Events are addressed to a subscription the renderer opened**, by an id the renderer
   minted and passed on the `invoke` that started the work. An event naming an id nothing
   subscribed to is dropped; the renderer never acts on an event it did not ask for.
4. **A stream is stopped through an `invoke`, never by ignoring events.** Stop must reach
   the provider, and an abandoned subscription that kept a request running would be a
   person pressing Stop and paying for the rest of the answer anyway.
5. **Bounded.** Each delta carries at most 8 KiB of text, and a subscription belongs to one
   conversation; the renderer holds the assembled answer, `main` holds none of it.

## Rejected

- **Polling an `invoke` for new text.** It is the shape that works today and it makes the
  answer's smoothness a function of a timer, spends a round trip per tick on the common
  case of nothing new, and still needs a way to say *finished*.
- **One event channel carrying a payload with a `kind`.** That is a second registry inside
  a payload, and the bound then belongs to the union rather than to the thing sent.
- **Letting the renderer call the provider.** Keys would leave `main`, and the CSP — pinned
  in §9.27 — gives the renderer no network on purpose.
- **Delivering the answer only when it is complete.** The owner's design streams, and a
  person watching a long answer arrive is the difference between waiting and reading.
- **A `MessagePort` handed to the renderer.** A second transport beside the bridge, with its
  own lifetime and no registry — B3a's second validated boundary, which this project has
  refused before.

## Consequences

- §5 states the second direction and the amendment log gets a line.
- The preload bundle changes, so `proof:rendererpolicy`'s read-back from the running
  renderer must show `subscribe` present beside `invoke` and nothing else exposed.
- The browser shim implements the event registry too, or it fails to compile — the fourth
  generated surface keeps its rule.
