import { MAX_RECENT_PREVIEW_BYTES } from '@monstera/contract';
import { asDocId } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type PictureFiles, createRecentPictures, pictureName } from './recentPictures.js';

const DOC = asDocId('doc-1');
const PATH = 'C:/Users/someone/Documents/Leases/harbor point.pdf';
const JPEG = Uint8Array.of(0xff, 0xd8, 0x02);

/** A folder in memory, holding what was written and nothing else. */
function folder(initial: Readonly<Record<string, Uint8Array<ArrayBuffer>>> = {}): PictureFiles & {
  readonly held: Map<string, Uint8Array<ArrayBuffer>>;
} {
  const held = new Map(Object.entries(initial));
  return {
    held,
    write: (name, bytes) => held.set(name, new Uint8Array(bytes)),
    read: (name) => held.get(name) ?? null,
    remove: (name) => held.delete(name),
    names: () => [...held.keys()],
  };
}

function pictures(options: {
  readonly files?: ReturnType<typeof folder>;
  readonly enabled?: () => boolean;
  readonly listed?: () => boolean;
  readonly picture?: () => Promise<Uint8Array>;
}) {
  const files = options.files ?? folder();
  const reported: string[] = [];
  const store = createRecentPictures({
    files,
    picture: options.picture ?? (() => Promise.resolve(JPEG)),
    enabled: options.enabled ?? (() => true),
    listed: options.listed ?? (() => true),
    notKept: (reason, detail) => reported.push(`${reason}:${detail}`),
  });
  return { store, files, reported };
}

