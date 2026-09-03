// @ts-check
/**
 * B7's *"React function components only"*, as a static rule with one exemption.
 *
 * `BUILD-PROMPT.md` rule B7 bans React class components outright. React has no
 * function form for an error boundary — `getDerivedStateFromError` is declared
 * on `StaticLifecycle` and `componentDidCatch` on `ComponentLifecycle`, both
 * class members, and no hook exists (read 2026-09-03 from
 * `node_modules/@types/react/index.d.ts:1225` and `:1219`, `@types/react`
 * 19.2.18 against `react` 19.2.8). So the law gained one confined exception
 * rather than a general relaxation
 * ([ADR-0036](../../docs/DECISIONS/0036-the-error-boundary-is-the-one-class-component.md),
 * `docs/ARCHITECTURE.md` §10.5a), and this is what confines it.
 *
 * ## The banned form is a class EXTENDING REACT'S BASE, not any class
 *
 * A React class component is a class whose superclass is React's `Component` or
 * `PureComponent`. Reporting every class instead would be a different rule
 * wearing this one's name: `DocumentStores` is a class, `AbortController`
 * subclasses exist, and a rule that reported them would be turned off — which
 * costs the class rather than the case.
 *
 * Both spellings are matched, because a codebase writes either and a fixture
 * exercising one leaves the other unproven:
 *
 *     class X extends Component { … }          // a named import
 *     class X extends React.Component { … }     // the namespace
 *
 * ## The owner is exempt, so this is a CONFINEMENT and not a ban
 *
 * `no-install-root-writes` confines `app.getPath` to `entry.ts` and
 * `no-bare-y-flip` confines the flip to `geometry.ts`; both carry a control
 * asserting the owner is *not* reported, without which a confinement is
 * indistinguishable from a ban. This one is the same shape and owes the same
 * control — and it owes it more, because the exempt file is the ONLY class
 * component in the tree, so a rule that reported its owner would be red on the
 * exact file the amendment exists to permit.
 *
 * ## What this does NOT catch, stated rather than left to be discovered
 *
 * A class component assembled indirectly — `const Base = Component; class X
 * extends Base` — is out of reach, for `no-bare-y-flip`'s reason: separating
 * that from any other subclass needs dataflow. Nothing in this tree writes it,
 * and a name-blind rule would report every class in the application.
 *
 * The rule is also scoped in `eslint.config.js` to `.tsx` under the rendering
 * packages, where React components live. A React class component written in a
 * `.ts` file is out of scope by placement, which is the same decision
 * `no-jsx-literals` and `no-raw-hex` already take and is recorded there.
 */

/** The one module permitted to declare a React class component. */
export const CLASS_COMPONENT_OWNER = 'packages/ui/src/ErrorBoundary.tsx';

/** React's two component base classes, as a member expression names them. */
const REACT_BASES = new Set(['Component', 'PureComponent']);

/**
 * The name a superclass expression carries, or null where it has none.
 *
 * An identifier answers with itself (`extends Component`); a member expression
 * answers with its property (`extends React.Component`), because that is the
 * name a reader sees and the name React exports under either import style.
 * Anything else — a call, a conditional — has no name, and a rule that guessed
 * one would be inventing the thing it matches on.
 *
 * @param {import('estree').Node | null | undefined} node
 * @returns {string | null}
 */
function baseName(node) {
  if (node === null || node === undefined) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noClassComponents = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'B7: React function components only. The error boundary is the single exception, ' +
        'because React declares getDerivedStateFromError on a class and offers no hook',
    },
    schema: [],
    messages: {
      classComponent:
        'React class component (`extends {{base}}`). B7 is function components only, and the ' +
        `one exception is ${CLASS_COMPONENT_OWNER} — an error boundary, which React has no ` +
        'function form for (ADR-0036, ARCHITECTURE §10.5a). If this is an error boundary, it ' +
        'belongs in that module; if it is anything else, it is a function component.',
    },
  },

  create(context) {
    // NORMALISED, because ESLint reports a platform path while the owner is
    // written the way the repository is. A backslash comparison would pass on
    // Windows and fail nowhere else, which is the worst direction.
    const here = context.filename.replace(/\\/gu, '/');
    if (here.endsWith(CLASS_COMPONENT_OWNER)) return {};

    /** @param {import('estree').Class} node */
    const report = (node) => {
      const base = baseName(node.superClass);
      if (base === null || !REACT_BASES.has(base)) return;
      context.report({ node, messageId: 'classComponent', data: { base } });
    };

    return { ClassDeclaration: report, ClassExpression: report };
  },
};

/**
 * A module that MUST be reported, so the rule's proof drives the real config.
 *
 * *No violations* is what a rule matching nothing reports and also what this
 * tree reports: the only class component in the application is the owner, which
 * is exempt. So a broken matcher and a clean repository produce identical
 * output, and a planted offender is the only thing that can tell them apart —
 * the confusion `consistent-type-imports` already cost this project once.
 *
 * Both spellings, because they take different branches of {@link baseName}.
 */
export const PLANTED_CLASS_COMPONENT_OFFENDER = [
  "import { Component } from 'react';",
  "import * as React from 'react';",
  '',
  'export class Named extends Component<{ a: number }> {',
  '  override render(): null {',
  '    return null;',
  '  }',
  '}',
  '',
  'export class Namespaced extends React.Component<{ a: number }> {',
  '  override render(): null {',
  '    return null;',
  '  }',
  '}',
].join('\n');

/**
 * A module that must NOT be reported, whatever file it is placed in.
 *
 * Without this the rule could report every class and still pass its offender
 * case, and a rule firing on `DocumentStores` is one somebody disables.
 *
 * Three legal shapes: a function component, a plain class, and a class
 * extending something that is not React's base — the last being the one a
 * base-blind rule gets wrong.
 */
export const PLANTED_CLASS_COMPONENT_INNOCENT = [
  'export function Fine(): null {',
  '  return null;',
  '}',
  '',
  'export class Store {',
  '  count = 0;',
  '}',
  '',
  'export class Louder extends Error {',
  '  readonly code = 1;',
  '}',
].join('\n');
