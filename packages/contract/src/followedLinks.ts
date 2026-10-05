/**
 * Which addresses a person may follow out of a document (ADR-0167 Decision 3).
 *
 * **One rule with two callers**: the renderer's dialog, which says before anything is sent that an address will not be
 * opened, and `main`, which opens only what this allows. Two spellings of the list would agree until one gained a
 * scheme (B3a), and the side that decides is `main`'s, so the renderer's answer is only ever a courtesy.
 *
 * A web page and a new mail message. Every other scheme a document can name — `file:`, `javascript:`, a custom handler
 * registered by some other program — hands the operating system something it would run rather than show.
 */
export const FOLLOWED_SCHEMES = ['https:', 'http:', 'mailto:'] as const;

/**
 * RFC 3986 §3.1's scheme, at the very start of the address: a letter, then letters, digits, `+`, `-` or `.`, then
 * the colon.
 *
 * **Stricter than a URL parser, on purpose.** WHATWG's parser strips leading spaces and control characters and
 * removes tabs and newlines anywhere, so `" javascript:…"` and `"java\tscript:…"` parse as `javascript:`. Read here,
 * neither has a scheme, so neither is followed: the address handed to the system is the one this read, and a reading
 * more lenient than the check would be a second opinion about the same string.
 */
const SCHEME = /^([a-z][a-z\d+.-]*):/iu;

/** An address's scheme, lower case with its colon, or `null` for one that does not begin with one. */
export function schemeOf(address: string): string | null {
  const found = SCHEME.exec(address);
  return found?.[1] === undefined ? null : `${found[1].toLowerCase()}:`;
}

/** The longest scheme a refusal says, in characters: RFC 3986 bounds no scheme, and a document can name one of any length. */
export const SHOWN_SCHEME_MAX = 64;

/**
 * An address's scheme as a refusal SAYS it: {@link schemeOf}, cut to {@link SHOWN_SCHEME_MAX}. The one spelling for
 * every side that puts a scheme in a message — `main`'s answer and the renderer's dialog both carry it under a schema
 * bounded by the same constant, so a document naming a longer one is told it is refused rather than failing the parse.
 * Never the input to a decision: {@link isFollowable} reads the whole scheme.
 */
export function shownSchemeOf(address: string): string | null {
  return schemeOf(address)?.slice(0, SHOWN_SCHEME_MAX) ?? null;
}

/** Whether an address may be opened in the person's browser or mail program. */
export function isFollowable(address: string): boolean {
  const scheme = schemeOf(address);
  return scheme !== null && (FOLLOWED_SCHEMES as readonly string[]).includes(scheme);
}
