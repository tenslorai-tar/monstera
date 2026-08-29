import { type Brand, brandValue } from './brand.js';

/**
 * A key into the message catalogue. Never a sentence.
 *
 * ADR-0029 Decision 6 waits on this type: a command's `title` is a `MessageKey`
 * so that a literal fails **at the registry boundary**, with the property's own
 * name on the error, rather than reaching a surface and rendering untranslated.
 *
 * ## What this closes that the lint rule cannot
 *
 * `monstera/no-jsx-literals` sees `<button>Save</button>` — JSX text, where
 * nothing has a type. It cannot see `<Button label="Save" />`, because deciding
 * that would need a hand-kept list of which attribute names are user-facing, and
 * that list is wrong the day somebody adds a prop it has not heard of (B3a).
 *
 * The type sees exactly the case the rule cannot: a `MessageKey` parameter
 * refuses a `string` literal by construction. **Two mechanisms for two
 * populations, and neither is a replacement for the other** — the type cannot
 * see JSX text, and the rule cannot see a prop.
 *
 * ## The shape of a key, and why it is checked at the mint
 *
 * `<domain>.<name>`, lower-case, dot-separated: `dialog.rename.title`,
 * `command.save.label`. Checked here because this is the only door — a brand
 * whose minter accepts anything is a brand that documents an intention.
 *
 * The domain prefix is not decoration. Extraction produces one catalogue file
 * per domain, and a key with no domain has nowhere to be extracted to.
 *
 * ## THE PRIMITIVES ADOPTED IT ON 2026-08-29, WHICH IS WHAT THIS SECTION ASKED
 *
 * It read: *"the primitives' text props become `MessageKey` in the commit that
 * lands a resolver"*, and until then `Button`, `IconButton`, `Input` and
 * `Dialog` took `string` — because changing them earlier would have made every
 * one of them render **the key**, and a control that displays
 * `dialog.rename.title` to a user is worse than one that displays English.
 *
 * The resolver landed and they changed in the same commit. `label`, `title`,
 * `closeLabel` and `placeholder` are all `MessageKey` now, resolved by
 * `useLingui` at the control that renders them — and a key with no catalogue
 * entry **throws** rather than being displayed, which is the stronger form of
 * what this paragraph was protecting.
 *
 * The trigger is kept rather than deleted because it is the record of why the
 * gap existed, and because the shape recurs: a type that would render its own
 * placeholder is a type to hold back until the thing that resolves it exists.
 */
export type MessageKey = Brand<string, 'MessageKey'>;

/** `<domain>.<name>`, lower-case, dot-separated, no empty segment. */
const KEY_SHAPE = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9-]*)+$/u;

/**
 * Whether a string has the `<domain>.<name>` shape — the grammar shared by
 * message keys and command ids.
 *
 * **Exported so a command id is checked against the SAME rule and not a second
 * opinion about it** (B3a). ADR-0029 fixes a command id as *"the same grammar
 * as a `MessageKey`"*, and `check:secondwiring` matches ids in a surfaces
 * module by that grammar — so an id outside it is one the scan cannot see, and
 * a second wiring place written with such an id passes silently. That is the
 * failure this predicate exists to make unrepresentable, and it is why the
 * registry calls it rather than testing a regex of its own.
 *
 * **There is already one other opinion and it cannot be removed**:
 * `scripts/lib/secondWiringPlace.mjs` holds the same grammar as a scanning
 * regex, because a Node script cannot import this module. Two is what the
 * languages force; a third would be a choice. Changing the grammar means
 * changing both, and ADR-0029's built-note says so in the same words.
 */
export function isDottedName(value: string): boolean {
  return KEY_SHAPE.test(value);
}

/**
 * Mints a key, or throws.
 *
 * **Throws rather than returning a `Result`**, and the two are not
 * interchangeable here. Every call site is a literal written by a developer, so
 * a malformed key is a typo caught once at module load — not a runtime
 * condition a caller could handle differently. A `Result` would put an `if` at
 * hundreds of call sites for a branch none of them can do anything about, and
 * the first one to write `?? fallbackKey` would have reinvented the untranslated
 * string this type exists to forbid.
 *
 * @param value the key, e.g. `dialog.rename.title`
 */
export function messageKey(value: string): MessageKey {
  if (!KEY_SHAPE.test(value)) {
    throw new Error(
      `"${value}" is not a message key. A key is <domain>.<name> — lower-case, dot-separated, ` +
        `at least two segments, e.g. dialog.rename.title. What was passed looks like a sentence ` +
        `or a malformed key, and a catalogue cannot hold either.`,
    );
  }
  return brandValue<string, 'MessageKey'>(value);
}

/**
 * The domain a key belongs to — its first segment.
 *
 * Extraction groups by this, so it is derived from the key rather than declared
 * beside it: a domain stated twice is a domain that disagrees with itself.
 */
export function messageDomain(key: MessageKey): string {
  return key.split('.')[0] ?? '';
}
