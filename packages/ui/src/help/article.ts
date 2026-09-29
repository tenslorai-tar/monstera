/**
 * A Help centre article, read from the small Markdown this project writes its articles in
 * ([ADR-0112](../../../../docs/DECISIONS/0112-the-help-centre-is-bundled-articles-and-f1-opens-the-one-for-where-you-are.md)).
 *
 * ## A subset, parsed here, into DATA
 *
 * Headings (`##`, `###`), paragraphs, numbered and bulleted lists with one nested level, **bold**, `code` and simple
 * tables — everything the articles use and nothing else. The output is plain data the viewer turns into React
 * elements, so no article can put markup in the page: there is no HTML path to take. An image line names a screenshot
 * by id and is kept as a block — the viewer draws it when a capture with that id is bundled, and nothing otherwise,
 * never a placeholder; any other image is dropped. An HTML comment is the author's note and is dropped too.
 *
 * ## A malformed article throws
 *
 * Front matter without an id or a title is refused with the article named; any other line is text. The articles are
 * bundled at build time, so a refusal reddens the case that loads them all rather than a person's screen.
 */

/**
 * A run of text, bold, code, or a web ADDRESS. An address is written `<https://…>` and drawn as text a person can
 * select and copy — never a link: the renderer has no route to open a web page, and an article is not the place to
 * grow one.
 */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'address'; readonly text: string };

/** One list item: its text, and any items nested under it. */
export interface Item {
  readonly inline: readonly Inline[];
  readonly nested: readonly (readonly Inline[])[];
}

export type Block =
  | { readonly kind: 'heading'; readonly level: 2 | 3; readonly inline: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | { readonly kind: 'numbered'; readonly items: readonly Item[] }
  | { readonly kind: 'bulleted'; readonly items: readonly Item[] }
  | { readonly kind: 'table'; readonly header: readonly (readonly Inline[])[]; readonly rows: readonly (readonly (readonly Inline[])[])[] }
  /**
   * A screenshot the article names — `![alt](screenshot:id)`. DATA, like every block: the viewer draws it only when a
   * capture with this id is bundled, and draws nothing otherwise, never a placeholder that looks like a picture.
   */
  | { readonly kind: 'screenshot'; readonly id: string; readonly alt: string };

export interface Article {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
  /** The command ids this article teaches — checked against the registry, and what *Show me* rings. */
  readonly commands: readonly string[];
  /** Where it belongs: rail section ids, `start-screen`, dialog ids, `panel.<id>`. */
  readonly contexts: readonly string[];
  /**
   * **Bold** words that name ANOTHER application's controls — the Azure portal's *Keys and Endpoint* — and so are
   * exempt from the check that every bold word is Monstera's own. Listed, so each exception is visible in review.
   */
  readonly outside: readonly string[];
  readonly blocks: readonly Block[];
}

/** `**bold**`, `` `code` `` and `<https://address>` within a line; everything else is text. */
export function inlineOf(line: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|<(https:\/\/[^>\s]+)>/gu;
  let at = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > at) parts.push({ kind: 'text', text: line.slice(at, match.index) });
    if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: 'code', text: match[2] });
    else if (match[3] !== undefined) parts.push({ kind: 'address', text: match[3] });
    at = match.index + match[0].length;
  }
  if (at < line.length) parts.push({ kind: 'text', text: line.slice(at) });
  return parts;
}

/** A front matter value: `[a, b]` as a list, anything else as one string. */
function listOf(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  const inner = /^\[(.*)\]$/u.exec(value.trim())?.[1];
  if (inner === undefined) return [value.trim()];
  return inner
    .split(',')
    .map((each) => each.trim())
    .filter((each) => each !== '');
}

const cellsOf = (line: string): Inline[][] =>
  line
    .trim()
    .replace(/^\||\|$/gu, '')
    .split('|')
    .map((cell) => inlineOf(cell.trim()));

/**
 * Parses one article.
 *
 * @param name where it came from, for a refusal's message
 */
