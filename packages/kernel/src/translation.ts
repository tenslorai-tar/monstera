/**
 * What a provider is asked when a page is translated, and how its answer is read back.
 *
 * ## One request per page, the blocks as a JSON array
 *
 * The page's blocks are the units a person sees outlined and the units `editTextBlock` writes, so
 * they are the units translated: each block's text, lines separated by line breaks, is one item of
 * an array, and the answer must be an array of the same length in the same order. One request per
 * page rather than per block, because a block is often a line and a line out of its paragraph is
 * translated worse — the model sees the page and answers item by item.
 *
 * ## The answer is refused whole when it is not exactly that
 *
 * A reply that is not a JSON array of strings, or has a different length, cannot be matched to the
 * blocks it is meant to replace — and a translation written into the wrong block is worse than none.
 * So {@link readTranslation} answers `undefined` and the caller reports the provider's answer as
 * unreadable. A fence around the array is tolerated because models add one when told not to; prose
 * around it is not searched for an array, because an array found inside an apology is a guess.
 *
 * Line breaks inside an item are the block's own lines. The model is asked to keep them, and a
 * translation that keeps a different number is still written: the block reflows either way
 * (ADR-0096), so the count is a request about looks, not a condition of correctness.
 */

/** The instruction ahead of the page, naming the language in English. */
export function translationInstruction(language: string): string {
  return [
    `You translate the text of one page of a PDF document into ${language}.`,
    'The user message is a JSON array of strings. Each string is one block of text on the page, in reading order; a line break inside a string separates the lines of that block.',
    `Answer with ONLY a JSON array of exactly the same number of strings, in the same order, each the ${language} translation of the string at the same position.`,
    'Keep the line breaks inside each string where a line break separates items such as list entries or address lines. Keep numbers, names, codes, e-mail addresses and web addresses as they are. A string that is already in the target language, or has nothing to translate, is answered unchanged.',
    'Do not add commentary, notes or a code fence.',
  ].join('\n');
}

/** The page's blocks as the request's one user message. */
export function translationRequest(blocks: readonly string[]): string {
  return JSON.stringify(blocks);
}

/**
 * The translated blocks, or `undefined` when the answer is not an array of `count` strings.
 *
 * @param answer the provider's whole reply
 * @param count how many blocks were sent
 */
export function readTranslation(answer: string, count: number): readonly string[] | undefined {
  const trimmed = answer.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/u.exec(trimmed);
  const body = fenced?.[1] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== count) return undefined;
  const texts: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') return undefined;
    texts.push(item.replace(INVISIBLE, ''));
  }
  return texts;
}

/**
 * Characters that draw nothing — zero-width space, joiners, word joiner, byte-order mark.
 *
 * A model puts them in answers it was not asked for them in (measured 2026-09-24: two U+200B in a
 * French translation of a corpus page), no standard font carries them, and so a page was refused
 * for a character no reader could ever see. Removed as the answer is read, they change nothing on
 * the page.
 */
const INVISIBLE = new RegExp(
  // BY CODE POINT, never typed: the characters themselves are invisible in this file, and an escape
  // written through an editing tool arrived as the character (2026-09-24, caught by lint's
  // no-irregular-whitespace). Numbers survive every tool.
  `[${String.fromCodePoint(0x200b)}-${String.fromCodePoint(0x200d)}${String.fromCodePoint(0x2060, 0xfeff)}]`,
  'gu',
);
