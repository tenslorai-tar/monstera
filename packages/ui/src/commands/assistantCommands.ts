import { MAX_ASK_SELECTION } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import type { AnnotationSelection } from '../annotations/selectTool.js';
import type { AskAssistant } from '../assistantRequest.js';
import {
  ASK_AI_SELECTION_TITLE,
  ASSISTANT_PROMPT_DRAFT_REPLY,
  ASSISTANT_PROMPT_EXPLAIN,
  ASSISTANT_PROMPT_SUMMARISE,
  ASSISTANT_PROMPT_TRANSLATE,
  DRAFT_REPLY_TITLE,
  EXPLAIN_SELECTION_TITLE,
  SUMMARISE_SELECTION_TITLE,
  TRANSLATE_SELECTION_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
import type { TextSelection } from '../TextLayer.js';

/**
 * The assistant, reached from a right-click
 * ([ADR-0088](../../../docs/DECISIONS/0088-an-ask-about-a-document-carries-a-bounded-window-read-in-main.md);
 * the owner's design, 2026-09-15: *Ask AI · Explain · Summarise · Translate* on selected text,
 * and reply-to-sticky-note).
 *
 * ## Each is one placement on a command, and the panel does the asking
 *
 * A command names the scope — the words selected, or the note's text — and, for all but *Ask
 * AI*, the question. `App`'s one `ask` reveals the panel and hands it the request, so the
 * conversation, the *Asking about* line and the provider stay the panel's. *Ask AI* points the
 * panel and asks nothing: the person types the question.
 *
 * ## The selection is read when the item is chosen
 *
 * `textSelectionCommands.ts`' rule: `selection()` answers what is selected NOW, and `when`
 * hides every item where nothing is.
 */
export interface AssistantCommandDeps {
  readonly selection: () => TextSelection | undefined;
  readonly ask: AskAssistant;
}

/** The four items, in the owner's order, after the menu's own seven. */
const SELECTION_ITEMS: readonly {
  readonly id: string;
  readonly title: MessageKey;
  readonly prompt: MessageKey | undefined;
  readonly order: number;
}[] = [
  { id: 'ai.ask-selection', title: ASK_AI_SELECTION_TITLE, prompt: undefined, order: 80 },
  { id: 'ai.explain-selection', title: EXPLAIN_SELECTION_TITLE, prompt: ASSISTANT_PROMPT_EXPLAIN, order: 90 },
  { id: 'ai.summarise-selection', title: SUMMARISE_SELECTION_TITLE, prompt: ASSISTANT_PROMPT_SUMMARISE, order: 100 },
  { id: 'ai.translate-selection', title: TRANSLATE_SELECTION_TITLE, prompt: ASSISTANT_PROMPT_TRANSLATE, order: 110 },
];

/** *Ask AI · Explain · Summarise · Translate* on the selected text. */
export function assistantSelectionCommands(deps: AssistantCommandDeps): readonly UiCommand[] {
  return SELECTION_ITEMS.map(({ id, title, prompt, order }) => ({
    id,
    title,
    placements: [{ surface: 'context-menu', context: 'selection', order }] as const,
    when: () => deps.selection() !== undefined,
    run: (context): void => {
      const selection = deps.selection();
      if (context.docId === undefined || selection === undefined) return;
      // CUT TO THE CHANNEL'S BOUND rather than refused there: a long selection is still a
      // question about its opening, and the window's line says what went.
      deps.ask(
        { scope: 'selection', docId: context.docId, page: selection.page, text: selection.text.slice(0, MAX_ASK_SELECTION) },
        prompt,
      );
    },
  }));
}

/**
 * *Draft a reply* on a comment: the assistant is asked for a reply to the note's text, and
 * the answer carries a button that posts it as `replyToAnnotation` — PDF's own thread
 * (`replySelectionCommand`), never the assistant writing into the document by itself.
 *
 * Hidden for a mark with nothing written in it: there is nothing to reply to, and an ask
 * about an empty note would be a request for invention.
 */
export function draftReplyCommand(deps: {
  readonly selection: () => AnnotationSelection | undefined;
  readonly ask: AskAssistant;
}): UiCommand {
  const only = () => {
    const selection = deps.selection();
    const item = selection?.items.length === 1 ? selection.items[0] : undefined;
    const text = item?.contents.trim() ?? '';
    return selection === undefined || item === undefined || text === '' ? undefined : { selection, item, text };
  };
  return {
    id: 'ai.draft-reply',
    title: DRAFT_REPLY_TITLE,
    // AFTER *Reply*, which is the person's own: the owner's order for this menu puts reply second.
    placements: [{ surface: 'context-menu', context: 'annotation', order: 25 }],
    when: () => only() !== undefined,
    run: (context): void => {
      const target = only();
      if (context.docId === undefined || target === undefined) return;
      const { selection, item, text } = target;
      deps.ask(
        // A COMMENT, not a selection: the instruction names what the text is.
        { scope: 'comment', docId: context.docId, page: selection.page, text: text.slice(0, MAX_ASK_SELECTION) },
        ASSISTANT_PROMPT_DRAFT_REPLY,
        { page: selection.page, index: item.index, version: selection.version },
      );
    },
  };
}
