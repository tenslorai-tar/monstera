import { type Article, parseArticle, searchTextOf } from './article.js';

/**
 * Every Help centre article, bundled with the renderer
 * ([ADR-0112](../../../../docs/DECISIONS/0112-the-help-centre-is-bundled-articles-and-f1-opens-the-one-for-where-you-are.md)).
 *
 * Read by the bundler at build time — `import.meta.glob` with `?raw` — so the Help centre needs no network, and the
 * set is the folder: an article added is an article shown, with no list here to forget it on.
 */
const SOURCES: Readonly<Record<string, string>> = import.meta.glob('./en/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Parsed once. Two articles with one id would make every link to it ambiguous, so that is refused here. */
function parseAll(): readonly Article[] {
  const articles = Object.entries(SOURCES)
    .map(([name, source]) => parseArticle(name, source))
    .sort((left, right) => left.title.localeCompare(right.title));
  const ids = new Set<string>();
  for (const article of articles) {
    if (ids.has(article.id)) throw new Error(`two help articles are named ${article.id}`);
    ids.add(article.id);
  }
  return articles;
}

export const HELP_ARTICLES: readonly Article[] = parseAll();

/**
 * The captured screenshots, by id — the file name without `.png` — bundled for the Help centre's reason: no network.
 * The set is the folder, as the articles' is, so a capture added is a picture shown and one removed is a picture that
 * is simply not drawn. What produces them is `packages/testing/src/helpScreens.capture.ts`.
 */
const SCREENSHOTS: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob<string>('./screenshots/*.png', { query: '?url', import: 'default', eager: true }),
  ).map(([path, url]) => [path.slice('./screenshots/'.length, -'.png'.length), url]),
);

/** Where the bundled capture for this screenshot id is, or `undefined` when none is captured. */
export function screenshotUrl(id: string): string | undefined {
  return SCREENSHOTS.get(id);
}

/** The article with this id, or `undefined`. */
export function helpArticle(id: string): Article | undefined {
  return HELP_ARTICLES.find((article) => article.id === id);
}

const SEARCH_TEXT = new Map(HELP_ARTICLES.map((article) => [article.id, searchTextOf(article)]));

/**
 * The articles a search finds: every word typed must appear in an article's title, summary, keywords or text. Titles
 * that match come first, so *rotate* finds *Rotate pages* before an article that mentions rotating in passing.
 */
export function searchHelp(query: string): readonly Article[] {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word !== '');
  if (words.length === 0) return HELP_ARTICLES;
  const found = HELP_ARTICLES.filter((article) => words.every((word) => SEARCH_TEXT.get(article.id)?.includes(word)));
  const inTitle = (article: Article): boolean => words.every((word) => article.title.toLowerCase().includes(word));
  return [...found.filter(inTitle), ...found.filter((article) => !inTitle(article))];
}

/**
 * The article for where a person is (ADR-0112 Decision 3): the one that teaches the tool in use, else the articles for
 * the context on show — a rail section, the start screen — in title order.
 */
export function helpFor(where: { readonly tool: string | undefined; readonly context: string }): {
  readonly article: Article | undefined;
  readonly related: readonly Article[];
} {
  const byTool = where.tool === undefined ? undefined : HELP_ARTICLES.find((article) => article.commands.includes(where.tool ?? ''));
  const related = HELP_ARTICLES.filter((article) => article.contexts.includes(where.context));
  return { article: byTool, related };
}
