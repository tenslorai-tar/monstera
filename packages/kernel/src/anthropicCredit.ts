import { z } from 'zod';

/**
 * Reading the Anthropic API's refusals: its error body, and whether it says the ACCOUNT is out of
 * credit.
 *
 * ## One reader, because two callers held two opinions (B3a)
 *
 * The assistant's chat (`aiChat.ts`) and the Claude recognition engine (`ocrClaude.ts`) both talk
 * to this API, and both must turn this refusal into the same plain sentence the owner asked for —
 * *"Your Anthropic account is out of credit — add credit at console.anthropic.com"* — because
 * people will meet it from either door. `ocrClaude.ts` already read the error body with a schema
 * of its own; the chat was about to read it with a second. Both now call this.
 *
 * ## The body's message is the only signal, and that is the API's choice rather than ours
 *
 * Measured 2026-09-18 and recorded in `ocrClaude.ts`: an account out of credit answers **400**,
 * error type `invalid_request_error` — the same status and type as a malformed request — with the
 * message *"Your credit balance is too low to access the Anthropic API…"*. No status or type
 * separates it, so the message is read. Matched case-insensitively on `credit balance`, the phrase
 * that names the account's money and nothing else a request can get wrong.
 *
 * **Only a 400 is considered.** A 401 is a bad key and a 429 is a rate limit, and a message that
 * happened to mention credit on either must not turn a key problem into a billing one — the person
 * would go and pay rather than fix the key.
 */

/** An error response's body, as the API documents it: `{ type: 'error', error: { message } }`. */
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

/** Whether a refusal with this status and message is the account being out of credit. */
export function isAnthropicOutOfCredit(status: number, message: string | null): boolean {
  return status === 400 && message !== null && /credit balance/iu.test(message);
}

/**
 * The API's error message from a response body, or `null` where the body carries none — read
 * defensively, because the body is the peer's and may be anything. Consumes the body, so a caller
 * reads it once and passes the text on. Unbounded: a caller that shows it bounds it.
 */
export async function anthropicErrorMessage(response: Response): Promise<string | null> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.message : null;
  } catch {
    // A body that is not JSON carries no message; the status still says what happened.
    return null;
  }
}
