// @ts-check
/**
 * `needsPassword()` is an AUTHENTICATION ATTEMPT, and it is banned here.
 *
 * ## The defect this exists for, measured 2026-09-12
 *
 * MuPDF's `Document.needsPassword()` is `fz_needs_password`, which is
 * `pdf_needs_password`, which is **not a flag read**:
 *
 * ```
 * if (pdf_authenticate_password(ctx, doc, ""))
 *     return 0;
 * return 1;
 * ```
 *
 * and `pdf_authenticate_password` clears `doc->crypt->access` and re-derives
 * the file key from the password it was handed. So a call on a document that
 * has already been authenticated **un-authenticates it**. Measured on an
 * `aes-256` document opened with the right user password: one call takes page 0
 * from 24 structured-text blocks to **0**, with the engine printing *ignoring
 * zlib error: incorrect header check* as it inflates streams nothing decrypted,
 * and the same page rasters 9,109 bytes of PNG before and **2,056** after —
 * blank.
 *
 * ## Why a rule and not a comment
 *
 * The surface writes itself. *Prompt until the document stops needing a
 * password* is the obvious loop, the call is named exactly as if it answered
 * that question, and the loop it produces **never terminates** — the call
 * re-runs the empty password every turn and that attempt fails — **and**
 * destroys the key on its first turn, so the second password a person types is
 * checked against a document the first check already broke.
 *
 * Nothing about writing it looks wrong, which is the property a rule is for and
 * a comment is not. This is B5 applied to a name: the wrong choice stops being
 * expressible rather than being discouraged
 * ([ADR-0055](../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md),
 * `docs/ARCHITECTURE.md` §3.2).
 *
 * ## What it reports, and what it deliberately does not
 *
 * A call to `.needsPassword()` on anything. **Receiver-blind on purpose**: the
 * value it is called on is a `Document` from a binding this build reaches
 * through several names, and a rule keyed on one of them would pass the next
 * caller who spelt it differently — which is exactly the *partial
 * reimplementation* shape B3a names. The cost is that an unrelated API with a
 * method of this name would be reported; there is none in this tree, and the
 * message names the alternative, so a false positive is a sentence rather than
 * a puzzle.
 *
 * **There is no exemption.** `mupdfWriter.ts` is the one module that opens a
 * document, and it does not call this either: the question it answers is *did
 * this password work*, which only `authenticatePassword` can answer — for an
 * unencrypted document that call returns `1`, so the unencrypted path is the
 * same call and the same branch rather than a second one guarded by a question.
 *
 * **It does not fire in test files**, scoped in `eslint.config.js` with every
 * other scope decision: the fixture that names the banned form is what proves
 * the rule sees, and it must not be the thing the rule reports.
 */

/** Where a caller is sent instead. */
const UNLOCK_OWNER = 'packages/kernel/src/mupdfWriter.ts';

/**
 * A module that MUST be reported, so the rule's proof drives the real config.
 *
 * *No violations* is what a rule matching nothing reports and also what this
 * tree reports, so a planted offender is the only thing separating a working
 * rule from a broken one.
 *
 * **Three spellings, because three ways of asking look different.** The loop is
 * how the defect would actually be written; the plain read is the innocent
 * shape somebody adds to a status line; and the negation is what a person
 * writes when they think they are checking that a document is *fine*.
 */
export const PLANTED_NEEDS_PASSWORD = [
  'declare const document: { needsPassword: () => boolean; authenticatePassword: (p: string) => number };',
  'declare function prompt(): string;',
  '',
  'export function unlock(): void {',
  '  while (document.needsPassword()) {',
  '    document.authenticatePassword(prompt());',
  '  }',
  '}',
  '',
  'export function locked(): boolean {',
  '  return document.needsPassword();',
  '}',
  '',
  'export function readable(): boolean {',
  '  return !document.needsPassword();',
  '}',
].join('\n');

/**
 * A module that must NOT be reported.
 *
 * Without this the rule could report every call expression and still pass its
 * offender case. Three legal shapes: the call this build actually makes, a
 * property whose NAME is the banned one but which is never called, and a
 * differently named method on the same object.
 */
export const PLANTED_AUTHENTICATES = [
  'declare const document: { authenticatePassword: (p: string) => number; hasPermission: (p: string) => boolean };',
  'declare const flags: { needsPassword: boolean };',
  '',
  'export function unlock(password: string): number {',
  '  return document.authenticatePassword(password);',
  '}',
  '',
  'export function permitted(): boolean {',
  '  return document.hasPermission("print");',
  '}',
  '',
  'export function reported(): boolean {',
  '  return flags.needsPassword;',
  '}',
].join('\n');

/** @type {import('eslint').Rule.RuleModule} */
export const noNeedsPassword = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'MuPDF needsPassword() is pdf_authenticate_password(doc, "") — an authentication ' +
        'attempt that destroys the key a successful one derived, so calling it on an ' +
        'authenticated document makes every later stream read decrypt to garbage',
    },
    schema: [],
    messages: {
      asked:
        '`needsPassword()` is not a flag read. MuPDF implements it as ' +
        '`pdf_authenticate_password(doc, "")`, which clears the crypt access and re-derives ' +
        'the file key — so on a document that was already unlocked it UN-locks it, and every ' +
        'stream read afterwards inflates bytes nothing decrypted. Measured 2026-09-12: one ' +
        'call takes a page from 24 structured-text blocks to 0 and rasters it blank. Unlocking ' +
        `is an OPEN: pass the password to \`open\` in ${UNLOCK_OWNER}, whose return says ` +
        'whether it worked and which password it was (ADR-0055).',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier') return;
        if (callee.property.name !== 'needsPassword') return;
        context.report({ node, messageId: 'asked' });
      },
    };
  },
};
