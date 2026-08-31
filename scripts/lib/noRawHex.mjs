// @ts-check
/**
 * §10.2's rule: a component consumes tokens, never a raw colour.
 *
 * `docs/ARCHITECTURE.md` §10.2, verbatim: *"Components consume tokens only; a
 * raw hex value or magic pixel number in a component is a lint error unless the
 * value is genuinely dynamic."*
 *
 * ## The scope is COMPONENTS, and that is the law rather than a convenience
 *
 * `CLAUDE.md` carried this as *"No raw hex … anywhere"*, which is wider than
 * §10.2 and wider than `BUILD-PROMPT.md` rule 16 and Part M2, both of which say
 * *in a component*. That extra word had a cost: it made
 * `windowPolicy.ts`'s `WINDOW_BACKGROUND` look like a violation, and the rule
 * was held back behind a token move nothing actually required. The digest is
 * corrected in the same commit as this file, per `CLAUDE.md`'s own header —
 * where it and the architecture document disagree, the architecture document is
 * right.
 *
 * So the scoping lives in `eslint.config.js` with every other scope decision in
 * this project, and it names component files. A rule that decided for itself
 * what a component is would be a second opinion about the file layout (B3a).
 *
 * ## What "genuinely dynamic" means here, and why it needs no exemption
 *
 * §10.2 exempts a value that is genuinely dynamic. A computed colour is not a
 * literal, so it is not a node this rule visits — the exemption is delivered by
 * the shape of the check rather than by a list of allowed call sites. That is
 * B5 rather than a comment: the legal case cannot be written as the illegal
 * one.
 *
 * `onColor(brand, background, minRatio)` is the sanctioned producer, and §10.2's
 * companion rule — storing a derived colour is a defect — is a different claim
 * about a different population, unaddressed here.
 *
 * ## Hex only, and the magic-pixel half is deliberately not attempted
 *
 * §10.2 names two things and this rule implements one. A numeric literal in a
 * component is `0`, `1`, an index, a duration, a count; reporting them needs a
 * model of which numbers are lengths, and a rule that fires on `slice(0, 40)` is
 * a rule someone turns off — which costs the colour half as well. Stated rather
 * than left for a reader to notice the gap.
 */

/**
 * A CSS hex colour: three, four, six or eight digits after a `#`.
 *
 * Anchored whole. An unanchored pattern matches the `#0f0` inside a comment
 * string or a URL fragment, and a rule with false positives is one that gets
 * disabled.
 */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;

/** @type {import('eslint').Rule.RuleModule} */
export const noRawHex = {
  meta: {
    type: 'problem',
    docs: {
      description: 'a component consumes design tokens, never a raw hex colour (§10.2)',
    },
    messages: {
      rawHex:
        'Raw hex colour in a component: {{value}}. §10.2 makes components consume tokens only. ' +
        'Use a token, or compute a contrast-bearing colour at the point of use with ' +
        'onColor(brand, background, minRatio) — a computed value is not a literal and this rule ' +
        'never sees it.',
    },
    schema: [],
  },
  create(context) {
    /** @param {string} raw @param {import('estree').Node} node */
    const check = (raw, node) => {
      if (!HEX_COLOUR.test(raw)) return;
      context.report({ node, messageId: 'rawHex', data: { value: raw } });
    };

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        check(node.value.trim(), node);
      },
      // A TEMPLATE WITH NO EXPRESSIONS IS A STRING with different quotes, and
      // leaving it out would make the rule avoidable by typing a backtick.
      // One with expressions is dynamic, which §10.2 exempts.
      TemplateLiteral(node) {
        if (node.expressions.length > 0) return;
        const [only] = node.quasis;
        if (only === undefined) return;
        check(only.value.raw.trim(), node);
      },
    };
  },
};

/**
 * A file that MUST be reported, for the proof to drive through the real config.
 *
 * Checklist 4b, and this rule needs it more than its neighbour does: there is
 * currently **no** raw hex in any component, so a rule that matched nothing at
 * all would report exactly what a clean tree reports. The two hex values in this
 * repository are in `windowPolicy.ts` and `canvasHarness.ts`, neither of which
 * is a component — so *zero* is the honest answer here and also the answer a
 * broken matcher gives.
 *
 * Kept beside the matcher so the offender and the pattern move together.
 */
export const PLANTED_HEX_OFFENDER = [
  'export function Swatch(): unknown {',
  "  return <div style={{ color: '#ff00ff' }} />;",
  '}',
].join('\n');
