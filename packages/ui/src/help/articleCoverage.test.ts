import { describe, expect, it } from 'vitest';

import { EN } from '../messages/en.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { parseArticle } from './article.js';
import { commandCoverage, settingCoverage } from './articleCoverage.js';
import { HELP_ARTICLES } from './articles.js';
import { SETTINGS_NO_ARTICLE } from './noArticleNeeded.js';

/**
 * Whether the articles teach what the registries hold (ADR-0290). The command half needs the registry the shell builds,
 * and is `App.test.tsx`'; these cases hold the rule's every branch, and the settings, whose registry needs no shell.
 */

const article = (id: string, commands: readonly string[], body: string) =>
  parseArticle(`${id}.md`, `---\nid: ${id}\ntitle: ${id}\nsummary: s\ncommands: [${commands.join(', ')}]\n---\n${body}\n`);
const save = { id: 'a.save', names: ['Save a copy…'] };

describe('commandCoverage', () => {
  it('a command an article lists and names is taught', () => {
    expect(commandCoverage([save], [article('x', ['a.save'], 'Choose **Save a copy**.')], {}, {})).toStrictEqual({
      untaught: [],
      listedNotNamed: [],
      badExemptions: [],
    });
  });

  it('CONTROL: a command no article lists is reported, even when an article says its name', () => {
    // SAYING THE NAME IS NOT TEACHING IT here: F1 and *Show me* read the list, so a name in passing leaves both blind.
    expect(commandCoverage([save], [article('x', [], 'Choose **Save a copy**.')], {}, {}).untaught).toStrictEqual(['a.save']);
  });

  it('CONTROL: a listing with no sentence behind it is reported, which an id alone would pass', () => {
    const report = commandCoverage([save], [article('x', ['a.save'], 'Nothing about it.')], {}, {});
    expect(report.untaught).toStrictEqual([]);
    expect(report.listedNotNamed).toStrictEqual(['x: a.save']);
  });

  it('CONTROL: a name only in the title, the summary or the keywords does not count, because none of them teaches anything', () => {
    const inFrontMatter = parseArticle(
      'x.md',
      '---\nid: x\ntitle: Save a copy\nsummary: Save a copy\nkeywords: [save a copy]\ncommands: [a.save]\n---\nNothing about it.\n',
    );
    expect(commandCoverage([save], [inFrontMatter], {}, {}).listedNotNamed).toStrictEqual(['x: a.save']);
  });

  it('a name said only INSIDE a longer word is not said (FFFFFFFFF-2): *Select* in *selecting*, *Cut* in *shortcut*', () => {
    // THE ONE REAL PAIR this exposed, 2026-11-10: the Float bar article listed `annotate.select`, whose button reads
    // Select, and said only "selecting", which the old `includes` counted.
    const select = { id: 'a.select', names: ['Select annotations', 'Select'] };
    expect(commandCoverage([select], [article('x', ['a.select'], 'It holds selecting, the hand.')], {}, {}).listedNotNamed).toStrictEqual([
      'x: a.select',
    ]);
    const cut = { id: 'a.cut', names: ['Cut'] };
    expect(commandCoverage([cut], [article('y', ['a.cut'], 'Press the shortcut.')], {}, {}).listedNotNamed).toStrictEqual(['y: a.cut']);
  });

  it('CONTROL: the same names said as words are said, beside punctuation, bold and the start and end of the text', () => {
    const select = { id: 'a.select', names: ['Select'] };
    for (const body of ['Choose **Select**.', 'Select', 'Use Select, then drag.', '(Select)']) {
      expect(commandCoverage([select], [article('x', ['a.select'], body)], {}, {}).listedNotNamed, body).toStrictEqual([]);
    }
  });

  it('a written exemption excuses a command, and a written pair excuses a listing in other words', () => {
    const none = commandCoverage([save], [], { 'a.save': 'Because.' }, {});
    expect(none.untaught).toStrictEqual([]);
    expect(none.badExemptions).toStrictEqual([]);
    const words = commandCoverage([save], [article('x', ['a.save'], 'Press the key.')], {}, { 'x: a.save': 'Taught as a key.' });
    expect(words.listedNotNamed).toStrictEqual([]);
    expect(words.badExemptions).toStrictEqual([]);
  });

  it('CONTROL: an exemption that excuses nothing is reported, by each way it can stop being true', () => {
    const taught = [article('x', ['a.save'], 'Choose **Save a copy**.')];
    expect(commandCoverage([], [], { 'a.gone': 'Because.' }, {}).badExemptions).toStrictEqual(['a.gone: nothing registers this id']);
    expect(commandCoverage([save], taught, { 'a.save': 'Because.' }, {}).badExemptions).toStrictEqual([
      'a.save: an article teaches it now, so the exemption is stale',
    ]);
    expect(commandCoverage([save], [], { 'a.save': '  ' }, {}).badExemptions).toStrictEqual(['a.save: no reason is written']);
    expect(commandCoverage([save], taught, {}, { 'x: a.save': 'Because.' }).badExemptions).toStrictEqual([
      'x: a.save: the article lists it and says its name now, or no longer lists it',
    ]);
    expect(commandCoverage([save], [article('x', ['a.save'], 'Press the key.')], {}, { 'x: a.save': '' }).badExemptions).toStrictEqual([
      'x: a.save: no reason is written',
    ]);
  });
});

