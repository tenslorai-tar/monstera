import { CONVERSION_CHANNELS } from '@monstera/contract';

/**
 * Calls as a test recorded them, with each CONVERSION's work name checked and set aside (ADR-0234), for the command tests
 * that assert exactly what was sent.
 *
 * Every call on a conversion channel must carry a name, a fresh random id this side minted, which no case can spell; so the
 * name is required here, refused where absent or empty, and removed, and the rest of the call is compared as before. A
 * call on any other channel is returned as it was sent.
 */
export function namedWorkSetAside<T extends { readonly id: string; readonly params: unknown }>(sent: readonly T[]): T[] {
  const conversions: readonly string[] = CONVERSION_CHANNELS;
  return sent.map((call) => {
    if (!conversions.includes(call.id)) return call;
    const { work, ...rest } = call.params as { readonly work?: unknown };
    if (typeof work !== 'string' || work === '') {
      throw new Error(`${call.id} was sent without its work's name, so no notice can show it (ADR-0234)`);
    }
    return { ...call, params: rest };
  });
}
