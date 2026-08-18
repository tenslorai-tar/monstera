import { randomBytes } from 'node:crypto';

/**
 * Minting opaque 256-bit tokens.
 *
 * Two kinds exist and both are minted the same way: `FileHandle` stands for a
 * path (`CapabilityRegistry`), `DocId` stands for an open document
 * (`DocumentService`). ADR-0009 §1 rejects every derived alternative for the
 * second — a path hash is the path in a lossy coat, and a counter reuses ids
 * after close so a late message naming document 3 lands on a *different*
 * document that now holds id 3.
 *
 * The width and the short-draw refusal live here rather than in each caller
 * because they are one rule (B3). Duplicated, the two copies can drift, and the
 * drift is invisible: a token minted from a short draw still looks right —
 * opaque, unique, base64url — while carrying a fraction of the entropy the
 * design claims.
 */

/**
 * Where a token's bytes come from.
 *
 * Injectable for one reason: the entropy claim was previously untestable, so it
 * was untested. A test naming it asserted uniqueness and a 43-character shape,
 * both of which a padded counter satisfies — and a padded counter substituted
 * for the CSPRNG left the whole suite green. A property no test can reach is a
 * property the code is free to lose.
 */
export type TokenBytesSource = (size: number) => Uint8Array;

/** 32 bytes = 256 bits. One constant, so prose and code cannot disagree. */
export const TOKEN_BYTES = 32;

/** The default source. Production has no reason to pass anything else. */
export const cryptoBytes: TokenBytesSource = randomBytes;

/**
 * Draws one token, refusing a source that returns the wrong width.
 *
 * `label` names the token kind so a failure says which mint refused.
 *
 * @throws if the source returns anything other than {@link TOKEN_BYTES} bytes.
 */
export function mintToken(label: string, source: TokenBytesSource): string {
  const bytes = source(TOKEN_BYTES);
  if (bytes.length !== TOKEN_BYTES) {
    throw new Error(
      `${label} byte source returned ${String(bytes.length)} bytes, expected ${String(TOKEN_BYTES)}. ` +
        'A token carries 256 bits of entropy by construction; a shorter draw is not a token.',
    );
  }
  // base64url so the token is safe in a JSON payload and in any log line that
  // manages to include one.
  return Buffer.from(bytes).toString('base64url');
}
