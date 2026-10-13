import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { fileTooLargeProblem, fileTooLargeProps, fileTooLargeValues } from './fileTooLarge.js';

/**
 * The one rendering of a refusal by size (the owner's O10): the file's own size beside the bound, in the units a person
 * reads, and never the same text for the two.
 */
describe('a refusal by size', () => {
  activateCatalogue('en', EN);
  const MIB = 1024 * 1024;

  it('names the file’s size AND the bound, each as a person reads a size', () => {
    expect(fileTooLargeValues(i18n, fileTooLargeProblem({ limitBytes: 64 * MIB, fileBytes: 71_200_000 }))).toStrictEqual({
      size: '67.9 MB',
      limit: '64 MB',
    });
  });

  it('CONTROL: a file just past the bound never reads as the bound, which a megabyte to one decimal would make it', () => {
    // 1 MiB + 20 KiB is "1 MB" beside "1 MB" at one decimal: a sentence refusing a file for being larger than itself.
    const values = fileTooLargeValues(i18n, fileTooLargeProblem({ limitBytes: MIB, fileBytes: MIB + 20 * 1024 }));
    expect(values.size).not.toBe(values.limit);
    expect(values).toStrictEqual({ size: '1,044 KB', limit: '1,024 KB' });
  });

  it('crosses both sizes, and a props object without the file’s size is refused', () => {
    expect(fileTooLargeProps.safeParse(fileTooLargeProblem({ limitBytes: MIB, fileBytes: 2 * MIB })).success).toBe(true);
    expect(fileTooLargeProps.safeParse({ reason: 'too-large', limitBytes: MIB }).success).toBe(false);
  });
});
