import { TIMESTAMP_AUTHORITIES } from '@monstera/contract';
import { readWithin, type RequestTimestamp } from '@monstera/kernel';

/**
 * The timestamp port the composition root registers with the signer
 * ([ADR-0058](../../../docs/DECISIONS/0058-a-timestamp-authority-is-verified-not-trusted-and-its-request-may-be-plain-http.md)
 * Decision 4).
 *
 * ## TRANSPORT ONLY — it judges nothing
 *
 * Whether a reply is a token is `acceptTimestampReply`'s question, in the kernel,
 * and nothing here reads a byte of it. So there is no content-type check either:
 * RFC 3161 names `application/timestamp-reply`, and an authority that labels a
 * correct token otherwise has still sent a correct token, while one that labels
 * garbage correctly has still sent garbage. The verification is the authority on
 * that, not a header (B3a).
 *
 * ## What it DOES decide, each against the network rule's exception
 *
 * - **The URL is the contract's**, looked up by id. The renderer names an id and
 *   never an address, so nothing a person or a document types reaches `fetch`.
 * - **Redirects are refused, not followed.** A redirect is how a request leaves the
 *   host it was locked to, and a redirected POST can arrive as a different request.
 * - **The reply is bounded by received bytes**, through `readWithin` — invariant
 *   9's third guarantee applied to it, in the one module that implements it.
 * - **The wait is bounded.** `fetch` imposes no timeout of its own, and a signing
 *   dialog that never returns is a hang a person cannot tell from work.
 *
 * Anything it throws becomes `TimestampUnreachableError` in the kernel, which is
 * the sentence *try again or choose another*.
 */

/**
 * The largest reply accepted, in RECEIVED bytes.
 *
 * **A bound, not a measurement.** A token is placed inside a signature hole of
 * `TIMESTAMPED_SIGNATURE_BYTES` (32,768) in `documentSign.ts`, so a reply larger
 * than twice that cannot become a signature that fits; reading further would be
 * reading bytes that are certain to be refused.
 */
export const MAX_TIMESTAMP_REPLY_BYTES = 65_536;

/**
 * How long one request may take, in milliseconds.
 *
 * **A bound, not a measurement**, set generously because it caps the worst case
 * and costs nothing in the ordinary one: an authority that answers answers in
 * well under it, and one that does not is reported unreachable rather than left
 * spinning.
 */
export const TIMESTAMP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Builds the port.
 *
 * @param fetchImpl injected so a case can answer without a network; the
 *   application passes nothing.
 */
export function timestampTransport(fetchImpl: typeof fetch = fetch): RequestTimestamp {
  return async (authority, query) => {
    const { url } = TIMESTAMP_AUTHORITIES[authority];
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body: query,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMESTAMP_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`the timestamp authority answered HTTP ${String(response.status)}`);
    }
    if (response.body === null) throw new Error('the timestamp authority answered no body');
    return readWithin(
      response.body,
      MAX_TIMESTAMP_REPLY_BYTES,
      (received) =>
        new Error(
          `the timestamp reply passed its ${String(MAX_TIMESTAMP_REPLY_BYTES)}-byte ceiling at ` +
            `${String(received)} bytes received`,
        ),
    );
  };
}
