// @ts-check
/**
 * `PDFDocument.load` must pin `updateMetadata: false` and `parseSpeed: ParseSpeeds.Fastest`, or go through the owner.
 * The second pin is {@link pinsParseSpeed}'s, with its measurement; the first is this header's.
 *
 * ## The defect this exists for, measured 2026-09-07
 *
 * `@cantoo/pdf-lib` defaults `updateMetadata` to **true**, which rewrites
 * `/ModDate` and `/Producer` on every save. A command that declares
 * `reproducible: true` and loads with the default is mis-declared: re-running
 * it against the same document produces different bytes. Two applies separated
 * by 1.1 seconds:
 *
 * | command | same bytes | `/ModDate` |
 * |---|---|---|
 * | `generateToc` (unpinned) | **no** | `172400Z` → `172401Z` |
 * | `insertImagePage` (unpinned) | **no** | `172401Z` → `172402Z` |
 * | `watermarkPages` (pinned) | yes | unchanged |
 *
 * ## Why a rule and not a review note
 *
 * The knowledge was already here and had already been paid for. The watermark's
 * FEATURES row records that the flag is what makes its `reproducible: true`
 * true, **and that the byte-equality case cannot see the stamp** — two saves
 * normally land inside one clock tick. Four call sites carried the flag and two
 * did not: the instance was fixed and the class was left, which is Rule 0's own
 * sentence.
 *
 * It surfaced as a **flake**, which is the only way an unpinned load can
 * surface: `pageToc.test.ts`'s byte-equality case fails exactly when two saves
 * straddle a second. A check that is usually green is worse than one that is
 * red, and this is what replaces it.
 *
 * ## What it reports, and the two things it deliberately does not
 *
 * A call to `PDFDocument.load` — or any `.load` on an identifier named
 * `PDFDocument` — whose second argument does not set `updateMetadata: false`,
 * and then one that does not set `parseSpeed: ParseSpeeds.Fastest`.
 * The property must be written literally: a spread or a variable is reported,
 * because *this call is pinned* has to be decidable here, and a rule that
 * accepted `...options` would pass the one shape that hides the default.
 *
 * **It does not look at `save`.** Save options differ per command — ADR-0008
 * makes incremental saving a decision about purpose — and folding the two
 * questions into one rule would give the wrong answer to the one that has
 * several.
 *
 * **It does not fire in test files.** A test may legitimately want the default
 * to observe what it does, and it is where the measurement above lives. The
 * scoping is in `eslint.config.js` with every other scope decision.
 */

/**
 * The module callers are sent to.
 *
 * **It is named in the message and NOT exempted**, which is worth stating
 * because the first spelling exempted it the way `noBareYFlip` exempts
 * `geometry.ts`. That exemption was dead: the owner's own call pins the flag,
 * so it passes on its merits, and ESLint reported the `eslint-disable` beside
 * it as unused — which is how a confinement that confines nothing announces
 * itself. `geometry.ts` genuinely needs its exemption because the legal
 * spelling there is textually identical to the banned one; here it is not.
 */
const LOAD_OWNER = 'packages/kernel/src/pdfLibSession.ts';

/**
 * Whether an argument node is literally `{ updateMetadata: false }` or better.
 *
 * Literal, for the reason in the header: a spread is the shape that hides a
 * default, so *pinned* must be readable from the call rather than inferred.
 *
 * @param {import('estree').Node | undefined} node
 * @returns {boolean}
 */
function pinsMetadata(node) {
  if (node === undefined || node.type !== 'ObjectExpression') return false;
  return node.properties.some(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      ((property.key.type === 'Identifier' && property.key.name === 'updateMetadata') ||
        (property.key.type === 'Literal' && property.key.value === 'updateMetadata')) &&
      property.value.type === 'Literal' &&
      property.value.value === false,
  );
}

/**
 * Whether an argument node pins `parseSpeed: ParseSpeeds.Fastest`, literally.
 *
 * ## The second default, measured 2026-10-16
 *
 * pdf-lib's `load` defaults `parseSpeed` to `ParseSpeeds.Slow`, 100: its parser hands the event loop back through a
 * zero-delay timer every 100 objects (`PDFParser.js`, `waitForTick`), so a load waits one timer tick per hundred objects
 * on top of the parse. Its writer's `objectsPerTick` is the same mechanism, closed for saves by `pdfLibSession.ts`
 * (KKKKKKKK-2); the parser was left, which is the half-fix this rule now names. Measured on this machine against the
 * 2,000-field form of `formFieldScale.test.ts`, two runs each: a field edit 597 and 603 ms with the default and 398 and
 * 405 ms pinned, a field creation 734 and 875 ms against 554 and 565 ms. The share grows with load, because a busy
 * machine stretches every tick.
 *
 * One spelling, for {@link pinsMetadata}'s reason: `ParseSpeeds.Fastest` is pdf-lib's own name for no yields, so the
 * pin is readable from the call and a reader need not know that the enum's value is `Infinity`.
 *
 * @param {import('estree').Node | undefined} node
 * @returns {boolean}
 */
