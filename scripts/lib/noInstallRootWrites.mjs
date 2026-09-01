// @ts-check
/**
 * Nothing shipped writes beside itself, as a static rule rather than a habit.
 *
 * Distribution is the Microsoft Store only ([ADR-0018](../../docs/DECISIONS/0018-distribution-is-the-microsoft-store.md)),
 * and **an MSIX application cannot write to its own install directory** — the
 * constraint ADR-0023's premise P1 is the other half of. A module that resolved
 * a writable path from where the app is installed would work on every developer
 * machine and fail on every real install, which is the class of defect that
 * cannot be found by running the thing.
 *
 * ## Why a lint rule, when the advisory register was tried first
 *
 * A verdict watching `getAppPath` was written into
 * `docs/security/engine-advisories.json` on 2026-09-01 and **withdrawn the same
 * day**, correctly refused by the register's own rule: a watched symbol needs a
 * witness proving the scan could find it, `getAppPath` is named nowhere in this
 * repository, and its only witness is Electron's `.d.ts` — which needs
 * provisioning, while the register's hand-picked lists cannot be derived claims.
 * Unwitnessed, a misspelling reads exactly like a clean verdict.
 *
 * A static rule has no such problem: ESLint parses the file and matches a
 * property name, so there is nothing to provision and nothing to witness. The
 * seam already exists — `eslint.config.js` registers this plugin and two rules
 * through it — so this is registration rather than new tooling.
 *
 * ## TWO NAMES, AND THE SCOPES ARE OPPOSITE
 *
 * They look like one rule and are two, which is why both are here and neither is
 * a special case of the other:
 *
 * - **`getAppPath`** is Electron's accessor for *where the app is installed*.
 *   Shipped code has no honest use for it: every writable path comes from
 *   `app.getPath`, and the install root is read-only under MSIX. Banned
 *   outright.
 * - **`getPath`** is *where the app may write*, and is legitimate — in exactly
 *   one file. `entry.ts` is the only module entitled to ask Electron that
 *   question and hand the answer down, which is the same discipline
 *   `pickDocument` and `AppInfo` already take. Confined rather than banned.
 *
 * ## What this deliberately does NOT watch, and why widening it would be worse
 *
 * `__dirname`, `import.meta.url` and `process.execPath` all resolve a location
 * from the app's own, and all three are used legitimately here — to **resolve a
 * module**, never to write. `engineHostPlatform.ts` finds the kernel entry
 * through `createRequire(import.meta.url).resolve`, which is the correct spelling
 * and the one the row praises.
 *
 * A rule cannot tell a read from a write by looking at the identifier, so
 * watching them would report the correct code and teach people to disable the
 * rule. Closing that half needs dataflow. **This watches the two names that have
 * no correct use in shipped code, and says so, rather than watching five and
 * being right about two** — a scan reported as covering the class while covering
 * one route is the shape this repository keeps paying for.
 */

/** The file allowed to ask Electron where the app may write. */
export const PATH_OWNER = 'apps/desktop/src/entry.ts';

/** @type {import('eslint').Rule.RuleModule} */
export const noInstallRootWrites = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'shipped code resolves no path from the install root, and asks Electron where it may ' +
        'write in exactly one file',
    },
    schema: [],
    messages: {
      installRoot:
        '`{{name}}` resolves the INSTALL ROOT, which an MSIX application cannot write to ' +
        '(ADR-0018, ADR-0023 premise P1). Every writable path comes from `app.getPath` in ' +
        `${PATH_OWNER}; a path derived from where the app is installed works on every ` +
        'developer machine and fails on every real install.',
      pathElsewhere:
        '`app.getPath` asks Electron where the application may write, and ' +
        `${PATH_OWNER} is the only file entitled to ask. Take the directory as a parameter ` +
        'instead — the same trade `pickDocument` and `AppInfo` already make, so that everything ' +
        'below stays decidable without a runtime.',
    },
  },

  create(context) {
    // NORMALISED, because ESLint reports a platform path and the allowlist is
    // written the way the repository is. A backslash comparison would pass on
    // Windows and fail nowhere else, which is the worst direction.
    const here = context.filename.replace(/\\/gu, '/');
    const isOwner = here.endsWith(PATH_OWNER);

    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== 'Identifier') return;
        const name = node.property.name;

        if (name === 'getAppPath' || name === 'resourcesPath') {
          context.report({ node: node.property, messageId: 'installRoot', data: { name } });
          return;
        }

        // `getPath` is reported only OUTSIDE its owner, so the rule is a
        // confinement rather than a ban and the owner needs no disable comment.
        if (name === 'getPath' && !isOwner) {
          context.report({ node: node.property, messageId: 'pathElsewhere' });
        }
      },
    };
  },
};

/**
 * A module that MUST be reported, so the rule's proof drives the real config.
 *
 * *No violations* is what a rule that matches nothing reports and also what this
 * clean tree reports — there is no `getAppPath` in any shipped file today, which
 * is the whole point and also the reason a planted offender is the only thing
 * that can say the rule sees.
 *
 * It carries **both** names, because the two branches have different scopes and
 * a fixture exercising one would leave the other unproven.
 */
export const PLANTED_INSTALL_ROOT_OFFENDER = [
  "import { app } from 'electron';",
  '',
  'export function where(): readonly string[] {',
  '  return [app.getAppPath(), app.getPath("userData")];',
  '}',
].join('\n');
