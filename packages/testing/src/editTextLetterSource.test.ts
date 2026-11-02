import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * EDIT TEXT TAKES ITS LETTERS FROM PDFIUM, the engine its blocks, words and writer come from, and never from the text
 * layer's MuPDF read (the owner's rule, 2026-11-02): matching one engine's runs to the other's lines is a defect. So no
 * module of Edit text's own (`editText/`, and the editor kit it draws with, `editorKit/`) imports the text layer's letter
 * geometry or the hook that asks main for the text layer, or names that channel.
 *
 * ITS OWN MODULES, not everything they reach: Edit text imports the command helpers, the command registry imports every
 * surface, and a walk of the whole graph from it reaches the text layer by that road (measured 2026-11-02:
 * `EditTextLayer.tsx → documentCommands.ts → registries/commands.ts → SideBySide.tsx → PageList.tsx → usePageText.ts`),
 * which says nothing about where its letters come from.
 *
 * A SEARCH, so its positive control runs first: the same scan of the text layer's own module must find the import.
 */

/** `packages/ui/src`, read as files: the renderer itself may not touch the filesystem, so this check lives here. */
const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui', 'src');

/** The text layer's letters: the geometry built from them, and the one reader of the channel that carries them. */
const LETTER_READERS = [join(UI, 'textLayerLetters.ts'), join(UI, 'usePageText.ts')];
const CHANNEL = /['"]document\.pageTextLayer['"]/u;

/** The modules a file imports by a relative path, resolved to their sources. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/gu)].map((match) =>
    resolve(dirname(file), (match[1] ?? '').replace(/\.js$/u, '.ts')),
  );
}

/** What a file does that reads the text layer's letters: each letter reader it imports, and the channel if it names it. */
function readsLetters(file: string): string[] {
  const found = importsOf(file)
    .flatMap((imported) => LETTER_READERS.filter((reader) => reader === imported || reader === imported.replace(/\.ts$/u, '.tsx')))
    .map((reader) => reader.slice(UI.length + 1));
  if (CHANNEL.test(readFileSync(file, 'utf8'))) found.push('document.pageTextLayer');
  return found;
}

/** Edit text's own source modules, tests left out. */
function ownModules(): string[] {
  return ['editText', 'editorKit'].flatMap((folder) =>
    readdirSync(join(UI, folder))
      .filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))
      .map((name) => join(UI, folder, name)),
  );
}

describe('Edit text’s letters are PDFium’s (item 2)', () => {
  it('POSITIVE CONTROL: the scan finds the text layer reading its letters', () => {
    expect(readsLetters(join(UI, 'TextLayer.tsx'))).toContain('textLayerLetters.ts');
    expect(readsLetters(join(UI, 'usePageText.ts'))).toContain('document.pageTextLayer');
  });

  it('no module of Edit text or its editor kit reads the text layer’s letters', () => {
    const modules = ownModules();
    // NOT VACUOUS: both folders were read, the files the caret depends on among them.
    expect(modules.map((file) => file.slice(UI.length + 1))).toEqual(expect.arrayContaining(['editText/blockModel.ts', 'editorKit/paint.ts']));
    expect(modules.flatMap((file) => readsLetters(file).map((reader) => `${file.slice(UI.length + 1)}: ${reader}`))).toStrictEqual([]);
  });
});
