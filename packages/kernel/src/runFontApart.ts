import { createHash } from 'node:crypto';

import { type ApartWork, runApartSync } from './apart.js';
import type { DrawnGlyph } from './runFont.js';

/** One font of a read: its embedded program and what PDFium draws for each character the page sets in it. */
export interface RunFontRequest {
  readonly program: Uint8Array;
  readonly drawn: ReadonlyMap<number, DrawnGlyph>;
}

/** The run fonts' thread, taken by this asker and by `runFontWorker.ts`. */
export const RUN_FONTS: ApartWork<readonly RunFontRequest[], readonly (Uint8Array | null)[]> = {
  entry: new URL('./runFontWorker.js', import.meta.url),
  label: 'the run fonts',
};

/**
 * How many bytes of rebuilt fonts are kept for reads to come. A rebuilt run font measured 277 KB (a fully embedded
 * Carlito, 2026-10-14); this keeps about fifty, so a session editing a few documents re-reads none.
 */
export const RUN_FONT_CACHE_BYTES = 16 * 1024 * 1024;

/** Answers already made, by request, oldest first: a Map's order is its insertion order, and a hit is reinserted. */
const answers = new Map<string, Uint8Array | null>();
let cachedBytes = 0;

/** What a request is: its program and its drawn characters, in code point order, hashed. */
function keyOf(request: RunFontRequest): string {
  const hash = createHash('sha256').update(request.program);
  for (const [point, glyph] of [...request.drawn].sort((left, right) => left[0] - right[0])) {
    hash.update(JSON.stringify([point, glyph.advance, glyph.box, glyph.points]));
  }
  return hash.digest('hex');
}

function remember(key: string, answer: Uint8Array | null): void {
  answers.set(key, answer);
  cachedBytes += answer?.length ?? 0;
  for (const [oldest, kept] of answers) {
    if (cachedBytes <= RUN_FONT_CACHE_BYTES) break;
    answers.delete(oldest);
    cachedBytes -= kept?.length ?? 0;
  }
}

/** Forgets every answer, for a proof that must see a read reach the thread. */
export function forgetRunFonts(): void {
  answers.clear();
  cachedBytes = 0;
}

/**
 * `runFontFor` for every font of one read
 * ([ADR-0239](../../../docs/DECISIONS/0239-a-fonts-whole-file-is-read-in-a-thread-that-ends.md), its addendum).
 *
 * A FONT NOT SEEN BEFORE is rebuilt in ONE thread that ends after the read's new fonts: each program is read through
 * HarfBuzz there, and what that keeps goes with the thread. Measured 2026-10-14, the read serving each edit held about
 * 96 MB of HarfBuzz memory in the PDFium host, which is the owner's 81 to 184 MB.
 *
 * A FONT SEEN BEFORE is answered from what was made for it, which is plain bytes: the editor asks for the same block's
 * fonts after every edit, and a thread per read cost what the HarfBuzz memory did (measured: +362 MB over sixty reads in
 * this container, most of it the allocator's per-thread arenas).
 *
 * Answers in the order asked, `null` where a font has no rebuild.
 *
 * @param started given the thread where one starts, for a proof that must see which reads reach it
 */
export function runFontsApart(requests: readonly RunFontRequest[], started?: () => void): readonly (Uint8Array | null)[] {
  const keys = requests.map(keyOf);
  // THIS READ'S ANSWERS, held here: a read whose own new fonts outgrow the cache must still be answered whole.
  const read = new Map<string, Uint8Array | null>();
  for (const key of keys) {
    if (!answers.has(key)) continue;
    read.set(key, answers.get(key) ?? null);
    // MOST RECENTLY USED moves to the end, so the oldest is the one forgotten.
    answers.delete(key);
    answers.set(key, read.get(key) ?? null);
  }
  /** Each font not answered before, once, by its key. */
  const unseen = new Map<string, RunFontRequest>();
  for (const [at, key] of keys.entries()) {
    const request = requests[at];
    if (request !== undefined && !read.has(key) && !unseen.has(key)) unseen.set(key, request);
  }
  const missing = [...unseen.keys()];
  if (missing.length > 0) {
    started?.();
    const made = runApartSync(RUN_FONTS, [...unseen.values()]);
    for (const [at, key] of missing.entries()) {
      read.set(key, made[at] ?? null);
      remember(key, made[at] ?? null);
    }
  }
  return keys.map((key) => read.get(key) ?? null);
}
