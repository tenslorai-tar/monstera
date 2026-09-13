export { type ComposeChannels, composeChannels } from './host/composeChannels.js';
export { type ComposePageSize, MarkdownComposeRefused, composeMarkdown } from './markdownCompose.js';

/**
 * `@monstera/kernel/compose` — everything whose import loads the **Markdown parser**
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## A fourth entry point, for `pdfium.ts`' reason one subject along
 *
 * `pdfium.ts` states the rule: **one entry point per engine**, so importing one is a
 * decision with that engine's name on it. The composer is not a native engine, and
 * the rule's reason holds anyway — a file picked for import is parsed in the compose
 * host and never in `main`, and a barrel edge to `markdownCompose.js` would put
 * `markdown-it` in `main`'s module graph with nothing about the import looking
 * wrong.
 *
 * `proof:kernelload` reads the emitted graph: the barrel must not reach
 * `markdownCompose.js`, and this module must, which is the control that says the
 * walk can see it.
 *
 * ## Who imports what
 *
 * `main` takes `composeChannels` and the types, to build a client for the host. The
 * compose host's entry imports the composer directly. The composer is exported here
 * so the proof's control has a root-level module that reaches it.
 */
