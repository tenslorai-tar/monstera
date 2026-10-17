import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Each host entry binds its engine, connects its pipe, and only then imports the module that serves its channels
 * ([ADR-0251](../../../../docs/DECISIONS/0251-a-host-reaches-its-pipe-before-it-loads-its-handlers.md)). `main`'s
 * connect bound waits for the connect, and an ES module's static imports are all evaluated before its first statement,
 * so what this holds is the entry's static import list: the binding, the pipe, and nothing that serves.
 *
 * Read from the source, which is what decides the order: the measured cost is in `scripts/research/hostStartWalk.mjs`,
 * which reads each host's own `connected` and `handlers loaded` lines in the running application.
 */
const HERE = import.meta.dirname;

/** The modules a launcher may import statically: its engine's binding, the start line, the pipe, its arguments. */
const LAUNCHER_MAY_IMPORT = new Set([
  '../mupdfRaw.js',
  '../pdfiumBinding.js',
  './bindEngine.js',
  './hostNodeSurfaces.js',
  './composeArguments.js',
]);

const ENTRIES = [
  { entry: 'hostEntry.ts', serves: './mupdfHostServe.js' },
  { entry: 'pdfiumHostEntry.ts', serves: './pdfiumHostServe.js' },
  { entry: 'composeHostEntry.ts', serves: './composeHostServe.js' },
] as const;

/** Every specifier a source imports statically, `import type` excluded since it is erased. */
function staticImports(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)';/gmu)].map((match) => match[1] ?? '');
}

/** Where in a source the pipe is connected, and where the serving module is imported dynamically; -1 for absent. */
function order(source: string, serves: string): { connect: number; load: number } {
  return { connect: source.indexOf('hostPipeStream('), load: source.indexOf(`await import('${serves}')`) };
}

describe('a host reaches its pipe before it loads its handlers (ADR-0251)', () => {
  for (const { entry, serves } of ENTRIES) {
    it(`${entry} imports only the binding and the pipe statically, and loads ${serves} after connecting`, () => {
      const source = readFileSync(join(HERE, entry), 'utf8');
      const imports = staticImports(source);
      // NOT EMPTY: a pattern that matched nothing would pass the subset check below over no imports.
      expect(imports).toContain('./hostNodeSurfaces.js');
      expect(imports.filter((specifier) => !LAUNCHER_MAY_IMPORT.has(specifier))).toStrictEqual([]);
      const { connect, load } = order(source, serves);
      expect(connect).toBeGreaterThan(-1);
      expect(load).toBeGreaterThan(connect);
    });
  }

  it('CONTROL: the entry as it was before ADR-0251 is refused by the same reading', () => {
    // THE SHAPE THE ENTRIES HAD: the serving modules imported statically and the pipe connected at the end.
    const before = [
      "import { mupdfWriter } from '../mupdfWriter.js';",
      "import { createEngineHandlers } from './engineHandlers.js';",
      "import { hostFilesystem, hostPipeStream } from './hostNodeSurfaces.js';",
      'startEngineHost(hostPipeStream(pipeName), dependencies, ended);',
    ].join('\n');
    expect(staticImports(before).filter((specifier) => !LAUNCHER_MAY_IMPORT.has(specifier))).toStrictEqual([
      '../mupdfWriter.js',
      './engineHandlers.js',
    ]);
    expect(order(before, './mupdfHostServe.js').load).toBe(-1);
  });
});
