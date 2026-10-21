import { describe, expect, it } from 'vitest';

import { HELP_ARTICLES } from './help/articles.js';
import { CONTEXT_PANEL_TAB_ASSISTANT, EN, OPEN_ASSISTANT_TITLE } from './messages/en.js';

/**
 * THE ASSISTANT IS CALLED THE AI ASSISTANT wherever a person reads it (the owner's R26, 2026-10-21: *"so people know
 * this is the AI assistant"*). The tab and the command are the two names the owner pointed at; every other message and
 * help article is read here too, because a sentence still saying *the assistant* beside a tab saying *AI assistant*
 * reads as two different things.
 */

/** Each mention of the assistant not named as the AI assistant. Placeholders are the code's names, not words a person reads. */
function bareMentions(text: string): readonly string[] {
  return [...text.replace(/\{[^}]*\}/gu, '').matchAll(/(?<!\bAI )\bassistant\b/giu)].map((match) => match[0]);
}

describe('the AI assistant’s name', () => {
  it('the tab and the command say AI assistant', () => {
    expect(EN[CONTEXT_PANEL_TAB_ASSISTANT]).toBe('AI assistant');
    expect(EN[OPEN_ASSISTANT_TITLE]).toBe('Open the AI assistant');
  });

  it('no message a person reads calls it just the assistant', () => {
    const bare = Object.entries(EN).filter(([, text]) => bareMentions(text).length > 0);
    expect(bare).toStrictEqual([]);
  });

  it('no help article calls it just the assistant', () => {
    const bare = HELP_ARTICLES.filter((article) =>
      bareMentions(JSON.stringify([article.title, article.summary, article.blocks])).length > 0,
    ).map((article) => article.id);
    expect(HELP_ARTICLES.length).toBeGreaterThan(0);
    expect(bare).toStrictEqual([]);
  });

  it('CONTROL: the old wordings are found, and the new ones and a placeholder are not', () => {
    expect(bareMentions('Open the assistant')).toHaveLength(1);
    expect(bareMentions('The Assistant is ready.')).toHaveLength(1);
    expect(bareMentions('Assistant')).toHaveLength(1);
    expect(bareMentions('Open the AI assistant')).toStrictEqual([]);
    expect(bareMentions('Try “{assistant}”.')).toStrictEqual([]);
  });
});
