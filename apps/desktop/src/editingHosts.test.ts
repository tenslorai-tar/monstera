import { describe, expect, it } from 'vitest';

import { type StartReading, type StartsAhead, startEditingHosts } from './editingHosts.js';

/** A host that records who asked it to start, answering `reading` after `ms`. */
function host(reading: StartReading, ms = 0): StartsAhead & { readonly asked: string[]; startedAt: number | null } {
  const record = {
    asked: [] as string[],
    startedAt: null as number | null,
    starts: (asker: 'editing-mode'): Promise<StartReading> => {
      record.asked.push(asker);
      record.startedAt = performance.now();
      return new Promise((done) => {
        setTimeout(() => {
          done(reading);
        }, ms);
      });
    },
  };
  return record;
}

describe('startEditingHosts', () => {
  it('starts the compose host with the PDFium host, so the first write does not start it', async () => {
    const pdfium = host('started');
    const compose = host('started');
    await startEditingHosts(pdfium, compose);
    expect(pdfium.asked).toStrictEqual(['editing-mode']);
    // THE FINDING: left to the first write, ADR-0126's keeper started this host in 2.39 of the write's 2.55 s.
    expect(compose.asked).toStrictEqual(['editing-mode']);
  });

  it('starts both at once, so the mode waits for the slower and not the sum', async () => {
    const pdfium = host('started', 40);
    const compose = host('started', 40);
    const began = performance.now();
    await startEditingHosts(pdfium, compose);
    if (pdfium.startedAt === null || compose.startedAt === null) throw new Error('a host was not started');
    // BOTH ASKED BEFORE EITHER ANSWERED: in sequence the second would be asked 40 ms after the first.
    expect(Math.abs(compose.startedAt - pdfium.startedAt)).toBeLessThan(20);
    expect(performance.now() - began).toBeGreaterThanOrEqual(35);
  });

  it("answers the writer's start alone: a keeper that cannot start does not make editing unavailable", async () => {
    expect(await startEditingHosts(host('started'), host('cannot-start'))).toBe(true);
    expect(await startEditingHosts(host('cannot-start'), host('started'))).toBe(false);
    expect(await startEditingHosts(host('started'), null)).toBe(true);
  });

  // CONTROL: with no PDFium host there is no write for the keeper to precede, so nothing is started.
  it('answers false with no PDFium host, and starts no compose host for nothing', async () => {
    const compose = host('started');
    expect(await startEditingHosts(null, compose)).toBe(false);
    expect(compose.asked).toStrictEqual([]);
  });
});