function pinsParseSpeed(node) {
  if (node === undefined || node.type !== 'ObjectExpression') return false;
  return node.properties.some(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      property.key.type === 'Identifier' &&
      property.key.name === 'parseSpeed' &&
      property.value.type === 'MemberExpression' &&
      !property.value.computed &&
      property.value.object.type === 'Identifier' &&
      property.value.object.name === 'ParseSpeeds' &&
      property.value.property.type === 'Identifier' &&
      property.value.property.name === 'Fastest',
  );
}

/**
 * A module that MUST be reported, so the rule's proof drives the real config.
 *
 * *No violations* is what a rule matching nothing reports and also what this
 * tree reports once the two unpinned sites are fixed — so a broken matcher and
 * a clean repository produce the same output, and a planted offender is the
 * only thing that separates them.
 *
 * **Three spellings, because three ways of not pinning look different.** A bare
 * call with no options at all is how both real defects were written; a spread
 * is the shape that hides a default behind a variable; and `true` written out
 * is the one a reader would swear was deliberate. A fixture with only the first
 * leaves the two that are harder to see unproven.
 */
export const PLANTED_UNPINNED_LOAD = [
  "import { PDFDocument, ParseSpeeds } from '@cantoo/pdf-lib';",
  '',
  'export async function open(bytes: Uint8Array, options: { updateMetadata: boolean }) {',
  '  const bare = await PDFDocument.load(bytes);',
  '  const spread = await PDFDocument.load(bytes, { ...options, parseSpeed: ParseSpeeds.Fastest });',
  '  const wrong = await PDFDocument.load(bytes, { updateMetadata: true, parseSpeed: ParseSpeeds.Fastest });',
  '  const yielding = await PDFDocument.load(bytes, { updateMetadata: false });',
  '  const slow = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Slow });',
  '  return [bare, spread, wrong, yielding, slow];',
  '}',
].join('\n');

/** How many calls {@link PLANTED_UNPINNED_LOAD} holds, each reported once. */
export const PLANTED_UNPINNED_COUNT = 5;

/**
 * A module that must NOT be reported.
 *
 * Without this the rule could report every `.load` and still pass its offender
 * case, and a rule that fires on the pinned call is one somebody disables —
 * which costs the class rather than the case. Three legal shapes: the pin
 * itself, the pin among other options, and a `.load` on something that is not
 * `PDFDocument` at all.
 */
export const PLANTED_PINNED_LOAD = [
  "import { PDFDocument, ParseSpeeds } from '@cantoo/pdf-lib';",
  '',
  'declare const registry: { load: (bytes: Uint8Array) => Promise<unknown> };',
  '',
  'export async function open(bytes: Uint8Array) {',
  '  const pinned = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: ParseSpeeds.Fastest });',
  '  const among = await PDFDocument.load(bytes, { ignoreEncryption: true, parseSpeed: ParseSpeeds.Fastest, updateMetadata: false });',
  '  const other = await registry.load(bytes);',
  '  return [pinned, among, other];',
  '}',
].join('\n');

/** @type {import('eslint').Rule.RuleModule} */
export const noUnpinnedPdfLoad = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'pdf-lib rewrites /ModDate on save unless updateMetadata is pinned false, which makes a ' +
        'command declaring reproducible: true produce different bytes each run',
    },
    schema: [],
    messages: {
      unpinned:
        'PDFDocument.load without `updateMetadata: false`. pdf-lib defaults it to TRUE and ' +
        'rewrites /ModDate and /Producer on save, so a command declaring `reproducible: true` ' +
        'writes different bytes on every run — measured 2026-09-07, /ModDate moving 172400Z to ' +
        `172401Z across two applies. Use \`openForWriting\` from ${LOAD_OWNER}, which is the pin. ` +
        'A byte-equality case will NOT catch this: two saves normally land inside one clock tick.',
      yielding:
        'PDFDocument.load without `parseSpeed: ParseSpeeds.Fastest`. pdf-lib defaults it to Slow and waits one timer ' +
        'tick every 100 objects it parses — measured 2026-10-16, a 2,000-field edit at 600 ms against 400 ms pinned, ' +
        `and the share grows under load. Use \`openForWriting\` from ${LOAD_OWNER}, or pin it here.`,
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 'load') return;
        if (callee.object.type !== 'Identifier' || callee.object.name !== 'PDFDocument') return;
        if (!pinsMetadata(node.arguments[1])) context.report({ node, messageId: 'unpinned' });
        else if (!pinsParseSpeed(node.arguments[1])) context.report({ node, messageId: 'yielding' });
      },
    };
  },
};
