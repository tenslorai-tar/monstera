// @ts-check
/**
 * B9's rule: no literal user-facing string in JSX.
 *
 * > *"A lint rule bans literal user-facing strings in JSX. … These cannot be
 * > retrofitted across tens of thousands of lines."*
 *
 * ## Why this is written here rather than taken from a plugin
 *
 * `eslint-plugin-react` ships `react/jsx-no-literals`, and it is **not
 * adoptable**: version 7.37.5, last published 2025-04-03, declares
 * `peerDependencies.eslint: "^3 || … || ^9.7"`. This project runs ESLint 10.8.1,
 * so the plugin claims no support for the major it would be installed under.
 *
 * That is the same finding §10.4 already recorded for `eslint-plugin-jsx-a11y`
 * — *"last shipped 2024-10-26 and declares no ESLint 10 support, so it is not
 * adopted"* — and the same ruling follows. Adopting it anyway would mean a
 * dependency whose maintainers have not claimed it works here, holding up a rule
 * B9 calls substrate.
 *
 * Both versions were read from the registry on 2026-08-28.
 *
 * ## What it reports, and the one thing it deliberately does not
 *
 * **`JSXText` carrying a word.** That is the shape a user reads:
 * `<button>Save</button>`. Whitespace, punctuation and digits alone are not
 * reported — `<span>·</span>` and `<td>42</td>` are not sentences anybody
 * translates, and a rule that fires on them is a rule someone turns off.
 *
 * **A string literal in a JSX ATTRIBUTE is NOT reported here**, and that is a
 * division of labour rather than a gap. ADR-0029 Decision 6 gives that half to
 * the type system: a text-bearing prop is typed `MessageKey`, which a string
 * literal cannot satisfy, so the failure is a compile error at the call site
 * with the prop's own name on it. Deciding it here instead would need a
 * hand-kept list of which attribute names are user-facing — `label`, `title`,
 * `alt`, `placeholder`, and whatever the next component invents — which is the
 * second-opinion shape B3a forbids and would be wrong the day somebody adds a
 * prop the list has not heard of.
 *
 * Two mechanisms for two populations, and neither replaces the other:
 * `MessageKey` cannot see `<button>Save</button>`, because nothing there has a
 * type.
 *
 * ## Test files are out of scope, and the reason is not convenience
 *
 * The rule protects **what renders to a user**. A test's JSX is a fixture that
 * ships to nobody, and requiring a catalogue key for `<button>Open</button>` in
 * a harness would add ceremony to the one place literal text is the clearest
 * thing to write. The scoping lives in `eslint.config.js`, where every other
 * scope decision in this project lives, rather than being reimplemented here.
 */

/** A run of characters that no catalogue would ever hold. */
const NOT_A_SENTENCE = /^[\s\d\p{P}\p{S}]*$/u;

/** @type {import('eslint').Rule.RuleModule} */
export const noJsxLiterals = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'user-facing text in JSX comes from the message catalogue, never from a literal (B9)',
    },
    messages: {
      literal:
        'Literal user-facing text in JSX: {{text}}. B9 makes i18n substrate — strings are ' +
        'catalogue keys from the first line, because a retrofit across tens of thousands of ' +
        'lines is what this rule exists to prevent. Render a translated message instead.',
    },
    schema: [],
  },
  create(context) {
    /** @param {import('estree').Node & { value: string }} node */
    const report = (node) => {
      const text = node.value.trim();
      if (text === '' || NOT_A_SENTENCE.test(text)) return;
      context.report({
        node,
        messageId: 'literal',
        data: { text: JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text) },
      });
    };

    // CAST, because ESLint's core `RuleListener` is keyed on ESTree node types
    // and `JSXText` is not one: JSX nodes come from the parser —
    // `typescript-eslint` here — and core has no declaration for them. The cast
    // is documenting a real gap in the type, not silencing a real mismatch, and
    // `proof:lintrules` is what establishes that the visitor is actually called:
    // a listener keyed on a name the parser never emits is silent, which is the
    // same output as a clean tree.
    return /** @type {import('eslint').Rule.RuleListener} */ (
      /** @type {unknown} */ ({ JSXText: report })
    );
  },
};

/**
 * The plugin object, so `eslint.config.js` names the rule once.
 *
 * `monstera/no-jsx-literals` rather than a bare name: a flat config's rule
 * namespace is shared, and a bare `no-jsx-literals` would collide silently with
 * a plugin adding one later — resolving to whichever was registered last, with
 * no diagnostic.
 */
export const monsteraPlugin = {
  rules: { 'no-jsx-literals': noJsxLiterals },
};

/**
 * A file that MUST be reported, for the proof to drive through the real config.
 *
 * Checklist 4b: *zero violations* is what a rule that does not match reports,
 * and it is also what a clean tree reports. This project has already paid for
 * that exact confusion once — `@typescript-eslint/consistent-type-imports` was
 * enabled to catch a class it is structurally silent about, reported 0, and read
 * as coverage until a planted offender showed it.
 *
 * Kept beside the rule rather than inside the proof so the offender and the
 * matcher move together.
 */
export const PLANTED_OFFENDER = [
  'export function Probe(): unknown {',
  '  return <button type="button">Save changes</button>;',
  '}',
].join('\n');
