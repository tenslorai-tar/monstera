// @ts-check
/**
 * Decodes one image with `sharp` in plain Node, for a kernel test running under the engine hosts' runtime.
 *
 * sharp declares itself possibly incompatible with Electron on Linux (its loader emits `SharpElectronLinux` there), and
 * a worker of `proof:hostruntime` died inside a sharp decode on main's CI at 2bd1e19e (2026-11-13), the decode being
 * the only thing in that case that was not the kernel's. So `decodeForTests.ts` sends the bytes here instead of loading
 * sharp into Electron. The image arrives on stdin; the answer is one JSON line.
 *
 * Usage: node scripts/lib/decodeImage.mjs [--ensure-alpha] < image
 */
import { readFileSync } from 'node:fs';

import sharp from 'sharp';

const input = readFileSync(0);
const image = process.argv.includes('--ensure-alpha') ? sharp(input).ensureAlpha() : sharp(input);
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
process.stdout.write(
  `${JSON.stringify({ width: info.width, height: info.height, channels: info.channels, data: data.toString('base64') })}\n`,
);
