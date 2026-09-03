import { i18n } from '@lingui/core';
// A DIRECT DEPENDENCY, declared in this package's `package.json` at the same
// version as `@lingui/core`. It arrives transitively either way; depending on
// it without saying so is a module that vanishes on a minor bump of a package
// this one does not control.
import { compileMessage } from '@lingui/message-utils/compileMessage';
import type { MessageKey } from '@monstera/shared';

/**
 * The message resolver — the half of the i18n scaffold that was held pending
 * this decision, and the trigger `packages/shared/src/messages.ts` names in its
 * own body.
 *
 * ## Explicit ids and source-as-message are not in tension, and neither ADR says
 * they are
 *
 * [ADR-0005](../../../docs/DECISIONS/0005-ui-foundation-libraries.md) chose
 * Lingui **because** it is source-as-message, and rejected i18next on a **scale**
 * argument: *"across a PDF editor's thousands of menu items, tooltips, tool
 * names and error strings that taxonomy becomes a permanent maintenance
 * surface"*. [ADR-0029](../../../docs/DECISIONS/0029-how-the-registries-are-built.md)
 * Decision 6 requires `title: MessageKey`, and says in its own words that it is
 * *"narrower than B9's lint rule and does not replace it … two mechanisms for
 * two populations"*.
 *
 * Registry metadata is one title per registered command, dialog or setting —
 * bounded by the registry rather than by the prose — so the rejection's stated
 * reason does not reach it. Prose gets `<Trans>`; registry titles get an id.
 *
 * **Lingui supports both with no new mechanism, verified against the shipped
 * declarations of 6.6.0 rather than recalled:** `TransProps` declares
 * `id: MessageId` required with `message?: string` optional, `MessageDescriptor`
 * is the same shape, and `I18n._` is overloaded as both `_(descriptor)` and
 * `_(id, values?, options?)`. The second overload is the call below.
 *
 * ## No macro, and therefore no transform decision taken here
 *
 * Nothing in this module imports either package's `macro` subpath — spelt that
 * way because the glob form closes this comment: a block comment cannot contain
 * the two characters a wildcard path puts between the scope and the entry, and
 * the compiler then parses the rest of the prose as code.
 *
 * ADR-0005 fixes the transform strategy *"before the first `<Trans>` is
 * written"*, and this writes none — so that decision is untouched and still owed
 * by whoever writes the first one.
 *
 * Measured 2026-08-29, from the artefact rather than from `npm ls`: a Vite
 * bundle importing `@lingui/core` and `@lingui/react` this way contains **zero**
 * occurrences of `@babel`, `babel`, `macro` or `regeneratorRuntime`. The string
 * is present two directories away — `@lingui/core/package.json` names babel
 * three times, and its `/macro` entry does — and absent from
 * `dist/index.mjs`, which is the entry this imports. So the scan was not blind
 * and the plugin is reachable only through a subpath nothing here takes.
 */

/**
 * A key with no entry in the active catalogue.
 *
 * **A throw, and the alternative is what `messages.ts` calls worse than
 * English**: Lingui's default for a missing message is to render the id, so a
 * control would show `dialog.rename.title` to a user. Failing closed makes it a
 * defect at the moment it happens instead of a string somebody screenshots.
 *
 * The expiry is a completeness check — every registered `MessageKey` has a
 * catalogue entry — which cannot be written until something is registered. Until
 * then this throw is the only guard, and it is deliberately the loud one.
 */
export class MessageMissing extends Error {
  constructor(
    readonly locale: string,
    readonly key: string,
  ) {
    super(
      `No message for "${key}" in the "${locale}" catalogue. Every MessageKey a surface can ` +
        `render must have an entry; rendering the key itself is worse than rendering English.`,
    );
    this.name = 'MessageMissing';
  }
}

// Registered at module scope rather than inside `activateCatalogue`, because the
// policy belongs to the instance and not to a load: a resolver used before any
// catalogue is active must fail the same way as one used after.
i18n.on('missing', (event) => {
  throw new MessageMissing(event.locale, event.id);
});

/**
 * THE MESSAGE COMPILER, REGISTERED BY US RATHER THAN INHERITED.
 *
 * ## The defect, measured 2026-09-03
 *
 * `I18n`'s constructor registers `compileMessage` **only when
 * `process.env.NODE_ENV !== 'production'`** (`@lingui/core` 6.6.0,
 * `dist/index.mjs:239`). Without a compiler, `_(id, values)` returns the raw
 * catalogue string, so every placeholder reaches the screen literally: the
 * built renderer rendered *"Monstera closed unexpectedly. Reopen {name}?"*, and
 * `Page {page} of {count}`, and `{count} matches on this page`.
 *
 * **Nothing in this repository could see it.** Every unit test runs in
 * development mode, where the constructor registers the compiler for us, so
 * every case asserting an interpolated string passed. What found it is the axe
 * gate, because that is the one check that drives the BUILT renderer — the
 * artefact the difference lives in.
 *
 * ## Why registering it rather than precompiling the catalogue
 *
 * Lingui's own answer is to precompile with its CLI, which is a build step, a
 * generated artefact and a second representation of `messages/en.ts` that can
 * go stale. `setMessagesCompiler` is the library's documented alternative for
 * *"if you need to compile catalogs at runtime"*, and it makes this build's
 * behaviour **the same in both modes** — which is the property that failed
 * here. A behaviour that depends on `NODE_ENV` is one that no test can hold.
 *
 * The cost is the ICU parser in the production bundle. That is the same parser
 * every development run already loads, and the alternative is a class of defect
 * that only the shipped artefact can exhibit.
 */
i18n.setMessagesCompiler(compileMessage);

/**
 * Loads a catalogue and makes it the active one.
 *
 * Both in one call, because a loaded-but-inactive catalogue is a state with no
 * use here — there is one locale live at a time and nothing switches without
 * loading. Two calls would be two chances to do half of it.
 */
export function activateCatalogue(
  locale: string,
  messages: Readonly<Record<string, string>>,
): void {
  // Spread rather than cast: `load` takes a mutable record, and the alternative
  // to copying is `as Record<string, string>` — widening a type to make an error
  // disappear, in the one parameter a caller might reasonably keep and mutate.
  i18n.load(locale, { ...messages });
  i18n.activate(locale);
}

/**
 * The resolved text for a key.
 *
 * The shape `DialogHost` and the primitives take: a `MessageKey` in, display
 * text out, with no component involved — so a non-React caller resolves the same
 * way a component does and there is one answer rather than two.
 *
 * @throws MessageMissing when the active catalogue has no entry.
 */
export function resolve(key: MessageKey): string {
  return i18n._(key);
}

/** The instance `I18nProvider` is given, so components and callers share one. */
export { i18n };
