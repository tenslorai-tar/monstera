import { type Article, searchTextOf } from './article.js';

/**
 * Whether the Help centre teaches what the registries hold
 * ([ADR-0290](../../../../docs/DECISIONS/0290-a-feature-is-not-finished-until-an-article-teaches-it.md)).
 *
 * ## Why a listed id is not enough
 *
 * A command's id in an article's `commands:` is what F1 and *Show me* read, and it costs one word to write. So a list
 * that only asked for the id could be satisfied without a sentence of help, which is why a listing must also be backed
 * by the body: the article has to say a name the person reads on screen.
 */

/** One thing a person can reach: its registry id, and the names it goes by on screen. */
export interface HelpSubject {
  readonly id: string;
  readonly names: readonly string[];
}

export interface CommandCoverage {
  /** Commands no article lists and no exemption excuses. */
  readonly untaught: readonly string[];
  /** `article: command`, where an article lists a command and never says its name. */
  readonly listedNotNamed: readonly string[];
  /** Exemptions that excuse nothing: the id is gone, an article now teaches it, or no reason is written. */
  readonly badExemptions: readonly string[];
}

/** A name as an article would say it: *Save a copy…* is *save a copy*. */
const asWritten = (name: string): string => name.replaceAll('…', '').replace(/\s+/gu, ' ').trim().toLowerCase();

/**
 * Whether this article's BODY says any of these names.
 *
 * The title, the summary and the keywords are left out: a keyword is a word to find the article by, and it says
 * nothing about using the tool, so an article with a keyword and an empty body must not count as teaching it. A
 * mutation found this: with every other mention gone, the name in the keywords alone kept the check green.
 */
export function articleNames(article: Article, names: readonly string[]): boolean {
  const text = asWritten(searchTextOf({ ...article, title: '', summary: '', keywords: [] }));
  return names.some((name) => saysAsWords(text, asWritten(name)));
}

/** A letter or a digit in any script: what a name must not run into on either side to be said as words. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Whether `text` says `name` as words of its own: found with no letter or digit against either end.
 *
 * A bare `includes` counted *Cut* as said by *shortcut* and *Print* by *printer*, so the half of the rule that asks an
 * article to say what it lists could pass for a word it never wrote (FFFFFFFFF-2, the audit of 0a5262ba..01d02a84). An
 * empty name says nothing: it would be found in every article.
 */
export function saysAsWords(text: string, name: string): boolean {
  if (name === '') return false;
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = at === 0 ? '' : (text[at - 1] ?? '');
    const after = text[at + name.length] ?? '';
    if (!WORD_CHARACTER.test(before) && !WORD_CHARACTER.test(after)) return true;
  }
  return false;
}

/**
 * What the articles teach of `subjects`, given the two written lists.
 *
 * @param noArticle command id → why it has no article
 * @param otherWords `article: command` → why the article does not say the command's name
 */
export function commandCoverage(
  subjects: readonly HelpSubject[],
  articles: readonly Article[],
  noArticle: Readonly<Record<string, string>>,
  otherWords: Readonly<Record<string, string>>,
): CommandCoverage {
  const listed = new Set(articles.flatMap((article) => article.commands));
  const known = new Map(subjects.map((subject) => [subject.id, subject]));
  const notNamed = articles.flatMap((article) =>
    article.commands
      .filter((id) => {
        const subject = known.get(id);
        return subject !== undefined && !articleNames(article, subject.names);
      })
      .map((id) => `${article.id}: ${id}`),
  );
  const withoutReason = (id: string, reason: string): string[] => (reason.trim() === '' ? [`${id}: no reason is written`] : []);
  return {
    untaught: subjects.filter((subject) => !listed.has(subject.id) && !Object.hasOwn(noArticle, subject.id)).map((subject) => subject.id),
    listedNotNamed: notNamed.filter((pair) => !Object.hasOwn(otherWords, pair)),
    badExemptions: [
      ...Object.entries(noArticle).flatMap(([id, reason]) => [
        ...(known.has(id) ? [] : [`${id}: nothing registers this id`]),
        ...(listed.has(id) ? [`${id}: an article teaches it now, so the exemption is stale`] : []),
        ...withoutReason(id, reason),
      ]),
      ...Object.entries(otherWords).flatMap(([pair, reason]) => [
        ...(notNamed.includes(pair) ? [] : [`${pair}: the article lists it and says its name now, or no longer lists it`]),
        ...withoutReason(pair, reason),
      ]),
    ],
  };
}

/** The settings whose title no article says, and the exemptions that excuse nothing. */
export function settingCoverage(
  subjects: readonly HelpSubject[],
  articles: readonly Article[],
  exemptions: Readonly<Record<string, string>>,
): { readonly unnamed: readonly string[]; readonly badExemptions: readonly string[] } {
  const named = (subject: HelpSubject): boolean => articles.some((article) => articleNames(article, subject.names));
  const known = new Map(subjects.map((subject) => [subject.id, subject]));
  return {
    unnamed: subjects.filter((subject) => !Object.hasOwn(exemptions, subject.id) && !named(subject)).map((subject) => subject.id),
    badExemptions: Object.entries(exemptions).flatMap(([id, reason]) => {
      const subject = known.get(id);
      return [
        ...(subject === undefined ? [`${id}: the dialog shows no such setting`] : []),
        ...(subject !== undefined && named(subject) ? [`${id}: an article names it now, so the exemption is stale`] : []),
        ...(reason.trim() === '' ? [`${id}: no reason is written`] : []),
      ];
    }),
  };
}