export function parseArticle(name: string, source: string): Article {
  const text = source.replaceAll('\r\n', '\n');
  const front = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  if (front === null) throw new Error(`${name}: an article opens with front matter between --- lines`);
  const fields = new Map<string, string>();
  for (const line of (front[1] ?? '').split('\n')) {
    const field = /^([a-z]+):\s*(.*)$/u.exec(line);
    if (field !== null) fields.set(field[1] ?? '', field[2] ?? '');
  }
  const id = fields.get('id')?.trim() ?? '';
  const title = fields.get('title')?.trim() ?? '';
  if (id === '' || title === '') throw new Error(`${name}: an article's front matter names its id and title`);

  const body = text.slice(front[0].length).replace(/<!--[\s\S]*?-->/gu, '');
  const blocks: Block[] = [];
  let list: { kind: 'numbered' | 'bulleted'; items: { inline: Inline[]; nested: Inline[][] }[] } | undefined;
  let table: { header: Inline[][]; rows: Inline[][][] } | undefined;
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inline: inlineOf(paragraph.join(' ')) });
    paragraph = [];
    if (list !== undefined) blocks.push(list);
    list = undefined;
    if (table !== undefined) blocks.push({ kind: 'table', header: table.header, rows: table.rows });
    table = undefined;
  };

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    // A SCREENSHOT, kept as data: whether it is drawn is the viewer's question, answered by what was captured.
    const shot = /^!\[([^\]]*)\]\(screenshot:([a-z0-9-]+)\)$/u.exec(line.trim());
    if (shot !== null) {
      flush();
      blocks.push({ kind: 'screenshot', id: shot[2] ?? '', alt: shot[1] ?? '' });
      continue;
    }
    // ANY OTHER IMAGE is not something an article may draw — there is no path from an article to a file or a web
    // address — so it is dropped.
    if (/^!\[[^\]]*\]\([^)]*\)$/u.test(line.trim())) continue;
    const heading = /^(#{2,3}) (.+)$/u.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1] === '##' ? 2 : 3, inline: inlineOf(heading[2] ?? '') });
      continue;
    }
    if (line.startsWith('# ')) {
      // THE TITLE, written again as a top heading by some articles: the viewer draws the front matter's.
      flush();
      continue;
    }
    if (line.trimStart().startsWith('|')) {
      if (/^\s*\|[\s:|-]+\|\s*$/u.test(line)) continue;
      if (table === undefined) {
        flush();
        table = { header: cellsOf(line), rows: [] };
      } else table.rows.push(cellsOf(line));
      continue;
    }
    const nested = /^ {2,4}(?:- |\d+\. )(.+)$/u.exec(line);
    if (nested !== null && list !== undefined) {
      const last = list.items.at(-1);
      if (last === undefined) throw new Error(`${name}: a nested item with no item above it`);
      last.nested.push(inlineOf(nested[1] ?? ''));
      continue;
    }
    const numbered = /^\d+\. (.+)$/u.exec(line);
    const bulleted = /^- (.+)$/u.exec(line);
    const item = numbered ?? bulleted;
    if (item !== null) {
      const kind = numbered !== null ? 'numbered' : 'bulleted';
      if (paragraph.length > 0 || table !== undefined || (list !== undefined && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push({ inline: inlineOf(item[1] ?? ''), nested: [] });
      continue;
    }
    if (list !== undefined && /^ {2,4}\S/u.test(line)) {
      // A LIST ITEM'S CONTINUATION LINE, wrapped by the author.
      const last = list.items.at(-1);
      if (last !== undefined) last.inline.push({ kind: 'text', text: ' ' }, ...inlineOf(line.trim()));
      continue;
    }
    if (list !== undefined || table !== undefined) flush();
    paragraph.push(line.trim());
  }
  flush();

  return {
    id,
    title,
    summary: fields.get('summary')?.trim() ?? '',
    keywords: listOf(fields.get('keywords')),
    commands: listOf(fields.get('commands')),
    contexts: listOf(fields.get('contexts')),
    outside: listOf(fields.get('outside')),
    blocks,
  };
}

/** Every word a person could search an article by, lower-cased: title, summary, keywords and body text. */
export function searchTextOf(article: Article): string {
  const inline = (parts: readonly Inline[]): string => parts.map((part) => part.text).join('');
  const blockText = (block: Block): string => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        return inline(block.inline);
      case 'numbered':
      case 'bulleted':
        return block.items.map((item) => [inline(item.inline), ...item.nested.map(inline)].join(' ')).join(' ');
      case 'table':
        return [...block.header, ...block.rows.flat()].map(inline).join(' ');
      // A PICTURE IS NOT TEXT A PERSON SEARCHED FOR: its alt describes a screen, and a search matching it would
      // find an article by the words of a caption the page may not even draw.
      case 'screenshot':
        return '';
    }
  };
  return [article.title, article.summary, ...article.keywords, ...article.blocks.map(blockText)].join(' ').toLowerCase();
}
