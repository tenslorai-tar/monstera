/**
 * What a thrown value says, without the file it was about: THE ONE SPELLING of a cause written where no path may be in
 * the clear (HHHHHHHHH-19). The failure log is attached to a crash report a person sends, and the chat history's store
 * names no PDF by its path, so neither does what is logged about it.
 *
 * A system error (Node's file calls) is said by its code and the call that raised it, `ENOENT on open`: its message
 * spells the path it was about, and the code is the part that says what happened. Anything else is said by its message,
 * which is this application's own wording or an engine's, neither of which is handed a path. The same holds of a plain
 * object carrying those fields, which is how a worker thread posts an error back.
 */
export function pathlessCause(thrown: unknown): string {
  if (typeof thrown !== 'object' || thrown === null) return String(thrown);
  if ('code' in thrown && typeof thrown.code === 'string') {
    const call = 'syscall' in thrown && typeof thrown.syscall === 'string' ? ` on ${thrown.syscall}` : '';
    return `${thrown.code}${call}`;
  }
  if ('message' in thrown && typeof thrown.message === 'string') return thrown.message;
  // AN OBJECT WITH NEITHER is said by the NAMES of its fields, never their values: its JSON said them all, and a `path`
  // field is the one a value would most likely carry (IIIIIIIII-24). `String` would say only `[object Object]`.
  return `an object with ${Object.keys(thrown).length === 0 ? 'no fields' : `fields ${Object.keys(thrown).join(', ')}`}`;
}
