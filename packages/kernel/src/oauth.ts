import { createHash, randomBytes } from 'node:crypto';

/**
 * The two pieces every sign-in makes for itself: a PKCE pair and a `state`
 * ([ADR-0059](../../../docs/DECISIONS/0059-a-sign-in-redirect-returns-on-loopback-for-one-request.md)).
 *
 * ONE MODULE FOR EVERY PROVIDER. DocuSign made them first; the cloud providers
 * (ADR-0091) take them from here rather than writing a second verifier, because two
 * opinions about how long a verifier is or which alphabet it uses is B3a's shape.
 */

/** A PKCE pair (RFC 7636). */
export interface PkcePair {
  /** 32 random bytes, base64url — 43 characters, inside §4.1's 43 to 128. */
  readonly verifier: string;
  /** base64url(SHA-256(verifier)), the `S256` method (§4.2). */
  readonly challenge: string;
}

/**
 * A fresh PKCE pair.
 *
 * @param random injected so a case can fix it; the application passes nothing.
 */
export function pkcePair(random: (count: number) => Buffer = randomBytes): PkcePair {
  const verifier = random(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** A fresh `state`, compared on the redirect (RFC 6749 §10.12). */
export function oauthState(random: (count: number) => Buffer = randomBytes): string {
  return random(24).toString('base64url');
}
