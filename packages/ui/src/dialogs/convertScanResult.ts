import { z } from 'zod';

/**
 * What a person chose to turn a scan into. Each is one of the commands the application already has; this dialog only says what
 * each does, in plain words, and sends the person to the one they pick. Its own module for the lazy body's reason.
 */
export const CONVERT_SCAN_OUTCOMES = ['searchable', 'word', 'excel'] as const;

export const CONVERT_SCAN_RESULT = z.object({ outcome: z.enum(CONVERT_SCAN_OUTCOMES) }).strict();

export type ConvertScanAnswer = z.infer<typeof CONVERT_SCAN_RESULT>;