describe('recent pictures (ADR-0100)', () => {
  it('keeps page 1’s picture for a listed file, and reads it back by path', async () => {
    const { store, files } = pictures({});

    await store.capture(DOC, PATH);

    expect(files.held.get(pictureName(PATH))).toStrictEqual(JPEG);
    expect(store.read(PATH)).toStrictEqual(JPEG);
  });

  it('a WRITE THAT FAILS is reported by the capture, which still resolves (CR-COR-02) — CONTROL: one that works reports nothing', async () => {
    // THE CALLER DOES NOT AWAIT A CAPTURE, so a throw from the write was a rejection nothing handled.
    const full = folder();
    const failing = pictures({
      files: {
        ...full,
        write: () => {
          throw Object.assign(new Error(`ENOSPC: no space left on device, open '${PATH}'`), { code: 'ENOSPC' });
        },
      },
    });
    await expect(failing.store.capture(DOC, PATH)).resolves.toBeUndefined();
    // THE CODE, never the message, which carries the path.
    expect(failing.reported).toStrictEqual(['failed:ENOSPC']);

    const working = pictures({});
    await working.store.capture(DOC, PATH);
    expect(working.reported).toStrictEqual([]);
  });

  it('names the file by a DIGEST, so the folder says nothing about the files it pictures', () => {
    const name = pictureName(PATH);
    expect(name).toMatch(/^[0-9a-f]{64}\.jpg$/u);
    expect(name).not.toContain('harbor');
  });

  it('makes nothing with the setting off — the picture is not even drawn', async () => {
    let drawn = 0;
    const { store, files } = pictures({
      enabled: () => false,
      picture: () => {
        drawn += 1;
        return Promise.resolve(JPEG);
      },
    });

    await store.capture(DOC, PATH);

    // THE CALL NOT MADE: an *off* that still drew the page and discarded it is the work the setting refuses.
    expect(drawn).toBe(0);
    expect(files.held.size).toBe(0);
  });

  it('keeps nothing for an entry that LEFT the list while its page was drawing', async () => {
    let listed = true;
    const { store, files } = pictures({
      listed: () => listed,
      picture: () => {
        listed = false;
        return Promise.resolve(JPEG);
      },
    });

    await store.capture(DOC, PATH);

    // A picture written now is one nothing would ever delete.
    expect(files.held.size).toBe(0);
  });

  it('keeps nothing when the setting went OFF while its page was drawing', async () => {
    // The check after the draw has two halves, and the case above reaches only `listed`. The setting is on
    // when the capture starts — so the check before the draw passes — and off when the picture arrives.
    let enabled = true;
    let drawn = 0;
    const { store, files } = pictures({
      enabled: () => enabled,
      picture: () => {
        drawn += 1;
        enabled = false;
        return Promise.resolve(JPEG);
      },
    });

    await store.capture(DOC, PATH);

    expect(drawn).toBe(1);
    expect(files.held.size).toBe(0);
  });

  it('keeps a picture exactly AT the bound — the bound is the largest allowed, not the first refused', async () => {
    const atBound = new Uint8Array(MAX_RECENT_PREVIEW_BYTES);
    const { store, files, reported } = pictures({ picture: () => Promise.resolve(atBound) });

    await store.capture(DOC, PATH);

    expect(files.held.get(pictureName(PATH))?.length).toBe(MAX_RECENT_PREVIEW_BYTES);
    expect(reported).toStrictEqual([]);
  });

  it('keeps nothing past the bound, and says so with the size rather than the path', async () => {
    const { store, files, reported } = pictures({
      picture: () => Promise.resolve(new Uint8Array(MAX_RECENT_PREVIEW_BYTES + 1)),
    });

    await store.capture(DOC, PATH);

    expect(files.held.size).toBe(0);
    expect(reported).toStrictEqual([`too-large:${String(MAX_RECENT_PREVIEW_BYTES + 1)}`]);
  });

  it('a picture that could not be drawn is reported by the error’s NAME, and nothing is kept', async () => {
    class DocumentPoisoned extends Error {
      override name = 'DocumentPoisonedError';
    }
    const { store, files, reported } = pictures({
      picture: () => Promise.reject(new DocumentPoisoned(`could not draw ${PATH}`)),
    });

    await store.capture(DOC, PATH);

    expect(files.held.size).toBe(0);
    // THE NAME, never the message, which here carries the path.
    expect(reported).toStrictEqual(['failed:DocumentPoisonedError']);
  });

  it('reads NOTHING with the setting off, even a picture still on disk', () => {
    const { store } = pictures({ files: folder({ [pictureName(PATH)]: JPEG }), enabled: () => false });
    expect(store.read(PATH)).toBeNull();
  });

  it('drops the pictures of entries that left, and only theirs', () => {
    const other = 'C:/Users/someone/Downloads/q3.pdf';
    const files = folder({ [pictureName(PATH)]: JPEG, [pictureName(other)]: JPEG });
    const { store } = pictures({ files });

    store.drop([PATH]);

    expect([...files.held.keys()]).toStrictEqual([pictureName(other)]);
  });

  it('turned OFF, a settings write deletes every picture — and leaves a file that is not one alone', () => {
    let enabled = true;
    const files = folder({ [pictureName(PATH)]: JPEG, 'desktop.ini': Uint8Array.of(1) });
    const { store } = pictures({ files, enabled: () => enabled });

    store.settingsWritten();
    // CONTROL: still on, a settings write deletes nothing.
    expect(files.held.size).toBe(2);

    enabled = false;
    store.settingsWritten();
    expect([...files.held.keys()]).toStrictEqual(['desktop.ini']);
  });

  describe('a removal’s save retakes the picture (ADR-0164)', () => {
    const BEFORE = Uint8Array.of(0xff, 0xd8, 0x01);

    it('replaces the picture of the page as it was with one of the page as saved', async () => {
      const { store, files } = pictures({ files: folder({ [pictureName(PATH)]: BEFORE }) });

      await store.retake(DOC, PATH);

      expect(files.held.get(pictureName(PATH))).toStrictEqual(JPEG);
    });

    it('DELETES FIRST, so a picture that cannot be drawn leaves the placeholder, never the old one', async () => {
      const { store, files, reported } = pictures({
        files: folder({ [pictureName(PATH)]: BEFORE }),
        picture: () => Promise.reject(new Error('the host is gone')),
      });

      await store.retake(DOC, PATH);

      expect(files.held.has(pictureName(PATH))).toBe(false);
      expect(reported).toStrictEqual(['failed:Error']);
    });

    it('CONTROL: a capture that cannot draw leaves the old picture, which is why the retake deletes first', async () => {
      const { store, files } = pictures({
        files: folder({ [pictureName(PATH)]: BEFORE }),
        picture: () => Promise.reject(new Error('the host is gone')),
      });

      await store.capture(DOC, PATH);

      expect(files.held.get(pictureName(PATH))).toStrictEqual(BEFORE);
    });

    it('a picture that could not be deleted is reported and nothing is drawn over it; the retake still resolves', async () => {
      let drawn = 0;
      const held = folder({ [pictureName(PATH)]: BEFORE });
      const { store, reported } = pictures({
        files: {
          ...held,
          remove: () => {
            throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${PATH}'`), { code: 'EBUSY' });
          },
        },
        picture: () => {
          drawn += 1;
          return Promise.resolve(JPEG);
        },
      });

      await expect(store.retake(DOC, PATH)).resolves.toBeUndefined();
      expect(reported).toStrictEqual(['failed:EBUSY']);
      expect(drawn).toBe(0);
    });
  });
});