describe('the settings the dialog shows', () => {
  const shown = ALL_SETTINGS.filter((setting) => setting.remembered !== true).map((setting) => ({
    id: setting.id,
    names: [EN[setting.title] ?? `(no title for ${setting.id})`],
  }));

  it('are each named by an article, or carry a written reason (ADR-0290)', () => {
    // A SEARCH, so it must find what it looks for: a known setting, and enough of them that a broken filter shows.
    expect(shown.length).toBeGreaterThan(50);
    expect(shown.map((setting) => setting.id)).toContain('viewing.starting-zoom');
    const report = settingCoverage(shown, HELP_ARTICLES, SETTINGS_NO_ARTICLE);
    expect([...report.unnamed, ...report.badExemptions]).toStrictEqual([]);
  });

  it('CONTROL: a setting no article names is reported, and a remembered one is never asked about', () => {
    // WITH THE ZOOM ARTICLE GONE, the settings only it names are reported, on the real settings and articles.
    const without = HELP_ARTICLES.filter((each) => each.id !== 'zoom-and-fit');
    expect(settingCoverage(shown, without, SETTINGS_NO_ARTICLE).unnamed).toStrictEqual([
      'viewing.starting-zoom',
      'viewing.zoom-step',
      'rendering.quality',
      'rendering.tile-threshold',
      'rendering.page-memory',
    ]);
    // A REMEMBERED SETTING DRAWS NO ROW: the panel's width is the splitter, and no article need name it.
    expect(ALL_SETTINGS.find((setting) => setting.id === 'appearance.document-panel-width')?.remembered).toBe(true);
    expect(shown.map((setting) => setting.id)).not.toContain('appearance.document-panel-width');
  });

  it('CONTROL: a stale, unknown or unreasoned exemption is reported', () => {
    const one = [{ id: 's.one', names: ['Theme'] }];
    expect(settingCoverage(one, HELP_ARTICLES, { 's.one': 'Because.' }).badExemptions).toStrictEqual([
      's.one: an article names it now, so the exemption is stale',
    ]);
    expect(settingCoverage([], [], { 's.gone': 'Because.' }).badExemptions).toStrictEqual(['s.gone: the dialog shows no such setting']);
    expect(settingCoverage([{ id: 's.one', names: ['Nothing says this'] }], HELP_ARTICLES, { 's.one': '' }).badExemptions).toStrictEqual([
      's.one: no reason is written',
    ]);
  });
});
