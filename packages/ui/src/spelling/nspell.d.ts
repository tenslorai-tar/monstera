/**
 * `nspell` ships no types, and this is the declaration rather than an `any`.
 *
 * B7 makes `any` an error and confines it to one adapter per **native**
 * boundary. This is not one — `nspell` is ordinary JavaScript — so the right
 * answer is not an exemption but a declaration of the surface actually used.
 *
 * **Only what this build calls.** A fuller transcription of the library's API
 * would be a second opinion about a shape nothing here checks: every extra
 * member is a claim the compiler will enforce against callers and the runtime
 * will not, so a wrong one turns a missing method into a confident type. Three
 * members are used and three are declared.
 *
 * The constructor takes the affix file and the word list, as strings. It also
 * accepts buffers and a `{aff, dic}` object; neither is declared, because the
 * one call site decodes to strings and a declared overload nobody uses is a
 * route for a future caller to take without anything having tested it.
 */
declare module 'nspell' {
  interface NSpell {
    /** Whether the dictionary accepts this word. */
    correct(word: string): boolean;
    /** Replacements, best first. Empty where it has none. */
    suggest(word: string): string[];
    /** Accepts a word from now on. Used for the personal dictionary. */
    add(word: string): NSpell;
  }

  function nspell(affix: string, words: string): NSpell;

  export default nspell;
}
