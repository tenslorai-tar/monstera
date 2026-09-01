// @ts-check
/**
 * The y-flip lives in one module, as a static rule rather than a sentence.
 *
 * Invariant L3 and `packages/shared/src/geometry.ts` both state it: PDF user
 * space is y-up and every screen space is y-down, so converting between them
 * subtracts a y from a bound — and `height - y` is correct **exactly** when the
 * page has no rotation and its CropBox starts at the origin. Most pages are
 * like that. A conversion that is right on the easy shape and wrong on the hard
 * one is the worst kind, because the first hundred documents confirm it.
 *
 * `CLAUDE.md` has asserted *"a bare y-flip is banned by lint"* since before any
 * such rule existed. This is that rule; the digest is corrected in the same
 * commit either way, because a digest that names a mechanism which is not there
 * reads as coverage.
 *
 * ## The banned form is a HEIGHT minus a Y, and that is the law's own wording
 *
 * `geometry.ts` says the difference in one sentence: `toViewport` subtracts
 * *"from the CropBox's top rather than from a page height, which is the whole
 * difference between this and the banned inline version."* So the shape to
 * report is not *any* subtraction involving a y — a same-space delta `b.y - a.y`
 * is ordinary arithmetic, and `crop.y1 - crop.y0` is a height — it is
 * specifically **a height-named operand minus a y-named one**.
 *
 * That keeps the rule decidable from the syntax and keeps the legal spelling
 * structurally different from the illegal one, rather than distinguishable by a
 * comment. A rule with false positives on correct code is a rule someone turns
 * off, and turning this one off costs the whole class.
 *
 * ## The owner is exempt, so this is a confinement rather than a ban
 *
 * `PageTransform` is the one thing permitted to convert, and it legitimately
 * writes `viewport.height - y` — not for the space flip, which subtracts from
 * `crop.y1`, but to **rotate within the viewport's own box**, where the height
 * is genuinely the bound. Reporting its owner would force a disable comment in
 * the one file that is right, which is how a rule acquires an escape hatch that
 * everything else then copies.
 *
 * `no-install-root-writes` confines `app.getPath` to `entry.ts` the same way,
 * and the control that matters is the same: a case asserting the owner is *not*
 * reported, without which a confinement is indistinguishable from a ban.
 *
 * ## What this does NOT catch, stated rather than left to be discovered
 *
 * A flip written through intermediates — `const h = viewport.height;` then
 * `h - point.y` — is caught only because `h` matches the height pattern by
 * name. One written as `bottom - point.y`, or through a value whose name says
 * nothing, is not: separating those needs dataflow, and a name-blind rule would
 * report every subtraction in the application.
 *
 * The types are the other half and they are already in place: the five spaces
 * are branded, so a `ViewportPoint` cannot be passed where a `PdfPoint` is
 * wanted. What the types cannot reach is arithmetic on the unbranded `number`
 * inside them, which is exactly the gap this closes and the reason the row owed
 * a rule as well as a type.
 */

/** The one module permitted to convert between coordinate spaces. */
export const FLIP_OWNER = 'packages/shared/src/geometry.ts';

/**
 * A name that denotes a height.
 *
 * `height`, `pageHeight`, `viewport.height`, and the bare `h` a hand-written
 * conversion reaches for. Anchored at the end so `heightOf` is not a height and
 * `rowHeights` is not one either — a plural is a collection, and subtracting a
 * y from one is already a type error.
 */
const HEIGHT_NAME = /^(?:h|[A-Za-z]*[Hh]eight)$/u;

/**
 * A name that denotes a y-coordinate.
 *
 * The bare `y`, a `.y` property, and the `somethingY` a destructured point
 * becomes. `y0` and `y1` are deliberately absent: they are box EDGES, and
 * `crop.y1 - crop.y0` is how a height is computed rather than how a point is
 * flipped.
 */
const Y_NAME = /^(?:y|[A-Za-z]+Y)$/u;

/**
 * The name a subtraction's operand carries, or null where it has none.
 *
 * A member expression answers with its property (`viewport.height` → `height`)
 * because that is the name a reader sees; an identifier answers with itself.
 * Anything else — a call, a literal, a nested expression — has no name, and a
 * rule that guessed one would be inventing the thing it matches on.
 *
 * @param {import('estree').Node} node
 * @returns {string | null}
 */
function operandName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noBareYFlip = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'only PageTransform converts between coordinate spaces; a bare `height - y` assumes ' +
        'rotation 0 and a CropBox at the origin',
    },
    schema: [],
    messages: {
      bareFlip:
        'Bare y-flip: `{{height}} - {{y}}`. This is correct only when the page has no rotation ' +
        'and its CropBox starts at the origin, which is most pages and not all of them — so it ' +
        `renders correctly until it does not. Convert through \`PageTransform\` in ${FLIP_OWNER}, ` +
        'which subtracts from the CropBox top with the quarter turn and the origin in hand ' +
        '(invariant L3).',
    },
  },

  create(context) {
    // NORMALISED, because ESLint reports a platform path while the owner is
    // written the way the repository is. A backslash comparison would pass on
    // Windows and fail nowhere else, which is the worst direction.
    const here = context.filename.replace(/\\/gu, '/');
    if (here.endsWith(FLIP_OWNER)) return {};


    return {
      BinaryExpression(node) {
        if (node.operator !== '-') return;
        if (node.left.type === 'PrivateIdentifier') return;
        const height = operandName(node.left);
        const y = operandName(node.right);
        if (height === null || y === null) return;
        if (!HEIGHT_NAME.test(height) || !Y_NAME.test(y)) return;
        context.report({ node, messageId: 'bareFlip', data: { height, y } });
      },
    };
  },
};

/**
 * A module that MUST be reported, so the rule's proof drives the real config.
 *
 * *No violations* is what a rule matching nothing reports and also what this
 * tree reports: the only `height - y` in the application is inside the owner,
 * which is exempt. So a broken matcher and a clean repository produce the same
 * output, and a planted offender is the only thing that can tell them apart.
 *
 * Both spellings, because they take different branches of {@link operandName} —
 * a bare identifier and a member property — and a fixture exercising one leaves
 * the other unproven.
 */
export const PLANTED_Y_FLIP_OFFENDER = [
  'export function place(height: number, y: number, point: { y: number }): readonly number[] {',
  '  return [height - y, height - point.y];',
  '}',
].join('\n');

/**
 * A module that must NOT be reported, whatever the file it is placed in.
 *
 * Without this the rule could report every subtraction and still pass its
 * offender case, and a confinement that fires on correct arithmetic is one
 * somebody disables — which costs the class rather than the case.
 *
 * Three legal shapes: a same-space delta, a height computed from two edges, and
 * a width, which shares the subtraction and none of the meaning.
 */
export const PLANTED_Y_FLIP_INNOCENT = [
  'export function spans(a: { y: number }, b: { y: number },',
  '  crop: { y0: number; y1: number; x0: number; x1: number }): readonly number[] {',
  '  return [b.y - a.y, crop.y1 - crop.y0, crop.x1 - crop.x0];',
  '}',
].join('\n');
