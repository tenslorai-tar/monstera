/**
 * The PROOF LOCALE — the founding record's *"i18n extraction complete (en + one proof locale)"*
 * (`BUILD-PROMPT.md`:721).
 *
 * ## What it is for
 *
 * Every English message, with its letters swapped for accented look-alikes, wrapped in `⟦ ⟧` and made about a third
 * longer. Under it, anything on screen that is still plain English did not come through the catalogue — a string
 * that escaped extraction — and anything cut off or overflowing is a layout that will break in a longer language.
 * Both are visible at a glance, which is the point: the English build cannot show either.
 *
 * ## Never a choice a person is offered
 *
 * It is not in {@link SHIPPED_LOCALES}, which is the list a language setting will offer, and nothing in a shipped
 * build activates it: the renderer turns it on only when it was BUILT with `VITE_MONSTERA_PSEUDO_LOCALE=on`, and a
 * case turns it on by calling {@link pseudoCatalogue} itself.
 *
 * ## ICU survives it
 *
 * A placeholder's name, a `plural` or `select` header, a branch's selector and `#` are copied exactly; only text is
 * transformed, branch bodies included. A catalogue that the transform broke would throw at render, so the case that
 * renders every message under it is also the proof that the transform keeps the syntax.
 */

/** The locales a person may be offered. The proof locale is not one, by construction. */
export const SHIPPED_LOCALES = ['en'] as const;

/** The proof locale's id: not a BCP 47 language, so nothing can mistake it for one. */
export const PSEUDO_LOCALE = 'pseudo';

const ACCENTED: Readonly<Record<string, string>> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

/** Plain text with its letters accented. */
const accented = (text: string): string => text.replace(/[A-Za-z]/gu, (letter) => ACCENTED[letter] ?? letter);

/** The index of the `}` that closes the `{` at `open`. */
function closing(message: string, open: number): number {
  let depth = 0;
  for (let at = open; at < message.length; at += 1) {
    if (message[at] === '{') depth += 1;
    else if (message[at] === '}' && --depth === 0) return at;
  }
  throw new Error(`an unbalanced brace in a catalogue message: ${message}`);
}

/** A message's text transformed and its ICU syntax kept: placeholders, headers, selectors and `#`. */
function transformed(message: string): string {
  let out = '';
  let at = 0;
  while (at < message.length) {
    const open = message.indexOf('{', at);
    if (open === -1) {
      out += accented(message.slice(at));
      break;
    }
    out += accented(message.slice(at, open));
    const close = closing(message, open);
    const inner = message.slice(open + 1, close);
    const choice = /^(\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,)([\s\S]*)$/u.exec(inner);
    if (choice === null) out += `{${inner}}`;
    else {
      // THE BRANCHES: each selector copied, each body transformed.
      const body = choice[2] ?? '';
      let branches = '';
      let from = 0;
      while (from < body.length) {
        const start = body.indexOf('{', from);
        if (start === -1) {
          branches += body.slice(from);
          break;
        }
        const end = closing(body, start);
        branches += `${body.slice(from, start)}{${transformed(body.slice(start + 1, end))}}`;
        from = end + 1;
      }
      out += `{${choice[1] ?? ''}${branches}}`;
    }
    at = close + 1;
  }
  return out;
}

/** One message in the proof locale: accented, marked at both ends, and about a third longer. */
export function pseudoMessage(message: string): string {
  const letters = message.replace(/\{[^{}]*\}/gu, '').length;
  return `⟦${transformed(message)}${'·'.repeat(Math.ceil(letters / 3))}⟧`;
}

/** The whole catalogue in the proof locale. */
export function pseudoCatalogue(messages: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, pseudoMessage(message)]));
}
